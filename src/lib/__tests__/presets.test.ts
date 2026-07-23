import { describe, expect, it } from "vitest";
import {
  buildBurnSubs,
  buildConcat,
  buildConvert,
  buildCut,
  buildCutSilence,
  buildGif,
  buildHideRegion,
  buildMuxSubs,
  buildTracks,
  buildWatermark,
  concatCompatible,
  estimateCompress,
  ffTime,
} from "../presets";
import type { MediaInfo } from "../types";

const audio: MediaInfo = {
  path: "C:\\a\\voz.mp3",
  name: "voz.mp3",
  sizeBytes: 5_000_000,
  durationMs: 120_000,
  container: "mp3",
  video: null,
  audio: [{ index: 0, codec: "mp3", channels: 2, lang: "", title: "" }],
  subs: [],
};

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

describe("legendas", () => {
  it("queimar de arquivo externo escapa o caminho do Windows no filtro", () => {
    const b = buildBurnSubs(video, { kind: "file", path: "C:\\legendas\\filme pt.srt" }, 0);
    const args = b.steps[0];
    const vf = args[args.indexOf("-vf") + 1];
    // Dois níveis de escape: "C:" vira "C\\:" e as barras viram "/".
    expect(vf).toBe("subtitles=C\\\\:/legendas/filme pt.srt");
    expect(args).toContain("libx264"); // hardsub recodifica o vídeo…
    const ca = args[args.indexOf("-c:a") + 1];
    expect(ca).toBe("copy"); // …mas copia o áudio
    expect(b.ext).toBe("mkv"); // origem mkv fica mkv
  });

  it("queimar legenda embutida usa o próprio vídeo com si=N e força tamanho", () => {
    const b = buildBurnSubs(video, { kind: "embedded", index: 0 }, 24);
    const vf = b.steps[0][b.steps[0].indexOf("-vf") + 1];
    expect(vf).toContain(":si=0");
    expect(vf).toContain(":force_style=Fontsize=24");
    expect(vf).toContain("subtitles=C\\\\:/v/filme.mkv");
  });

  it("anexar como faixa não recodifica; mp4 vira mov_text, mkv copia", () => {
    const mkv = buildMuxSubs(video, "C:/l/pt.srt");
    expect(mkv.steps[0]).toContain("copy");
    expect(mkv.steps[0]).not.toContain("libx264");
    expect(mkv.steps[0][mkv.steps[0].indexOf("-c:s") + 1]).toBe("copy");
    expect(mkv.ext).toBe("mkv");

    const mp4 = buildMuxSubs({ ...video, container: "mp4" }, "C:/l/pt.srt");
    expect(mp4.steps[0][mp4.steps[0].indexOf("-c:s") + 1]).toBe("mov_text");
    expect(mp4.ext).toBe("mp4");

    // Container sem suporte a legenda cai pra MKV.
    const avi = buildMuxSubs({ ...video, container: "avi" }, "C:/l/pt.srt");
    expect(avi.ext).toBe("mkv");
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

describe("buildWatermark (logo)", () => {
  it("dois inputs, overlay no canto pedido, áudio copiado", () => {
    const b = buildWatermark(video, "C:\\l\\logo.png", "tr", 0.15, 0.8);
    const args = b.steps[0];
    // Vídeo é o input 0, logo o 1.
    expect(args[args.indexOf("-i") + 1]).toBe(video.path);
    expect(args.lastIndexOf("-i")).toBeGreaterThan(args.indexOf("-i"));
    expect(args[args.lastIndexOf("-i") + 1]).toBe("C:\\l\\logo.png");
    const fc = args[args.indexOf("-filter_complex") + 1];
    // Canto superior direito: encosta na direita e no topo, com margem.
    expect(fc).toContain("overlay=main_w-overlay_w-");
    // Logo escalado pra 15% da largura (1920*0.15 = 288) e opacidade 0.8.
    expect(fc).toContain("scale=288:-1");
    expect(fc).toContain("colorchannelmixer=aa=0.800");
    expect(args).toContain("copy"); // -c:a copy
  });

  it("centro usa expressão centralizada", () => {
    const fc = buildWatermark(video, "l.png", "center", 0.2, 1).steps[0].join(" ");
    expect(fc).toContain("overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2");
  });
});

describe("buildHideRegion (esconder logo — delogo, não remove)", () => {
  it("usa delogo com a região no canto, respeitando a borda de 1px", () => {
    const b = buildHideRegion(video, "br", 0.2, 0.12);
    const vf = b.steps[0][b.steps[0].indexOf("-vf") + 1];
    expect(vf).toMatch(/^delogo=x=\d+:y=\d+:w=\d+:h=\d+$/);
    // Canto inferior direito de 1920×1080: x/y positivos, dentro do quadro.
    const m = vf.match(/x=(\d+):y=(\d+):w=(\d+):h=(\d+)/)!;
    const [x, y, w, h] = m.slice(1).map(Number);
    expect(x + w).toBeLessThanOrEqual(1919); // 1px de borda à direita
    expect(y + h).toBeLessThanOrEqual(1079);
    expect(x).toBeGreaterThanOrEqual(1);
    expect(y).toBeGreaterThanOrEqual(1);
  });
});

describe("buildCutSilence (só áudio — no vídeo dessincronizaria)", () => {
  it("silenceremove com o threshold pedido, sem vídeo", () => {
    const b = buildCutSilence(audio, -45);
    const args = b.steps[0];
    expect(args).toContain("-vn");
    const af = args[args.indexOf("-af") + 1];
    expect(af).toContain("silenceremove");
    expect(af).toContain("start_threshold=-45dB");
    expect(af).toContain("stop_threshold=-45dB");
    expect(b.ext).toBe("mp3");
  });

  it("threshold é grampeado pra faixa sã", () => {
    expect(buildCutSilence(audio, -999).steps[0].join(" ")).toContain("-80dB");
    expect(buildCutSilence(audio, 5).steps[0].join(" ")).toContain("-10dB");
  });
});
