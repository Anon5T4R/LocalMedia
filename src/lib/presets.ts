/** Montagem dos argumentos do ffmpeg — funções PURAS (unit-testadas).
 *  O Rust injeta `-hide_banner -nostdin -y -progress pipe:1 -loglevel error`;
 *  aqui entra só o que muda por operação. Regra de ouro do plano: corte sem
 *  troca de codec usa `-c copy` (instantâneo, sem re-encode). */

import type { MediaInfo } from "./types";

export interface BuiltJob {
  label: string;
  steps: string[][];
  /** Extensão sugerida do arquivo de saída. */
  ext: string;
  /** Sufixo pro nome sugerido ("meu video - <sufixo>.<ext>"). */
  suffix: string;
  /** Denominador de progresso em ms (duração processada). */
  denomMs: number;
}

/** ms → "HH:MM:SS.mmm" pros -ss/-t. */
export function ffTime(ms: number): string {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3_600_000);
  const m = Math.floor((t % 3_600_000) / 60_000);
  const s = Math.floor((t % 60_000) / 1000);
  const frac = t % 1000;
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(h)}:${two(m)}:${two(s)}.${String(frac).padStart(3, "0")}`;
}

// ---------- conversão com presets ----------

export type PresetId =
  | "mp4-web"
  | "whatsapp"
  | "webm"
  | "mkv-copy"
  | "mp3"
  | "opus"
  | "wav-voz";

export const PRESETS: { id: PresetId; label: string; hint: string; audioOnly: boolean }[] = [
  {
    id: "mp4-web",
    label: "Vídeo pra web (MP4/H.264)",
    hint: "compatível com tudo, começa a tocar antes de baixar inteiro",
    audioOnly: false,
  },
  {
    id: "whatsapp",
    label: "Compatível com WhatsApp",
    hint: "MP4 H.264 até 1280px, arquivo pequeno",
    audioOnly: false,
  },
  { id: "webm", label: "WebM (VP9)", hint: "aberto, ótimo pra web moderna", audioOnly: false },
  {
    id: "mkv-copy",
    label: "Trocar container pra MKV (sem recodificar)",
    hint: "instantâneo — só re-empacota os streams",
    audioOnly: false,
  },
  { id: "mp3", label: "Só o áudio (MP3)", hint: "universal", audioOnly: true },
  { id: "opus", label: "Só o áudio (Opus)", hint: "melhor qualidade por MB", audioOnly: true },
  {
    id: "wav-voz",
    label: "Áudio pra transcrição (WAV 16 kHz mono)",
    hint: "o formato que o LocalScribe usa",
    audioOnly: true,
  },
];

export function buildConvert(info: MediaInfo, preset: PresetId): BuiltJob {
  const base = ["-i", info.path];
  const d = info.durationMs;
  switch (preset) {
    case "mp4-web":
      return {
        label: "Converter → MP4 web",
        ext: "mp4",
        suffix: "web",
        denomMs: d,
        steps: [
          [
            ...base,
            "-c:v", "libx264", "-crf", "23", "-preset", "veryfast",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "128k",
            "-movflags", "+faststart",
          ],
        ],
      };
    case "whatsapp":
      return {
        label: "Converter → WhatsApp",
        ext: "mp4",
        suffix: "whatsapp",
        denomMs: d,
        steps: [
          [
            ...base,
            "-vf", "scale='min(1280,iw)':-2",
            "-c:v", "libx264", "-crf", "26", "-preset", "veryfast",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "96k",
            "-movflags", "+faststart",
          ],
        ],
      };
    case "webm":
      return {
        label: "Converter → WebM",
        ext: "webm",
        suffix: "webm",
        denomMs: d,
        steps: [
          [
            ...base,
            "-c:v", "libvpx-vp9", "-crf", "32", "-b:v", "0",
            "-row-mt", "1", "-cpu-used", "4",
            "-c:a", "libopus", "-b:a", "96k",
          ],
        ],
      };
    case "mkv-copy":
      return {
        label: "Re-empacotar → MKV",
        ext: "mkv",
        suffix: "mkv",
        denomMs: d,
        steps: [[...base, "-map", "0", "-c", "copy"]],
      };
    case "mp3":
      return {
        label: "Extrair áudio → MP3",
        ext: "mp3",
        suffix: "audio",
        denomMs: d,
        steps: [[...base, "-vn", "-c:a", "libmp3lame", "-q:a", "2"]],
      };
    case "opus":
      return {
        label: "Extrair áudio → Opus",
        ext: "opus",
        suffix: "audio",
        denomMs: d,
        steps: [[...base, "-vn", "-c:a", "libopus", "-b:a", "96k"]],
      };
    case "wav-voz":
      return {
        label: "Áudio pra transcrição",
        ext: "wav",
        suffix: "16khz",
        denomMs: d,
        steps: [[...base, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le"]],
      };
  }
}

// ---------- compressão por qualidade (CRF) ----------

export function buildCompress(info: MediaInfo, crf: number): BuiltJob {
  const c = Math.min(34, Math.max(18, Math.round(crf)));
  return {
    label: `Comprimir (CRF ${c})`,
    ext: "mp4",
    suffix: `crf${c}`,
    denomMs: info.durationMs,
    steps: [
      [
        "-i", info.path,
        "-c:v", "libx264", "-crf", String(c), "-preset", "medium",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
      ],
    ],
  };
}

/** Estimativa GROSSEIRA do tamanho pós-CRF (fração do original, heurística). */
export function estimateCompress(sizeBytes: number, crf: number): number {
  // CRF 18 ≈ 90% do original; cada +1 de CRF ≈ ×0.82. Só pra dar noção.
  const factor = 0.9 * Math.pow(0.82, crf - 18);
  return Math.round(sizeBytes * Math.min(1, factor));
}

// ---------- corte ----------

export function buildCut(
  info: MediaInfo,
  startMs: number,
  endMs: number,
  copy: boolean,
): BuiltJob {
  const dur = Math.max(0, endMs - startMs);
  const seek = ["-ss", ffTime(startMs), "-i", info.path, "-t", ffTime(dur)];
  if (copy) {
    return {
      label: "Cortar (sem recodificar)",
      ext: info.container || "mp4",
      suffix: "corte",
      denomMs: dur,
      steps: [[...seek, "-map", "0", "-c", "copy", "-avoid_negative_ts", "make_zero"]],
    };
  }
  return {
    label: "Cortar (recodificando)",
    ext: "mp4",
    suffix: "corte",
    denomMs: dur,
    steps: [
      [
        ...seek,
        "-c:v", "libx264", "-crf", "20", "-preset", "veryfast",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
      ],
    ],
  };
}

// ---------- GIF (2 passes: palettegen → paletteuse) ----------

export function buildGif(
  info: MediaInfo,
  startMs: number,
  endMs: number,
  fps: number,
  width: number,
  palettePath: string,
): BuiltJob {
  const dur = Math.max(0, endMs - startMs);
  const seek = ["-ss", ffTime(startMs), "-t", ffTime(dur), "-i", info.path];
  const filters = `fps=${fps},scale=${width}:-1:flags=lanczos`;
  return {
    label: "Gerar GIF",
    ext: "gif",
    suffix: "gif",
    denomMs: dur * 2,
    steps: [
      [...seek, "-vf", `${filters},palettegen`, palettePath],
      [
        ...seek,
        "-i", palettePath,
        "-lavfi", `${filters}[x];[x][1:v]paletteuse`,
      ],
    ],
  };
}

// ---------- juntar (concat demuxer, codecs iguais) ----------

export function buildConcat(listPath: string, container: string, totalMs: number): BuiltJob {
  return {
    label: "Juntar clipes",
    ext: container,
    suffix: "juntado",
    denomMs: totalMs,
    steps: [["-f", "concat", "-safe", "0", "-i", listPath, "-map", "0", "-c", "copy"]],
  };
}

/** Os arquivos podem ser concatenados com -c copy? (mesmo container/codecs) */
export function concatCompatible(files: MediaInfo[]): boolean {
  if (files.length < 2) return false;
  const first = files[0];
  return files.every(
    (f) =>
      f.container === first.container &&
      (f.video?.codec ?? "") === (first.video?.codec ?? "") &&
      (f.audio[0]?.codec ?? "") === (first.audio[0]?.codec ?? ""),
  );
}

// ---------- ajustes (redimensionar / rotacionar / volume) ----------

export function buildResize(info: MediaInfo, width: number): BuiltJob {
  return {
    label: `Redimensionar → ${width}px`,
    ext: "mp4",
    suffix: `${width}px`,
    denomMs: info.durationMs,
    steps: [
      [
        "-i", info.path,
        "-vf", `scale=${width}:-2`,
        "-c:v", "libx264", "-crf", "20", "-preset", "veryfast",
        "-pix_fmt", "yuv420p",
        "-c:a", "copy",
        "-movflags", "+faststart",
      ],
    ],
  };
}

export type Rotation = 90 | 180 | 270;

export function buildRotate(info: MediaInfo, rotation: Rotation): BuiltJob {
  const vf =
    rotation === 90 ? "transpose=1" : rotation === 270 ? "transpose=2" : "transpose=1,transpose=1";
  return {
    label: `Rotacionar ${rotation}°`,
    ext: "mp4",
    suffix: `rot${rotation}`,
    denomMs: info.durationMs,
    steps: [
      [
        "-i", info.path,
        "-vf", vf,
        "-c:v", "libx264", "-crf", "20", "-preset", "veryfast",
        "-pix_fmt", "yuv420p",
        "-c:a", "copy",
        "-movflags", "+faststart",
      ],
    ],
  };
}

export function buildLoudnorm(info: MediaInfo): BuiltJob {
  const hasVideo = info.video !== null;
  const args = hasVideo
    ? [
        "-i", info.path,
        "-c:v", "copy",
        "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
        "-c:a", "aac", "-b:a", "160k",
      ]
    : ["-i", info.path, "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-c:a", "libmp3lame", "-q:a", "2"];
  return {
    label: "Normalizar volume",
    ext: hasVideo ? (info.container === "mkv" ? "mkv" : "mp4") : "mp3",
    suffix: "volume",
    denomMs: info.durationMs,
    steps: [args],
  };
}

// ---------- faixas (áudio/legendas) ----------

export function buildTracks(
  info: MediaInfo,
  keepAudio: number[],
  keepSubs: number[],
): BuiltJob {
  const container = info.container === "mkv" ? "mkv" : "mp4";
  const args = ["-i", info.path, "-map", "0:v?"];
  for (const a of keepAudio) args.push("-map", `0:a:${a}`);
  for (const s of keepSubs) args.push("-map", `0:s:${s}`);
  args.push("-c:v", "copy", "-c:a", "copy");
  if (keepSubs.length > 0) {
    // mp4 só carrega legenda mov_text; mkv copia o que vier.
    args.push("-c:s", container === "mp4" ? "mov_text" : "copy");
  } else {
    args.push("-sn");
  }
  return {
    label: "Ajustar faixas",
    ext: container,
    suffix: "faixas",
    denomMs: info.durationMs,
    steps: [args],
  };
}
