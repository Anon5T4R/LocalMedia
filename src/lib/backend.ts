// Wrappers dos comandos Rust (Tauri v2: chaves camelCase no invoke).

import { invoke } from "@tauri-apps/api/core";

export function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function cmd<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!inTauri()) return Promise.reject(new Error(`fora do Tauri: ${name}`));
  return invoke<T>(name, args);
}

export const ffmpegOk = () => cmd<boolean>("ffmpeg_ok");
export const mediaProbe = (path: string) => cmd<string>("media_probe", { path });
export const thumbnails = (id: string, path: string, count: number, durationMs: number) =>
  cmd<string[]>("thumbnails", { id, path, count, durationMs });
export const ffRun = (jobId: string, args: string[]) => cmd<void>("ff_run", { jobId, args });
export const ffCancel = (jobId: string) => cmd<void>("ff_cancel", { jobId });
export const uniquePath = (path: string) => cmd<string>("unique_path", { path });
export const concatList = (id: string, files: string[]) =>
  cmd<string>("concat_list", { id, files });
export const tmpPath = (name: string) => cmd<string>("tmp_path", { name });
