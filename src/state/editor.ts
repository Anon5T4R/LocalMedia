// Estado do editor: projeto, clipes, trilhas, playhead e as ações da timeline.
// As operações pesadas são puras (lib/editor/model.ts); aqui fica a cola:
// gestos com undo/redo, importação/colocação de mídia (inclusive soltar na
// trilha certa), trilhas com ocultar/mudo/solo e exportação pra fila.

import { create } from "zustand";
import { open, save } from "@tauri-apps/plugin-dialog";
import * as be from "../lib/backend";
import { parseProbe } from "../lib/probe";
import {
  CLIP_DEFAULTS,
  bestGapStart,
  clipDurMs,
  clipEndMs,
  defaultAudioTrack,
  defaultVideoTrack,
  isVideoKind,
  moveClip,
  projectDurMs,
  rippleDelete,
  setClipSpeed,
  splitClip,
  trackClips,
  trimClip,
  visibleClips,
  type AudioTrackOpts,
  type Clip,
  type ProjectSettings,
  type VideoTrackOpts,
} from "../lib/editor/model";
import { buildTimelineExport } from "../lib/editor/render";
import { IMAGE_EXTENSIONS, type MediaInfo } from "../lib/types";
import { useStore } from "./store";
import { useUi } from "./ui";

function newId(): string {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

function extOf(path: string): string {
  return path.split(".").pop()?.toLowerCase() ?? "";
}

function stemDir(path: string): string {
  const norm = path.replace(/\\/g, "/");
  const idx = norm.lastIndexOf("/");
  return idx > 0 ? path.slice(0, idx) : path;
}

const IS_WINDOWS = navigator.userAgent.includes("Windows");
const SEP = IS_WINDOWS ? "\\" : "/";
const MAX_TRACKS = 4;
const IMAGE_DEFAULT_MS = 5000;
const TEXT_DEFAULT_MS = 4000;
const AUTOSAVE_KEY = "editor-autosave-v1";

/** Onde um arquivo foi solto na timeline (hit-test feito pela Timeline). */
export interface DropTarget {
  group: "video" | "audio";
  track: number;
  ms: number;
}

/** Formato do arquivo de projeto (.json) e do autosave. A v1 guardava só a
 *  contagem de trilhas; a v2 guarda o estado (ocultar/mudo/solo) de cada uma. */
interface ProjectFile {
  version: 2;
  project: ProjectSettings;
  exportCrf: number;
  vTracks: VideoTrackOpts[];
  aTracks: AudioTrackOpts[];
  clips: Clip[];
}

/** Reconstrói clipes de um projeto salvo, preenchendo campos que versões
 *  futuras adicionarem (defaults) e descartando lixo óbvio. */
function sanitizeClips(raw: unknown): Clip[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Clip[])
    .filter((c) => c && typeof c === "object" && typeof c.id === "string" && c.src)
    .map((c) => ({ ...CLIP_DEFAULTS, ...c }));
}

/** Lê as trilhas de um projeto salvo, migrando o formato v1 (contagens). */
function sanitizeTracks(raw: {
  vTracks?: unknown;
  aTracks?: unknown;
  videoTracks?: unknown;
  audioTracks?: unknown;
}): { vTracks: VideoTrackOpts[]; aTracks: AudioTrackOpts[] } {
  const clampLen = (n: unknown) => Math.max(1, Math.min(MAX_TRACKS, Number(n) || 1));
  const vTracks = Array.isArray(raw.vTracks)
    ? raw.vTracks.slice(0, MAX_TRACKS).map((t) => ({ ...defaultVideoTrack(), ...t }))
    : Array.from({ length: clampLen(raw.videoTracks) }, defaultVideoTrack);
  const aTracks = Array.isArray(raw.aTracks)
    ? raw.aTracks.slice(0, MAX_TRACKS).map((t) => ({ ...defaultAudioTrack(), ...t }))
    : Array.from({ length: clampLen(raw.audioTracks) }, defaultAudioTrack);
  return {
    vTracks: vTracks.length > 0 ? vTracks : [defaultVideoTrack()],
    aTracks: aTracks.length > 0 ? aTracks : [defaultAudioTrack()],
  };
}

