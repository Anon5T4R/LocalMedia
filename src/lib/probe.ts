/** Parse do JSON do ffprobe (-show_format -show_streams) → MediaInfo. */

import type { AudioTrack, MediaInfo, SubTrack } from "./types";

function fileName(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop() ?? path;
}

/** "30000/1001" → 29.97; "25/1" → 25. */
function parseFps(rate: string | undefined): number {
  if (!rate) return 0;
  const [num, den] = rate.split("/").map(Number);
  if (!num || !den) return Number(rate) || 0;
  return Math.round((num / den) * 100) / 100;
}

export function parseProbe(path: string, raw: string): MediaInfo {
  const data = JSON.parse(raw) as {
    format?: {
      duration?: string;
      size?: string;
      format_name?: string;
    };
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
      avg_frame_rate?: string;
      r_frame_rate?: string;
      channels?: number;
      tags?: Record<string, string>;
    }>;
  };

  const streams = data.streams ?? [];
  const videoStream = streams.find((s) => s.codec_type === "video" && (s.width ?? 0) > 0);
  const audio: AudioTrack[] = [];
  const subs: SubTrack[] = [];
  for (const s of streams) {
    if (s.codec_type === "audio") {
      audio.push({
        index: audio.length,
        codec: s.codec_name ?? "?",
        channels: s.channels ?? 0,
        lang: s.tags?.language ?? "",
        title: s.tags?.title ?? "",
      });
    } else if (s.codec_type === "subtitle") {
      subs.push({
        index: subs.length,
        codec: s.codec_name ?? "?",
        lang: s.tags?.language ?? "",
        title: s.tags?.title ?? "",
      });
    }
  }

  // format_name é uma lista ("mov,mp4,m4a,..."); a extensão real é mais útil.
  const ext = fileName(path).split(".").pop()?.toLowerCase() ?? "";

  return {
    path,
    name: fileName(path),
    sizeBytes: Number(data.format?.size ?? 0),
    durationMs: Math.round(Number(data.format?.duration ?? 0) * 1000),
    container: ext || (data.format?.format_name ?? "").split(",")[0],
    video: videoStream
      ? {
          codec: videoStream.codec_name ?? "?",
          width: videoStream.width ?? 0,
          height: videoStream.height ?? 0,
          fps: parseFps(videoStream.avg_frame_rate ?? videoStream.r_frame_rate),
        }
      : null,
    audio,
    subs,
  };
}
