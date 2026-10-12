import type { Ann, Candle } from "./generator";

export type LiveStatus = "aguardando" | "confirmada" | "ativa" | "take" | "stop" | "expirada" | "cancelada" | "indeterminada";
export type SignalStrength = "pendente" | "moderado" | "forte" | "sem-confirmacao";
export const DETECTOR_VERSION = "BOS/FVG v9";
export const CONTRACT_OUNCES_PER_LOT = 100;
export const RISK_REWARD_RATIO = 2;
export const MAX_STOP_LOSS_USD = 134;
export const DEFAULT_LOT_SIZE = 0.25;
/** FVG must be within these multiples of the mean of the last 10 bull + 10 bear gaps. */
export const FVG_MIN_REL = 0.7;
export const FVG_MAX_REL = 3;
export const DEFAULT_FVG_ENTRY_DEPTH = 0.15;
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
  confirmedAt?: number;
  filledAt?: number;
  closedAt?: number;
  reason?: string;
};

const PIVOT = 3;
const M5_PIVOT = 1;
const MAX_WAIT = 60;
export const COOLDOWN_BARS = 5;
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
  return fvgEntryAtDepth(top, bottom, dir, 0.5);
}

export function fvgEntryAtDepth(top: number, bottom: number, dir: 1 | -1, depth: number) {
  if (!Number.isFinite(depth) || depth <= 0 || depth >= 1) {
    throw new RangeError("A profundidade de entrada no FVG deve estar entre 0 e 1.");
  }
  const width = top - bottom;
  return round(dir === 1 ? top - width * depth : bottom + width * depth);
}

export function takePrice(entry: number, stop: number, dir: 1 | -1, riskRewardRatio = RISK_REWARD_RATIO) {
  if (!Number.isFinite(riskRewardRatio) || riskRewardRatio <= 0) {
    throw new RangeError("A relação risco-retorno deve ser um número positivo.");
  }
  const risk = Math.abs(entry - stop);
  if (!Number.isFinite(risk) || risk <= 0) throw new RangeError("O stop deve definir um risco positivo.");
  return round(entry + dir * risk * riskRewardRatio);
}

/** A touch or wick through the edge is allowed while price respects the zone and stop. */
export function respectsFvg(bars: Candle[], top: number, bottom: number, stop: number, dir: 1 | -1) {
  const far = dir === 1 ? bottom : top;
  return bars.every(k => (k.c - far) * dir >= 0 && (dir === 1 ? k.l > stop : k.h < stop));
}

/** Track only the first retest. A later winning move cannot upgrade an earlier weak entry. */
export function updateStrength(s: LiveSetup, k: Candle, i: number) {
  if (s.retestComplete) return;
  const size = s.fvgTop - s.fvgBottom;
  const depth = s.dir === 1 ? (s.fvgTop - k.l) / size : (k.h - s.fvgBottom) / size;
  s.maxDepth = Math.max(s.maxDepth, depth);
  const near = s.dir === 1 ? s.fvgTop : s.fvgBottom;
  const rejection = confirmsRejection(s, k);
  s.strength = s.maxDepth < 0.5 ? "moderado"
    : s.maxDepth <= 0.7 && rejection ? "forte" : "sem-confirmacao";
  s.strengthAt = i;
  if ((k.c - near) * s.dir >= 0) s.retestComplete = true;
}

/** Place the stop just beyond the far edge of the FVG. */
export function fvgStop(top: number, bottom: number, dir: 1 | -1, atr: number) {
  const far = dir === 1 ? bottom : top;
  return round(far - dir * Math.max(POINT, atr * 0.1));
}

/** Require a closed rejection candle before treating a FVG touch as an entry. */
export function confirmsRejection(s: LiveSetup, k: Candle, minimumWickFraction = 0.4, maximumAdverseWickFraction = 0.4) {
  const range = k.h - k.l;
  if (range <= 0 || (k.c - k.o) * s.dir <= 0) return false;
  const favorableWick = s.dir === 1 ? Math.min(k.o, k.c) - k.l : k.h - Math.max(k.o, k.c);
  const adverseWick = s.dir === 1 ? k.h - Math.max(k.o, k.c) : Math.min(k.o, k.c) - k.l;
  return favorableWick >= range * minimumWickFraction
    && favorableWick >= Math.abs(k.c - k.o)
    && adverseWick <= range * maximumAdverseWickFraction
    && (k.c - s.entry) * s.dir >= 0;
}

