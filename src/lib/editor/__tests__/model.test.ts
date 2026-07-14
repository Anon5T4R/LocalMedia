import { describe, expect, it } from "vitest";
import {
  CLIP_DEFAULTS,
  audibleAudioTracks,
  bestGapStart,
  clipDurMs,
  clipEndMs,
  moveClip,
  projectDurMs,
  rippleDelete,
  setClipSpeed,
  snapMs,
  splitClip,
  trimClip,
  visibleClips,
  type Clip,
} from "../model";

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

describe("duração", () => {
  it("clipe e projeto", () => {
    const a = mkClip({ startMs: 1000, inMs: 500, outMs: 3500 });
    expect(clipDurMs(a)).toBe(3000);
    expect(clipEndMs(a)).toBe(4000);
    const b = mkClip({ id: "c2", kind: "audio", startMs: 8000, inMs: 0, outMs: 2000 });
    expect(projectDurMs([a, b])).toBe(10_000);
    expect(projectDurMs([])).toBe(0);
  });
});

describe("moveClip", () => {
  it("não passa por cima do vizinho da mesma trilha", () => {
    const a = mkClip({ id: "a", startMs: 0, outMs: 5000 });
    const b = mkClip({ id: "b", startMs: 5000, outMs: 5000 });
    const moved = moveClip([a, b], "b", 2000);
    expect(moved.find((c) => c.id === "b")?.startMs).toBe(5000); // travado no fim de a
  });

  it("não deixa início negativo", () => {
    const a = mkClip({ id: "a", startMs: 3000, outMs: 2000 });
    const moved = moveClip([a], "a", -500);
    expect(moved[0].startMs).toBe(0);
  });

  it("vinculados se movem juntos e respeitam vizinhos das duas trilhas", () => {
    const v = mkClip({ id: "v", startMs: 0, outMs: 4000, linkId: "L" });
    const a = mkClip({ id: "a", kind: "audio", startMs: 0, outMs: 4000, linkId: "L" });
    const bloqueio = mkClip({ id: "x", kind: "audio", startMs: 6000, outMs: 2000 });
    const moved = moveClip([v, a, bloqueio], "v", 5000);
    // O áudio vinculado bate no clipe de áudio em 6000 → delta máximo 2000.
    expect(moved.find((c) => c.id === "v")?.startMs).toBe(2000);
    expect(moved.find((c) => c.id === "a")?.startMs).toBe(2000);
  });
});

describe("trimClip", () => {
  it("borda de entrada consome o trim da fonte", () => {
    const a = mkClip({ startMs: 1000, inMs: 0, outMs: 5000 });
    const [t] = trimClip([a], "c1", "in", 2000);
    expect(t.startMs).toBe(2000);
    expect(t.inMs).toBe(1000);
    expect(clipDurMs(t)).toBe(4000);
  });

  it("borda de entrada não recua antes do início da fonte", () => {
    const a = mkClip({ startMs: 3000, inMs: 1000, outMs: 5000 });
    const [t] = trimClip([a], "c1", "in", 0);
    expect(t.startMs).toBe(2000); // só tinha 1000ms de fonte pra recuar
    expect(t.inMs).toBe(0);
  });

  it("imagem apara mudando só a duração (fonte infinita)", () => {
    const img = mkClip({ kind: "image", src: { path: "i.png", name: "i.png", durationMs: 0, width: 800, height: 600 }, startMs: 1000, inMs: 0, outMs: 5000 });
    const [t] = trimClip([img], "c1", "in", 2500);
    expect(t.startMs).toBe(2500);
    expect(t.inMs).toBe(0);
    expect(t.outMs).toBe(3500);
    const [t2] = trimClip([img], "c1", "out", 9000);
    expect(clipDurMs(t2)).toBe(8000); // imagem estica à vontade
  });

  it("borda de saída trava no vizinho e no fim da fonte", () => {
    const a = mkClip({ id: "a", startMs: 0, inMs: 4000, outMs: 8000 }); // 4s usados, 6s restantes
    const b = mkClip({ id: "b", startMs: 5000, outMs: 3000 });
    const trimmed = trimClip([a, b], "a", "out", 9000);
    expect(clipEndMs(trimmed.find((c) => c.id === "a")!)).toBe(5000); // vizinho
    const sozinho = trimClip([a], "a", "out", 9000);
    expect(clipEndMs(sozinho[0])).toBe(6000); // fonte acabou (10s - 4s de in)
  });
});

