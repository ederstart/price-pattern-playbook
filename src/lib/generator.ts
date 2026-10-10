export type Candle = { o: number; h: number; l: number; c: number };
export type SetupType = "choch" | "bos";

export type Ann =
  | { kind: "line"; x1: number; x2: number; y: number; label: string; tone: "neutral" | "entry" | "stop" | "take"; show: number }
  | { kind: "box"; x1: number; x2: number; top: number; bottom: number; show: number }
  | { kind: "text"; x: number; y: number; label: string; pos: "above" | "below"; show: number };

export type Setup = {
  type: SetupType;
  dir: 1 | -1;
  start: number;
  fvgAt: number;
  entryAt: number;
  end: number;
  entry: number;
  stop: number;
  take: number;
};

const r = (a: number, b: number) => a + Math.random() * (b - a);

class Builder {
  candles: Candle[] = [];
  anns: Ann[] = [];
  setups: Setup[] = [];
  price: number;
  constructor(p: number) {
    this.price = p;
  }
  get i() {
    return this.candles.length - 1;
  }
  push(o: number, c: number, wick: number) {
    const h = Math.max(o, c) + Math.random() * wick;
    const l = Math.min(o, c) - Math.random() * wick;
    this.candles.push({ o, h, l, c });
    this.price = c;
  }
  move(delta: number, n: number, noise = 0.8, wick = 0.9) {
    const s = this.price;
    for (let k = 1; k <= n; k++) {
      const base = s + (delta * k) / n;
      const c = k === n ? base : base + r(-noise, noise);
      this.push(this.price, c, wick);
    }
  }
  /** returns extreme (high if d=1 / low if d=-1) of last n candles */
  ext(n: number, d: 1 | -1) {
    const sl = this.candles.slice(-n);
    return d === 1 ? Math.max(...sl.map((c) => c.h)) : Math.min(...sl.map((c) => c.l));
  }
  extIdx(n: number, d: 1 | -1) {
    const start = this.candles.length - n;
    let best = start;
    for (let k = start; k < this.candles.length; k++) {
      const c = this.candles[k]!;
      const b = this.candles[best]!;
      if (d === 1 ? c.h > b.h : c.l < b.l) best = k;
    }
    return best;
  }
  /** 3-candle impulse that leaves an FVG */
  impulse(d: 1 | -1, size: number) {
    const tiny = (w: number) => Math.random() * w;
    const o1 = this.price;
    const c1 = o1 + d * size * 0.15;
    this.candles.push({ o: o1, c: c1, h: Math.max(o1, c1) + tiny(0.3), l: Math.min(o1, c1) - tiny(0.3) });
    const c2 = c1 + d * size * 0.65;
    this.candles.push({ o: c1, c: c2, h: Math.max(c1, c2) + tiny(0.2), l: Math.min(c1, c2) - tiny(0.2) });
    const c3 = c2 + d * size * 0.2;
    this.candles.push({ o: c2, c: c3, h: Math.max(c2, c3) + tiny(0.3), l: Math.min(c2, c3) - tiny(0.3) });
    this.price = c3;
    const a = this.candles[this.i - 2]!;
    const b = this.candles[this.i]!;
    const top = d === 1 ? b.l : a.l;
    const bottom = d === 1 ? a.h : b.h;
    return { top, bottom, idx: this.i - 1 };
  }
  filler(n: number) {
    let left = n;
    while (left > 0) {
      const k = Math.min(left, Math.floor(r(3, 7)));
      this.move(r(-4, 4), k, 0.9, 1);
      left -= k;
    }
  }