export function buildM5Bias(c: Candle[], times: readonly number[] | undefined) {
  const groups = new Map<number, { indices: number[]; time: number }>();
  for (let j = 0; j < c.length; j++) {
    const bucket = times ? Math.floor(times[j]! / 300) : Math.floor(j / 5);
    const group = groups.get(bucket) ?? { indices: [], time: times ? bucket * 300 : bucket * 5 };
    group.indices.push(j);
    groups.set(bucket, group);
  }
  const m5: { time: number; high: number; low: number; close: number; closedAt: number }[] = [];
  for (const group of groups.values()) {
    if (group.indices.length !== 5) continue;
    if (times && group.indices.some((index, offset) => offset > 0 && times[index]! !== times[group.indices[offset - 1]!]! + 60)) continue;
    const bars = group.indices.map(index => c[index]!);
    m5.push({
      time: group.time,
      high: Math.max(...bars.map(bar => bar.h)),
      low: Math.min(...bars.map(bar => bar.l)),
      close: bars[4]!.c,
      closedAt: times ? group.time + 300 : group.indices[4]! + 1,
    });
  }
  m5.sort((a, b) => a.time - b.time);
  const bias: (1 | -1 | 0 | null)[] = [];
  let pointer = 0, direction: 1 | -1 | null = null;
  let lastHigh: number | null = null, lastLow: number | null = null;
  const completedBias: (1 | -1 | null)[] = [];
  for (let i = 0; i < m5.length; i++) {
    const pivot = i - M5_PIVOT;
    if (pivot >= M5_PIVOT) {
      let isHigh = true, isLow = true;
      for (let j = pivot - M5_PIVOT; j <= pivot + M5_PIVOT; j++) {
        if (j === pivot) continue;
        if (m5[j]!.high >= m5[pivot]!.high) isHigh = false;
        if (m5[j]!.low <= m5[pivot]!.low) isLow = false;
      }
      if (isHigh) lastHigh = m5[pivot]!.high;
      if (isLow) lastLow = m5[pivot]!.low;
    }
    if (lastHigh !== null && m5[i]!.close > lastHigh) {
      direction = 1;
      lastHigh = null;
    } else if (lastLow !== null && m5[i]!.close < lastLow) {
      direction = -1;
      lastLow = null;
    }
    completedBias.push(direction);
  }
  for (let i = 0; i < c.length; i++) {
    const currentTime = times ? times[i]! : i;
    while (pointer < m5.length && m5[pointer]!.closedAt <= currentTime) {
      pointer++;
    }
    bias.push(pointer === 0 ? null : completedBias[pointer - 1]!);
  }
  return bias;
}