describe("splitClip", () => {
  it("divide preservando o trim e aplicando linkId novo à direita", () => {
    const a = mkClip({ startMs: 1000, inMs: 500, outMs: 4500, linkId: "L" });
    const out = splitClip([a], "c1", 3000, "c1b", "L2");
    expect(out).toHaveLength(2);
    const [l, r] = out;
    expect(l.outMs).toBe(2500); // in 500 + 2000 decorridos
    expect(r.startMs).toBe(3000);
    expect(r.inMs).toBe(2500);
    expect(r.outMs).toBe(4500);
    expect(r.id).toBe("c1b");
    expect(r.linkId).toBe("L2");
    expect(l.linkId).toBe("L");
  });

  it("não divide fora do clipe nem rente às bordas", () => {
    const a = mkClip({ startMs: 1000, outMs: 3000 });
    expect(splitClip([a], "c1", 500, "x")).toHaveLength(1);
    expect(splitClip([a], "c1", 1050, "x")).toHaveLength(1);
  });
});

describe("velocidade", () => {
  it("2x encurta a duração na timeline pela metade", () => {
    const a = mkClip({ startMs: 1000, inMs: 0, outMs: 8000, speed: 2 });
    expect(clipDurMs(a)).toBe(4000);
    expect(clipEndMs(a)).toBe(5000);
  });

  it("trim de entrada consome fonte na proporção da velocidade", () => {
    const a = mkClip({ startMs: 0, inMs: 0, outMs: 8000, speed: 2 }); // 4s na timeline
    const [t] = trimClip([a], "c1", "in", 1000); // avança 1s de timeline
    expect(t.startMs).toBe(1000);
    expect(t.inMs).toBe(2000); // 1s × 2 de fonte
    expect(clipDurMs(t)).toBe(3000);
  });

  it("split em clipe acelerado corta a fonte no ponto certo", () => {
    const a = mkClip({ startMs: 0, inMs: 0, outMs: 8000, speed: 2 });
    const [l, r] = splitClip([a], "c1", 1500, "c1b");
    expect(l.outMs).toBe(3000); // 1.5s × 2
    expect(r.inMs).toBe(3000);
    expect(clipDurMs(l) + clipDurMs(r)).toBe(4000);
  });

  it("setClipSpeed não deixa o clipe alongado engolir o vizinho", () => {
    const a = mkClip({ id: "a", startMs: 0, inMs: 0, outMs: 4000, speed: 1 });
    const b = mkClip({ id: "b", startMs: 5000, outMs: 3000 });
    const out = setClipSpeed([a, b], "a", 0.5); // dobraria pra 8s, só cabem 5s
    expect(out.find((c) => c.id === "a")?.speed).toBe(0.8); // 4000/5000
  });

  it("split reparte os fades entre as metades", () => {
    const a = mkClip({ startMs: 0, outMs: 6000, fadeInMs: 500, fadeOutMs: 700 });
    const [l, r] = splitClip([a], "c1", 3000, "c1b");
    expect([l.fadeInMs, l.fadeOutMs]).toEqual([500, 0]);
    expect([r.fadeInMs, r.fadeOutMs]).toEqual([0, 700]);
  });
});

