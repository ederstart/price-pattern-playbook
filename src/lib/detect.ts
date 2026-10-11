import type { Ann, Candle } from "./generator";

export type LiveStatus = "aguardando" | "ativa" | "take" | "stop" | "expirada" | "cancelada";
export type LiveSetup = {
  id: number;
  type: "choch" | "bos";
  dir: 1 | -1;
  breakAt: number;
  fvgAt: number;
  fvgTop: number;
  fvgBottom: number;
  entry: number;
  stop: number;
  take: number;
  status: LiveStatus;
  filledAt?: number;
  closedAt?: number;
};

const PIVOT = 3;
const MAX_WAIT = 60;

function atr(c: Candle[], i: number, n = 14) {
  let s = 0, k = 0;
  for (let j = Math.max(1, i - n + 1); j <= i; j++) {
    const a = c[j]!, p = c[j - 1]!;
    s += Math.max(a.h - a.l, Math.abs(a.h - p.c), Math.abs(a.l - p.c));
    k++;
  }
  return k ? s / k : 1;
}

/** Detects CHoCH / BOS + FVG setups on real candles and follows each to its outcome. */
export function detect(c: Candle[]) {
  const anns: Ann[] = [];
  const setups: LiveSetup[] = [];
  const highs: number[] = []; // confirmed pivot indexes
  const lows: number[] = [];
  let lastHigh: number | null = null; // unbroken pivot high idx
  let lastLow: number | null = null;
  let trend: 0 | 1 | -1 = 0;
  let id = 0;

  const resolve = (s: LiveSetup, i: number) => {
    const k = c[i]!;
    if (s.status === "aguardando") {
      if (i - s.fvgAt > MAX_WAIT) { s.status = "expirada"; s.closedAt = i; return; }
      const touched = s.dir === 1 ? k.l <= s.entry : k.h >= s.entry;
      if (touched) {
        s.status = "ativa"; s.filledAt = i;
        if (s.dir === 1 ? k.l <= s.stop : k.h >= s.stop) { s.status = "stop"; s.closedAt = i; }
        return;
      }
      if (s.dir === 1 ? k.h >= s.take : k.l <= s.take) { s.status = "cancelada"; s.closedAt = i; }
    } else if (s.status === "ativa") {
      const hitStop = s.dir === 1 ? k.l <= s.stop : k.h >= s.stop;
      const hitTake = s.dir === 1 ? k.h >= s.take : k.l <= s.take;
      if (hitStop) { s.status = "stop"; s.closedAt = i; }
      else if (hitTake) { s.status = "take"; s.closedAt = i; }
    }
  };

  for (let i = 0; i < c.length; i++) {
    // progress open setups
    for (const s of setups) if ((s.status === "aguardando" || s.status === "ativa") && i > s.fvgAt) resolve(s, i);

    // confirm pivot at i - PIVOT
    const p = i - PIVOT;
    if (p >= PIVOT) {
      let isH = true, isL = true;
      for (let j = p - PIVOT; j <= p + PIVOT; j++) {
        if (j === p) continue;
        if (c[j]!.h >= c[p]!.h) isH = false;
        if (c[j]!.l <= c[p]!.l) isL = false;
      }
      if (isH) { highs.push(p); lastHigh = p; }
      if (isL) { lows.push(p); lastLow = p; }
    }

    const k = c[i]!;
    for (const dir of [1, -1] as const) {
      const piv = dir === 1 ? lastHigh : lastLow;
      if (piv === null || piv >= i) continue;
      const level = dir === 1 ? c[piv]!.h : c[piv]!.l;
      if (!(dir === 1 ? k.c > level : k.c < level)) continue;
      // structure broken
      const type = trend === -dir ? "choch" : "bos";
      trend = dir;
      if (dir === 1) lastHigh = null; else lastLow = null;
      anns.push({ kind: "line", x1: piv, x2: i, y: level, label: type === "choch" ? "CHoCH" : "BOS", tone: "neutral", show: i });

      // cancel pending setups in the opposite direction
      for (const s of setups) if (s.status === "aguardando" && s.dir !== dir) { s.status = "cancelada"; s.closedAt = i; }

      // FVG inside the impulse leg (latest one)
      const a = atr(c, i);
      let fvg: { idx: number; top: number; bottom: number } | null = null;
      for (let j = i; j >= Math.max(piv, 2) && j > i - 15; j--) {
        const a0 = c[j - 2]!, a2 = c[j]!;
        const top = dir === 1 ? a2.l : a0.l;
        const bottom = dir === 1 ? a0.h : a2.h;
        if (top - bottom > a * 0.15) { fvg = { idx: j - 1, top, bottom }; break; }
      }
      if (!fvg) continue;

      const entry = (fvg.top + fvg.bottom) / 2;
      const far = dir === 1 ? fvg.bottom : fvg.top;
      const stop = far - dir * a * 0.2;
      const risk = Math.abs(entry - stop);
      // target: next structure / liquidity = nearest older pivot beyond the break, at least 1.5R
      const pool = (dir === 1 ? highs : lows).filter((x) => x < piv).map((x) => (dir === 1 ? c[x]!.h : c[x]!.l));
      const beyond = pool.filter((v) => (v - entry) * dir >= risk * 1.5).sort((x, y) => (x - y) * dir);
      const take = beyond.length ? beyond[0]! : entry + dir * risk * 2;
      setups.push({ id: id++, type, dir, breakAt: i, fvgAt: i, fvgTop: fvg.top, fvgBottom: fvg.bottom, entry, stop, take, status: "aguardando" });
    }
  }

  const last = c.length - 1;
  for (const s of setups) {
    const x1 = s.fvgAt - 2;
    const x2 = s.closedAt ?? last + 3;
    anns.push({ kind: "box", x1, x2, top: s.fvgTop, bottom: s.fvgBottom, show: s.fvgAt });
    if (s.status === "cancelada" || s.status === "expirada") continue;
    anns.push(
      { kind: "line", x1: s.fvgAt, x2, y: s.entry, label: s.dir === 1 ? "ENTRADA COMPRA" : "ENTRADA VENDA", tone: "entry", show: s.fvgAt },
      { kind: "line", x1: s.fvgAt, x2, y: s.stop, label: "STOP", tone: "stop", show: s.fvgAt },
      { kind: "line", x1: s.fvgAt, x2, y: s.take, label: "TAKE", tone: "take", show: s.fvgAt },
    );
    if (s.filledAt !== undefined) {
      anns.push({ kind: "text", x: s.filledAt, y: s.entry, label: "▲ ENTROU".replace("▲", s.dir === 1 ? "▲" : "▼"), pos: s.dir === 1 ? "below" : "above", show: s.filledAt });
    }
    if (s.status === "take" || s.status === "stop") {
      const y = s.status === "take" ? s.take : s.stop;
      anns.push({ kind: "text", x: s.closedAt!, y, label: s.status === "take" ? "TAKE ✓" : "STOP ✗", pos: (y - s.entry) * 1 > 0 ? "above" : "below", show: s.closedAt! });
    }
  }
  return { anns, setups };
}
