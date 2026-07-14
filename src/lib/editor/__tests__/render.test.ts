import { describe, expect, it } from "vitest";
import { atempoFactors, buildTimelineExport, escDrawtext } from "../render";
import { CLIP_DEFAULTS, type Clip, type ProjectSettings } from "../model";

const PROJ: ProjectSettings = { width: 1280, height: 720, fps: 30 };

function mkClip(over: Partial<Clip>): Clip {
  return {
    id: "c1",
    kind: "video",
    src: { path: "C:/v/a.mp4", name: "a.mp4", durationMs: 10_000, width: 1920, height: 1080 },
    track: 0,
    startMs: 0,
    inMs: 0,
    outMs: 10_000,
    gain: 1,
    muted: false,
    fit: "cheia",
    x: 0,
    y: 0,
    w: 1,
    linkId: "",
    ...CLIP_DEFAULTS,
    ...over,
  };
}

function graphOf(args: string[]): string {
  return args[args.indexOf("-filter_complex") + 1];
}

describe("buildTimelineExport", () => {
  it("vídeo com áudio vinculado: 1 entrada só, overlay com enable e map de áudio direto", () => {
    const v = mkClip({ id: "v", startMs: 1000, inMs: 500, outMs: 4500, linkId: "L" });
    const a = mkClip({ id: "a", kind: "audio", startMs: 1000, inMs: 500, outMs: 4500, linkId: "L" });
    const job = buildTimelineExport(PROJ, [v, a]);
    const args = job.steps[0];

    // Mesmo arquivo → um -i só.
    expect(args.filter((x) => x === "C:/v/a.mp4")).toHaveLength(1);

    const graph = graphOf(args);
    expect(graph).toContain("color=c=black:s=1280x720:r=30:d=5.000[cv0]");
    expect(graph).toContain("[0:v]trim=start=0.500:end=4.500,setpts=PTS-STARTPTS+1.000/TB");
    expect(graph).toContain("force_original_aspect_ratio=decrease");
    expect(graph).toContain("overlay=x=0:y=0:eof_action=pass:enable='between(t,1.000,5.000)'");
    expect(graph).toContain("[0:a]atrim=start=0.500:end=4.500");
    expect(graph).toContain("adelay=1000|1000[a0]");
    expect(graph).not.toContain("amix");

    expect(args).toContain("[cv1]");
    expect(args).toContain("[a0]");
    expect(args).toContain("libx264");
    expect(job.ext).toBe("mp4");
    expect(job.denomMs).toBe(5000);
  });

  it("imagem entra com -loop 1 -t e sem trim; camada custom usa scale por largura", () => {
    const base = mkClip({ id: "v", outMs: 6000 });
    const img = mkClip({
      id: "i",
      kind: "image",
      src: { path: "C:/img/logo.png", name: "logo.png", durationMs: 0, width: 400, height: 400 },
      track: 1,
      startMs: 2000,
      inMs: 0,
      outMs: 3000, // duração = out - in = 3 s na timeline (2 s → 5 s)
      fit: "custom",
      x: 0.5,
      y: 0.25,
      w: 0.25,
    });
    const args = buildTimelineExport(PROJ, [base, img]).steps[0];
    const li = args.indexOf("-loop");
    expect(li).toBeGreaterThanOrEqual(0);
    expect(args.slice(li, li + 6)).toEqual(["-loop", "1", "-t", "3.000", "-i", "C:/img/logo.png"]);

    const graph = graphOf(args);
    expect(graph).toContain("[1:v]setpts=PTS-STARTPTS+2.000/TB,scale=320:-2");
    expect(graph).toContain("overlay=x=640:y=180");
    expect(graph).toContain("[cv2]"); // dois overlays encadeados
  });

  it("duas faixas de áudio → amix", () => {
    const a1 = mkClip({ id: "a1", kind: "audio", outMs: 5000 });
    const a2 = mkClip({
      id: "a2",
      kind: "audio",
      src: { path: "C:/m/musica.mp3", name: "musica.mp3", durationMs: 60_000, width: 0, height: 0 },
      track: 1,
      startMs: 1000,
      outMs: 4000,
      gain: 0.5,
    });
    const graph = graphOf(buildTimelineExport(PROJ, [a1, a2]).steps[0]);
    expect(graph).toContain("volume=0.5");
    expect(graph).toContain("amix=inputs=2:duration=longest:normalize=0[aout]");
  });

  it("projeto só de áudio sai como m4a sem trilha de vídeo", () => {
    const a = mkClip({ id: "a", kind: "audio", outMs: 5000 });
    const job = buildTimelineExport(PROJ, [a]);
    expect(job.ext).toBe("m4a");
    expect(job.steps[0]).not.toContain("libx264");
    expect(graphOf(job.steps[0])).not.toContain("color=");
  });

  it("clipe dividido (mesmo stream 2×) passa por split/asplit — o ffmpeg não aceita reusar [0:v]", () => {
    const v1 = mkClip({ id: "v1", startMs: 0, inMs: 0, outMs: 4000 });
    const v2 = mkClip({ id: "v2", startMs: 4000, inMs: 4000, outMs: 10_000 });
    const a1 = mkClip({ id: "a1", kind: "audio", startMs: 0, inMs: 0, outMs: 4000 });
    const a2 = mkClip({ id: "a2", kind: "audio", startMs: 4000, inMs: 4000, outMs: 10_000 });
    const graph = graphOf(buildTimelineExport(PROJ, [v1, v2, a1, a2]).steps[0]);
    expect(graph).toContain("[0:v]split=2[sv0_0][sv0_1]");
    expect(graph).toContain("[0:a]asplit=2[sa0_0][sa0_1]");
    expect(graph).toContain("[sv0_1]trim=start=4.000:end=10.000");
    expect(graph).toContain("[sa0_0]atrim=start=0.000:end=4.000");
    // Nenhum stream de entrada consumido mais de uma vez.
    expect(graph.match(/\[0:v\]/g)).toHaveLength(1);
    expect(graph.match(/\[0:a\]/g)).toHaveLength(1);
  });

  it("velocidade: setpts dividido no vídeo e atempo no áudio", () => {
    const v = mkClip({ id: "v", outMs: 8000, speed: 2 });
    const a = mkClip({ id: "a", kind: "audio", outMs: 8000, speed: 2 });
    const graph = graphOf(buildTimelineExport(PROJ, [v, a]).steps[0]);
    expect(graph).toContain("setpts=(PTS-STARTPTS)/2+0.000/TB");
    expect(graph).toContain("atempo=2");
  });

  it("atempoFactors encadeia fora da faixa 0.5–2", () => {
    expect(atempoFactors(1)).toEqual([]);
    expect(atempoFactors(4)).toEqual([2, 2]);
    expect(atempoFactors(3)).toEqual([2, 1.5]);
    expect(atempoFactors(0.25)).toEqual([0.5, 0.5]);
    expect(atempoFactors(0.4)).toEqual([0.5, 0.8]);
  });

  it("fades: alpha no vídeo e afade no áudio (nas bordas do clipe)", () => {
    const v = mkClip({ id: "v", startMs: 1000, outMs: 5000, fadeInMs: 500, fadeOutMs: 1000 });
    const a = mkClip({ id: "a", kind: "audio", startMs: 1000, outMs: 5000, fadeInMs: 500, fadeOutMs: 1000 });
    const graph = graphOf(buildTimelineExport(PROJ, [v, a]).steps[0]);
    expect(graph).toContain("format=yuva420p,fade=t=in:st=1.000:d=0.500:alpha=1,fade=t=out:st=5.000:d=1.000:alpha=1");
    expect(graph).toContain("afade=t=in:st=0:d=0.500,afade=t=out:st=4.000:d=1.000");
  });

  it("opacidade e rotação/espelho entram na cadeia do clipe", () => {
    const v = mkClip({ id: "v", outMs: 4000, opacity: 0.5, rotation: 90, flipH: true });
    const graph = graphOf(buildTimelineExport(PROJ, [v]).steps[0]);
    expect(graph).toContain("transpose=1,hflip");
    expect(graph).toContain("colorchannelmixer=aa=0.5");
  });

  it("título vira drawtext por cima de tudo, com escaping e fonte do Windows", () => {
    const v = mkClip({ id: "v", outMs: 6000 });
    const t = mkClip({
      id: "t",
      kind: "text",
      track: 1,
      startMs: 1000,
      inMs: 0,
      outMs: 4000,
      x: 0.1,
      y: 0.8,
      text: "it's 10:30",
      textSize: 0.1,
      textColor: "#ff8800",
      textBox: true,
      src: { path: "", name: "Título", durationMs: 0, width: 0, height: 0 },
    });
    const graph = graphOf(buildTimelineExport(PROJ, [v, t], { windows: true }).steps[0]);
    expect(graph).toContain("fontfile=C\\\\:/Windows/Fonts/arial.ttf");
    expect(graph).toContain("text=it\\\\\\'s 10\\\\:30");
    expect(graph).toContain("expansion=none");
    expect(graph).toContain("fontcolor=0xff8800@1");
    expect(graph).toContain("fontsize=72");
    expect(graph).toContain("x=128:y=576");
    expect(graph).toContain("box=1:boxcolor=0x000000@0.45");
    expect(graph).toContain("[cv1]drawtext");
    // Linux usa fontconfig.
    const linux = graphOf(buildTimelineExport(PROJ, [v, t]).steps[0]);
    expect(linux).toContain("drawtext=font=Sans");
    // Título não gera entrada -i.
    const args = buildTimelineExport(PROJ, [v, t]).steps[0];
    expect(args.filter((x) => x === "-i")).toHaveLength(1);
  });

  it("projeto só com título gera canvas e exporta mp4", () => {
    const t = mkClip({
      id: "t",
      kind: "text",
      outMs: 3000,
      text: "Olá",
      src: { path: "", name: "Título", durationMs: 0, width: 0, height: 0 },
    });
    const job = buildTimelineExport(PROJ, [t]);
    expect(job.ext).toBe("mp4");
    expect(graphOf(job.steps[0])).toContain("color=c=black");
    expect(graphOf(job.steps[0])).toContain("[cv0]drawtext");
  });

  it("qualidade configurável muda o CRF", () => {
    const v = mkClip({ id: "v", outMs: 3000 });
    const args = buildTimelineExport(PROJ, [v], { crf: 26 }).steps[0];
    const i = args.indexOf("-crf");
    expect(args[i + 1]).toBe("26");
  });

  it("escDrawtext cobre os metacaracteres do filtergraph", () => {
    expect(escDrawtext("a:b")).toBe("a\\\\:b");
    expect(escDrawtext("it's")).toBe("it\\\\\\'s");
    expect(escDrawtext("a,b;c[d]")).toBe("a\\,b\\;c\\[d\\]");
    expect(escDrawtext("c:\\x")).toBe("c\\\\:\\\\\\\\x");
    expect(escDrawtext("linha1\nlinha2")).toBe("linha1 linha2");
  });

  it("áudio mudo fica de fora (e sem nenhum áudio vai -an)", () => {
    const v = mkClip({ id: "v", outMs: 3000 });
    const a = mkClip({ id: "a", kind: "audio", outMs: 3000, muted: true });
    const args = buildTimelineExport(PROJ, [v, a]).steps[0];
    expect(args).toContain("-an");
    expect(graphOf(args)).not.toContain("atrim");
  });
});
