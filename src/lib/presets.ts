/** Montagem dos argumentos do ffmpeg — funções PURAS (unit-testadas).
 *  O Rust injeta `-hide_banner -nostdin -y -progress pipe:1 -loglevel error`;
 *  aqui entra só o que muda por operação. Regra de ouro do plano: corte sem
 *  troca de codec usa `-c copy` (instantâneo, sem re-encode). */

import { escDrawtext } from "./editor/render";
import { t as tr, type MessageKey } from "./i18n";
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

// label/hint são CHAVES de i18n (o componente chama t()) — assim são reativas à troca de idioma.
export const PRESETS: { id: PresetId; label: MessageKey; hint: MessageKey; audioOnly: boolean }[] = [
  { id: "mp4-web", label: "preset.mp4web.label", hint: "preset.mp4web.hint", audioOnly: false },
  { id: "whatsapp", label: "preset.whatsapp.label", hint: "preset.whatsapp.hint", audioOnly: false },
  { id: "webm", label: "preset.webm.label", hint: "preset.webm.hint", audioOnly: false },
  { id: "mkv-copy", label: "preset.mkvcopy.label", hint: "preset.mkvcopy.hint", audioOnly: false },
  { id: "mp3", label: "preset.mp3.label", hint: "preset.mp3.hint", audioOnly: true },
  { id: "opus", label: "preset.opus.label", hint: "preset.opus.hint", audioOnly: true },
  { id: "wav-voz", label: "preset.wavvoz.label", hint: "preset.wavvoz.hint", audioOnly: true },
];

