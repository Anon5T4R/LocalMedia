import { describe, expect, it } from "vitest";
import { fmtBytes, fmtCut, fmtDur, parseCut } from "../time";

describe("fmtDur / fmtBytes", () => {
  it("durações", () => {
    expect(fmtDur(65_000)).toBe("1:05");
    expect(fmtDur(3_723_000)).toBe("1:02:03");
  });
  it("tamanhos", () => {
    expect(fmtBytes(0)).toBe("—");
    expect(fmtBytes(1500)).toBe("1,5 KB");
    expect(fmtBytes(123_456_789)).toBe("123 MB");
  });
});

describe("fmtCut / parseCut", () => {
  it("ida e volta", () => {
    expect(fmtCut(90_500)).toBe("1:30.5");
    expect(parseCut("1:30.5")).toBe(90_500);
    expect(parseCut(fmtCut(3_723_400))).toBe(3_723_400);
  });
  it("aceita segundos puros e HH:MM:SS", () => {
    expect(parseCut("90")).toBe(90_000);
    expect(parseCut("1:02:03")).toBe(3_723_000);
  });
  it("rejeita lixo", () => {
    expect(Number.isNaN(parseCut("abc"))).toBe(true);
    expect(Number.isNaN(parseCut("1::2"))).toBe(true);
    expect(Number.isNaN(parseCut("-5"))).toBe(true);
  });
});
