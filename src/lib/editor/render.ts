/** Exportação do projeto do editor → argumentos do ffmpeg (função PURA,
 *  unit-testada; o Rust injeta -y/-progress/etc. como nos presets).
 *
 *  Estratégia: um canvas preto do tamanho/duração do projeto (source `color`)
 *  recebe cada clipe de vídeo/imagem por `overlay` na ordem das trilhas
 *  (V1 primeiro, camadas por cima depois), com `enable=between(t,…)` pra
 *  janela de tempo. Áudio: cada clipe vira atrim+adelay e tudo se mistura
 *  num `amix`. Imagens entram com `-loop 1 -t`. */

import type { BuiltJob } from "../presets";
import {
  clipDurMs,
  clipEndMs,
  isVideoKind,
  projectDurMs,
  type Clip,
  type ProjectSettings,
} from "./model";

/** ms → segundos com 3 casas ("12.345") pros filtros. */
function sec(ms: number): string {
  return (Math.max(0, ms) / 1000).toFixed(3);
}

/** Largura par (o yuv420p exige dimensões pares). */
function even(px: number): number {
  return Math.max(2, 2 * Math.round(px / 2));
}

function num(v: number): string {
  return String(Math.round(v * 100) / 100);
}

export function buildTimelineExport(project: ProjectSettings, clips: Clip[]): BuiltJob {
  const durMs = projectDurMs(clips);
  const { width: W, height: H, fps } = project;

  const videoClips = clips
    .filter((c) => isVideoKind(c.kind))
    .sort((a, b) => a.track - b.track || a.startMs - b.startMs);
  const audioClips = clips
    .filter((c) => c.kind === "audio" && !c.muted && c.gain > 0)
    .sort((a, b) => a.track - b.track || a.startMs - b.startMs);

  // ---- entradas (-i): imagens são 1 entrada POR CLIPE (-loop 1 -t);
  // vídeo/áudio deduplicam por caminho.
  const inputArgs: string[] = [];
  const byPath = new Map<string, number>();
  const inputOf = new Map<string, number>();
  let n = 0;
  for (const c of [...videoClips, ...audioClips]) {
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
  function sourceLabels(
    clipsOfKind: Clip[],
    stream: "v" | "a",
  ): Map<string, string> {
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

  // ---- vídeo: canvas + um overlay por clipe, na ordem das camadas.
  if (videoClips.length > 0) {
    parts.push(`color=c=black:s=${W}x${H}:r=${fps}:d=${sec(durMs)}[cv0]`);
    const srcOf = sourceLabels(videoClips, "v");
    videoClips.forEach((c, k) => {
      const i = inputOf.get(c.id);
      const scale =
        c.fit === "cheia"
          ? `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2`
          : `scale=${even(W * c.w)}:-2`;
      const chain =
        c.kind === "image"
          ? `[${i}:v]setpts=PTS-STARTPTS+${sec(c.startMs)}/TB,${scale},setsar=1[v${k}]`
          : `${srcOf.get(c.id)}trim=start=${sec(c.inMs)}:end=${sec(c.outMs)},setpts=PTS-STARTPTS+${sec(c.startMs)}/TB,${scale},setsar=1[v${k}]`;
      parts.push(chain);
      const x = c.fit === "cheia" ? 0 : Math.round(W * c.x);
      const y = c.fit === "cheia" ? 0 : Math.round(H * c.y);
      parts.push(
        `[cv${k}][v${k}]overlay=x=${x}:y=${y}:eof_action=pass:enable='between(t,${sec(c.startMs)},${sec(clipEndMs(c))})'[cv${k + 1}]`,
      );
    });
    maps.push("-map", `[cv${videoClips.length}]`);
  }

  // ---- áudio: atrim + volume + adelay por clipe; amix se houver mais de um.
  if (audioClips.length > 0) {
    const labels: string[] = [];
    const srcOf = sourceLabels(audioClips, "a");
    audioClips.forEach((c, k) => {
      const delay = Math.round(c.startMs);
      parts.push(
        `${srcOf.get(c.id)}atrim=start=${sec(c.inMs)}:end=${sec(c.outMs)},asetpts=PTS-STARTPTS,volume=${num(c.gain)},` +
          `aformat=sample_rates=48000:channel_layouts=stereo,adelay=${delay}|${delay}[a${k}]`,
      );
      labels.push(`[a${k}]`);
    });
    if (labels.length > 1) {
      parts.push(`${labels.join("")}amix=inputs=${labels.length}:duration=longest:normalize=0[aout]`);
      maps.push("-map", "[aout]");
    } else {
      maps.push("-map", labels[0]);
    }
  }

  const hasVideo = videoClips.length > 0;
  const args = [
    ...inputArgs,
    "-filter_complex",
    parts.join(";"),
    ...maps,
    ...(hasVideo
      ? ["-c:v", "libx264", "-crf", "20", "-preset", "veryfast", "-pix_fmt", "yuv420p"]
      : []),
    ...(audioClips.length > 0 ? ["-c:a", "aac", "-b:a", "192k"] : ["-an"]),
    "-movflags", "+faststart",
    "-t", sec(durMs),
  ];

  return {
    label: "Exportar projeto",
    ext: hasVideo ? "mp4" : "m4a",
    suffix: "editado",
    denomMs: durMs,
    steps: [args],
  };
}
