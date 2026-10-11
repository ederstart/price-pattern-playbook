import { describe, expect, it } from "vitest";
import { detect, fvgEntry, isDisplacement, priorAtr, respectsFvg, impulseStop, resolveSetup, takePrice, updateStrength, type LiveSetup } from "./detect";
import type { Candle } from "./generator";

const prices = [...Array<number>(14).fill(100), 102, 104, 103, 102, 101, 102, 105, 109, 107, 105, 103, 104, 108, 113, 111, 109, 107, 108, 112, 117, 115, 113, 111, 112, 113, 112, 111, 112, 110, 109, 106, 102, 98];
function candles(values: number[]): Candle[] {
  return values.map((c, i) => {
    const o = values[i - 1] ?? c;
    return { o, c, h: Math.max(o, c) + (c >= o ? 0.12 : 0.05), l: Math.min(o, c) - (c < o ? 0.12 : 0.05) };
  });
}
function setup(dir: 1 | -1 = 1): LiveSetup {
  return { id: 0, type: "bos", dir, breakAt: 20, breakLevel: 110, fvgAt: 20, fvgStart: 18,
    fvgTop: 110, fvgBottom: 100, entry: fvgEntry(110, 100, dir), stop: dir === 1 ? 99 : 111,
    take: dir === 1 ? 115 : 95, status: "ativa", strength: "pendente", maxDepth: 0, retestComplete: false };
}
const mirror = (c: Candle): Candle => ({ o: 210 - c.o, c: 210 - c.c, h: 210 - c.l, l: 210 - c.h });

