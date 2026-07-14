import { create } from "zustand";

export interface Toast {
  id: number;
  kind: "info" | "error" | "success";
  text: string;
}

interface UiState {
  toasts: Toast[];
  /** Tela atual: conversor (home) ou editor de timeline. */
  view: "home" | "editor";
  /** Arquivo com o modal de tarefas aberto (id) e aba inicial. */
  taskFileId: string;
  taskTab: string;
  batchOpen: boolean;
  helpOpen: boolean;

  toast(kind: Toast["kind"], text: string): void;
  dismissToast(id: number): void;
  setView(view: "home" | "editor"): void;
  openTask(fileId: string, tab?: string): void;
  closeTask(): void;
  setBatchOpen(open: boolean): void;
  setHelpOpen(open: boolean): void;
}

let nextToast = 1;

export const useUi = create<UiState>((set) => ({
  toasts: [],
  view: "home",
  taskFileId: "",
  taskTab: "converter",
  batchOpen: false,
  helpOpen: false,

  toast(kind, text) {
    const id = nextToast++;
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 6000);
  },
  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
  setView(view) {
    set({ view });
  },
  openTask(fileId, tab = "converter") {
    set({ taskFileId: fileId, taskTab: tab });
  },
  closeTask() {
    set({ taskFileId: "" });
  },
  setBatchOpen(open) {
    set({ batchOpen: open });
  },
  setHelpOpen(open) {
    set({ helpOpen: open });
  },
}));

// Só em dev: expõe o store pra testes manuais no console.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__ui = useUi;
}
