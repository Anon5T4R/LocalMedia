import { describe, expect, it } from "vitest";
import {
  buildConcat,
  buildConvert,
  buildCut,
  buildGif,
  buildTracks,
  concatCompatible,
  estimateCompress,
  ffTime,
} from "../presets";
import type { MediaInfo } from "../types";

const video: MediaInfo = {
  path: "C:\\v\\filme.mkv",
  name: "filme.mkv",
  sizeBytes: 100_000_000,
  durationMs: 60_000,
  container: "mkv",
  video: { codec: "h264", width: 1920, height: 1080, fps: 25 },
  audio: [
    { index: 0, codec: "aac", channels: 2, lang: "por", title: "" },
    { index: 1, codec: "aac", channels: 2, lang: "eng", title: "" },
  ],
  subs: [{ index: 0, codec: "subrip", lang: "por", title: "" }],
};

describe("ffTime", () => {
  it("formata HH:MM:SS.mmm", () => {
    expect(ffTime(0)).toBe("00:00:00.000");
    expect(ffTime(90_500)).toBe("00:01:30.500");
    expect(ffTime(3_723_007)).toBe("01:02:03.007");
  });
});

describe("buildConvert", () => {
  it("mp4-web tem faststart e H.264", () => {
    const b = buildConvert(video, "mp4-web");
    const args = b.steps[0];
    expect(b.ext).toBe("mp4");
    expect(args).toContain("libx264");
    expect(args).toContain("+faststart");
    expect(args[args.indexOf("-i") + 1]).toBe(video.path);
  });
  it("wav-voz é 16 kHz mono (contrato com o LocalScribe)", () => {
    const b = buildConvert(video, "wav-voz");
    const args = b.steps[0];
    expect(args).toContain("-vn");
    expect(args[args.indexOf("-ar") + 1]).toBe("16000");
    expect(args[args.indexOf("-ac") + 1]).toBe("1");
  });
});

describe("buildCut", () => {
  it("sem recodificar usa -c copy e seek de entrada", () => {
    const b = buildCut(video, 10_000, 25_000, true);
    const args = b.steps[0];
    // -ss antes do -i (corte rápido por keyframe).
    expect(args.indexOf("-ss")).toBeLessThan(args.indexOf("-i"));
    expect(args[args.indexOf("-ss") + 1]).toBe("00:00:10.000");
    expect(args[args.indexOf("-t") + 1]).toBe("00:00:15.000");
    expect(args).toContain("copy");
    expect(b.denomMs).toBe(15_000);
    expect(b.ext).toBe("mkv"); // mantém o container
  });
  it("recodificando vira mp4 H.264", () => {
    const b = buildCut(video, 0, 5000, false);
    expect(b.ext).toBe("mp4");
    expect(b.steps[0]).toContain("libx264");
  });
});

describe("buildGif", () => {
  it("tem 2 passes: palettegen e paletteuse", () => {
    const b = buildGif(video, 1000, 4000, 12, 480, "C:/tmp/p.png");
    expect(b.steps).toHaveLength(2);
    expect(b.steps[0].join(" ")).toContain("palettegen");
    expect(b.steps[0][b.steps[0].length - 1]).toBe("C:/tmp/p.png");
    expect(b.steps[1].join(" ")).toContain("paletteuse");
    // O 2º passe usa a paleta como 2ª entrada.
    expect(b.steps[1].filter((a) => a === "-i")).toHaveLength(2);
    expect(b.denomMs).toBe(6000); // 3 s × 2 passes
  });
});

describe("buildTracks", () => {
  it("mantém só as faixas pedidas, sem recodificar", () => {
    const b = buildTracks(video, [0], []);
    const args = b.steps[0];
    expect(args.join(" ")).toContain("-map 0:a:0");
    expect(args.join(" ")).not.toContain("-map 0:a:1");
    expect(args).toContain("-sn");
    expect(args.join(" ")).toContain("-c:v copy");
  });
  it("legenda em mp4 vira mov_text, em mkv copia", () => {
    const mp4 = { ...video, container: "mp4" };
    expect(buildTracks(mp4, [0], [0]).steps[0].join(" ")).toContain("-c:s mov_text");
    expect(buildTracks(video, [0], [0]).steps[0].join(" ")).toContain("-c:s copy");
  });
});

describe("concat", () => {
  it("compatível exige mesmo container e codecs", () => {
    const b = { ...video, path: "C:\\v\\b.mkv" };
    expect(concatCompatible([video, b])).toBe(true);
    expect(concatCompatible([video, { ...b, container: "mp4" }])).toBe(false);
    expect(
      concatCompatible([video, { ...b, video: { ...video.video!, codec: "hevc" } }]),
    ).toBe(false);
    expect(concatCompatible([video])).toBe(false);
  });
  it("job de concat usa o demuxer com -c copy", () => {
    const b = buildConcat("C:/tmp/list.txt", "mkv", 120_000);
    const args = b.steps[0];
    expect(args.join(" ")).toContain("-f concat");
    expect(args).toContain("copy");
    expect(b.denomMs).toBe(120_000);
  });
});

describe("estimateCompress", () => {
  it("é monotônica no CRF e nunca maior que o original", () => {
    const s = 100_000_000;
    expect(estimateCompress(s, 20)).toBeGreaterThan(estimateCompress(s, 28));
    expect(estimateCompress(s, 18)).toBeLessThanOrEqual(s);
  });
});
