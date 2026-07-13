import { create } from "zustand";

export interface Toast {
  id: number;
  kind: "info" | "error" | "success";
  text: string;
}

interface UiState {
  toasts: Toast[];
  /** Arquivo com o modal de tarefas aberto (id) e aba inicial. */
  taskFileId: string;
  taskTab: string;
  batchOpen: boolean;

  toast(kind: Toast["kind"], text: string): void;
  dismissToast(id: number): void;
  openTask(fileId: string, tab?: string): void;
  closeTask(): void;
  setBatchOpen(open: boolean): void;
}

let nextToast = 1;

export const useUi = create<UiState>((set) => ({
  toasts: [],
  taskFileId: "",
  taskTab: "converter",
  batchOpen: false,

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
  openTask(fileId, tab = "converter") {
    set({ taskFileId: fileId, taskTab: tab });
  },
  closeTask() {
    set({ taskFileId: "" });
  },
  setBatchOpen(open) {
    set({ batchOpen: open });
  },
}));