interface Snapshot {
  clips: Clip[];
  vTracks: VideoTrackOpts[];
  aTracks: AudioTrackOpts[];
}

interface EditorState {
  project: ProjectSettings;
  clips: Clip[];
  vTracks: VideoTrackOpts[];
  aTracks: AudioTrackOpts[];
  selectedId: string;
  playheadMs: number;
  playing: boolean;
  pxPerSec: number;
  snapOn: boolean;
  /** Área de transferência de clipes (Ctrl+C/Ctrl+V). */
  clipboard: Clip[];
  /** Miniatura por caminho de fonte (pros blocos da timeline). */
  thumbs: Record<string, string>;
  /** CRF da exportação (18 máxima · 20 alta · 26 compacta). */
  exportCrf: number;
  undoStack: Snapshot[];
  redoStack: Snapshot[];

  addMediaPaths(paths: string[]): Promise<void>;
  /** Igual ao addMediaPaths, mas mirando trilha/tempo (soltar na timeline). */
  addMediaPathsAt(paths: string[], target?: DropTarget): Promise<void>;
  select(id: string): void;
  setPlayhead(ms: number): void;
  setPlaying(playing: boolean): void;
  setZoom(pxPerSec: number): void;
  toggleSnap(): void;

  /** Chamar UMA vez no início de um gesto de arrastar/aparar (grava o undo). */
  beginGesture(): void;
  move(id: string, desiredStartMs: number, toTrack?: number): void;
  trim(id: string, edge: "in" | "out", desiredMs: number): void;

  splitAtPlayhead(): void;
  removeSelected(): void;
  /** Remove e fecha o buraco (montagem — Shift+Delete). */
  rippleRemoveSelected(): void;
  unlinkSelected(): void;
  duplicateSelected(): void;
  copySelected(): void;
  pasteAtPlayhead(): void;
  setGain(id: string, gain: number): void;
  toggleMute(id: string): void;
  setFit(id: string, fit: Clip["fit"]): void;
  setRect(id: string, patch: Partial<Pick<Clip, "x" | "y" | "w">>): void;
  setSpeed(id: string, speed: number): void;
  setFade(id: string, patch: Partial<Pick<Clip, "fadeInMs" | "fadeOutMs">>): void;
  setOpacity(id: string, opacity: number): void;
  setRotation(id: string, rotation: Clip["rotation"]): void;
  toggleFlipH(id: string): void;
  addTextClip(): void;
  setTextProps(
    id: string,
    patch: Partial<Pick<Clip, "text" | "textSize" | "textColor" | "textBox">>,
  ): void;
  setProject(patch: Partial<ProjectSettings>): void;
  setExportCrf(crf: number): void;
  addTrack(kind: "video" | "audio"): void;
  /** Remove a trilha de cima do grupo, se estiver vazia. */
  removeTrack(kind: "video" | "audio"): void;
  toggleTrackHidden(track: number): void;
  toggleTrackMuted(track: number): void;
  toggleTrackSolo(track: number): void;
  clearProject(): void;

  undo(): void;
  redo(): void;
  exportProject(): Promise<void>;
  saveProjectAs(): Promise<void>;
  openProjectFile(): Promise<void>;
}

function snap(s: EditorState): Snapshot {
  return { clips: s.clips, vTracks: s.vTracks, aTracks: s.aTracks };
}

/** Fim da trilha (onde um clipe novo deve ser anexado). */
function trackEndMs(clips: Clip[], kind: "video" | "audio", track: number): number {
  return trackClips(clips, kind, track).reduce((acc, c) => Math.max(acc, clipEndMs(c)), 0);
}

/** Há espaço livre em [startMs, startMs+durMs) nessa trilha? */
function fitsAt(
  clips: Clip[],
  kind: "video" | "audio",
  track: number,
  startMs: number,
  durMs: number,
): boolean {
  return !trackClips(clips, kind, track).some(
    (c) => c.startMs < startMs + durMs && clipEndMs(c) > startMs,
  );
}

