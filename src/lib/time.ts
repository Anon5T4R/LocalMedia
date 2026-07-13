/** Formatação pra UI. */

/** "2:05", "1:02:03". */
export function fmtDur(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

/** "12,3 MB" / "1,2 GB". */
export function fmtBytes(bytes: number): string {
  if (bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes;
  let u = 0;
  while (v >= 1000 && u < units.length - 1) {
    v /= 1000;
    u++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1).replace(".", ",")} ${units[u]}`;
}

/** "1:23.4" pra campos de corte (mm:ss.d) e o parse de volta. */
export function fmtCut(ms: number): string {
  const t = Math.max(0, Math.round(ms));
  const m = Math.floor(t / 60_000);
  const s = Math.floor((t % 60_000) / 1000);
  const d = Math.floor((t % 1000) / 100);
  return `${m}:${String(s).padStart(2, "0")}.${d}`;
}

/** Aceita "90", "1:30", "1:30.5", "1:02:03" → ms (NaN se inválido). */
export function parseCut(text: string): number {
  const parts = text.trim().split(":");
  if (parts.length === 0 || parts.length > 3 || parts.some((p) => p === "")) return NaN;
  let ms = 0;
  for (const p of parts) {
    const v = Number(p.replace(",", "."));
    if (!Number.isFinite(v) || v < 0) return NaN;
    ms = ms * 60 + v * 1000;
  }
  return Math.round(ms);
}
