import { useMemo } from "react";
import type { Candle } from "@/lib/generator";

// Investing.com-style technical summary. Display only; it does not affect setup detection.
type Vote = 1 | 0 | -1;

const sma = (v: number[], n: number) => v.length < n ? null : v.slice(-n).reduce((a, b) => a + b, 0) / n;
function ema(v: number[], n: number) {
  if (v.length < n) return null;
  const k = 2 / (n + 1);
  let e = v.slice(0, n).reduce((a, b) => a + b, 0) / n;
  for (let i = n; i < v.length; i++) e = v[i]! * k + e * (1 - k);
  return e;
}
function emaSeries(v: number[], n: number) {
  const k = 2 / (n + 1); const out: number[] = []; let e = v[0] ?? 0;
  for (const x of v) { e = x * k + e * (1 - k); out.push(e); }
  return out;
}
function rsi(c: number[], n = 14) {
  if (c.length <= n) return null;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = c[i]! - c[i - 1]!; if (d > 0) g += d; else l -= d; }
  g /= n; l /= n;
  for (let i = n + 1; i < c.length; i++) {
    const d = c[i]! - c[i - 1]!;
    g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n;
  }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}

function indicators(k: Candle[]): Vote[] {
  const c = k.map((x) => x.c);
  const last = k.slice(-14);
  const hh = Math.max(...last.map((x) => x.h)), ll = Math.min(...last.map((x) => x.l));
  const close = c[c.length - 1]!;
  const votes: Vote[] = [];
  const r = rsi(c);
  if (r !== null) votes.push(r > 70 ? -1 : r < 30 ? 1 : r > 55 ? 1 : r < 45 ? -1 : 0);
  const stoch = hh === ll ? 50 : ((close - ll) / (hh - ll)) * 100;
  votes.push(stoch > 80 ? -1 : stoch < 20 ? 1 : stoch > 55 ? 1 : stoch < 45 ? -1 : 0);
  const macd = emaSeries(c, 12).map((v, i) => v - emaSeries(c, 26)[i]!);
  const signal = emaSeries(macd, 9);
  votes.push(macd.at(-1)! > signal.at(-1)! ? 1 : -1);
  const wr = hh === ll ? -50 : ((hh - close) / (hh - ll)) * -100;
  votes.push(wr > -20 ? -1 : wr < -80 ? 1 : wr > -45 ? 1 : wr < -55 ? -1 : 0);
  const tp = k.slice(-14).map((x) => (x.h + x.l + x.c) / 3);
  const m = tp.reduce((a, b) => a + b, 0) / tp.length;
  const md = tp.reduce((a, b) => a + Math.abs(b - m), 0) / tp.length;
  const cci = md === 0 ? 0 : (tp.at(-1)! - m) / (0.015 * md);
  votes.push(cci > 100 ? 1 : cci < -100 ? -1 : 0);
  if (c.length > 12) { const roc = close - c[c.length - 13]!; votes.push(roc > 0 ? 1 : roc < 0 ? -1 : 0); }
  return votes;
}

function averages(k: Candle[]): Vote[] {
  const c = k.map((x) => x.c);
  const close = c[c.length - 1]!;
  const votes: Vote[] = [];
  for (const n of [5, 10, 20, 50, 100, 200]) for (const v of [sma(c, n), ema(c, n)]) {
    if (v !== null) votes.push(close > v ? 1 : close < v ? -1 : 0);
  }
  return votes;
}

const score = (v: Vote[]) => v.length ? v.reduce<number>((a, b) => a + b, 0) / v.length : 0;
const LABELS = ["Venda Forte", "Venda", "Neutro", "Compra", "Compra Forte"] as const;
const bucket = (s: number) => s <= -0.5 ? 0 : s <= -0.1 ? 1 : s < 0.1 ? 2 : s < 0.5 ? 3 : 4;
const TONE = ["bear", "bear", "muted", "bull", "bull"] as const;

function Gauge({ title, value, big }: { title: string; value: number; big?: boolean }) {
  const b = bucket(value);
  const r = 40, cx = 50, cy = 48;
  const pt = (a: number, rr = r) => [cx - rr * Math.cos(a), cy - rr * Math.sin(a)] as const;
  const arc = (a1: number, a2: number) => { const [x1, y1] = pt(a1), [x2, y2] = pt(a2); return `M${x1} ${y1} A${r} ${r} 0 0 1 ${x2} ${y2}`; };
  const segs = [0, 1, 2, 3, 4].map((i) => [i * Math.PI / 5 + 0.03, (i + 1) * Math.PI / 5 - 0.03] as const);
  const ang = ((value + 1) / 2) * Math.PI;
  const [nx, ny] = pt(ang, r - 10);
  const strong = b === 0 || b === 4;
  return (
    <div className="flex flex-col items-center">
      <div className={`font-semibold ${big ? "text-sm" : "text-xs"}`}>{title}</div>
      <svg viewBox="0 0 100 56" className={big ? "w-36" : "w-24"}>
        {segs.map(([a1, a2], i) => (
          <path key={i} d={arc(a1, a2)} fill="none" strokeWidth={i === 0 || i === 4 ? 4 : 3}
            className={i < 2 ? "stroke-bear" : i > 2 ? "stroke-bull" : "stroke-muted-foreground"} opacity={i === 0 || i === 4 ? 1 : 0.5} />
        ))}
        <line x1={cx} y1={cy} x2={nx} y2={ny} className="stroke-muted-foreground" strokeWidth="1.2" />
        <circle cx={cx} cy={cy} r="2.5" className="fill-muted-foreground" />
      </svg>
      <span className={`rounded-full px-3 py-0.5 text-xs font-semibold ${
        TONE[b] === "muted" ? "bg-muted text-muted-foreground"
          : big && strong ? (TONE[b] === "bull" ? "bg-bull text-background" : "bg-bear text-background")
          : TONE[b] === "bull" ? "bg-bull/15 text-bull" : "bg-bear/15 text-bear"}`}>{LABELS[b]}</span>
    </div>
  );
}

export function TechGauges({ candles }: { candles: Candle[] }) {
  const s = useMemo(() => {
    if (candles.length < 30) return null;
    const k = candles.slice(-400);
    const ind = indicators(k), ma = averages(k);
    return { ind: score(ind), ma: score(ma), all: score([...ind, ...ma]) };
  }, [candles]);
  if (!s) return null;
  return (
    <div className="panel">
      <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Análise técnica · tempo gráfico atual</div>
      <div className="flex justify-center"><Gauge title="Resumo" value={s.all} big /></div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Gauge title="Indicadores Técnicos" value={s.ind} />
        <Gauge title="Médias Móveis" value={s.ma} />
      </div>
    </div>
  );
}