/** Busca a miniatura de uma fonte de vídeo em segundo plano (best-effort). */
function requestThumb(path: string, durationMs: number) {
  const st = useEditor.getState();
  if (st.thumbs[path] !== undefined || durationMs <= 0) return;
  be.thumbnails(newId() + "-tl", path, 1, durationMs)
    .then((t) => {
      if (t[0]) useEditor.setState((s) => ({ thumbs: { ...s.thumbs, [path]: t[0] } }));
    })
    .catch(() => {});
}

export const useEditor = create<EditorState>((set, get) => ({
  project: { width: 1280, height: 720, fps: 30 },
  clips: [],
  vTracks: [defaultVideoTrack()],
  aTracks: [defaultAudioTrack()],
  selectedId: "",
  playheadMs: 0,
  playing: false,
  pxPerSec: 60,
  snapOn: true,
  clipboard: [],
  thumbs: {},
  exportCrf: 20,
  undoStack: [],
  redoStack: [],

  async addMediaPaths(paths) {
    return get().addMediaPathsAt(paths);
  },

  async addMediaPathsAt(paths, target) {
    const toast = useUi.getState().toast;
    for (const path of paths) {
      let info: MediaInfo;
      try {
        info = parseProbe(path, await be.mediaProbe(path));
      } catch (e) {
        toast("error", `${path.split(/[\\/]/).pop()}: ${e}`);
        continue;
      }
      const isImage = IMAGE_EXTENSIONS.includes(extOf(path));
      const hasVideo = !isImage && info.video !== null && info.durationMs > 0;
      const hasAudio = !isImage && info.audio.length > 0 && info.durationMs > 0;
      if (!isImage && !hasVideo && !hasAudio) {
        toast("error", `${info.name}: sem vídeo nem áudio utilizável.`);
        continue;
      }
      const s = get();
      const src = {
        path,
        name: info.name,
        durationMs: isImage ? 0 : info.durationMs,
        width: info.video?.width ?? 0,
        height: info.video?.height ?? 0,
      };
      if (hasVideo) requestThumb(path, info.durationMs);
      const common = {
        src,
        gain: 1,
        muted: false,
        fit: "cheia" as const,
        x: 0,
        y: 0,
        w: 1,
        ...CLIP_DEFAULTS,
      };
      const pip = { fit: "custom" as const, x: 0.6, y: 0.05, w: 0.35 };

      const added: Clip[] = [];
      let vTracks = s.vTracks;
      let aTracks = s.aTracks;

      // Primeira faixa de áudio com espaço no instante `at` (cria se der).
      const freeAudioTrack = (at: number, dur: number): number => {
        for (let t = 0; t < aTracks.length; t++) {
          if (fitsAt(s.clips, "audio", t, at, dur)) return t;
        }
        if (aTracks.length < MAX_TRACKS) {
          aTracks = [...aTracks, defaultAudioTrack()];
          return aTracks.length - 1;
        }
        return -1;
      };

      if (isImage) {
        let track = 0;
        let at: number;
        let overlay = false;
        if (target) {
          track = target.group === "video" ? Math.min(target.track, vTracks.length - 1) : 0;
          at = bestGapStart(s.clips, "video", track, Math.max(0, target.ms), IMAGE_DEFAULT_MS);
          overlay = track > 0;
        } else if (s.clips.some((c) => isVideoKind(c.kind))) {
          // Já tem vídeo → a imagem entra como CAMADA (PiP) acima da base,
          // no playhead — comportamento de editor profissional.
          let t = -1;
          for (let i = 1; i < vTracks.length; i++) {
            if (fitsAt(s.clips, "video", i, s.playheadMs, IMAGE_DEFAULT_MS)) {
              t = i;
              break;
            }
          }
          if (t === -1 && vTracks.length < MAX_TRACKS) {
            vTracks = [...vTracks, defaultVideoTrack()];
            t = vTracks.length - 1;
          }
          if (t !== -1) {
            track = t;
            at = s.playheadMs;
            overlay = true;
          } else {
            at = trackEndMs(s.clips, "video", 0);
          }
        } else {
          at = 0;
        }
        added.push({
          id: newId(),
          kind: "image",
          track,
          startMs: at,
          inMs: 0,
          outMs: IMAGE_DEFAULT_MS,
          linkId: "",
          ...common,
          ...(overlay ? pip : {}),
        });
      } else if (hasVideo) {
        const linkId = hasAudio ? newId() : "";
        let vTrack = 0;
        let at: number;
        if (target) {
          vTrack = target.group === "video" ? Math.min(target.track, vTracks.length - 1) : 0;
          at = bestGapStart(s.clips, "video", vTrack, Math.max(0, target.ms), info.durationMs);
        } else {
          at = Math.max(
            trackEndMs(s.clips, "video", 0),
            hasAudio ? trackEndMs(s.clips, "audio", 0) : 0,
          );
        }
        added.push({
          id: newId(),
          kind: "video",
          track: vTrack,
          startMs: at,
          inMs: 0,
          outMs: info.durationMs,
          linkId,
          ...common,
          // Solto numa camada de cima → entra como PiP.
          ...(target && vTrack > 0 ? pip : {}),
        });
        if (hasAudio) {
          const aTrack = target ? freeAudioTrack(at, info.durationMs) : 0;
          if (aTrack >= 0) {
            added.push({
              id: newId(),
              kind: "audio",
              track: aTrack,
              startMs: at,
              inMs: 0,
              outMs: info.durationMs,
              linkId,
              ...common,
            });
          } else {
            added[added.length - 1] = { ...added[added.length - 1], linkId: "" };
            toast("info", `${info.name}: sem faixa de áudio livre — só o vídeo entrou.`);
          }
        }
      } else {
        // Só áudio: no alvo do drop, ou no playhead na primeira faixa livre
        // (é assim que se põe música em cima do som do vídeo sem arrastar).
        let track: number;
        let at: number;
        if (target && target.group === "audio") {
          track = Math.min(target.track, aTracks.length - 1);
          at = bestGapStart(s.clips, "audio", track, Math.max(0, target.ms), info.durationMs);
        } else {
          const ref = target ? Math.max(0, target.ms) : s.playheadMs;
          const t = freeAudioTrack(ref, info.durationMs);
          if (t >= 0) {
            track = t;
            at = ref;
          } else {
            track = 0;
            at = trackEndMs(s.clips, "audio", 0);
          }
        }
        added.push({
          id: newId(),
          kind: "audio",
          track,
          startMs: at,
          inMs: 0,
          outMs: info.durationMs,
          linkId: "",
          ...common,
        });
      }

      // O primeiro vídeo define o formato do projeto.
      const firstVideo =
        !s.clips.some((c) => c.kind === "video") && hasVideo ? info.video : null;
      set((st) => ({
        undoStack: [...st.undoStack.slice(-49), snap(st)],
        redoStack: [],
        clips: [...st.clips, ...added],
        vTracks,
        aTracks,
        selectedId: added[0].id,
        ...(firstVideo
          ? {
              project: {
                width: firstVideo.width - (firstVideo.width % 2),
                height: firstVideo.height - (firstVideo.height % 2),
                fps: Math.round(firstVideo.fps) || 30,
              },
            }
          : {}),
      }));
    }
  },

  select(id) {
    set({ selectedId: id });
  },

  setPlayhead(ms) {
    const dur = projectDurMs(get().clips);
    set({ playheadMs: Math.max(0, Math.min(dur, ms)) });
  },

  setPlaying(playing) {
    set({ playing });
  },

  setZoom(pxPerSec) {
    set({ pxPerSec: Math.max(8, Math.min(400, pxPerSec)) });
  },

  toggleSnap() {
    set((s) => ({ snapOn: !s.snapOn }));
  },

  beginGesture() {
    set((s) => ({ undoStack: [...s.undoStack.slice(-49), snap(s)], redoStack: [] }));
  },

  move(id, desiredStartMs, toTrack) {
    set((s) => {
      let clips = s.clips;
      const clip = clips.find((c) => c.id === id);
      if (!clip) return {};
      if (toTrack !== undefined && toTrack !== clip.track) {
        const max = isVideoKind(clip.kind) ? s.vTracks.length : s.aTracks.length;
        const t = Math.max(0, Math.min(max - 1, toTrack));
        if (t !== clip.track) clips = clips.map((c) => (c.id === id ? { ...c, track: t } : c));
      }
      return { clips: moveClip(clips, id, Math.max(0, desiredStartMs)) };
    });
  },

  trim(id, edge, desiredMs) {
    set((s) => ({ clips: trimClip(s.clips, id, edge, desiredMs) }));
  },

  splitAtPlayhead() {
    const s = get();
    const at = s.playheadMs;
    const clip = s.clips.find((c) => c.id === s.selectedId);
    if (!clip) {
      useUi.getState().toast("info", "Selecione um clipe pra dividir.");
      return;
    }
    const partner = clip.linkId
      ? s.clips.find((c) => c.id !== clip.id && c.linkId === clip.linkId)
      : undefined;
    let clips = s.clips;
    // Par vinculado dividido junto: as duas metades direitas ganham um vínculo novo.
    const rightLink = partner ? newId() : undefined;
    const before = clips.length;
    clips = splitClip(clips, clip.id, at, newId(), rightLink);
    if (clips.length === before) {
      useUi.getState().toast("info", "Posicione o cursor dentro do clipe selecionado.");
      return;
    }
    if (partner) clips = splitClip(clips, partner.id, at, newId(), rightLink);
    set((st) => ({
      undoStack: [...st.undoStack.slice(-49), snap(st)],
      redoStack: [],
      clips,
    }));
  },

  removeSelected() {
    const s = get();
    const clip = s.clips.find((c) => c.id === s.selectedId);
    if (!clip) return;
    set((st) => ({
      undoStack: [...st.undoStack.slice(-49), snap(st)],
      redoStack: [],
      // O par vinculado fica (é assim que se apaga só o áudio ou só o vídeo),
      // mas solto — não faz sentido vínculo com clipe removido.
      clips: st.clips
        .filter((c) => c.id !== clip.id)
        .map((c) => (clip.linkId && c.linkId === clip.linkId ? { ...c, linkId: "" } : c)),
      selectedId: "",
    }));
  },

  rippleRemoveSelected() {
    const s = get();
    const clip = s.clips.find((c) => c.id === s.selectedId);
    if (!clip) return;
    set((st) => ({
      undoStack: [...st.undoStack.slice(-49), snap(st)],
      redoStack: [],
      clips: rippleDelete(st.clips, clip.id),
      selectedId: "",
    }));
  },

  unlinkSelected() {
    const s = get();
    const clip = s.clips.find((c) => c.id === s.selectedId);
    if (!clip?.linkId) return;
    set((st) => ({
      undoStack: [...st.undoStack.slice(-49), snap(st)],
      redoStack: [],
      clips: st.clips.map((c) => (c.linkId === clip.linkId ? { ...c, linkId: "" } : c)),
    }));
  },

  duplicateSelected() {
    const s = get();
    const clip = s.clips.find((c) => c.id === s.selectedId);
    if (!clip) return;
    const group = isVideoKind(clip.kind) ? "video" : "audio";
    const copy: Clip = {
      ...clip,
      id: newId(),
      linkId: "",
      startMs: trackEndMs(s.clips, group, clip.track),
    };
    set((st) => ({
      undoStack: [...st.undoStack.slice(-49), snap(st)],
      redoStack: [],
      clips: [...st.clips, copy],
      selectedId: copy.id,
    }));
  },

  copySelected() {
    const s = get();
    const clip = s.clips.find((c) => c.id === s.selectedId);
    if (!clip) return;
    const partner = clip.linkId
      ? s.clips.find((c) => c.id !== clip.id && c.linkId === clip.linkId)
      : undefined;
    set({ clipboard: partner ? [clip, partner] : [clip] });
    useUi.getState().toast("info", partner ? "Par copiado." : "Clipe copiado.");
  },

  pasteAtPlayhead() {
    const s = get();
    if (s.clipboard.length === 0) return;
    const main = s.clipboard[0];
    const group = isVideoKind(main.kind) ? "video" : "audio";
    const at = bestGapStart(s.clips, group, main.track, s.playheadMs, clipDurMs(main));
    const linkId = s.clipboard.length > 1 ? newId() : "";
    const pasted: Clip[] = [{ ...main, id: newId(), startMs: at, linkId }];
    if (s.clipboard.length > 1) {
      const partner = s.clipboard[1];
      const pGroup = isVideoKind(partner.kind) ? "video" : "audio";
      if (fitsAt(s.clips, pGroup, partner.track, at, clipDurMs(partner))) {
        pasted.push({ ...partner, id: newId(), startMs: at, linkId });
      } else {
        pasted[0] = { ...pasted[0], linkId: "" };
      }
    }
    set((st) => ({
      undoStack: [...st.undoStack.slice(-49), snap(st)],
      redoStack: [],
      clips: [...st.clips, ...pasted],
      selectedId: pasted[0].id,
    }));
  },

  setGain(id, gain) {
    set((s) => ({
      clips: s.clips.map((c) =>
        c.id === id ? { ...c, gain: Math.max(0, Math.min(2, gain)) } : c,
      ),
    }));
  },

  toggleMute(id) {
    set((s) => ({
      clips: s.clips.map((c) => (c.id === id ? { ...c, muted: !c.muted } : c)),
    }));
  },

  setFit(id, fit) {
    set((s) => ({
      clips: s.clips.map((c) =>
        c.id === id ? { ...c, fit, ...(fit === "custom" && c.w >= 1 ? { w: 0.4, x: 0.05, y: 0.05 } : {}) } : c,
      ),
    }));
  },

  setRect(id, patch) {
    const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
    set((s) => ({
      clips: s.clips.map((c) =>
        c.id === id
          ? {
              ...c,
              ...(patch.x !== undefined ? { x: clamp01(patch.x) } : {}),
              ...(patch.y !== undefined ? { y: clamp01(patch.y) } : {}),
              ...(patch.w !== undefined ? { w: Math.max(0.05, Math.min(1, patch.w)) } : {}),
            }
          : c,
      ),
    }));
  },

  setSpeed(id, speed) {
    set((s) => ({ clips: setClipSpeed(s.clips, id, speed) }));
  },

  setFade(id, patch) {
    const clamp = (v: number) => Math.max(0, Math.min(5000, Math.round(v)));
    set((s) => ({
      clips: s.clips.map((c) =>
        c.id === id
          ? {
              ...c,
              ...(patch.fadeInMs !== undefined ? { fadeInMs: clamp(patch.fadeInMs) } : {}),
              ...(patch.fadeOutMs !== undefined ? { fadeOutMs: clamp(patch.fadeOutMs) } : {}),
            }
          : c,
      ),
    }));
  },

  setOpacity(id, opacity) {
    set((s) => ({
      clips: s.clips.map((c) =>
        c.id === id ? { ...c, opacity: Math.max(0.1, Math.min(1, opacity)) } : c,
      ),
    }));
  },

  setRotation(id, rotation) {
    set((s) => ({ clips: s.clips.map((c) => (c.id === id ? { ...c, rotation } : c)) }));
  },

  toggleFlipH(id) {
    set((s) => ({ clips: s.clips.map((c) => (c.id === id ? { ...c, flipH: !c.flipH } : c)) }));
  },

  addTextClip() {
    const s = get();
    // Título entra na trilha de vídeo de cima, no playhead se houver espaço.
    const track = s.vTracks.length - 1;
    const at = fitsAt(s.clips, "video", track, s.playheadMs, TEXT_DEFAULT_MS)
      ? s.playheadMs
      : trackEndMs(s.clips, "video", track);
    const clip: Clip = {
      id: newId(),
      kind: "text",
      src: { path: "", name: "Título", durationMs: 0, width: 0, height: 0 },
      track,
      startMs: at,
      inMs: 0,
      outMs: TEXT_DEFAULT_MS,
      gain: 1,
      muted: false,
      fit: "custom",
      x: 0.1,
      y: 0.8,
      w: 0.8,
      linkId: "",
      ...CLIP_DEFAULTS,
      text: "Seu texto aqui",
    };
    set((st) => ({
      undoStack: [...st.undoStack.slice(-49), snap(st)],
      redoStack: [],
      clips: [...st.clips, clip],
      selectedId: clip.id,
    }));
  },

  setTextProps(id, patch) {
    set((s) => ({
      clips: s.clips.map((c) =>
        c.id === id
          ? {
              ...c,
              ...patch,
              ...(patch.textSize !== undefined
                ? { textSize: Math.max(0.03, Math.min(0.25, patch.textSize)) }
                : {}),
            }
          : c,
      ),
    }));
  },

  setProject(patch) {
    set((s) => ({ project: { ...s.project, ...patch } }));
  },

  setExportCrf(crf) {
    set({ exportCrf: crf });
  },

  addTrack(kind) {
    set((s) =>
      kind === "video"
        ? s.vTracks.length < MAX_TRACKS
          ? { vTracks: [...s.vTracks, defaultVideoTrack()] }
          : {}
        : s.aTracks.length < MAX_TRACKS
          ? { aTracks: [...s.aTracks, defaultAudioTrack()] }
          : {},
    );
  },

  removeTrack(kind) {
    const s = get();
    const len = kind === "video" ? s.vTracks.length : s.aTracks.length;
    if (len <= 1) return;
    const top = len - 1;
    const busy = s.clips.some((c) =>
      kind === "video" ? isVideoKind(c.kind) && c.track === top : c.kind === "audio" && c.track === top,
    );
    if (busy) {
      useUi.getState().toast("info", "A trilha de cima ainda tem clipes.");
      return;
    }
    set((st) => ({
      undoStack: [...st.undoStack.slice(-49), snap(st)],
      redoStack: [],
      ...(kind === "video"
        ? { vTracks: st.vTracks.slice(0, -1) }
        : { aTracks: st.aTracks.slice(0, -1) }),
    }));
  },

  toggleTrackHidden(track) {
    set((s) => ({
      vTracks: s.vTracks.map((t, i) => (i === track ? { ...t, hidden: !t.hidden } : t)),
    }));
  },

  toggleTrackMuted(track) {
    set((s) => ({
      aTracks: s.aTracks.map((t, i) => (i === track ? { ...t, muted: !t.muted } : t)),
    }));
  },

  toggleTrackSolo(track) {
    set((s) => ({
      aTracks: s.aTracks.map((t, i) => (i === track ? { ...t, solo: !t.solo } : t)),
    }));
  },

  clearProject() {
    set((s) => ({
      undoStack: [...s.undoStack.slice(-49), snap(s)],
      redoStack: [],
      clips: [],
      selectedId: "",
      playheadMs: 0,
      playing: false,
    }));
  },

  undo() {
    const s = get();
    const prev = s.undoStack[s.undoStack.length - 1];
    if (!prev) return;
    set({
      undoStack: s.undoStack.slice(0, -1),
      redoStack: [...s.redoStack, snap(s)],
      ...prev,
      selectedId: "",
    });
  },

  redo() {
    const s = get();
    const next = s.redoStack[s.redoStack.length - 1];
    if (!next) return;
    set({
      redoStack: s.redoStack.slice(0, -1),
      undoStack: [...s.undoStack, snap(s)],
      ...next,
      selectedId: "",
    });
  },

  async exportProject() {
    const s = get();
    const toast = useUi.getState().toast;
    // Trilha oculta e áudio mudo/sem-solo ficam fora, como no preview.
    const visible = visibleClips(s.clips, s.vTracks, s.aTracks);
    if (visible.length === 0) {
      toast("info", "Nada visível pra exportar — confira as trilhas ocultas/mudas.");
      return;
    }
    set({ playing: false });
    const built = buildTimelineExport(s.project, visible, {
      crf: s.exportCrf,
      windows: IS_WINDOWS,
    });
    const withPath = s.clips.find((c) => c.src.path);
    const dir = withPath ? `${stemDir(withPath.src.path)}${SEP}` : "";
    const out = await save({
      title: "Exportar projeto",
      defaultPath: `${dir}projeto - ${built.suffix}.${built.ext}`,
      filters: [{ name: built.ext.toUpperCase(), extensions: [built.ext] }],
    }).catch(() => null);
    if (!out) return;
    useStore.getState().enqueue(built, out);
    useUi.getState().setView("home");
    toast("success", "Exportação na fila — acompanhe o progresso aqui.");
  },

  async saveProjectAs() {
    const s = get();
    const toast = useUi.getState().toast;
    if (s.clips.length === 0) {
      toast("info", "Nada pra salvar ainda.");
      return;
    }
    const withPath = s.clips.find((c) => c.src.path);
    const dir = withPath ? `${stemDir(withPath.src.path)}${SEP}` : "";
    const out = await save({
      title: "Salvar projeto",
      defaultPath: `${dir}projeto.localmedia.json`,
      filters: [{ name: "Projeto LocalMedia", extensions: ["json"] }],
    }).catch(() => null);
    if (!out) return;
    const file: ProjectFile = {
      version: 2,
      project: s.project,
      exportCrf: s.exportCrf,
      vTracks: s.vTracks,
      aTracks: s.aTracks,
      clips: s.clips,
    };
    try {
      await be.writeTextFile(out, JSON.stringify(file, null, 1));
      toast("success", "Projeto salvo.");
    } catch (e) {
      toast("error", String(e));
    }
  },

  async openProjectFile() {
    const toast = useUi.getState().toast;
    const picked = await open({
      multiple: false,
      title: "Abrir projeto",
      filters: [{ name: "Projeto LocalMedia", extensions: ["json"] }],
    }).catch(() => null);
    if (!picked || Array.isArray(picked)) return;
    try {
      const raw = JSON.parse(await be.readTextFile(picked)) as Record<string, unknown>;
      const clips = sanitizeClips(raw.clips);
      if (clips.length === 0) throw new Error("arquivo sem clipes válidos");
      const tracks = sanitizeTracks(raw);
      set((st) => ({
        undoStack: [...st.undoStack.slice(-49), snap(st)],
        redoStack: [],
        clips,
        project: (raw.project as ProjectSettings) ?? st.project,
        exportCrf: (raw.exportCrf as number) ?? st.exportCrf,
        ...tracks,
        selectedId: "",
        playheadMs: 0,
        playing: false,
      }));
      for (const c of clips) {
        if (c.kind === "video") requestThumb(c.src.path, c.src.durationMs);
      }
      toast("success", "Projeto aberto.");
    } catch (e) {
      toast("error", `Não consegui abrir o projeto: ${e}`);
    }
  },
}));

