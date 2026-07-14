// Timeline multi-faixa com cara de NLE: coluna de cabeçalhos por trilha
// (ocultar vídeo, mudo/solo de áudio), trilhas de vídeo em camadas (V2 acima
// de V1), clipes arrastáveis (com snap opcional e troca de trilha) e alças de
// aparar. Toda a matemática de limite mora em lib/editor/model.
//
// O App usa `resolveDropTarget` pra descobrir em que trilha/tempo um arquivo
// foi solto (drag & drop mira a trilha, como nos editores profissionais).

import { useEffect, useRef } from "react";
import {
  clipDurMs,
  isVideoKind,
  projectDurMs,
  snapMs,
  snapTargets,
  type Clip,
} from "../../lib/editor/model";
import { fileSrc } from "../../lib/backend";
import { fmtDur } from "../../lib/time";
import { useEditor, type DropTarget } from "../../state/editor";

const ROW_H = 48;
const SNAP_PX = 8;

// Hit-test do drop de arquivos (registrado enquanto a Timeline está montada).
let dropResolver: ((clientX: number, clientY: number) => DropTarget | null) | null = null;

export function resolveDropTarget(clientX: number, clientY: number): DropTarget | null {
  return dropResolver ? dropResolver(clientX, clientY) : null;
}

interface Drag {
  pointerId: number;
  clipId: string;
  mode: "move" | "in" | "out";
  grabOffsetMs: number;
  origTrack: number;
  startY: number;
  kind: "video" | "audio";
}