/** Returns true only for a cancellation before entry (which starts cooldown). */
export function resolveSetup(
  s: LiveSetup,
  k: Candle,
  i: number,
  lotSize = DEFAULT_LOT_SIZE,
): boolean {
  const hitStop = s.dir === 1 ? k.l <= s.stop : k.h >= s.stop;
  const hitTake = s.dir === 1 ? k.h >= s.take : k.l <= s.take;
  const finish = (status: LiveStatus, reason: string) => {
    s.status = status; s.closedAt = i; s.reason = reason;
  };
  if (s.status === "confirmada") {
    if (i <= s.confirmedAt!) return false;
    if (i - s.fvgAt > MAX_WAIT) {
      finish("expirada", "Prazo de retorno encerrado");
      return false;
    }
    const entry = round(k.o);
    const far = s.dir === 1 ? s.fvgBottom : s.fvgTop;
    const stop = s.stop;
    if ((stop - far) * s.dir >= 0 || Math.abs(entry - stop) * CONTRACT_OUNCES_PER_LOT * lotSize > MAX_STOP_LOSS_USD) {
      finish("cancelada", "Abertura após rejeição excede o risco máximo");
      return false;
    }
    const take = takePrice(entry, stop, s.dir);
    if ((entry - take) * s.dir >= 0) {
      finish("cancelada", "Preço abriu além do alvo 2R antes da entrada");
      return false;
    }
    s.entry = entry;
    s.stop = stop;
    s.take = take;
    s.status = "ativa";
    s.filledAt = i;
    const hitStopOnEntry = s.dir === 1 ? k.l <= stop : k.h >= stop;
    const hitTakeOnEntry = s.dir === 1 ? k.h >= s.take : k.l <= s.take;
    if (hitStopOnEntry && hitTakeOnEntry) finish("indeterminada", "Stop e alvo tocados na vela de entrada");
    else if (hitStopOnEntry) finish("stop", "Stop atingido na vela de entrada");
    else if (hitTakeOnEntry) finish("indeterminada", "Alvo tocado na vela de entrada; ordem intrabar incerta");
    return false;
  }
  if (s.status === "aguardando") {
    if (i - s.fvgAt > MAX_WAIT) { finish("expirada", "Prazo de retorno encerrado"); return false; }
    const touched = k.l <= s.entry && k.h >= s.entry;
    if (touched) {
      if (hitStop) {
        finish("cancelada", "Reteste atingiu o stop antes da confirmação");
        return true;
      }
      if (confirmsRejection(s, k)) {
        s.status = "confirmada";
        s.confirmedAt = i;
        updateStrength(s, k, i);
      } else {
        const far = s.dir === 1 ? s.fvgBottom : s.fvgTop;
        if ((k.c - far) * s.dir < 0) {
          finish("cancelada", "Zona FVG perdida sem rejeição válida");
          return true;
        }
      }
      return false;
    }
    const far = s.dir === 1 ? s.fvgBottom : s.fvgTop;
    if (hitStop || (k.c - far) * s.dir < 0) {
      finish("cancelada", hitStop ? "Stop violado sem entrada negociável" : "Zona perdida sem toque na entrada");
      return true;
    }
  } else if (s.status === "ativa") {
    if (hitStop && hitTake) finish("indeterminada", "Stop e alvo tocados na mesma vela");
    else if (hitStop) finish("stop", "Stop atingido");
    else {
      updateStrength(s, k, i);
      if (hitTake) finish("take", "Alvo atingido");
    }
  }
  return false;
}

