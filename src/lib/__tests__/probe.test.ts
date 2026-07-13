import { describe, expect, it } from "vitest";
import { parseProbe } from "../probe";

const RAW = JSON.stringify({
  format: { duration: "63.415", size: "12345678", format_name: "matroska,webm" },
  streams: [
    {
      codec_type: "video",
      codec_name: "h264",
      width: 1920,
      height: 1080,
      avg_frame_rate: "30000/1001",
    },
    { codec_type: "audio", codec_name: "aac", channels: 2, tags: { language: "por" } },
    { codec_type: "audio", codec_name: "ac3", channels: 6, tags: { language: "eng" } },
    { codec_type: "subtitle", codec_name: "subrip", tags: { language: "por", title: "Full" } },
  ],
});

describe("parseProbe", () => {
  it("extrai formato, vídeo, áudios e legendas", () => {
    const info = parseProbe("C:\\v\\filme.mkv", RAW);
    expect(info.name).toBe("filme.mkv");
    expect(info.container).toBe("mkv");
    expect(info.durationMs).toBe(63_415);
    expect(info.sizeBytes).toBe(12_345_678);
    expect(info.video).toEqual({ codec: "h264", width: 1920, height: 1080, fps: 29.97 });
    expect(info.audio).toHaveLength(2);
    expect(info.audio[1]).toMatchObject({ index: 1, codec: "ac3", channels: 6, lang: "eng" });
    expect(info.subs[0]).toMatchObject({ index: 0, codec: "subrip", lang: "por", title: "Full" });
  });

  it("áudio puro fica sem vídeo", () => {
    const raw = JSON.stringify({
      format: { duration: "10", size: "1000", format_name: "mp3" },
      streams: [{ codec_type: "audio", codec_name: "mp3", channels: 2 }],
    });
    const info = parseProbe("/m/musica.mp3", raw);
    expect(info.video).toBeNull();
    expect(info.container).toBe("mp3");
    expect(info.audio).toHaveLength(1);
  });
});
