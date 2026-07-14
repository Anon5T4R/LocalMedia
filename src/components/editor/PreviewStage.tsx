// Preview do projeto: um elemento <video>/<img> por clipe de vídeo ativo no
// playhead, empilhados na ordem das trilhas (camadas) e posicionados como na
// exportação; o áudio das trilhas toca por <audio> invisíveis. Scrub busca o
// tempo; play avança o playhead com rAF e corrige a deriva dos elementos.

import { useEffect, useRef } from "react";
import { fileSrc } from "../../lib/backend";
import {
  clipEndMs,
  isVideoKind,
  projectDurMs,
  type Clip,
} from "../../lib/editor/model";
import { useEditor } from "../../state/editor";

function isActive(c: Clip, tMs: number): boolean {
  return tMs >= c.startMs && tMs < clipEndMs(c);
}

export default function PreviewStage() {
  const clips = useEditor((s) => s.clips);
  const project = useEditor((s) => s.project);
  const playheadMs = useEditor((s) => s.playheadMs);
  const playing = useEditor((s) => s.playing);
  const setPlaying = useEditor((s) => s.setPlaying);

  const refs = useRef(new Map<string, HTMLMediaElement>());
  const setRef = (id: string) => (el: HTMLMediaElement | null) => {
    if (el) refs.current.set(id, el);
    else refs.current.delete(id);
  };

  const activeVideo = clips
    .filter((c) => isVideoKind(c.kind) && isActive(c, playheadMs))
    .sort((a, b) => a.track - b.track);
  const activeAudio = clips.filter(
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
  }, [playing, setPlaying]);

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

  function layerStyle(c: Clip): React.CSSProperties {
    const fx: React.CSSProperties = {};
    if (c.opacity < 1) fx.opacity = c.opacity;
    const t: string[] = [];
    if (c.rotation !== 0) t.push(`rotate(${c.rotation}deg)`);
    if (c.flipH) t.push("scaleX(-1)");
    if (t.length > 0) fx.transform = t.join(" ");
    if (c.fit === "cheia") {
      return { inset: 0, width: "100%", height: "100%", objectFit: "contain", ...fx };
    }
    return { left: `${c.x * 100}%`, top: `${c.y * 100}%`, width: `${c.w * 100}%`, ...fx };
  }

  // Aproximação do drawtext: fonte = fração da altura do palco (que em CSS é
  // min(36vh, 330px) — manter em sincronia com .preview-stage no App.css).
  function textStyle(c: Clip): React.CSSProperties {
    return {
      left: `${c.x * 100}%`,
      top: `${c.y * 100}%`,
      fontSize: `calc(min(36vh, 330px) * ${c.textSize})`,
      color: c.textColor,
      opacity: c.opacity,
      background: c.textBox ? "rgba(0, 0, 0, 0.45)" : "transparent",
    };
  }

  return (
    <div className="preview-wrap">
      <div className="preview-stage" style={{ aspectRatio: `${project.width} / ${project.height}` }}>
        {activeVideo.length === 0 && <div className="preview-empty">▶</div>}
        {activeVideo.map((c) =>
          c.kind === "text" ? (
            <div key={c.id} className="preview-layer preview-text" style={textStyle(c)}>
              {c.text}
            </div>
          ) : c.kind === "image" ? (
            <img
              key={c.id}
              className="preview-layer"
              style={layerStyle(c)}
              src={fileSrc(c.src.path) || undefined}
              alt=""
              draggable={false}
            />
          ) : (
            <video
              key={c.id}
              ref={setRef(c.id) as React.Ref<HTMLVideoElement>}
              className="preview-layer"
              style={layerStyle(c)}
              src={fileSrc(c.src.path) || undefined}
              muted
              playsInline
              preload="auto"
            />
          ),
        )}
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