describe("trilhas (ocultar/mudo/solo)", () => {
  it("solo silencia as outras faixas; sem solo vale o mudo", () => {
    expect([...audibleAudioTracks([{ muted: false, solo: false }, { muted: true, solo: false }])]).toEqual([0]);
    expect([...audibleAudioTracks([{ muted: false, solo: false }, { muted: false, solo: true }])]).toEqual([1]);
    // Mudo + solo na mesma faixa: solo vence (comportamento de NLE).
    expect([...audibleAudioTracks([{ muted: true, solo: true }, { muted: false, solo: false }])]).toEqual([0]);
  });

  it("visibleClips tira trilha de vídeo oculta e áudio inaudível", () => {
    const v0 = mkClip({ id: "v0" });
    const v1 = mkClip({ id: "v1", track: 1 });
    const a0 = mkClip({ id: "a0", kind: "audio" });
    const a1 = mkClip({ id: "a1", kind: "audio", track: 1 });
    const out = visibleClips(
      [v0, v1, a0, a1],
      [{ hidden: false }, { hidden: true }],
      [{ muted: true, solo: false }, { muted: false, solo: false }],
    );
    expect(out.map((c) => c.id)).toEqual(["v0", "a1"]);
  });
});

describe("rippleDelete", () => {
  it("remove o par vinculado e fecha o buraco nas duas trilhas", () => {
    const v1 = mkClip({ id: "v1", outMs: 4000, linkId: "L1" });
    const a1 = mkClip({ id: "a1", kind: "audio", outMs: 4000, linkId: "L1" });
    const v2 = mkClip({ id: "v2", startMs: 4000, outMs: 6000 });
    const a2 = mkClip({ id: "a2", kind: "audio", startMs: 4000, outMs: 6000 });
    const out = rippleDelete([v1, a1, v2, a2], "v1");
    expect(out).toHaveLength(2);
    expect(out.find((c) => c.id === "v2")?.startMs).toBe(0);
    expect(out.find((c) => c.id === "a2")?.startMs).toBe(0);
  });

  it("não engole clipe anterior quando já havia gap antes do removido", () => {
    const a = mkClip({ id: "a", startMs: 0, outMs: 2000 });
    const b = mkClip({ id: "b", startMs: 5000, outMs: 3000 }); // gap 2000–5000
    const c = mkClip({ id: "c", startMs: 8000, outMs: 2000 });
    const out = rippleDelete([a, b, c], "b");
    // c só pode recuar até encostar em a (fim 2000): shift limitado a 3000? Não —
    // shift = min(dur 3000, espaço 8000-2000=6000) = 3000 → c vai pra 5000.
    expect(out.find((x) => x.id === "c")?.startMs).toBe(5000);
  });

  it("não mexe nas outras trilhas", () => {
    const v1 = mkClip({ id: "v1", outMs: 4000 });
    const v2 = mkClip({ id: "v2", startMs: 4000, outMs: 6000 });
    const pip = mkClip({ id: "pip", track: 1, startMs: 6000, outMs: 2000 });
    const out = rippleDelete([v1, v2, pip], "v1");
    expect(out.find((c) => c.id === "v2")?.startMs).toBe(0);
    expect(out.find((c) => c.id === "pip")?.startMs).toBe(6000);
  });
});

describe("bestGapStart", () => {
  it("cai onde o usuário mirou quando o espaço está livre", () => {
    const a = mkClip({ id: "a", startMs: 0, outMs: 2000 });
    expect(bestGapStart([a], "video", 0, 5000, 3000)).toBe(5000);
  });

  it("encosta no buraco válido mais próximo quando o alvo está ocupado", () => {
    const a = mkClip({ id: "a", startMs: 0, outMs: 4000 });
    const b = mkClip({ id: "b", startMs: 6000, outMs: 4000 }); // buraco 4000–6000
    // Mirar dentro de `a` com um clipe de 2s → encaixa no buraco 4000–6000.
    expect(bestGapStart([a, b], "video", 0, 2500, 2000)).toBe(4000);
    // Clipe de 3s não cabe no buraco → vai pro fim (10000).
    expect(bestGapStart([a, b], "video", 0, 2500, 3000)).toBe(10_000);
  });

  it("trilha vazia usa o alvo direto", () => {
    expect(bestGapStart([], "audio", 2, 1234, 5000)).toBe(1234);
  });
});

describe("snapMs", () => {
  it("encosta no alvo mais próximo dentro da tolerância", () => {
    expect(snapMs(1980, [0, 2000, 5000], 100)).toBe(2000);
    expect(snapMs(1700, [0, 2000, 5000], 100)).toBe(1700);
  });
});