describe("confirmed structure and displacement", () => {
  it("uses only the 14 preceding true ranges", () => {
    const c = Array.from({ length: 15 }, () => ({ o: 100, c: 100, h: 101, l: 99 }));
    c[14] = { o: 100, c: 200, h: 200, l: 100 };
    expect(priorAtr(c, 13)).toBeNull();
    expect(priorAtr(c, 14)).toBe(2);
  });
  it("requires directional body, 60% body, 0.7 ATR and closing margin", () => {
    expect(isDisplacement({ o: 100, c: 101.5, h: 101.6, l: 99.9 }, 1, 101, 2)).toBe(true);
    expect(isDisplacement({ o: 101.4, c: 101.5, h: 102, l: 100 }, 1, 101, 2)).toBe(false);
    expect(isDisplacement({ o: 100, c: 101.2, h: 101.3, l: 99.9 }, 1, 101, 2)).toBe(false);
    expect(isDisplacement({ o: 99.6, c: 101.01, h: 101.1, l: 99.5 }, 1, 101, 2)).toBe(false);
    expect(isDisplacement({ o: 102, c: 101.5, h: 102.1, l: 101.4 }, 1, 101, 0.5)).toBe(false);
  });
  it("does not reset a proven direction on a weak contrary pierce", () => {
    const c = candles(prices.slice(0, 28));
    c[25] = { o: 100.95, c: 100.85, h: 105, l: 100.75 };
    expect(detect(c).anns).toContainEqual(expect.objectContaining({ kind: "line", label: "BOS", show: 27 }));
  });
  it("discards contrary breaks before a continuation BOS", () => {
    const result = detect(candles([...prices.slice(0, 25), 101, 97, 93]));
    expect(result.anns.some(a => a.kind === "line" && a.label === "CHoCH")).toBe(false);
    expect(result.setups).toHaveLength(0);
  });
  it.each([false, true])("confirms BOS before CHoCH, with real swept-pivot annotations (mirror=%s)", reversed => {
    const base = candles(prices);
    base[28] = { o: 113, c: 111, h: 113.1, l: 106 };
    base[34] = { o: 117, c: 115, h: 117.1, l: 110 };
    const c = base.map(k => reversed ? mirror(k) : k);
    const result = detect(c);
    const breaks = result.anns.filter(a => a.kind === "line" && ["BOS", "CHoCH"].includes(a.label));
    expect(breaks.map(a => a.kind === "line" ? a.label : "")).toEqual(["BOS", "BOS", "CHoCH"]);
    const liquidity = result.anns.find(a => a.kind === "text" && a.label === "LIQUIDEZ");
    expect(liquidity).toMatchObject({ x: 27, show: 45 });
    expect(result.anns).toContainEqual(expect.objectContaining({ kind: "line", x1: 27, x2: 33, label: "" }));
    expect(result.anns).toContainEqual(expect.objectContaining({ label: "LIQUIDEZ VARRIDA / REVERSÃO", x: 33 }));
  });
  it("cancellation silences the next ten bars, including the boundary", () => {
    const c = candles(prices);
    c[28] = { o: 103, c: 102, h: 103.5, l: 101 };
    expect(detect(c.slice(0, 29)).setups[0]).toMatchObject({ status: "cancelada", closedAt: 28 });
    for (let i = 28; i <= 38; i++) {
      const result = detect(c.slice(0, i + 1));
      expect(result.cooldownRemaining).toBe(38 - i);
      expect(result.setups.filter(s => s.breakAt > 28 && s.breakAt <= 38)).toHaveLength(0);
      expect(result.anns.filter(a => a.kind === "line" && ["BOS", "CHoCH"].includes(a.label) && a.show > 28 && a.show <= 38)).toHaveLength(0);
    }
    expect(detect(c).cooldownRemaining).toBe(0);
  });
  it("a gap through a pending stop without trading entry cancels and starts cooldown", () => {
    const c = candles(prices.slice(0, 28));
    c.push({ o: 103, c: 102, h: 103.5, l: 101 });
    expect(detect(c).setups[0]).toMatchObject({ status: "cancelada", closedAt: 28 });
    expect(detect(c).setups[0]?.filledAt).toBeUndefined();
    expect(detect(c).cooldownRemaining).toBe(10);
  });
  it.each([false, true])("fills a valid return and resolves its take on a later candle (mirror=%s)", reversed => {
    const c = candles(prices.slice(0, 28));
    c.push({ o: 110, c: 108, h: 110.1, l: 106 });
    const mapped = () => c.map(k => reversed ? mirror(k) : k);
    expect(detect(mapped()).setups[0]).toMatchObject({ status: "ativa", filledAt: 28 });
    c.push({ o: 108, c: 112, h: 112.1, l: 107.9 });
    expect(detect(mapped()).setups[0]).toMatchObject({ status: "take", closedAt: 29 });
  });
  it("keeps BOS orders valid after a target touch or normal pullback above the zone", () => {
    const c = candles(prices.slice(0, 30));
    const result = detect(c);
    expect(result.setups[0]?.status).toBe("aguardando");
    expect(result.cooldownRemaining).toBe(0);
  });
  it("detects a BOS on the latest candle and an additional FVG on the next candle", () => {
    expect(detect(candles(prices.slice(0, 28))).setups[0]).toMatchObject({ breakAt: 27, fvgAt: 27 });
    const result = detect(candles(prices.slice(0, 29)));
    expect(result.setups).toContainEqual(expect.objectContaining({ breakAt: 27, fvgAt: 28, fvgStart: 26 }));
  });
  it("permits subsequent trend BOS signals without needing another CHoCH", () => {
    const result = detect(candles(prices.slice(0, 34)));
    expect(result.setups.some(s => s.breakAt === 27)).toBe(true);
    expect(result.setups.some(s => s.breakAt === 33)).toBe(true);
    expect(result.setups.every(s => s.type === "bos" && s.dir === 1)).toBe(true);
  });
  it("does not enter against the established direction on CHoCH alone", () => {
    const c = candles(prices);
    c[28] = { o: 113, c: 111, h: 113.1, l: 106 };
    c[34] = { o: 117, c: 115, h: 117.1, l: 110 };
    const result = detect(c);
    expect(result.anns.some(a => a.kind === "line" && a.label === "CHoCH")).toBe(true);
    expect(result.setups.some(s => s.dir === -1)).toBe(false);
  });
  it("preserves an actually touched entry instead of retroactively canceling a losing trade", () => {
    const result = detect(candles(prices));
    expect(result.setups.filter(s => s.breakAt === 33 && s.fvgAt === 33)[0]).toMatchObject({ status: "stop", filledAt: 42, closedAt: 44 });
  });
  it("does not draw a later CHoCH or sweep before confirmation", () => {
    const early = detect(candles(prices.slice(0, 42)));
    expect(early.anns.some(a => a.kind === "text" && a.label.includes("LIQUIDEZ"))).toBe(false);
    expect(early.anns.some(a => a.kind === "line" && a.label === "CHoCH")).toBe(false);
  });
});

