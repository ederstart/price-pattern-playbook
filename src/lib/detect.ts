import type { Ann, Candle } from "./generator";

export type LiveStatus = "aguardando" | "ativa" | "take" | "stop" | "expirada" | "cancelada";
export type SignalStrength = "pendente" | "moderado" | "forte" | "sem-confirmacao";
export const STRENGTH_LABELS: Record<SignalStrength, string> = {
  pendente: "Aguardando retorno",
  moderado: "Moderado / Fraco",
  forte: "Forte / Ideal",
  "sem-confirmacao": "Sem rejeição ideal",
};
export type LiveSetup = {
  id: number;
  type: "choch" | "bos";
  dir: 1 | -1;
  breakAt: number;
  breakLevel: number;
  fvgAt: number;
  fvgStart: number;
  fvgTop: number;
  fvgBottom: number;
  entry: number;
  stop: number;
  take: number;
  status: LiveStatus;
  strength: SignalStrength;
  maxDepth: number;
  retestComplete: boolean;
  strengthAt?: number;
  filledAt?: number;
  closedAt?: number;
};

const PIVOT = 3;
const MAX_WAIT = 60;
export const COOLDOWN_BARS = 10;
const POINT = 0.01; // XAUUSD reference: 500 points = 5.00 in price, not account profit.
const round = (v: number) => Math.round(v * 100) / 100;

/** Simple mean of the preceding 14 true ranges; never includes the breakout. */
export function priorAtr(c: Candle[], i: number): number | null {
  if (i < 14) return null;
  let sum = 0;
  for (let j = i - 14; j < i; j++) {
    const k = c[j]!;
    const previous = c[j - 1]?.c ?? k.o;
    sum += Math.max(k.h - k.l, Math.abs(k.h - previous), Math.abs(k.l - previous));
  }
  return sum / 14;
}

export function isDisplacement(k: Candle, dir: 1 | -1, level: number, atr: number) {
  const body = (k.c - k.o) * dir;
  const range = k.h - k.l;
  return atr > 0 && range > 0 && body >= range * 0.6 && body >= atr * 0.7
    && (k.c - level) * dir >= Math.max(POINT, atr * 0.05);
}

export function fvgEntry(top: number, bottom: number, dir: 1 | -1) {
  return round(dir === 1 ? top - (top - bottom) * 0.382 : bottom + (top - bottom) * 0.382);
}

export function takePrice(entry: number, stop: number, dir: 1 | -1, liquidity: number[]) {
  const risk = Math.abs(entry - stop);
  const nearby = liquidity.filter(v => (v - entry) * dir >= risk * 1.5 && (v - entry) * dir <= 5)
    .sort((a, b) => (a - b) * dir);
  return round(nearby[0] ?? entry + dir * 500 * POINT);
}

/** Track only the first retest. A later winning move cannot upgrade an earlier weak entry. */
export function updateStrength(s: LiveSetup, k: Candle, i: number) {
  if (s.retestComplete) return;
  const size = s.fvgTop - s.fvgBottom;
  const depth = s.dir === 1 ? (s.fvgTop - k.l) / size : (k.h - s.fvgBottom) / size;
  s.maxDepth = Math.max(s.maxDepth, depth);
  const near = s.dir === 1 ? s.fvgTop : s.fvgBottom;
  const wick = s.dir === 1 ? Math.min(k.o, k.c) - k.l : k.h - Math.max(k.o, k.c);
  const rejection = (k.c - k.o) * s.dir > 0 && wick >= (k.h - k.l) * 0.25
    && (k.c - near) * s.dir >= 0;
  s.strength = s.maxDepth < 0.5 ? "moderado"
    : s.maxDepth <= 0.7 && rejection ? "forte" : "sem-confirmacao";
  s.strengthAt = i;
  if ((k.c - near) * s.dir >= 0) s.retestComplete = true;
}