  choch(d: 1 | -1) {
    const start = this.candles.length;
    const startPrice = this.price;
    this.move(-d * r(7, 9), 6);
    this.move(d * r(3.5, 4.5), 4);
    this.move(-d * r(6, 7.5), 5);
    const prevLowIdx = this.extIdx(5, (-d) as 1 | -1);
    const prevLow = this.ext(5, (-d) as 1 | -1);
    this.move(d * r(4.5, 5.5), 4);
    const lhIdx = this.extIdx(4, d);
    const lh = this.ext(4, d);
    this.move(-d * r(6.5, 8), 5, 0.6);
    const revIdx = this.extIdx(5, (-d) as 1 | -1);
    const rev = this.ext(5, (-d) as 1 | -1);
    this.move(d * 1.2, 2, 0.3, 0.5);
    const size = (lh - this.price) * d + r(2.5, 4);
    const fvg = this.impulse(d, size);
    const breakIdx = this.i - 1;
    this.move(d * 1.2, 2, 0.3, 0.6);
    const mid = (fvg.top + fvg.bottom) / 2;
    this.move(mid - this.price, 4, 0.3, 0.4);
    const entryAt = this.i;
    const entry = mid;
    const far = d === 1 ? fvg.bottom : fvg.top;
    const stop = far - d * 1.2;
    const take = Math.max(startPrice * d, (entry + d * (entry - stop) * 2.5) * d) * d;
    this.move((take - this.price) * 0.55, 6);
    this.move(-d * 1.5, 3);
    this.move(take + d * r(1, 3) - this.price, 6);
    const end = this.i;
    const pos = (s: 1 | -1) => (s === 1 ? "above" : "below") as "above" | "below";
    this.anns.push(
      { kind: "text", x: prevLowIdx, y: d === 1 ? prevLow : prevLow, label: "LIQUIDEZ", pos: pos((-d) as 1 | -1), show: prevLowIdx },
      { kind: "line", x1: prevLowIdx, x2: revIdx, y: prevLow, label: "", tone: "neutral", show: revIdx },
      { kind: "text", x: revIdx, y: rev, label: "LIQUIDEZ VARRIDA / REVERSÃO", pos: pos((-d) as 1 | -1), show: revIdx + 1 },
      { kind: "line", x1: lhIdx, x2: breakIdx, y: lh, label: "CHoCH", tone: "neutral", show: breakIdx },
      { kind: "box", x1: fvg.idx - 1, x2: entryAt + 6, top: fvg.top, bottom: fvg.bottom, show: fvg.idx + 1 },
      { kind: "line", x1: fvg.idx, x2: entryAt + 8, y: entry, label: d === 1 ? "ENTRADA COMPRA" : "ENTRADA VENDA", tone: "entry", show: fvg.idx + 1 },
      { kind: "line", x1: fvg.idx, x2: entryAt + 8, y: stop, label: "STOP", tone: "stop", show: fvg.idx + 1 },
      { kind: "line", x1: fvg.idx, x2: entryAt + 8, y: take, label: "TAKE", tone: "take", show: fvg.idx + 1 },
    );
    this.setups.push({ type: "choch", dir: d, start, fvgAt: fvg.idx + 1, entryAt, end, entry, stop, take });
  }

  bos(d: 1 | -1) {
    const start = this.candles.length;
    this.move(d * r(5, 7), 5);
    const e1Idx = this.extIdx(5, d);
    const e1 = this.ext(5, d);
    this.move(-d * r(2.5, 3.5), 3);
    this.move(d * r(5.5, 7), 4);
    const b1 = this.candles.findIndex((c, k) => k > e1Idx && (d === 1 ? c.h > e1 : c.l < e1));
    const e2Idx = this.extIdx(4, d);
    const e2 = this.ext(4, d);
    this.move(-d * r(2.5, 3.5), 3, 0.5);
    this.move(d * 0.8, 1, 0.2, 0.4);
    const size = (e2 - this.price) * d + r(2.5, 4);
    const fvg = this.impulse(d, size);
    const b2 = this.i - 1;
    this.move(d * 1, 2, 0.3, 0.5);
    const mid = (fvg.top + fvg.bottom) / 2;
    this.move(mid - this.price, 4, 0.3, 0.4);
    const entryAt = this.i;
    const entry = mid;
    const far = d === 1 ? fvg.bottom : fvg.top;
    const stop = far - d * 1.2;
    const take = entry + d * (entry - stop) * d * d * r(2.5, 3.2) * (d === 1 ? 1 : 1);
    const takeFix = entry + d * Math.abs(entry - stop) * r(2.5, 3.2);
    void take;
    this.move((takeFix - this.price) * 0.6, 5);
    this.move(-d * 1.8, 3);
    this.move(takeFix + d * r(0.5, 2) - this.price, 5);
    const end = this.i;
    const pos = d === 1 ? "above" : "below";
    this.anns.push(
      { kind: "line", x1: e1Idx, x2: b1, y: e1, label: "BOS", tone: "neutral", show: b1 },
      { kind: "line", x1: e2Idx, x2: b2, y: e2, label: "BOS", tone: "neutral", show: b2 },
      { kind: "box", x1: fvg.idx - 1, x2: entryAt + 6, top: fvg.top, bottom: fvg.bottom, show: fvg.idx + 1 },
      { kind: "line", x1: fvg.idx, x2: entryAt + 8, y: entry, label: d === 1 ? "ENTRADA COMPRA" : "ENTRADA VENDA", tone: "entry", show: fvg.idx + 1 },
      { kind: "line", x1: fvg.idx, x2: entryAt + 8, y: stop, label: "STOP", tone: "stop", show: fvg.idx + 1 },
      { kind: "line", x1: fvg.idx, x2: entryAt + 8, y: takeFix, label: "TAKE", tone: "take", show: fvg.idx + 1 },
    );
    void pos;
    this.setups.push({ type: "bos", dir: d, start, fvgAt: fvg.idx + 1, entryAt, end, entry, stop, take: takeFix });
  }
}

export function generate(mode: "both" | SetupType, count = 14) {
  const b = new Builder(r(2300, 2450));
  b.filler(40);
  for (let k = 0; k < count; k++) {
    const t: SetupType = mode === "both" ? (Math.random() < 0.5 ? "choch" : "bos") : mode;
    const d: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
    if (t === "choch") b.choch(d);
    else b.bos(d);
    b.filler(Math.floor(r(18, 30)));
  }
  return { candles: b.candles, anns: b.anns, setups: b.setups };
}
