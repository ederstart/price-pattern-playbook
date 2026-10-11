import { describe, expect, it } from "vitest";
import { buildM5Bias, confirmsRejection, DEFAULT_FVG_ENTRY_DEPTH, detect, fvgEntry, fvgEntryAtDepth, fvgStop, isDisplacement, priorAtr, RISK_REWARD_RATIO, respectsFvg, resolveSetup, takePrice, updateStrength, type LiveSetup } from "./detect";
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
function rejectionBar(s: LiveSetup): Candle {
  const top = s.dir === 1 ? s.fvgTop : 210 - s.fvgBottom;
  const bottom = s.dir === 1 ? s.fvgBottom : 210 - s.fvgTop;
  const entry = s.dir === 1 ? s.entry : 210 - s.entry;
  const width = top - bottom;
  const bar = {
    o: top + 0.02,
    c: top + 0.04,
    h: top + width * 0.02,
    l: entry - width * 0.25,
  };
  return s.dir === 1 ? bar : mirror(bar);
}
function entryRetestBar(s: LiveSetup): Candle {
  const entry = s.dir === 1 ? s.entry : 210 - s.entry;
  const bar = {
    o: entry + 0.05,
    c: entry + 0.06,
    h: entry + 0.1,
    l: entry - 0.01,
  };
  return s.dir === 1 ? bar : mirror(bar);
}
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
  it("keeps structure annotations but blocks 1m orders without confirmed M5 history", () => {
    const c = candles(prices.slice(0, 28));
    const times = c.map((_, i) => 1_700_000_100 + i * 60);
    const result = detect(c, { times });
    expect(result.anns).toContainEqual(expect.objectContaining({ kind: "line", label: "BOS", show: 27 }));
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
  it("hides canceled setups and silences the next five bars, including the boundary", () => {
    const c = candles(prices);
    c[28] = { o: 103, c: 102, h: 103.5, l: 101 };
    expect(detect(c.slice(0, 29), { entryDepth: 0.5 }).setups).toHaveLength(0);
    expect(detect(c.slice(0, 29), { entryDepth: 0.5 }).anns.some(a => a.kind === "box")).toBe(false);
    for (let i = 28; i <= 33; i++) {
      const result = detect(c.slice(0, i + 1), { entryDepth: 0.5 });
      expect(result.cooldownRemaining).toBe(33 - i);
      expect(result.setups.filter(s => s.breakAt > 28 && s.breakAt <= 33)).toHaveLength(0);
    }
    expect(detect(c, { entryDepth: 0.5 }).cooldownRemaining).toBe(0);
  });
  it("a gap through a pending stop without trading entry cancels and starts cooldown", () => {
    const c = candles(prices.slice(0, 28));
    c.push({ o: 103, c: 102, h: 103.5, l: 101 });
    expect(detect(c, { entryDepth: 0.5 }).setups).toHaveLength(0);
    expect(detect(c, { entryDepth: 0.5 }).anns.some(a => a.kind === "box")).toBe(false);
    expect(detect(c, { entryDepth: 0.5 }).cooldownRemaining).toBe(5);
  });
  it.each([false, true])("fills only after rejection and next-candle execution (mirror=%s)", reversed => {
    const c = candles(prices.slice(0, 28));
    const pending = detect(c, { lotSize: 0.1 }).setups[0]!;
    c.push(rejectionBar(pending));
    c.push(entryRetestBar(pending));
    const mapped = () => c.map(k => reversed ? mirror(k) : k);
    const active = detect(mapped(), { lotSize: 0.1 }).setups[0]!;
    expect(active).toMatchObject({ status: "ativa", confirmedAt: 28, filledAt: 29 });
    const targetInBasePrices = reversed ? 210 - active.take : active.take;
    const close = Math.max(112, targetInBasePrices + 0.1);
    c.push({ o: 108, c: close, h: close + 0.1, l: 107.9 });
    expect(detect(mapped(), { lotSize: 0.1 }).setups[0]).toMatchObject({ status: "take", closedAt: 30 });
  });
  it("fills only after a valid rejection candle, without starting a cooldown", () => {
    const c = candles(prices.slice(0, 28));
    const pending = detect(c, { lotSize: 0.1 }).setups[0]!;
    c.push(rejectionBar(pending));
    c.push(entryRetestBar(pending));
    const result = detect(c, { lotSize: 0.1 });
    expect(result.setups[0]?.status).toBe("ativa");
    expect(result.cooldownRemaining).toBe(0);
  });
  it("detects a BOS on the latest candle and an additional FVG on the next candle", () => {
    expect(detect(candles(prices.slice(0, 28)), { entryDepth: 0.5 }).setups[0]).toMatchObject({ breakAt: 27, fvgAt: 27 });
    const result = detect(candles(prices.slice(0, 29)), { entryDepth: 0.5 });
    expect(result.setups).toContainEqual(expect.objectContaining({ breakAt: 27, fvgAt: 28, fvgStart: 26 }));
  });
  it("permits subsequent trend BOS signals without needing another CHoCH", () => {
    const result = detect(candles(prices.slice(0, 34)), { entryDepth: 0.5 });
    expect(result.setups.some(s => s.breakAt === 27)).toBe(true);
    expect(result.anns.some(a => a.kind === "line" && a.label === "BOS" && a.show === 33)).toBe(true);
  });
  it.each([false, true])("confirms a swept-liquidity CHoCH (mirror=%s)", reversed => {
    const c = candles(prices);
    c[28] = { o: 113, c: 111, h: 113.1, l: 106 };
    c[34] = { o: 117, c: 115, h: 117.1, l: 110 };
    const result = detect(c.map(k => reversed ? mirror(k) : k));
    expect(result.anns.some(a => a.kind === "line" && a.label === "CHoCH")).toBe(true);
    expect(result.anns.some(a => a.kind === "text" && a.label === "LIQUIDEZ VARRIDA / REVERSÃO")).toBe(true);
  });
  it("does not mark an unconfirmed retest as an executed trade", () => {
    const result = detect(candles(prices));
    expect(result.setups.some(s => s.breakAt === 33 && s.fvgAt === 33 && s.filledAt === 42)).toBe(false);
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
  it("enters at 50% of the FVG", () => {
    expect(fvgEntry(110, 100, 1)).toBe(105);
    expect(fvgEntry(110, 100, -1)).toBe(105);
  });
  it("supports configurable retracement depth from the near FVG edge", () => {
    expect(fvgEntryAtDepth(110, 100, 1, 0.382)).toBe(106.18);
    expect(fvgEntryAtDepth(110, 100, -1, 0.382)).toBe(103.82);
    expect(() => fvgEntryAtDepth(110, 100, 1, 1)).toThrow(RangeError);
  });
  it("uses the backtested 15% entry depth by default", () => {
    const trade = detect(candles(prices.slice(0, 28)), { lotSize: 0.1 }).setups[0]!;
    expect(DEFAULT_FVG_ENTRY_DEPTH).toBe(0.15);
    expect(trade.entry).toBe(fvgEntryAtDepth(trade.fvgTop, trade.fvgBottom, trade.dir, DEFAULT_FVG_ENTRY_DEPTH));
  });
  it("rejects negative minimum FVG sizes", () => {
    expect(() => detect([], { minFvgAtr: -0.01 })).toThrow(RangeError);
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
    updateStrength(s, { o: 108, c: 111, h: 111.2, l: 104 }, 22);
    expect(s.strength).toBe("forte");
  });
  it.each([1, -1] as const)("requires a large favorable wick and rejects a large adverse wick in direction %s", dir => {
    const s = setup(dir);
    const bar = (k: Candle) => dir === 1 ? k : mirror(k);
    expect(confirmsRejection(s, bar({ o: 110.2, c: 111, h: 111.2, l: 103 }))).toBe(true);
    expect(confirmsRejection(s, bar({ o: 104, c: 111, h: 116, l: 103 }))).toBe(false);
    expect(confirmsRejection(s, bar({ o: 111, c: 109, h: 111.2, l: 103 }))).toBe(false);
  });
  it("sets the take to 2R from the actual entry-to-stop risk", () => {
    expect(RISK_REWARD_RATIO).toBe(2);
    expect(takePrice(2650, 2648, 1)).toBe(2654);
    expect(takePrice(2650, 2652, -1)).toBe(2646);
    expect(() => takePrice(2650, 2650, 1)).toThrow(RangeError);
  });
  it("caps monetary risk and skips a too-wide structural stop", () => {
    const c = candles(prices.slice(0, 28));
    const result = detect(c, { lotSize: 0.5, entryDepth: 0.5 });
    const trade = result.setups[0]!;
    const riskUsd = Math.abs(trade.entry - trade.stop) * 100 * 0.5;
    const targetUsd = Math.abs(trade.take - trade.entry) * 100 * 0.5;
    expect(riskUsd).toBeLessThanOrEqual(134);
    expect(targetUsd).toBeCloseTo(riskUsd * RISK_REWARD_RATIO, 0);
    expect(result.anns.find(a => a.kind === "line" && a.tone === "stop")).toMatchObject({ amount: -riskUsd });
    expect(result.anns.find(a => a.kind === "line" && a.tone === "take")).toMatchObject({ amount: targetUsd });
    expect(detect(c, { lotSize: 1 }).setups).toHaveLength(0);
  });
  it("records why BOS FVG candidates are skipped when diagnostics are requested", () => {
    const result = detect(candles(prices.slice(0, 29)), { includeDiagnostics: true });
    expect(result.diagnostics).toMatchObject({
      fvgCandidates: expect.any(Number),
      fvgTooSmall: expect.any(Number),
      fvgStopTooWide: expect.any(Number),
      fvgAlreadyViolated: expect.any(Number),
      fvgSelected: expect.any(Number),
    });
  });
  it("computes M5 bias from a completed swing BOS without moving averages", () => {
    const levels = [100, 102, 101, 104, 102, 101.5, 105, 103, 102.5, 106, 104, 103.5, 107, 105, 104.5, 109];
    const m5 = levels.map(close => ({ o: close, c: close, h: close + 0.05, l: close - 0.05 }));
    const c = m5.flatMap(bar => Array.from({ length: 5 }, () => bar));
    const start = 1_700_000_100 - (1_700_000_100 % 300);
    const times = c.map((_, i) => start + i * 60);
    const bias = buildM5Bias(c, times);
    expect(bias[bias.length - 1]).toBe(1);
    expect(bias.findIndex(direction => direction === 1)).toBeGreaterThanOrEqual(0);
  });
  it("does not use an incomplete M5 candle to set the structural direction", () => {
    const c = Array.from({ length: 29 }, (_, i) => {
      const close = i < 25 ? 100 : 100 + (i - 24) * 3;
      return { o: close, c: close, h: close + 0.02, l: close - 0.02 };
    });
    const start = 1_700_000_100 - (1_700_000_100 % 300);
    const times = c.map((_, i) => start + i * 60);
    expect(buildM5Bias(c, times).at(-1)).toBeNull();
  });
});


describe("execution accounting and FVG stop rules", () => {
  function pending(dir: 1 | -1): LiveSetup {
    const s = setup(dir);
    s.fvgTop = dir === 1 ? 102 : 110;
    s.fvgBottom = dir === 1 ? 100 : 108;
    s.entry = dir === 1 ? 101 : 109;
    s.stop = dir === 1 ? 99.8 : 110.2;
    s.fvgTop = dir === 1 ? 102 : 110;
    s.fvgBottom = dir === 1 ? 100 : 108;
    s.entry = dir === 1 ? 101 : 109;
    s.stop = dir === 1 ? 99.8 : 110.2;
    s.status = "aguardando";
    s.take = Math.round((s.entry + dir * 5) * 100) / 100;
    return s;
  }
  const reflected = (k: Candle, dir: 1 | -1) => dir === 1 ? k : mirror(k);
  it.each([1, -1] as const)("does not treat the rejection candle as the entry candle for direction %s", dir => {
    const s = pending(dir);
    resolveSetup(s, rejectionBar(s), 21);
    expect(s).toMatchObject({ status: "confirmada", confirmedAt: 21 });
    expect(s.filledAt).toBeUndefined();
    resolveSetup(s, entryRetestBar(s), 22);
    expect(s).toMatchObject({ status: "ativa", filledAt: 22 });
    expect(Math.abs(s.take - s.entry)).toBeCloseTo(Math.abs(s.entry - s.stop) * RISK_REWARD_RATIO);
  });
  it.each([1, -1] as const)("keeps waiting after an unconfirmed retest in direction %s", dir => {
    const s = pending(dir);
    resolveSetup(s, reflected({ o: 109, c: 108, h: 112.2, l: 105 }, dir), 21);
    expect(s.status).toBe("aguardando");
    expect(s.filledAt).toBeUndefined();
  });
  it.each([1, -1] as const)("discards a retest that hits stop before rejection for direction %s", dir => {
    const s = pending(dir);
    const canceled = resolveSetup(s, reflected({ o: 108, c: 98.5, h: 109, l: 98 }, dir), 21);
    expect(canceled).toBe(true);
    expect(s).toMatchObject({ status: "cancelada", closedAt: 21 });
    expect(s.filledAt).toBeUndefined();
  });
  it("marks simultaneous stop and take on an active position as unordered", () => {
    const s = setup();
    resolveSetup(s, { o: 108, c: 112, h: 116, l: 98 }, 22);
    expect(s.status).toBe("indeterminada");
  });
  it("places the stop just beyond the far FVG edge", () => {
    expect(fvgStop(110, 100, 1, 2)).toBe(99.8);
    expect(fvgStop(110, 100, -1, 2)).toBe(110.2);
  });
  it("enters a bearish FVG only on the candle after rejection", () => {
    const s = pending(-1);
    s.take = 104;
    expect(confirmsRejection(s, rejectionBar(s))).toBe(true);
    resolveSetup(s, rejectionBar(s), 21);
    expect(s.status).toBe("confirmada");
    resolveSetup(s, entryRetestBar(s), 22);
    expect(s).toMatchObject({ status: "ativa", filledAt: 22 });
    resolveSetup(s, { o: 103, c: 94.5, h: 103.2, l: 94 }, 23);
    expect(s).toMatchObject({ status: "take", closedAt: 23 });
    expect(s.entry).toBeCloseTo(108.95);
  });
});