// ---- autosave: guarda o projeto no localStorage (com debounce) e restaura
// na inicialização — fechar o app não perde a timeline.
try {
  const raw = localStorage.getItem(AUTOSAVE_KEY);
  if (raw) {
    const saved = JSON.parse(raw) as Record<string, unknown>;
    const clips = sanitizeClips(saved.clips);
    if (clips.length > 0) {
      useEditor.setState({
        clips,
        project: (saved.project as ProjectSettings) ?? { width: 1280, height: 720, fps: 30 },
        exportCrf: (saved.exportCrf as number) ?? 20,
        ...sanitizeTracks(saved),
      });
      for (const c of clips) {
        if (c.kind === "video") requestThumb(c.src.path, c.src.durationMs);
      }
    }
  }
} catch {
  // autosave corrompido não pode travar o app
}

let autosaveTimer: ReturnType<typeof setTimeout> | undefined;
useEditor.subscribe((s, prev) => {
  if (
    s.clips === prev.clips &&
    s.project === prev.project &&
    s.exportCrf === prev.exportCrf &&
    s.vTracks === prev.vTracks &&
    s.aTracks === prev.aTracks
  ) {
    return;
  }
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    const st = useEditor.getState();
    const file: ProjectFile = {
      version: 2,
      project: st.project,
      exportCrf: st.exportCrf,
      vTracks: st.vTracks,
      aTracks: st.aTracks,
      clips: st.clips,
    };
    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(file));
    } catch {
      // localStorage cheio/indisponível: só ignora
    }
  }, 800);
});

// Só em dev: expõe o store pra testes manuais no console.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__editor = useEditor;
}
