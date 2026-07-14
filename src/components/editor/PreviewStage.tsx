// Preview do projeto (monitor de programa): um elemento por clipe de vídeo
// ativo no playhead, empilhados na ordem das trilhas e posicionados como na
// exportação. Camadas de posição livre e títulos podem ser ARRASTADOS com o
// mouse (e redimensionados pela alça), como nos editores profissionais.
// Trilha oculta some daqui; mudo/solo valem pro áudio. Scrub busca o tempo;
// play avança o playhead com rAF e corrige a deriva dos elementos.

import { useEffect, useRef } from "react";
import { fileSrc } from "../../lib/backend";
import {
  clipEndMs,
  isVideoKind,
  projectDurMs,
  visibleClips,
  type Clip,
} from "../../lib/editor/model";
import { useEditor } from "../../state/editor";

function isActive(c: Clip, tMs: number): boolean {
  return tMs >= c.startMs && tMs < clipEndMs(c);
}

interface StageDrag {
  pointerId: number;
  clipId: string;
  mode: "move" | "resize";
  origX: number;
  origY: number;
  origW: number;
  startClientX: number;
  startClientY: number;
}

export default function PreviewStage() {
  const clips = useEditor((s) => s.clips);
  const vTracks = useEditor((s) => s.vTracks);
  const aTracks = useEditor((s) => s.aTracks);
  const project = useEditor((s) => s.project);
  const playheadMs = useEditor((s) => s.playheadMs);
  const playing = useEditor((s) => s.playing);
  const selectedId = useEditor((s) => s.selectedId);
  const select = useEditor((s) => s.select);
  const setRect = useEditor((s) => s.setRect);
  const beginGesture = useEditor((s) => s.beginGesture);

  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<StageDrag | null>(null);
  const refs = useRef(new Map<string, HTMLMediaElement>());
  const setRef = (id: string) => (el: HTMLMediaElement | null) => {
    if (el) refs.current.set(id, el);
    else refs.current.delete(id);
  };

  const visible = visibleClips(clips, vTracks, aTracks);
  const activeVideo = visible
    .filter((c) => isVideoKind(c.kind) && isActive(c, playheadMs))
    .sort((a, b) => a.track - b.track);
  const activeAudio = visible.filter(
    (c) => c.kind === "audio" && !c.muted && c.gain > 0 && isActive(c, playheadMs),
  );

  // Relógio do play: avança o playhead e para no fim do projeto.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const st = useEditor.getState();
      const dt = now - last;
      last = now;
      const dur = projectDurMs(st.clips);
      const next = st.playheadMs + dt;
      if (next >= dur) {
        st.setPlayhead(dur);
        st.setPlaying(false);
        return;
      }
      st.setPlayhead(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // Sincroniza os elementos de mídia com o playhead (a cada render).
  useEffect(() => {
    const t = playheadMs;
    for (const c of [...activeVideo, ...activeAudio]) {
      if (c.kind === "image" || c.kind === "text") continue;
      const el = refs.current.get(c.id);
      if (!el) continue;
      // Clipe acelerado consome a fonte speed× mais rápido que a timeline.
      const want = (c.inMs + (t - c.startMs) * c.speed) / 1000;
      if (c.kind === "audio") el.volume = Math.min(1, c.gain);
      el.playbackRate = c.speed;
      if (playing) {
        if (el.paused) void el.play().catch(() => {});
        if (Math.abs(el.currentTime - want) > 0.25) el.currentTime = want;
      } else {
        if (!el.paused) el.pause();
        if (Math.abs(el.currentTime - want) > 0.05) el.currentTime = want;
      }
    }
  });

  // Pausa tudo quando o play desliga (elementos que continuam montados).
  useEffect(() => {
    if (playing) return;
    for (const el of refs.current.values()) {
      if (!el.paused) el.pause();
    }
  }, [playing]);

  // ---- arrastar camadas no palco (mover posição livre / redimensionar).

  function canDrag(c: Clip): boolean {
    return c.kind === "text" || c.fit === "custom";
  }

  function onBoxPointerDown(e: React.PointerEvent, c: Clip, mode: StageDrag["mode"]) {
    e.stopPropagation();
    select(c.id);
    if (mode === "move" && !canDrag(c)) return;
    beginGesture();
    dragRef.current = {
      pointerId: e.pointerId,
      clipId: c.id,
      mode,
      origX: c.x,
      origY: c.y,
      origW: c.w,
      startClientX: e.clientX,
      startClientY: e.clientY,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onBoxPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    const stage = stageRef.current;
    if (!d || e.pointerId !== d.pointerId || !stage) return;
    const r = stage.getBoundingClientRect();
    const dx = (e.clientX - d.startClientX) / r.width;
    const dy = (e.clientY - d.startClientY) / r.height;
    if (d.mode === "move") {
      setRect(d.clipId, { x: d.origX + dx, y: d.origY + dy });
    } else {
      setRect(d.clipId, { w: d.origW + dx });
    }
  }

  function onBoxPointerUp(e: React.PointerEvent) {
    if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null;
  }

  function boxStyle(c: Clip): React.CSSProperties {
    const fx: React.CSSProperties = {};
    if (c.opacity < 1) fx.opacity = c.opacity;
    const t: string[] = [];
    if (c.rotation !== 0) t.push(`rotate(${c.rotation}deg)`);
    if (c.flipH) t.push("scaleX(-1)");
    if (t.length > 0) fx.transform = t.join(" ");
    if (c.kind !== "text" && c.fit === "cheia") {
      return { inset: 0, width: "100%", height: "100%", ...fx };
    }
    if (c.kind === "text") {
      return { left: `${c.x * 100}%`, top: `${c.y * 100}%`, opacity: c.opacity };
    }
    return { left: `${c.x * 100}%`, top: `${c.y * 100}%`, width: `${c.w * 100}%`, ...fx };
  }

  return (
    <div className="preview-wrap">
      <div
        className="preview-stage"
        ref={stageRef}
        style={{ aspectRatio: `${project.width} / ${project.height}` }}
      >
        {activeVideo.length === 0 && <div className="preview-empty">▶</div>}
        {activeVideo.map((c) => (
          <div
            key={c.id}
            className={`layer-box ${selectedId === c.id ? "selected" : ""} ${canDrag(c) ? "draggable" : ""}`}
            style={boxStyle(c)}
            onPointerDown={(e) => onBoxPointerDown(e, c, "move")}
            onPointerMove={onBoxPointerMove}
            onPointerUp={onBoxPointerUp}
          >
            {c.kind === "text" ? (
              <div
                className="preview-text"
                style={{
                  fontSize: `calc(min(36vh, 330px) * ${c.textSize})`,
                  color: c.textColor,
                  background: c.textBox ? "rgba(0, 0, 0, 0.45)" : "transparent",
                }}
              >
                {c.text}
              </div>
            ) : c.kind === "image" ? (
              <img src={fileSrc(c.src.path) || undefined} alt="" draggable={false} />
            ) : (
              <video
                ref={setRef(c.id) as React.Ref<HTMLVideoElement>}
                src={fileSrc(c.src.path) || undefined}
                muted
                playsInline
                preload="auto"
              />
            )}
            {selectedId === c.id && c.kind !== "text" && c.fit === "custom" && (
              <span
                className="layer-resize"
                title="Arraste pra redimensionar"
                onPointerDown={(e) => onBoxPointerDown(e, c, "resize")}
                onPointerMove={onBoxPointerMove}
                onPointerUp={onBoxPointerUp}
              />
            )}
          </div>
        ))}
        {activeAudio.map((c) => (
          <audio
            key={c.id}
            ref={setRef(c.id) as React.Ref<HTMLAudioElement>}
            src={fileSrc(c.src.path) || undefined}
            preload="auto"
          />
        ))}
      </div>
    </div>
  );
}
