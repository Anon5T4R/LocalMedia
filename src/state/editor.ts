// Estado do editor: projeto, clipes, playhead e as ações da timeline.
// As operações pesadas são puras (lib/editor/model.ts); aqui fica a cola:
// gestos com undo/redo, importação de mídia e exportação pra fila existente.

import { create } from "zustand";
import { open, save } from "@tauri-apps/plugin-dialog";
import * as be from "../lib/backend";
import { parseProbe } from "../lib/probe";
import {
  CLIP_DEFAULTS,
  clipEndMs,
  isVideoKind,
  moveClip,
  projectDurMs,
  setClipSpeed,
  splitClip,
  trackClips,
  trimClip,
  type Clip,
  type ProjectSettings,
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

/** Formato do arquivo de projeto (.json) e do autosave. */
interface ProjectFile {
  version: 1;
  project: ProjectSettings;
  exportCrf: number;
  videoTracks: number;
  audioTracks: number;
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

interface Snapshot {
  clips: Clip[];
  videoTracks: number;
  audioTracks: number;
}

interface EditorState {
  project: ProjectSettings;
  clips: Clip[];
  videoTracks: number;
  audioTracks: number;
  selectedId: string;
  playheadMs: number;
  playing: boolean;
  pxPerSec: number;
  /** Miniatura por caminho de fonte (pros blocos da timeline). */
  thumbs: Record<string, string>;
  /** CRF da exportação (18 máxima · 20 alta · 26 compacta). */
  exportCrf: number;
  undoStack: Snapshot[];
  redoStack: Snapshot[];

  addMediaPaths(paths: string[]): Promise<void>;
  select(id: string): void;
  setPlayhead(ms: number): void;
  setPlaying(playing: boolean): void;
  setZoom(pxPerSec: number): void;

  /** Chamar UMA vez no início de um gesto de arrastar/aparar (grava o undo). */
  beginGesture(): void;
  move(id: string, desiredStartMs: number, toTrack?: number): void;
  trim(id: string, edge: "in" | "out", desiredMs: number): void;

  splitAtPlayhead(): void;
  removeSelected(): void;
  unlinkSelected(): void;
  duplicateSelected(): void;
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
  clearProject(): void;

  undo(): void;
  redo(): void;
  exportProject(): Promise<void>;
  saveProjectAs(): Promise<void>;
  openProjectFile(): Promise<void>;
}

function snap(s: EditorState): Snapshot {
  return { clips: s.clips, videoTracks: s.videoTracks, audioTracks: s.audioTracks };
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
  videoTracks: 1,
  audioTracks: 1,
  selectedId: "",
  playheadMs: 0,
  playing: false,
  pxPerSec: 60,
  thumbs: {},
  exportCrf: 20,
  undoStack: [],
  redoStack: [],

  async addMediaPaths(paths) {
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
      const s = get();
      const src = {
        path,
        name: info.name,
        durationMs: isImage ? 0 : info.durationMs,
        width: info.video?.width ?? 0,
        height: info.video?.height ?? 0,
      };
      const added: Clip[] = [];
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
      if (info.video && !isImage) requestThumb(path, info.durationMs);

      if (isImage) {
        added.push({
          id: newId(),
          kind: "image",
          track: 0,
          startMs: trackEndMs(s.clips, "video", 0),
          inMs: 0,
          outMs: IMAGE_DEFAULT_MS,
          linkId: "",
          ...common,
        });
      } else if (info.video && info.durationMs > 0) {
        // Vídeo (com áudio → par vinculado alinhado no fim das duas trilhas).
        const at = Math.max(
          trackEndMs(s.clips, "video", 0),
          info.audio.length > 0 ? trackEndMs(s.clips, "audio", 0) : 0,
        );
        const linkId = info.audio.length > 0 ? newId() : "";
        added.push({
          id: newId(),
          kind: "video",
          track: 0,
          startMs: at,
          inMs: 0,
          outMs: info.durationMs,
          linkId,
          ...common,
        });
        if (info.audio.length > 0) {
          added.push({
            id: newId(),
            kind: "audio",
            track: 0,
            startMs: at,
            inMs: 0,
            outMs: info.durationMs,
            linkId,
            ...common,
          });
        }
      } else if (info.audio.length > 0 && info.durationMs > 0) {
        added.push({
          id: newId(),
          kind: "audio",
          track: 0,
          startMs: trackEndMs(s.clips, "audio", 0),
          inMs: 0,
          outMs: info.durationMs,
          linkId: "",
          ...common,
        });
      } else {
        toast("error", `${info.name}: sem vídeo nem áudio utilizável.`);
        continue;
      }

      // O primeiro vídeo define o formato do projeto.
      const firstVideo =
        !s.clips.some((c) => c.kind === "video") && info.video && !isImage ? info.video : null;
      set((st) => ({
        undoStack: [...st.undoStack.slice(-49), snap(st)],
        redoStack: [],
        clips: [...st.clips, ...added],
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

  beginGesture() {
    set((s) => ({ undoStack: [...s.undoStack.slice(-49), snap(s)], redoStack: [] }));
  },

  move(id, desiredStartMs, toTrack) {
    set((s) => {
      let clips = s.clips;
      const clip = clips.find((c) => c.id === id);
      if (!clip) return {};
      if (toTrack !== undefined && toTrack !== clip.track) {
        const max = isVideoKind(clip.kind) ? s.videoTracks : s.audioTracks;
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
    const track = s.videoTracks - 1;
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
        ? { videoTracks: Math.min(MAX_TRACKS, s.videoTracks + 1) }
        : { audioTracks: Math.min(MAX_TRACKS, s.audioTracks + 1) },
    );
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
    if (s.clips.length === 0) {
      toast("info", "Adicione clipes na timeline antes de exportar.");
      return;
    }
    set({ playing: false });
    const built = buildTimelineExport(s.project, s.clips, {
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
      version: 1,
      project: s.project,
      exportCrf: s.exportCrf,
      videoTracks: s.videoTracks,
      audioTracks: s.audioTracks,
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
      const raw = JSON.parse(await be.readTextFile(picked)) as Partial<ProjectFile>;
      const clips = sanitizeClips(raw.clips);
      if (clips.length === 0) throw new Error("arquivo sem clipes válidos");
      set((st) => ({
        undoStack: [...st.undoStack.slice(-49), snap(st)],
        redoStack: [],
        clips,
        project: raw.project ?? st.project,
        exportCrf: raw.exportCrf ?? st.exportCrf,
        videoTracks: Math.max(1, Math.min(MAX_TRACKS, raw.videoTracks ?? 1)),
        audioTracks: Math.max(1, Math.min(MAX_TRACKS, raw.audioTracks ?? 1)),
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
    const saved = JSON.parse(raw) as Partial<ProjectFile>;
    const clips = sanitizeClips(saved.clips);
    if (clips.length > 0) {
      useEditor.setState({
        clips,
        project: saved.project ?? { width: 1280, height: 720, fps: 30 },
        exportCrf: saved.exportCrf ?? 20,
        videoTracks: Math.max(1, Math.min(MAX_TRACKS, saved.videoTracks ?? 1)),
        audioTracks: Math.max(1, Math.min(MAX_TRACKS, saved.audioTracks ?? 1)),
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
    s.videoTracks === prev.videoTracks &&
    s.audioTracks === prev.audioTracks
  ) {
    return;
  }
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    const st = useEditor.getState();
    const file: ProjectFile = {
      version: 1,
      project: st.project,
      exportCrf: st.exportCrf,
      videoTracks: st.videoTracks,
      audioTracks: st.audioTracks,
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