export default function Timeline() {
  const clips = useEditor((s) => s.clips);
  const vTracks = useEditor((s) => s.vTracks);
  const aTracks = useEditor((s) => s.aTracks);
  const selectedId = useEditor((s) => s.selectedId);
  const thumbs = useEditor((s) => s.thumbs);
  const playheadMs = useEditor((s) => s.playheadMs);
  const pxPerSec = useEditor((s) => s.pxPerSec);
  const snapOn = useEditor((s) => s.snapOn);
  const select = useEditor((s) => s.select);
  const setPlayhead = useEditor((s) => s.setPlayhead);
  const setPlaying = useEditor((s) => s.setPlaying);
  const beginGesture = useEditor((s) => s.beginGesture);
  const move = useEditor((s) => s.move);
  const trim = useEditor((s) => s.trim);
  const toggleTrackHidden = useEditor((s) => s.toggleTrackHidden);
  const toggleTrackMuted = useEditor((s) => s.toggleTrackMuted);
  const toggleTrackSolo = useEditor((s) => s.toggleTrackSolo);

  const wrapRef = useRef<HTMLDivElement>(null);
  const headsRef = useRef<HTMLDivElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);

  const pxPerMs = pxPerSec / 1000;
  const durMs = projectDurMs(clips);
  const totalMs = Math.max(durMs + 3000, 15_000);
  const widthPx = totalMs * pxPerMs;

  const rows: { kind: "video" | "audio"; track: number }[] = [];
  for (let t = vTracks.length - 1; t >= 0; t--) rows.push({ kind: "video", track: t });
  for (let t = 0; t < aTracks.length; t++) rows.push({ kind: "audio", track: t });

  // Zoom com Ctrl+roda (listener nativo: o onWheel do React é passivo).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const s = useEditor.getState();
      s.setZoom(s.pxPerSec * (e.deltaY < 0 ? 1.25 : 0.8));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Hit-test pro drop de arquivos: descobre trilha e tempo pela posição.
  useEffect(() => {
    dropResolver = (clientX, clientY) => {
      const rowsEl = rowsRef.current;
      if (!rowsEl) return null;
      const pms = useEditor.getState().pxPerSec / 1000;
      for (const el of rowsEl.querySelectorAll<HTMLElement>(".tl-row")) {
        const r = el.getBoundingClientRect();
        if (clientY >= r.top && clientY < r.bottom) {
          const group = el.dataset.kind === "audio" ? "audio" : "video";
          const track = Number(el.dataset.track ?? 0);
          const ms = Math.max(0, (clientX - r.left) / pms);
          return { group, track, ms };
        }
      }
      return null;
    };
    return () => {
      dropResolver = null;
    };
  }, []);

  function msAt(clientX: number): number {
    const rect = rowsRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.max(0, (clientX - rect.left) / pxPerMs);
  }

  function snappedStart(clip: Clip, desired: number): number {
    if (!snapOn) return desired;
    const targets = snapTargets(clips, clip.id, playheadMs);
    const tol = SNAP_PX / pxPerMs;
    const dur = clipDurMs(clip);
    const byStart = snapMs(desired, targets, tol);
    if (byStart !== desired) return byStart;
    const byEnd = snapMs(desired + dur, targets, tol) - dur;
    return byEnd;
  }

  function onClipPointerDown(e: React.PointerEvent, clip: Clip, mode: Drag["mode"]) {
    e.stopPropagation();
    select(clip.id);
    setPlaying(false);
    beginGesture();
    dragRef.current = {
      pointerId: e.pointerId,
      clipId: clip.id,
      mode,
      grabOffsetMs: msAt(e.clientX) - clip.startMs,
      origTrack: clip.track,
      startY: e.clientY,
      kind: isVideoKind(clip.kind) ? "video" : "audio",
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onClipPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const cur = useEditor.getState().clips.find((c) => c.id === d.clipId);
    if (!cur) return;
    if (d.mode === "move") {
      const desired = snappedStart(cur, msAt(e.clientX) - d.grabOffsetMs);
      // Nas trilhas de vídeo a camada de cima vem primeiro (subir = track+1).
      const dRows = Math.round((e.clientY - d.startY) / ROW_H);
      const track = d.origTrack + (d.kind === "video" ? -dRows : dRows);
      move(d.clipId, desired, track);
    } else {
      const desired = snapOn
        ? snapMs(msAt(e.clientX), snapTargets(clips, d.clipId, playheadMs), SNAP_PX / pxPerMs)
        : msAt(e.clientX);
      trim(d.clipId, d.mode, desired);
    }
  }

  function onClipPointerUp(e: React.PointerEvent) {
    if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null;
  }

  function onRulerPointerDown(e: React.PointerEvent) {
    setPlaying(false);
    setPlayhead(msAt(e.clientX));
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onRulerPointerMove(e: React.PointerEvent) {
    if (e.buttons & 1) setPlayhead(msAt(e.clientX));
  }

  function onRowPointerDown(e: React.PointerEvent) {
    // Clique no vazio da trilha: solta a seleção e posiciona o cursor.
    select("");
    setPlaying(false);
    setPlayhead(msAt(e.clientX));
  }

  // Régua adaptativa: menor passo cujo espaçamento fique legível.
  const step =
    [200, 500, 1000, 2000, 5000, 10_000, 30_000, 60_000, 300_000].find(
      (s) => s * pxPerMs >= 70,
    ) ?? 300_000;
  const ticks: number[] = [];
  for (let t = 0; t <= totalMs; t += step) ticks.push(t);

  function rowClips(kind: "video" | "audio", track: number): Clip[] {
    return clips.filter(
      (c) => (kind === "video" ? isVideoKind(c.kind) : c.kind === "audio") && c.track === track,
    );
  }

  return (
    <div className="tl2">
      <div className="tl2-heads-clip">
        <div className="tl2-heads" ref={headsRef}>
          <div className="tl2-head-ruler" />
          {rows.map(({ kind, track }) => (
            <div key={`${kind}${track}`} className="tl2-head" style={{ height: `${ROW_H}px` }}>
              <span className="tl2-head-name">
                {kind === "video" ? `V${track + 1}` : `A${track + 1}`}
              </span>
              {kind === "video" ? (
                <button
                  className={`tl2-tbtn ${vTracks[track]?.hidden ? "off" : ""}`}
                  title={vTracks[track]?.hidden ? "Trilha oculta — clique pra mostrar" : "Ocultar trilha (fica fora do preview e da exportação)"}
                  onClick={() => toggleTrackHidden(track)}
                >
                  {vTracks[track]?.hidden ? "🚫" : "👁"}
                </button>
              ) : (
                <>
                  <button
                    className={`tl2-tbtn ${aTracks[track]?.muted ? "active-m" : ""}`}
                    title="Mudo (M): silencia esta faixa"
                    onClick={() => toggleTrackMuted(track)}
                  >
                    M
                  </button>
                  <button
                    className={`tl2-tbtn ${aTracks[track]?.solo ? "active-s" : ""}`}
                    title="Solo (S): só as faixas em solo tocam"
                    onClick={() => toggleTrackSolo(track)}
                  >
                    S
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      <div
        className="tl"
        ref={wrapRef}
        onScroll={(e) => {
          if (headsRef.current) {
            headsRef.current.style.transform = `translateY(-${(e.target as HTMLElement).scrollTop}px)`;
          }
        }}
      >
        <div className="tl-inner" style={{ width: `${widthPx}px` }}>
          <div
            className="tl-ruler"
            onPointerDown={onRulerPointerDown}
            onPointerMove={onRulerPointerMove}
          >
            {ticks.map((t) => (
              <div key={t} className="tl-tick" style={{ left: `${t * pxPerMs}px` }}>
                {fmtDur(t)}
              </div>
            ))}
            <div className="tl-ph-handle" style={{ left: `${playheadMs * pxPerMs}px` }} />
          </div>
          <div className="tl-rows" ref={rowsRef}>
            {rows.map(({ kind, track }) => (
              <div
                key={`${kind}${track}`}
                className={`tl-row ${kind} ${kind === "video" && vTracks[track]?.hidden ? "dimmed" : ""}`}
                data-kind={kind}
                data-track={track}
                style={{ height: `${ROW_H}px` }}
                onPointerDown={onRowPointerDown}
              >
                {rowClips(kind, track).map((c) => (
                  <div
                    key={c.id}
                    className={`tl-clip clip-${c.kind} ${selectedId === c.id ? "selected" : ""} ${c.muted ? "muted" : ""} ${c.kind === "video" && thumbs[c.src.path] ? "has-thumb" : ""}`}
                    style={{
                      left: `${c.startMs * pxPerMs}px`,
                      width: `${Math.max(4, clipDurMs(c) * pxPerMs)}px`,
                      ...(c.kind === "video" && thumbs[c.src.path]
                        ? { backgroundImage: `url("${fileSrc(thumbs[c.src.path])}")` }
                        : {}),
                    }}
                    onPointerDown={(e) => onClipPointerDown(e, c, "move")}
                    onPointerMove={onClipPointerMove}
                    onPointerUp={onClipPointerUp}
                  >
                    <span className="tl-clip-name">
                      {c.linkId && <span title="vinculado ao par áudio/vídeo">🔗 </span>}
                      {c.muted && "🔇 "}
                      {c.speed !== 1 && `${c.speed}× `}
                      {c.kind === "text" ? `𝐓 ${c.text || "Título"}` : c.src.name}
                    </span>
                    <span
                      className="tl-handle left"
                      onPointerDown={(e) => onClipPointerDown(e, c, "in")}
                    />
                    <span
                      className="tl-handle right"
                      onPointerDown={(e) => onClipPointerDown(e, c, "out")}
                    />
                  </div>
                ))}
              </div>
            ))}
            <div className="tl-playhead" style={{ left: `${playheadMs * pxPerMs}px` }} />
            {durMs > 0 && <div className="tl-end" style={{ left: `${durMs * pxPerMs}px` }} />}
          </div>
        </div>
      </div>
    </div>
  );
}