/** Closed candles only. Processes pivots, breaks and outcomes in chronological order. */
export function detect(c: Candle[]) {
  const anns: Ann[] = [];
  const setups: LiveSetup[] = [];
  const highs: number[] = [];
  const lows: number[] = [];
  const takenHighs = new Set<number>();
  const takenLows = new Set<number>();
  type Sweep = { pivot: number; at: number; level: number; extreme: number };
  let lowSweep: Sweep | null = null;
  let highSweep: Sweep | null = null;
  let lastHigh: number | null = null;
  let lastLow: number | null = null;
  let trend: 0 | 1 | -1 = 0;
  let bosCount = 0;
  let trendStart = 0;
  let cooldownUntil = -1;
  let id = 0;

  const cancel = (s: LiveSetup, i: number) => {
    s.status = "cancelada";
    s.closedAt = i;
    cooldownUntil = Math.max(cooldownUntil, i + COOLDOWN_BARS);
  };
  const resolve = (s: LiveSetup, i: number) => {
    const k = c[i]!;
    const hitStop = s.dir === 1 ? k.l <= s.stop : k.h >= s.stop;
    const hitTake = s.dir === 1 ? k.h >= s.take : k.l <= s.take;
    if (s.status === "aguardando") {
      if (i - s.fvgAt > MAX_WAIT) { s.status = "expirada"; s.closedAt = i; return; }
      const touched = k.l <= s.entry && k.h >= s.entry;
      const far = s.dir === 1 ? s.fvgBottom : s.fvgTop;
      // OHLC cannot order intrabar touches: invalidate conservatively before activation.
      if (hitStop || (k.c - far) * s.dir < 0 || (!touched && (k.c - s.breakLevel) * s.dir < 0)) {
        cancel(s, i); return;
      }
      if (touched) {
        s.status = "ativa"; s.filledAt = i;
        updateStrength(s, k, i);
        // No same-bar take: price may have reached it before filling the entry.
        return;
      }
      if (hitTake) cancel(s, i);
    } else if (s.status === "ativa") {
      if (hitStop) { s.status = "stop"; s.closedAt = i; }
      else {
        updateStrength(s, k, i);
        if (hitTake) { s.status = "take"; s.closedAt = i; }
      }
    }
  };

  for (let i = 0; i < c.length; i++) {
    for (const s of setups) if ((s.status === "aguardando" || s.status === "ativa") && i > s.fvgAt) resolve(s, i);
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
    // Keep the captured pivot and the actual extreme, including multi-candle sweeps.
    if (lowSweep && k.l < lowSweep.extreme) { lowSweep.at = i; lowSweep.extreme = k.l; }
    if (highSweep && k.h > highSweep.extreme) { highSweep.at = i; highSweep.extreme = k.h; }
    for (const pivot of lows) if (!takenLows.has(pivot) && k.l < c[pivot]!.l) {
      takenLows.add(pivot); lowSweep = { pivot, at: i, level: c[pivot]!.l, extreme: k.l };
    }
    for (const pivot of highs) if (!takenHighs.has(pivot) && k.h > c[pivot]!.h) {
      takenHighs.add(pivot); highSweep = { pivot, at: i, level: c[pivot]!.h, extreme: k.h };
    }
    const a = priorAtr(c, i);
    for (const dir of [1, -1] as const) {
      const piv = dir === 1 ? lastHigh : lastLow;
      if (piv === null || piv >= i) continue;
      const level = dir === 1 ? c[piv]!.h : c[piv]!.l;
      if ((k.c - level) * dir <= 0) continue;
      // Consume even weak breaks: a later candle must not relabel the same broken pivot.
      if (dir === 1) lastHigh = null; else lastLow = null;
      const opposite = trend === -dir;
      if (opposite) for (const s of setups) if (s.status === "aguardando" && s.dir !== dir) cancel(s, i);
      if (a === null || !isDisplacement(k, dir, level, a)) {
        if (opposite) { trend = 0; bosCount = 0; }
        continue;
      }
      // First break seeds direction. Only subsequent continuation proves a trend.
      if (trend === 0) { trend = dir; bosCount = 0; trendStart = i; continue; }
      const type = opposite ? "choch" : "bos";
      const valid = !opposite || bosCount >= 1;
      const oldTrendStart = trendStart;
      if (opposite) { trend = dir; bosCount = 0; trendStart = i; }
      else bosCount++;
      if (!valid || i <= cooldownUntil) continue;
      anns.push({ kind: "line", x1: piv, x2: i, y: level, label: type === "choch" ? "CHoCH" : "BOS", tone: "neutral", show: i });
      if (type === "choch") {
        const sweep = dir === 1 ? lowSweep : highSweep;
        if (sweep && sweep.at >= oldTrendStart && sweep.at < i && i - sweep.at <= MAX_WAIT && (k.c - sweep.level) * dir > 0) {
          const pos = dir === 1 ? "below" : "above";
          anns.push(
            { kind: "text", x: sweep.pivot, y: sweep.level, label: "LIQUIDEZ", pos, show: i },
            { kind: "line", x1: sweep.pivot, x2: sweep.at, y: sweep.level, label: "", tone: "neutral", show: i },
            { kind: "text", x: sweep.at, y: sweep.extreme, label: "LIQUIDEZ VARRIDA / REVERSÃO", pos, show: i },
          );
        }
        if (dir === 1) lowSweep = null; else highSweep = null;
      }
      let fvg: { idx: number; top: number; bottom: number } | null = null;
      for (let j = i; j >= Math.max(piv, 2) && j > i - 15; j--) {
        const a0 = c[j - 2]!, a2 = c[j]!;
        const top = dir === 1 ? a2.l : a0.l;
        const bottom = dir === 1 ? a0.h : a2.h;
        if (top - bottom <= a * 0.15) continue;
        // Do not issue a fresh entry for an FVG already filled before this break.
        const entry = fvgEntry(top, bottom, dir);
        if (c.slice(j + 1, i + 1).some(bar => dir === 1 ? bar.l <= entry : bar.h >= entry)) continue;
        fvg = { idx: j - 2, top, bottom }; break;
      }
      if (!fvg) continue;
      const entry = fvgEntry(fvg.top, fvg.bottom, dir);
      const far = dir === 1 ? fvg.bottom : fvg.top;
      const stop = round(far - dir * a * 0.2);
      const pool = (dir === 1 ? highs : lows).filter(x => !(dir === 1 ? takenHighs : takenLows).has(x))
        .map(x => dir === 1 ? c[x]!.h : c[x]!.l);
      const take = takePrice(entry, stop, dir, pool);
      setups.push({ id: id++, type, dir, breakAt: i, breakLevel: level, fvgAt: i, fvgStart: fvg.idx,
        fvgTop: fvg.top, fvgBottom: fvg.bottom, entry, stop, take, status: "aguardando",
        strength: "pendente", maxDepth: 0, retestComplete: false });
    }
  }
  const last = c.length - 1;
  for (const s of setups) {
    const x2 = s.closedAt ?? last + 3;
    anns.push({ kind: "box", x1: s.fvgStart, x2, top: s.fvgTop, bottom: s.fvgBottom, show: s.fvgAt });
    if (s.status === "cancelada" || s.status === "expirada") continue;
    anns.push(
      { kind: "line", x1: s.fvgAt, x2, y: s.entry, label: s.dir === 1 ? "ENTRADA COMPRA" : "ENTRADA VENDA", tone: "entry", show: s.fvgAt },
      { kind: "line", x1: s.fvgAt, x2, y: s.stop, label: "STOP", tone: "stop", show: s.fvgAt },
      { kind: "line", x1: s.fvgAt, x2, y: s.take, label: "TAKE", tone: "take", show: s.fvgAt },
    );
    if (s.filledAt !== undefined) {
      anns.push({ kind: "text", x: s.filledAt, y: s.entry, label: s.dir === 1 ? "▲ ENTROU" : "▼ ENTROU", pos: s.dir === 1 ? "below" : "above", show: s.filledAt });
    }
    if (s.status === "take" || s.status === "stop") {
      const y = s.status === "take" ? s.take : s.stop;
      anns.push({ kind: "text", x: s.closedAt!, y, label: s.status === "take" ? "TAKE ✓" : "STOP ✗", pos: y > s.entry ? "above" : "below", show: s.closedAt! });
    }
  }
  return { anns, setups, cooldownRemaining: Math.max(0, cooldownUntil - last) };
}
