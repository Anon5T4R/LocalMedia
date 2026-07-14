/** Informações de um arquivo de mídia (ffprobe já parseado). */
export interface AudioTrack {
  index: number; // índice do stream de áudio (0-based entre os áudios)
  codec: string;
  channels: number;
  lang: string;
  title: string;
}

export interface SubTrack {
  index: number; // índice do stream de legenda (0-based entre as legendas)
  codec: string;
  lang: string;
  title: string;
}

export interface MediaInfo {
  path: string;
  name: string;
  sizeBytes: number;
  durationMs: number;
  container: string;
  video: { codec: string; width: number; height: number; fps: number } | null;
  audio: AudioTrack[];
  subs: SubTrack[];
}

export interface MediaFile {
  id: string;
  info: MediaInfo;
  thumb?: string; // primeira miniatura (capa do card)
  selected: boolean;
}

export type JobStatus = "waiting" | "running" | "done" | "error" | "cancelled";

/** Um job pode ter vários passes do ffmpeg (ex.: GIF = palettegen + paletteuse). */
export interface Job {
  id: string;
  label: string;
  steps: string[][];
  outPath: string;
  /** Denominador do progresso (ms processados / este valor). */
  denomMs: number;
  status: JobStatus;
  step: number;
  pct: number;
  speed: string;
  error?: string;
}

export const MEDIA_EXTENSIONS = [
  "mp4",
  "mkv",
  "webm",
  "avi",
  "mov",
  "m4v",
  "mpg",
  "mpeg",
  "ts",
  "wmv",
  "flv",
  "3gp",
  "mp3",
  "m4a",
  "m4b",
  "aac",
  "ogg",
  "oga",
  "opus",
  "flac",
  "wav",
  "wma",
  "mka",
  "gif",
];

/** Imagens aceitas no editor (viram clipes de duração livre). */
export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "bmp"];

/** Arquivos de legenda aceitos (queimar/anexar). */
export const SUBTITLE_EXTENSIONS = ["srt", "vtt", "ass", "ssa"];