export function buildConvert(info: MediaInfo, preset: PresetId): BuiltJob {
  const base = ["-i", info.path];
  const d = info.durationMs;
  switch (preset) {
    case "mp4-web":
      return {
        label: tr("job.convertMp4"),
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
        label: tr("job.convertWhatsapp"),
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
        label: tr("job.convertWebm"),
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
        label: tr("job.remuxMkv"),
        ext: "mkv",
        suffix: "mkv",
        denomMs: d,
        steps: [[...base, "-map", "0", "-c", "copy"]],
      };
    case "mp3":
      return {
        label: tr("job.extractMp3"),
        ext: "mp3",
        suffix: "audio",
        denomMs: d,
        steps: [[...base, "-vn", "-c:a", "libmp3lame", "-q:a", "2"]],
      };
    case "opus":
      return {
        label: tr("job.extractOpus"),
        ext: "opus",
        suffix: "audio",
        denomMs: d,
        steps: [[...base, "-vn", "-c:a", "libopus", "-b:a", "96k"]],
      };
    case "wav-voz":
      return {
        label: tr("job.audioTranscribe"),
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
    label: tr("job.compress", { c }),
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
      label: tr("job.cutCopy"),
      ext: info.container || "mp4",
      suffix: "corte",
      denomMs: dur,
      steps: [[...seek, "-map", "0", "-c", "copy", "-avoid_negative_ts", "make_zero"]],
    };
  }
  return {
    label: tr("job.cutRecode"),
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
    label: tr("job.gif"),
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
    label: tr("job.concat"),
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
    label: tr("job.resize", { w: width }),
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
    label: tr("job.rotate", { r: rotation }),
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

// ---------- quick-ops (v0.11): logo, esconder região, cortar silêncio ----------
//
// A régua da suíte (decisão 2026-07-23): operação de UM arquivo, UM passo, SEM
// timeline mora no Media (o "resolvo rápido"); arranjar clipes no tempo é o
// LocalVideo. Estas três são exatamente isso — o que o Video faz do jeito
// profissional (camada de imagem, filtro por clipe), aqui é um clique.

/** Onde o logo/região se ancora no quadro. Quatro cantos + centro cobrem o que
 *  a mão precisa; um seletor de caixa livre seria o editor, que é o Video. */
export type Corner = "tl" | "tr" | "bl" | "br" | "center";

/** Expressão de posição do `overlay` (usa main_w/overlay_w do ffmpeg) — o logo
 *  já foi escalado, então a margem `m` é em pixels do quadro de saída. */
function overlayPos(corner: Corner, m: number): string {
  switch (corner) {
    case "tl": return `${m}:${m}`;
    case "tr": return `main_w-overlay_w-${m}:${m}`;
    case "bl": return `${m}:main_h-overlay_h-${m}`;
    case "br": return `main_w-overlay_w-${m}:main_h-overlay_h-${m}`;
    case "center": return `(main_w-overlay_w)/2:(main_h-overlay_h)/2`;
  }
}

function clampInt(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

/**
 * Marca d'água / logo: sobrepõe um PNG num canto. `sizePct` é a largura do logo
 * como fração da largura do vídeo; `opacity` 0..1. Recodifica o vídeo (overlay
 * mexe no pixel), copia o áudio. É o "carimba meu logo nisto" — no Video o mesmo
 * é uma camada de imagem que entra e sai no tempo.
 */
export function buildWatermark(
  info: MediaInfo,
  logoPath: string,
  corner: Corner,
  sizePct: number,
  opacity: number,
): BuiltJob {
  const W = info.video?.width ?? 1280;
  const logoW = clampInt(W * sizePct, 2, W);
  const m = Math.max(1, Math.round(W * 0.02));
  const op = Math.min(1, Math.max(0, opacity));
  // Logo escalado + opacidade extra (colorchannelmixer=aa) e depois o overlay.
  const fc =
    `[1:v]scale=${logoW}:-1,format=rgba,colorchannelmixer=aa=${op.toFixed(3)}[l];` +
    `[0:v][l]overlay=${overlayPos(corner, m)}[v]`;
  const container = info.container === "mkv" ? "mkv" : "mp4";
  return {
    label: tr("job.watermark"),
    ext: container,
    suffix: "logo",
    denomMs: info.durationMs,
    steps: [
      [
        "-i", info.path,
        "-i", logoPath,
        "-filter_complex", fc,
        "-map", "[v]", "-map", "0:a?",
        "-c:v", "libx264", "-crf", "20", "-preset", "veryfast",
        "-pix_fmt", "yuv420p",
        "-c:a", "copy",
        ...(container === "mp4" ? ["-movflags", "+faststart"] : []),
      ],
    ],
  };
}

/**
 * Esconder um logo/marca: o filtro `delogo` BORRA uma região interpolando das
 * bordas. **Esconde, não reconstrói** — remoção de verdade (inpainting) é o
 * LocalPaint (MI-GAN/LaMa). O nome e a dica dizem isso, pra o botão não prometer
 * o que não cumpre. Região por canto + tamanho (fração), como o logo.
 */
export function buildHideRegion(
  info: MediaInfo,
  corner: Corner,
  wPct: number,
  hPct: number,
): BuiltJob {
  const W = info.video?.width ?? 1280;
  const H = info.video?.height ?? 720;
  let bw = clampInt(W * wPct, 8, W - 4);
  let bh = clampInt(H * hPct, 8, H - 4);
  const m = Math.round(W * 0.02);
  let x = 0, y = 0;
  switch (corner) {
    case "tl": x = m; y = m; break;
    case "tr": x = W - bw - m; y = m; break;
    case "bl": x = m; y = H - bh - m; break;
    case "br": x = W - bw - m; y = H - bh - m; break;
    case "center": x = (W - bw) / 2; y = (H - bh) / 2; break;
  }
  // delogo EXIGE 1px de borda dentro do quadro (interpola dela) — clampa x/y/w/h.
  x = clampInt(x, 1, W - 3);
  y = clampInt(y, 1, H - 3);
  bw = clampInt(bw, 1, W - x - 1);
  bh = clampInt(bh, 1, H - y - 1);
  const container = info.container === "mkv" ? "mkv" : "mp4";
  return {
    label: tr("job.hideRegion"),
    ext: container,
    suffix: "sem-logo",
    denomMs: info.durationMs,
    steps: [
      [
        "-i", info.path,
        "-vf", `delogo=x=${x}:y=${y}:w=${bw}:h=${bh}`,
        "-c:v", "libx264", "-crf", "20", "-preset", "veryfast",
        "-pix_fmt", "yuv420p",
        "-c:a", "copy",
        ...(container === "mp4" ? ["-movflags", "+faststart"] : []),
      ],
    ],
  };
}

/**
 * Cortar silêncio de um ÁUDIO: `silenceremove` tira o silêncio do começo e os
 * vãos longos (> `stop_duration`). **Só áudio** de propósito — num vídeo, encurtar
 * o áudio dessincronizaria a imagem (isso é trabalho de timeline, o Video). Pra
 * limpar uma gravação de voz/podcast é o clique certo. `thresholdDb` negativo
 * (ex.: −50) = o que conta como silêncio.
 */
export function buildCutSilence(info: MediaInfo, thresholdDb: number): BuiltJob {
  const th = clampInt(thresholdDb, -80, -10);
  const af =
    `silenceremove=start_periods=1:start_duration=0:start_threshold=${th}dB:` +
    `stop_periods=-1:stop_duration=0.3:stop_threshold=${th}dB`;
  return {
    label: tr("job.cutSilence"),
    ext: "mp3",
    suffix: "sem-silencio",
    denomMs: info.durationMs,
    steps: [["-i", info.path, "-vn", "-af", af, "-c:a", "libmp3lame", "-q:a", "2"]],
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
    label: tr("job.loudnorm"),
    ext: hasVideo ? (info.container === "mkv" ? "mkv" : "mp4") : "mp3",
    suffix: "volume",
    denomMs: info.durationMs,
    steps: [args],
  };
}

// ---------- legendas (queimar / anexar) ----------

/** De onde vem a legenda: arquivo externo (.srt/.vtt/.ass) ou uma faixa já
 *  embutida no próprio vídeo (índice entre as legendas). */
export type SubSource = { kind: "file"; path: string } | { kind: "embedded"; index: number };

/** Queima a legenda nos quadros (hardsub) — pra postar onde legenda em faixa
 *  não aparece (WhatsApp, Instagram…). Recodifica o vídeo; áudio é copiado.
 *  fontSize 0 = tamanho padrão do libass. */
export function buildBurnSubs(info: MediaInfo, source: SubSource, fontSize: number): BuiltJob {
  const subPath = source.kind === "file" ? source.path : info.path;
  // Mesmo escaping de dois níveis do drawtext (caminho vira valor de filtro).
  let vf = `subtitles=${escDrawtext(subPath.replace(/\\/g, "/"))}`;
  if (source.kind === "embedded") vf += `:si=${source.index}`;
  if (fontSize > 0) vf += `:force_style=Fontsize=${fontSize}`;
  const container = info.container === "mkv" ? "mkv" : "mp4";
  return {
    label: tr("job.burnSubs"),
    ext: container,
    suffix: "legendado",
    denomMs: info.durationMs,
    steps: [
      [
        "-i", info.path,
        "-map", "0:v:0", "-map", "0:a?",
        "-vf", vf,
        "-c:v", "libx264", "-crf", "20", "-preset", "veryfast",
        "-pix_fmt", "yuv420p",
        "-c:a", "copy",
        ...(container === "mp4" ? ["-movflags", "+faststart"] : []),
      ],
    ],
  };
}

/** Anexa um arquivo de legenda como FAIXA, sem recodificar (instantâneo).
 *  MP4 só carrega mov_text; MKV copia srt/ass como estão. Containers que não
 *  aceitam legenda (avi/webm…) saem como MKV. */
export function buildMuxSubs(info: MediaInfo, subPath: string): BuiltJob {
  const mp4 = ["mp4", "m4v", "mov"].includes(info.container);
  const container = mp4 ? "mp4" : "mkv";
  return {
    label: tr("job.muxSubs"),
    ext: container,
    suffix: "legendado",
    denomMs: info.durationMs,
    steps: [
      [
        "-i", info.path,
        "-i", subPath,
        "-map", "0", "-map", "1:0",
        "-c", "copy",
        "-c:s", mp4 ? "mov_text" : "copy",
        ...(mp4 ? ["-movflags", "+faststart"] : []),
      ],
    ],
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
    label: tr("job.tracks"),
    ext: container,
    suffix: "faixas",
    denomMs: info.durationMs,
    steps: [args],
  };
}
