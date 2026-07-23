import { describe, expect, it } from "vitest";
import { availableActions, CAPABILITIES, TASK_ACTIONS } from "../capabilities";
import type { MediaInfo } from "../types";

function info(over: Partial<MediaInfo> = {}): MediaInfo {
  return {
    path: "C:/v/a.mp4",
    name: "a.mp4",
    sizeBytes: 1000,
    durationMs: 5000,
    container: "mp4",
    video: { codec: "h264", width: 1280, height: 720, fps: 30 },
    audio: [{ index: 0, codec: "aac", channels: 2, lang: "", title: "" }],
    subs: [],
    ...over,
  };
}

const ids = (list: { id: string }[]) => list.map((a) => a.id);

describe("availableActions", () => {
  it("vídeo comum: todas as de vídeo, sem faixas (1 faixa) nem silêncio (é vídeo)", () => {
    expect(ids(availableActions(info()))).toEqual([
      "converter",
      "comprimir",
      "cortar",
      "gif",
      "legendas",
      "logo",
      "esconder",
      "ajustes",
    ]);
  });

  it("só áudio: some o que precisa de vídeo; ENTRA cortar silêncio", () => {
    const a = availableActions(info({ video: null }));
    expect(ids(a)).toEqual(["converter", "cortar", "silencio", "ajustes"]);
  });

  it("cortar silêncio NÃO aparece em vídeo (dessincronizaria) nem em áudio mudo", () => {
    expect(ids(availableActions(info()))).not.toContain("silencio");
    expect(ids(availableActions(info({ video: null, audio: [] })))).not.toContain("silencio");
  });

  it("MKV com 2 áudios: faixas aparece", () => {
    const a = availableActions(
      info({
        audio: [
          { index: 0, codec: "aac", channels: 2, lang: "por", title: "" },
          { index: 1, codec: "ac3", channels: 6, lang: "eng", title: "" },
        ],
      }),
    );
    expect(ids(a)).toContain("faixas");
  });

  it("legenda embutida também conta pra faixas", () => {
    const a = availableActions(
      info({ subs: [{ index: 0, codec: "subrip", lang: "por", title: "" }] }),
    );
    expect(ids(a)).toContain("faixas");
  });
});

describe("catálogo de capacidades (fonte única da ajuda)", () => {
  it("toda ação do card/modal tem entrada no catálogo — era a divergência que escondia Legendas", () => {
    const capIds = new Set(CAPABILITIES.map((c) => c.id));
    for (const a of TASK_ACTIONS) {
      expect(capIds.has(a.id), `ação "${a.id}" sem entrada em CAPABILITIES`).toBe(true);
    }
  });

  it("ids únicos", () => {
    const all = CAPABILITIES.map((c) => c.id);
    expect(new Set(all).size).toBe(all.length);
  });
});
