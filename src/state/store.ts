// Estado central: arquivos abertos, fila de jobs do ffmpeg e execução.
// A fila roda SEQUENCIAL de propósito (1 encode por vez — encode paraleliza
// mal em máquina modesta; decisão do plano).

import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import * as be from "../lib/backend";
import { parseProbe } from "../lib/probe";
import type { BuiltJob } from "../lib/presets";
import type { Job, MediaFile } from "../lib/types";
import { useUi } from "./ui";

function newId(): string {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

function dirOf(path: string): string {
  const norm = path.replace(/\\/g, "/");
  const idx = norm.lastIndexOf("/");
  return idx > 0 ? path.slice(0, idx) : path;
}

function stemOf(path: string): string {
  const name = path.replace(/\\/g, "/").split("/").pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

const SEP = navigator.userAgent.includes("Windows") ? "\\" : "/";

/** Nome de saída sugerido, ao lado do original. */
export function suggestOut(inputPath: string, suffix: string, ext: string): string {
  return `${dirOf(inputPath)}${SEP}${stemOf(inputPath)} - ${suffix}.${ext}`;
}

interface Store {
  ready: boolean;
  runtimeOk: boolean;
  files: MediaFile[];
  queue: Job[];
  processing: boolean;

  init(): Promise<void>;
  addPaths(paths: string[]): Promise<void>;
  removeFile(id: string): void;
  toggleSelect(id: string): void;
  clearSelection(): void;

  enqueue(built: BuiltJob, outPath: string): void;
  cancelJob(id: string): void;
  clearFinishedJobs(): void;
}

let eventsBound = false;

export const useStore = create<Store>((set, get) => ({
  ready: false,
  runtimeOk: true,
  files: [],
  queue: [],
  processing: false,

  async init() {
    if (!be.inTauri()) {
      set({ ready: true, runtimeOk: false });
      return;
    }
    try {
      set({ runtimeOk: await be.ffmpegOk() });
    } catch {
      set({ runtimeOk: false });
    }
    if (!eventsBound) {
      eventsBound = true;
      await listen<{ jobId: string; outTimeMs: number; speed: string }>(
        "ffjob-progress",
        (e) => {
          const { jobId, outTimeMs, speed } = e.payload;
          set((s) => ({
            queue: s.queue.map((j) => {
              if (j.id !== jobId || j.status !== "running") return j;
              // Progresso por passo: passos anteriores contam inteiros.
              const stepDenom = j.denomMs / j.steps.length;
              const done = j.step * stepDenom + Math.min(outTimeMs, stepDenom);
              const pct = j.denomMs > 0 ? Math.min(99, Math.round((done / j.denomMs) * 100)) : 0;
              return { ...j, pct, speed };
            }),
          }));
        },
      );
    }
    set({ ready: true });
  },

  async addPaths(paths) {
    const toast = useUi.getState().toast;
    for (const path of paths) {
      if (get().files.some((f) => f.info.path === path)) continue;
      const id = newId();
      try {
        const raw = await be.mediaProbe(path);
        const info = parseProbe(path, raw);
        const file: MediaFile = { id, info, selected: false };
        set((s) => ({ files: [...s.files, file] }));
        // Capa do card (melhor esforço, só pra vídeo).
        if (info.video && info.durationMs > 0) {
          be.thumbnails(id + "-cover", path, 1, info.durationMs)
            .then((thumbs) => {
              if (thumbs[0]) {
                set((s) => ({
                  files: s.files.map((f) => (f.id === id ? { ...f, thumb: thumbs[0] } : f)),
                }));
              }
            })
            .catch(() => {});
        }
      } catch (e) {
        toast("error", `${stemOf(path)}: ${e}`);
      }
    }
  },

  removeFile(id) {
    set((s) => ({ files: s.files.filter((f) => f.id !== id) }));
  },

  toggleSelect(id) {
    set((s) => ({
      files: s.files.map((f) => (f.id === id ? { ...f, selected: !f.selected } : f)),
    }));
  },

  clearSelection() {
    set((s) => ({ files: s.files.map((f) => ({ ...f, selected: false })) }));
  },

  enqueue(built, outPath) {
    // O caminho de saída entra no fim do ÚLTIMO passo (passos intermediários,
    // como a paleta do GIF, já trazem a própria saída embutida).
    const steps = built.steps.map((s, i) =>
      i === built.steps.length - 1 ? [...s, outPath] : s,
    );
    const job: Job = {
      id: newId(),
      label: built.label,
      steps,
      outPath,
      denomMs: Math.max(1, built.denomMs),
      status: "waiting",
      step: 0,
      pct: 0,
      speed: "",
    };
    set((s) => ({ queue: [...s.queue, job] }));
    void runQueue(set, get);
  },

  cancelJob(id) {
    const job = get().queue.find((j) => j.id === id);
    if (!job) return;
    if (job.status === "waiting") {
      set((s) => ({
        queue: s.queue.map((j) => (j.id === id ? { ...j, status: "cancelled" } : j)),
      }));
    } else if (job.status === "running") {
      be.ffCancel(id).catch(() => {});
      set((s) => ({
        queue: s.queue.map((j) => (j.id === id ? { ...j, status: "cancelled" } : j)),
      }));
    }
  },

  clearFinishedJobs() {
    set((s) => ({
      queue: s.queue.filter((j) => j.status === "waiting" || j.status === "running"),
    }));
  },
}));

// Só em dev: expõe o store pra testes manuais no console.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__store = useStore;
}

type Set = (fn: (s: Store) => Partial<Store>) => void;

function patchJob(set: Set, id: string, patch: Partial<Job>) {
  set((s) => ({ queue: s.queue.map((j) => (j.id === id ? { ...j, ...patch } : j)) }));
}

async function runQueue(set: Set, get: () => Store) {
  if (get().processing) return;
  set(() => ({ processing: true }));
  const toast = useUi.getState().toast;
  try {
    for (;;) {
      const job = get().queue.find((j) => j.status === "waiting");
      if (!job) break;
      const id = job.id;
      patchJob(set, id, { status: "running", pct: 0 });
      try {
        for (let i = 0; i < job.steps.length; i++) {
          if ((get().queue.find((j) => j.id === id)?.status ?? "") === "cancelled") break;
          patchJob(set, id, { step: i });
          await be.ffRun(id, job.steps[i]);
        }
        if ((get().queue.find((j) => j.id === id)?.status ?? "") === "cancelled") continue;
        patchJob(set, id, { status: "done", pct: 100 });
        toast("success", `${job.label}: pronto.`);
      } catch (e) {
        const cancelled =
          (get().queue.find((j) => j.id === id)?.status ?? "") === "cancelled";
        if (!cancelled) {
          patchJob(set, id, { status: "error", error: String(e) });
          toast("error", `${job.label} falhou: ${e}`);
        }
      }
    }
  } finally {
    set(() => ({ processing: false }));
  }
}
