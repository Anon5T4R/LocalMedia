/** Exportação do projeto do editor → argumentos do ffmpeg (função PURA,
 *  unit-testada; o Rust injeta -y/-progress/etc. como nos presets).
 *
 *  Estratégia: um canvas preto do tamanho/duração do projeto (source `color`)
 *  recebe cada clipe de vídeo/imagem por `overlay` na ordem das trilhas
 *  (V1 primeiro, camadas por cima depois), com `enable=between(t,…)` pra
 *  janela de tempo. Títulos (drawtext) entram por cima de tudo, na ordem das
 *  trilhas. Áudio: cada clipe vira atrim(+atempo/afade)+adelay e tudo se
 *  mistura num `amix`. Imagens entram com `-loop 1 -t`. */

import type { BuiltJob } from "../presets";
import { t as tr } from "../i18n";
import {
  clipDurMs,
  clipEndMs,
  isVideoKind,
  projectDurMs,
  type Clip,
  type ProjectSettings,
} from "./model";

export interface ExportOptions {
  /** Qualidade do H.264 (18 = máxima, 20 = padrão, 26 = compacta). */
  crf?: number;
  /** true = fonte do drawtext via arial.ttf do Windows; false = fontconfig. */
  windows?: boolean;
}

/** ms → segundos com 3 casas ("12.345") pros filtros. */
function sec(ms: number): string {
  return (Math.max(0, ms) / 1000).toFixed(3);
}

/** Largura par (o yuv420p exige dimensões pares). */
function even(px: number): number {
  return Math.max(2, 2 * Math.round(px / 2));
}

function num(v: number): string {
  return String(Math.round(v * 1000) / 1000);
}

/** Fatores do atempo (só aceita 0.5–2 por instância; encadeia pro resto). */
export function atempoFactors(speed: number): number[] {
  if (Math.abs(speed - 1) < 1e-6) return [];
  const out: number[] = [];
  let s = speed;
  while (s > 2) {
    out.push(2);
    s /= 2;
  }
  while (s < 0.5) {
    out.push(0.5);
    s *= 2;
  }
  if (Math.abs(s - 1) > 1e-6) out.push(Math.round(s * 1000) / 1000);
  return out;
}

/** Escapa texto pro drawtext dentro de -filter_complex (DOIS níveis: o valor
 *  da opção e o parser do filtergraph — regra do manual do ffmpeg). */