/** Processes every supplied candle, including the live candle, in chronological order. */
export function detect(
  c: Candle[],
  options: {
    times?: readonly number[];
    lotSize?: number;
    entryDepth?: number;
    minFvgAtr?: number;
    includeDiagnostics?: boolean;
  } = {},
) {
  const lotSize = options.lotSize ?? DEFAULT_LOT_SIZE;
  const entryDepth = options.entryDepth ?? DEFAULT_FVG_ENTRY_DEPTH;
  const minFvgAtr = options.minFvgAtr ?? 0.15;
  if (!Number.isFinite(lotSize) || lotSize <= 0) throw new RangeError("O lote deve ser um número positivo.");
  if (options.times && options.times.length !== c.length) throw new RangeError("A quantidade de horários deve corresponder às velas.");
  if (!Number.isFinite(entryDepth) || entryDepth <= 0 || entryDepth >= 1) {
    throw new RangeError("A profundidade de entrada no FVG deve estar entre 0 e 1.");
  }
  if (!Number.isFinite(minFvgAtr) || minFvgAtr < 0) {
    throw new RangeError("O tamanho mínimo do FVG em ATR não pode ser negativo.");
  }
  const m5Bias = buildM5Bias(c, options.times);
  const diagnostics = {
    impulsesBlockedByM5: 0,
    impulsesBlockedByCooldown: 0,
    chochWithoutSweep: 0,
    fvgCandidates: 0,
    fvgTooSmall: 0,
    fvgStopTooWide: 0,
    fvgAlreadyViolated: 0,
    fvgDuplicateOpenZone: 0,
    fvgSelected: 0,
    samples: [] as { breakAt: number; fvgAt: number; dir: 1 | -1; size: number; atr: number; reason: string }[],
    breakEvents: [] as { at: number; dir: 1 | -1; type: "bos" | "choch"; reason: string }[],
    selectedFvgs: [] as { breakAt: number; fvgIndex: number; dir: 1 | -1; size: number; atr: number }[],
  };
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
  type Impulse = { at: number; pivot: number; level: number; dir: 1 | -1; type: "choch" | "bos"; atr: number; emitted: Set<number> };
  let impulses: Impulse[] = [];
  const bullGaps: number[] = [];
  const bearGaps: number[] = [];
  const gapRef = () => bullGaps.length >= 10 && bearGaps.length >= 10
    ? (bullGaps.slice(-10).reduce((a, b) => a + b, 0) + bearGaps.slice(-10).reduce((a, b) => a + b, 0)) / 20
    : null;

  const cancel = (s: LiveSetup, i: number) => {
    s.status = "cancelada";
    s.closedAt = i;
    s.reason = "Quebra contrária com displacement";
    cooldownUntil = Math.max(cooldownUntil, i + COOLDOWN_BARS);
  };

  for (let i = 0; i < c.length; i++) {
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
      // A weak pierce is not a change of context and cannot cancel valid orders.
      if (a === null || !isDisplacement(k, dir, level, a)) continue;
      if (dir === 1) lastHigh = null; else lastLow = null;
      const opposite = trend === -dir;
      if (opposite) for (const s of setups) if ((s.status === "aguardando" || s.status === "confirmada") && s.dir !== dir) {
        // If price traded the entry during this candle, resolve the execution first.
        if (s.status === "aguardando" && k.l <= s.entry && k.h >= s.entry) {
          resolveSetup(s, k, i, lotSize);
        }
        else cancel(s, i);
      }
      // First break seeds direction. Only subsequent continuation proves a trend.
      if (trend === 0) { trend = dir; bosCount = 0; trendStart = i; continue; }
      const type = opposite ? "choch" : "bos";
      const valid = !opposite || bosCount >= 1;
      const oldTrendStart = trendStart;
      if (!valid) {
        if (options.includeDiagnostics) diagnostics.breakEvents.push({ at: i, dir, type, reason: "reversão sem BOS de contexto" });
      }
      if (opposite) { trend = dir; bosCount = 0; trendStart = i; }
      else bosCount++;
      if (!valid) continue;
      anns.push({ kind: "line", x1: piv, x2: i, y: level, label: type === "choch" ? "CHoCH" : "BOS", tone: "neutral", show: i });
      let reversalHasSweep = false;
      if (type === "choch") {
        const sweep = dir === 1 ? lowSweep : highSweep;
        if (sweep && sweep.at >= oldTrendStart && sweep.at < i && i - sweep.at <= MAX_WAIT && (k.c - sweep.level) * dir > 0) {
          reversalHasSweep = true;
          const pos = dir === 1 ? "below" : "above";
          anns.push(
            { kind: "text", x: sweep.pivot, y: sweep.level, label: "LIQUIDEZ", pos, show: i },
            { kind: "line", x1: sweep.pivot, x2: sweep.at, y: sweep.level, label: "", tone: "neutral", show: i },
            { kind: "text", x: sweep.at, y: sweep.extreme, label: "LIQUIDEZ VARRIDA / REVERSÃO", pos, show: i },
          );
        }
        if (dir === 1) lowSweep = null; else highSweep = null;
      }
      if (i <= cooldownUntil) {
        diagnostics.impulsesBlockedByCooldown++;
        if (options.includeDiagnostics) diagnostics.breakEvents.push({ at: i, dir, type, reason: "cooldown" });
        continue;
      }
      if (options.times && m5Bias[i] !== dir) {
        diagnostics.impulsesBlockedByM5++;
        if (options.includeDiagnostics) diagnostics.breakEvents.push({ at: i, dir, type, reason: "M5 ausente ou contrário" });
        continue;
      }
      if (type === "choch" && !reversalHasSweep) {
        diagnostics.chochWithoutSweep++;
        if (options.includeDiagnostics) diagnostics.breakEvents.push({ at: i, dir, type, reason: "CHoCH sem varredura" });
        continue;
      }
      if (type === "bos" || reversalHasSweep) {
        if (options.includeDiagnostics) diagnostics.breakEvents.push({ at: i, dir, type, reason: "impulso elegível" });
        impulses.push({ at: i, pivot: piv, level, dir, type, atr: a, emitted: new Set() });
      }
    }
    for (const s of setups) if ((s.status === "aguardando" || s.status === "confirmada" || s.status === "ativa") && i > s.fvgAt && s.filledAt !== i) {
      if (resolveSetup(s, k, i, lotSize)) {
        cooldownUntil = Math.max(cooldownUntil, i + COOLDOWN_BARS);
      }
    }
    impulses = impulses.filter(leg =>
      i - leg.at <= 3 && leg.dir === trend && (leg.type === "choch" || bosCount >= 1) && i > cooldownUntil,
    );
    // Reference uses gaps closed before this candle so the candidate never biases itself.
    const ref = gapRef();
    if (i >= 2) {
      const up = c[i]!.l - c[i - 2]!.h, dn = c[i - 2]!.l - c[i]!.h;
      if (up > 0) bullGaps.push(up);
      if (dn > 0) bearGaps.push(dn);
    }
    for (const leg of impulses) {
      const { dir } = leg;
      const first = i === leg.at;
      for (let j = i; j >= (first ? Math.max(leg.at, 2, i - 14) : i); j--) {
        if (j < 2 || leg.emitted.has(j)) continue;
        const top = dir === 1 ? c[j]!.l : c[j - 2]!.l;
        const bottom = dir === 1 ? c[j - 2]!.h : c[j]!.h;
        const size = top - bottom;
        if (size <= 0) continue;
        diagnostics.fvgCandidates++;
        let reason = "selected";
        if (size <= leg.atr * minFvgAtr) {
          diagnostics.fvgTooSmall++;
          reason = "gap menor ou igual a 0,15 ATR";
        } else if (ref !== null && size < ref * FVG_MIN_REL) {
          diagnostics.fvgTooSmall++;
          reason = "FVG pequeno vs. média dos últimos 20";
        } else if (ref !== null && size > ref * FVG_MAX_REL) {
          diagnostics.fvgTooSmall++;
          reason = "FVG gigante vs. média dos últimos 20";
        }
        if (reason !== "selected") {
          if (options.includeDiagnostics && diagnostics.samples.length < 40) diagnostics.samples.push({ breakAt: leg.at, fvgAt: j, dir, size, atr: leg.atr, reason });
          continue;
        }
        const entry = fvgEntryAtDepth(top, bottom, dir, entryDepth);
        const stop = fvgStop(top, bottom, dir, leg.atr);
        const maxStopDistance = MAX_STOP_LOSS_USD / (CONTRACT_OUNCES_PER_LOT * lotSize);
        const stopDistance = Math.abs(entry - stop);
        if (stopDistance > maxStopDistance) {
          diagnostics.fvgStopTooWide++;
          if (options.includeDiagnostics && diagnostics.samples.length < 40) diagnostics.samples.push({ breakAt: leg.at, fvgAt: j, dir, size, atr: leg.atr, reason: "stop excede o risco máximo" });
          continue;
        }
        const sizedStop = round(entry - dir * stopDistance);
        const riskUsd = Math.abs(entry - sizedStop) * CONTRACT_OUNCES_PER_LOT * lotSize;
        if (riskUsd > MAX_STOP_LOSS_USD) {
          diagnostics.fvgStopTooWide++;
          if (options.includeDiagnostics && diagnostics.samples.length < 40) diagnostics.samples.push({ breakAt: leg.at, fvgAt: j, dir, size, atr: leg.atr, reason: "stop excede o risco máximo após arredondamento" });
          continue;
        }
        // Prior touches are valid; only loss of the zone/stop invalidates reuse.
        if (!respectsFvg(c.slice(j + 1, i + 1), top, bottom, sizedStop, dir)) {
          diagnostics.fvgAlreadyViolated++;
          if (options.includeDiagnostics && diagnostics.samples.length < 40) diagnostics.samples.push({ breakAt: leg.at, fvgAt: j, dir, size, atr: leg.atr, reason: "zona perdeu integridade antes do sinal" });
          continue;
        }
        // One open position/order per zone; another BOS can reuse it after closure.
        if (setups.some(s => s.dir === dir && s.fvgStart === j - 2 && (s.status === "aguardando" || s.status === "confirmada" || s.status === "ativa"))) {
          diagnostics.fvgDuplicateOpenZone++;
          if (options.includeDiagnostics && diagnostics.samples.length < 40) diagnostics.samples.push({ breakAt: leg.at, fvgAt: j, dir, size, atr: leg.atr, reason: "já existe ordem aberta nesta zona" });
          continue;
        }
        const take = takePrice(entry, sizedStop, dir);
        setups.push({ id: id++, type: leg.type, dir, breakAt: leg.at, breakLevel: leg.level,
          fvgAt: i, fvgStart: j - 2, fvgTop: top, fvgBottom: bottom, entry, stop: sizedStop, take,
          status: "aguardando", strength: "pendente", maxDepth: 0, retestComplete: false });
        diagnostics.fvgSelected++;
        if (options.includeDiagnostics) diagnostics.selectedFvgs.push({ breakAt: leg.at, fvgIndex: j, dir, size, atr: leg.atr });
        if (options.includeDiagnostics && diagnostics.samples.length < 40) diagnostics.samples.push({ breakAt: leg.at, fvgAt: j, dir, size, atr: leg.atr, reason: "selecionado" });
        leg.emitted.add(j);
        break;
      }
    }
  }
  const last = c.length - 1;
  for (const s of setups) {
    if (s.status === "cancelada" || s.status === "expirada") continue;
    const x2 = s.closedAt ?? last + 3;
    anns.push({ kind: "box", x1: s.fvgStart, x2, top: s.fvgTop, bottom: s.fvgBottom, show: s.fvgAt });
    anns.push(
      { kind: "line", x1: s.fvgAt, x2, y: s.entry, label: s.dir === 1 ? "ENTRADA COMPRA" : "ENTRADA VENDA", tone: "entry", show: s.fvgAt },
      { kind: "line", x1: s.fvgAt, x2, y: s.stop, label: "STOP · RISCO", tone: "stop", show: s.fvgAt, amount: -Math.abs(s.entry - s.stop) * CONTRACT_OUNCES_PER_LOT * lotSize },
      { kind: "line", x1: s.fvgAt, x2, y: s.take, label: "TAKE · GANHO", tone: "take", show: s.fvgAt, amount: Math.abs(s.take - s.entry) * CONTRACT_OUNCES_PER_LOT * lotSize },
    );
    if (s.filledAt !== undefined) {
      anns.push({ kind: "text", x: s.filledAt, y: s.entry, label: s.dir === 1 ? "▲ ENTROU" : "▼ ENTROU", pos: s.dir === 1 ? "below" : "above", show: s.filledAt });
    }
    if (s.status === "indeterminada") {
      anns.push({ kind: "text", x: s.closedAt!, y: s.entry, label: "ORDEM INTRABAR INCERTA", pos: s.dir === 1 ? "below" : "above", show: s.closedAt! });
    }
    if (s.status === "take" || s.status === "stop") {
      const y = s.status === "take" ? s.take : s.stop;
      anns.push({ kind: "text", x: s.closedAt!, y, label: s.status === "take" ? "TAKE ✓" : "STOP ✗", pos: y > s.entry ? "above" : "below", show: s.closedAt! });
    }
  }
  return {
    anns,
    setups: setups.filter(s => s.status !== "cancelada" && s.status !== "expirada"),
    cooldownRemaining: Math.max(0, cooldownUntil - last),
    ...(options.includeDiagnostics ? { diagnostics } : {}),
  };
}