describe("FVG entry, rejection and target", () => {
  it.each([1, -1] as const)("allows touched FVGs that retain context in direction %s", dir => {
    const bar = (k: Candle) => dir === 1 ? k : mirror(k);
    expect(respectsFvg([bar({ o: 111, c: 108, h: 112, l: 104 })], 110, 100, dir === 1 ? 99 : 111, dir)).toBe(true);
    expect(respectsFvg([bar({ o: 108, c: 99.5, h: 109, l: 99.2 })], 110, 100, dir === 1 ? 99 : 111, dir)).toBe(false);
    expect(respectsFvg([bar({ o: 108, c: 109, h: 110, l: 98 })], 110, 100, dir === 1 ? 99 : 111, dir)).toBe(false);
  });
  it("enters at 38.2% from the correct side", () => {
    expect(fvgEntry(110, 100, 1)).toBe(106.18);
    expect(fvgEntry(110, 100, -1)).toBe(103.82);
  });
  it.each([1, -1] as const)("classifies shallow and ideal retests for direction %s", dir => {
    const shallow = setup(dir), ideal = setup(dir), deep = setup(dir);
    const bar = (k: Candle) => dir === 1 ? k : mirror(k);
    updateStrength(shallow, bar({ o: 109, c: 111, h: 112, l: 106 }), 21);
    updateStrength(ideal, bar({ o: 108, c: 111, h: 112, l: 104 }), 21);
    updateStrength(deep, bar({ o: 108, c: 111, h: 112, l: 102 }), 21);
    expect(shallow.strength).toBe("moderado");
    expect(ideal.strength).toBe("forte");
    expect(deep.strength).toBe("sem-confirmacao");
    updateStrength(shallow, bar({ o: 108, c: 111, h: 112, l: 104 }), 22);
    expect(shallow.strength).toBe("moderado");
  });
  it("requires rejection, not depth alone", () => {
    const s = setup();
    updateStrength(s, { o: 109, c: 105, h: 110, l: 104 }, 21);
    expect(s.strength).toBe("sem-confirmacao");
    updateStrength(s, { o: 106, c: 111, h: 112, l: 104 }, 22);
    expect(s.strength).toBe("forte");
  });
  it("uses 5.00 by default or nearer liquidity at least 1.5R", () => {
    expect(takePrice(2650, 2648, 1, [])).toBe(2655);
    expect(takePrice(2650, 2652, -1, [])).toBe(2645);
    expect(takePrice(2650, 2648, 1, [2651, 2654, 2658])).toBe(2654);
    expect(takePrice(2650, 2652, -1, [2649, 2646, 2640])).toBe(2646);
  });
});


describe("execution accounting and impulse stop regressions", () => {
  function pending(dir: 1 | -1): LiveSetup {
    const s = setup(dir);
    s.status = "aguardando";
    s.take = Math.round((s.entry + dir * 5) * 100) / 100;
    return s;
  }
  const reflected = (k: Candle, dir: 1 | -1) => dir === 1 ? k : mirror(k);
  it.each([1, -1] as const)("counts a provable same-candle take after entry for direction %s", dir => {
    const s = pending(dir);
    resolveSetup(s, reflected({ o: 109, c: 112, h: 112.2, l: 105 }, dir), 21);
    expect(s).toMatchObject({ status: "take", filledAt: 21, closedAt: 21 });
  });
  it.each([1, -1] as const)("does not count an unordered target touch as a win or later loss for direction %s", dir => {
    const s = pending(dir);
    resolveSetup(s, reflected({ o: 109, c: 108, h: 112.2, l: 105 }, dir), 21);
    expect(s.status).toBe("indeterminada");
  });
  it.each([1, -1] as const)("counts entry then stop instead of cancellation for direction %s", dir => {
    const s = pending(dir);
    const canceled = resolveSetup(s, reflected({ o: 108, c: 98.5, h: 109, l: 98 }, dir), 21);
    expect(canceled).toBe(false);
    expect(s).toMatchObject({ status: "stop", filledAt: 21, closedAt: 21 });
  });
  it("marks simultaneous stop and take on an active position as unordered", () => {
    const s = setup();
    resolveSetup(s, { o: 108, c: 112, h: 116, l: 98 }, 22);
    expect(s.status).toBe("indeterminada");
  });
  it("places the stop beyond the displacement candle, including its wick", () => {
    const impulse = { o: 114, c: 99, h: 115, l: 98 };
    expect(impulseStop(impulse, 110, 100, -1, 2)).toBe(115.2);
    expect(impulseStop(mirror(impulse), 110, 100, 1, 2)).toBe(94.8);
  });
  it("takes the bearish FVG retest after a large red impulse without another BOS", () => {
    const s = pending(-1);
    s.stop = impulseStop({ o: 114, c: 99, h: 115, l: 98 }, 110, 100, -1, 2);
    resolveSetup(s, { o: 101, c: 103, h: 104, l: 100 }, 21);
    expect(s).toMatchObject({ status: "ativa", filledAt: 21 });
    resolveSetup(s, { o: 103, c: 98.5, h: 103.2, l: 98 }, 22);
    expect(s).toMatchObject({ status: "take", closedAt: 22 });
    expect(s.take).toBe(98.82);
  });
});