export function escDrawtext(raw: string): string {
  return raw
    .replace(/\r?\n/g, " ")
    .replace(/\\/g, "\\\\\\\\") // \  →  \\\\
    .replace(/'/g, "\\\\\\'") //   '  →  \\\'
    .replace(/:/g, "\\\\:") //     :  →  \\:
    .replace(/([,;[\]])/g, "\\$1"); // , ; [ ]  →  \,  etc.
}

/** #rrggbb → 0xrrggbb (fallback branco). */
function ffColor(hex: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? `0x${hex.slice(1)}` : "0xffffff";
}

export function buildTimelineExport(
  project: ProjectSettings,
  clips: Clip[],
  opts: ExportOptions = {},
): BuiltJob {
  const crf = opts.crf ?? 20;
  const durMs = projectDurMs(clips);
  const { width: W, height: H, fps } = project;

  const videoKinds = clips
    .filter((c) => isVideoKind(c.kind))
    .sort((a, b) => a.track - b.track || a.startMs - b.startMs);
  const mediaClips = videoKinds.filter((c) => c.kind !== "text");
  const textClips = videoKinds.filter((c) => c.kind === "text" && c.text.trim() !== "");
  const audioClips = clips
    .filter((c) => c.kind === "audio" && !c.muted && c.gain > 0)
    .sort((a, b) => a.track - b.track || a.startMs - b.startMs);

  // ---- entradas (-i): imagens são 1 entrada POR CLIPE (-loop 1 -t);
  // vídeo/áudio deduplicam por caminho; títulos não têm entrada.
  const inputArgs: string[] = [];
  const byPath = new Map<string, number>();
  const inputOf = new Map<string, number>();
  let n = 0;
  for (const c of [...mediaClips, ...audioClips]) {
    if (c.kind === "image") {
      inputArgs.push("-loop", "1", "-t", sec(clipDurMs(c)), "-i", c.src.path);
      inputOf.set(c.id, n++);
    } else {
      let idx = byPath.get(c.src.path);
      if (idx === undefined) {
        idx = n++;
        byPath.set(c.src.path, idx);
        inputArgs.push("-i", c.src.path);
      }
      inputOf.set(c.id, idx);
    }
  }

  const parts: string[] = [];
  const maps: string[] = [];

  // Um stream de entrada só pode alimentar UM ramo do filter_complex; quando
  // vários clipes vêm do mesmo stream (ex.: clipe dividido), split/asplit.
  function sourceLabels(clipsOfKind: Clip[], stream: "v" | "a"): Map<string, string> {
    const uses = new Map<number, string[]>();
    for (const c of clipsOfKind) {
      if (c.kind === "image") continue;
      const i = inputOf.get(c.id)!;
      uses.set(i, [...(uses.get(i) ?? []), c.id]);
    }
    const labelOf = new Map<string, string>();
    for (const [i, ids] of uses) {
      if (ids.length === 1) {
        labelOf.set(ids[0], `[${i}:${stream}]`);
      } else {
        const labels = ids.map((_, k) => `s${stream}${i}_${k}`);
        parts.push(
          `[${i}:${stream}]${stream === "a" ? "asplit" : "split"}=${ids.length}${labels.map((l) => `[${l}]`).join("")}`,
        );
        ids.forEach((id, k) => labelOf.set(id, `[${labels[k]}]`));
      }
    }
    return labelOf;
  }

  // ---- vídeo: canvas + um overlay por clipe de mídia + drawtext dos títulos.
  if (videoKinds.length > 0) {
    parts.push(`color=c=black:s=${W}x${H}:r=${fps}:d=${sec(durMs)}[cv0]`);
    const srcOf = sourceLabels(mediaClips, "v");
    mediaClips.forEach((c, k) => {
      const end = clipEndMs(c);
      const chain: string[] = [];
      if (c.kind === "video") chain.push(`trim=start=${sec(c.inMs)}:end=${sec(c.outMs)}`);
      chain.push(
        c.speed !== 1
          ? `setpts=(PTS-STARTPTS)/${num(c.speed)}+${sec(c.startMs)}/TB`
          : `setpts=PTS-STARTPTS+${sec(c.startMs)}/TB`,
      );
      if (c.rotation === 90) chain.push("transpose=1");
      else if (c.rotation === 180) chain.push("hflip", "vflip");
      else if (c.rotation === 270) chain.push("transpose=2");
      if (c.flipH) chain.push("hflip");
      chain.push(
        c.fit === "cheia"
          ? `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2`
          : `scale=${even(W * c.w)}:-2`,
        "setsar=1",
      );
      // Fades e opacidade via canal alpha (funciona em qualquer camada).
      const dur = clipDurMs(c);
      const fi = Math.min(c.fadeInMs, dur);
      const fo = Math.min(c.fadeOutMs, dur);
      if (fi > 0 || fo > 0 || c.opacity < 1) {
        chain.push("format=yuva420p");
        if (fi > 0) chain.push(`fade=t=in:st=${sec(c.startMs)}:d=${sec(fi)}:alpha=1`);
        if (fo > 0) chain.push(`fade=t=out:st=${sec(end - fo)}:d=${sec(fo)}:alpha=1`);
        if (c.opacity < 1) chain.push(`colorchannelmixer=aa=${num(c.opacity)}`);
      }
      const src = c.kind === "image" ? `[${inputOf.get(c.id)}:v]` : srcOf.get(c.id);
      parts.push(`${src}${chain.join(",")}[v${k}]`);
      const x = c.fit === "cheia" ? 0 : Math.round(W * c.x);
      const y = c.fit === "cheia" ? 0 : Math.round(H * c.y);
      parts.push(
        `[cv${k}][v${k}]overlay=x=${x}:y=${y}:eof_action=pass:enable='between(t,${sec(c.startMs)},${sec(end)})'[cv${k + 1}]`,
      );
    });

    let cur = mediaClips.length;
    for (const c of textClips) {
      const fontsize = Math.max(8, Math.round(H * c.textSize));
      const font = opts.windows
        ? `fontfile=${escDrawtext("C:/Windows/Fonts/arial.ttf")}`
        : "font=Sans";
      const color = `${ffColor(c.textColor)}@${num(c.opacity)}`;
      const box = c.textBox
        ? `:box=1:boxcolor=0x000000@0.45:boxborderw=${Math.max(4, Math.round(fontsize * 0.3))}`
        : "";
      parts.push(
        `[cv${cur}]drawtext=${font}:text=${escDrawtext(c.text)}:expansion=none:fontcolor=${color}:fontsize=${fontsize}` +
          `:x=${Math.round(W * c.x)}:y=${Math.round(H * c.y)}${box}:enable='between(t,${sec(c.startMs)},${sec(clipEndMs(c))})'[cv${cur + 1}]`,
      );
      cur++;
    }
    maps.push("-map", `[cv${cur}]`);
  }

  // ---- áudio: atrim + atempo + afade + volume + adelay; amix se > 1.
  if (audioClips.length > 0) {
    const labels: string[] = [];
    const srcOf = sourceLabels(audioClips, "a");
    audioClips.forEach((c, k) => {
      const delay = Math.round(c.startMs);
      const dur = clipDurMs(c);
      const fi = Math.min(c.fadeInMs, dur);
      const fo = Math.min(c.fadeOutMs, dur);
      const chain = [
        `atrim=start=${sec(c.inMs)}:end=${sec(c.outMs)}`,
        "asetpts=PTS-STARTPTS",
        ...atempoFactors(c.speed).map((f) => `atempo=${num(f)}`),
        ...(fi > 0 ? [`afade=t=in:st=0:d=${sec(fi)}`] : []),
        ...(fo > 0 ? [`afade=t=out:st=${sec(dur - fo)}:d=${sec(fo)}`] : []),
        `volume=${num(c.gain)}`,
        "aformat=sample_rates=48000:channel_layouts=stereo",
        `adelay=${delay}|${delay}`,
      ];
      parts.push(`${srcOf.get(c.id)}${chain.join(",")}[a${k}]`);
      labels.push(`[a${k}]`);
    });
    if (labels.length > 1) {
      parts.push(`${labels.join("")}amix=inputs=${labels.length}:duration=longest:normalize=0[aout]`);
      maps.push("-map", "[aout]");
    } else {
      maps.push("-map", labels[0]);
    }
  }

  const hasVideo = videoKinds.length > 0;
  const args = [
    ...inputArgs,
    "-filter_complex",
    parts.join(";"),
    ...maps,
    ...(hasVideo
      ? ["-c:v", "libx264", "-crf", String(crf), "-preset", "veryfast", "-pix_fmt", "yuv420p"]
      : []),
    ...(audioClips.length > 0 ? ["-c:a", "aac", "-b:a", "192k"] : ["-an"]),
    "-movflags", "+faststart",
    "-t", sec(durMs),
  ];

  return {
    label: tr("editor.exportTitle"),
    ext: hasVideo ? "mp4" : "m4a",
    suffix: "editado",
    denomMs: durMs,
    steps: [args],
  };
}
