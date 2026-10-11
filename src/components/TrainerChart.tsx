import { useEffect, useRef } from "react";
import type { Ann, Candle } from "@/lib/generator";

type Props = {
  candles: Candle[];
  anns: Ann[];
  visible: number;
  window: number;
  times?: number[];
  tf?: string;
  onView?: (end: number, window: number) => void;
};

function cssVar(el: Element, name: string) {
  return getComputedStyle(el).getPropertyValue(name).trim();
}

export function TrainerChart({ candles, anns, visible, window: win, times, tf, onView }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const live = useRef({ visible, win, onView, len: candles.length });
  live.current = { visible, win, onView, len: candles.length };

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    let drag: { x: number; end: number } | null = null;
    const step = () => (cv.clientWidth - 70) / live.current.win;
    const clampEnd = (e: number) => Math.max(10, Math.min(live.current.len + 20, e));
    const down = (e: PointerEvent) => {
      if (!live.current.onView) return;
      drag = { x: e.clientX, end: live.current.visible };
      cv.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      const shift = Math.round((e.clientX - drag.x) / step());
      live.current.onView?.(clampEnd(drag.end - shift), live.current.win);
    };
    const up = () => { drag = null; };
    const wheel = (e: WheelEvent) => {
      if (!live.current.onView) return;
      e.preventDefault();
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        live.current.onView(clampEnd(live.current.visible + Math.round(e.deltaX / step())), live.current.win);
        return;
      }
      const w = Math.round(Math.max(20, Math.min(600, live.current.win * (e.deltaY > 0 ? 1.15 : 0.87))));
      live.current.onView(live.current.visible, w);
    };
    cv.addEventListener("pointerdown", down);
    cv.addEventListener("pointermove", move);
    cv.addEventListener("pointerup", up);
    cv.addEventListener("wheel", wheel, { passive: false });
    return () => {
      cv.removeEventListener("pointerdown", down);
      cv.removeEventListener("pointermove", move);
      cv.removeEventListener("pointerup", up);
      cv.removeEventListener("wheel", wheel);
    };
  }, []);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const draw = () => {
      const dpr = globalThis.devicePixelRatio || 1;
      const W = cv.clientWidth;
      const FH = cv.clientHeight;
      const H = FH - (times ? 22 : 0);
      cv.width = W * dpr;
      cv.height = FH * dpr;
      const ctx = cv.getContext("2d")!;
      ctx.scale(dpr, dpr);
      const col = {
        bg: cssVar(cv, "--chart-bg"),
        grid: cssVar(cv, "--chart-grid"),
        bull: cssVar(cv, "--bull"),
        bear: cssVar(cv, "--bear"),
        text: cssVar(cv, "--chart-text"),
        muted: cssVar(cv, "--muted-foreground"),
        fvg: cssVar(cv, "--fvg"),
        entry: cssVar(cv, "--entry"),
        stop: cssVar(cv, "--bear"),
        take: cssVar(cv, "--take"),
      };
      ctx.fillStyle = col.bg;
      ctx.fillRect(0, 0, W, FH);

      const axisW = 70;
      const plotW = W - axisW;
      const end = visible;
      const start = Math.max(0, end - win);
      const view = candles.slice(start, Math.min(end, candles.length));
      if (!view.length) return;
      const step = plotW / win;
      const xOf = (i: number) => (i - start) * step + step / 2;
      let hi = Math.max(...view.map((c) => c.h));
      let lo = Math.min(...view.map((c) => c.l));
      const shown = anns.filter((a) => a.show < end && (a.kind === "text" ? a.x : a.x2) >= start);
      for (const a of shown) {
        if (a.kind === "line") { hi = Math.max(hi, a.y); lo = Math.min(lo, a.y); }
        if (a.kind === "box") { hi = Math.max(hi, a.top); lo = Math.min(lo, a.bottom); }
      }
      const pad = (hi - lo) * 0.1 + 1;
      hi += pad; lo -= pad;
      const yOf = (p: number) => ((hi - p) / (hi - lo)) * H;

      // grid
      ctx.strokeStyle = col.grid;
      ctx.lineWidth = 1;
      ctx.fillStyle = col.muted;
      ctx.font = "11px 'JetBrains Mono', monospace";
      const gstep = Math.max(1, Math.round((hi - lo) / 8));
      for (let p = Math.ceil(lo / gstep) * gstep; p < hi; p += gstep) {
        const y = Math.round(yOf(p)) + 0.5;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(plotW, y); ctx.stroke();
        ctx.fillText(p.toFixed(2), plotW + 8, y + 4);
      }

      // time axis
      if (times) {
        ctx.fillStyle = col.muted;
        const every = Math.max(1, Math.round(win / 8));
        for (let i = Math.ceil(start / every) * every; i < Math.min(end, candles.length); i += every) {
          const t = times[i];
          if (t === undefined) continue;
          const d = new Date(t * 1000);
          const pad2 = (n: number) => String(n).padStart(2, "0");
          const lab = tf === "1D" ? `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}` : `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
          const x = xOf(i);
          ctx.fillText(lab, x - ctx.measureText(lab).width / 2, FH - 6);
          ctx.strokeStyle = col.grid;
          ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); ctx.stroke();
        }
      }

      // boxes
      for (const a of shown) {
        if (a.kind !== "box") continue;
        const x1 = xOf(a.x1), x2 = Math.min(xOf(Math.min(a.x2, end - 1 + 6)), plotW);
        ctx.fillStyle = col.fvg;
        ctx.globalAlpha = 0.35;
        ctx.fillRect(x1, yOf(a.top), x2 - x1, yOf(a.bottom) - yOf(a.top));
        ctx.globalAlpha = 1;
        ctx.fillStyle = col.text;
        ctx.font = "bold 10px 'JetBrains Mono', monospace";
        ctx.fillText("FVG", x1 + 3, yOf(a.top) - 3);
      }

      // candles
      const bw = Math.max(1, step * 0.65);
      view.forEach((c, k) => {
        const i = start + k;
        const x = xOf(i);
        const up = c.c >= c.o;
        ctx.strokeStyle = ctx.fillStyle = up ? col.bull : col.bear;
        ctx.beginPath(); ctx.moveTo(x, yOf(c.h)); ctx.lineTo(x, yOf(c.l)); ctx.stroke();
        const y1 = yOf(Math.max(c.o, c.c)), y2 = yOf(Math.min(c.o, c.c));
        ctx.fillRect(x - bw / 2, y1, bw, Math.max(1, y2 - y1));
      });

      // lines + texts
      for (const a of shown) {
        ctx.font = "bold 10px 'JetBrains Mono', monospace";
        if (a.kind === "line") {
          const x1 = xOf(a.x1), x2 = Math.min(xOf(a.x2), plotW - 4);
          const color = a.tone === "neutral" ? col.text : col[a.tone];
          ctx.strokeStyle = color;
          ctx.setLineDash(a.tone === "neutral" && !a.label ? [3, 3] : a.tone === "neutral" ? [] : [6, 3]);
          ctx.lineWidth = a.tone === "neutral" ? 1 : 1.5;
          const y = yOf(a.y);
          ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
          ctx.setLineDash([]);
          if (a.label) {
            ctx.fillStyle = color;
            if (a.tone === "neutral") {
              const w = ctx.measureText(a.label).width;
              ctx.fillText(a.label, (x1 + x2) / 2 - w / 2, y - 4);
            } else {
              const label = `${a.label} ${a.y.toFixed(2)}`;
              const amount = a.amount === undefined ? "" : `${a.amount >= 0 ? "+" : "−"}${new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(Math.abs(a.amount))}`;
              const textWidth = Math.max(ctx.measureText(label).width, ctx.measureText(amount).width);
              const x = x2 + 4 + textWidth > plotW ? Math.max(4, plotW - textWidth - 4) : x2 + 4;
              ctx.fillText(label, x, y - (amount ? 7 : 4));
              if (amount) ctx.fillText(amount, x, y + 6);
            }
          }
        } else if (a.kind === "text") {
          ctx.fillStyle = col.text;
          const w = ctx.measureText(a.label).width;
          const y = a.pos === "above" ? yOf(a.y) - 10 : yOf(a.y) + 18;
          ctx.fillText(a.label, xOf(a.x) - w / 2, y);
        }
        ctx.lineWidth = 1;
      }

      // current price
      const last = view[view.length - 1]!;
      const ly = yOf(last.c);
      const up = last.c >= last.o;
      ctx.strokeStyle = up ? col.bull : col.bear;
      ctx.setLineDash([2, 2]);
      ctx.beginPath(); ctx.moveTo(0, ly); ctx.lineTo(plotW, ly); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = up ? col.bull : col.bear;
      ctx.fillRect(plotW, ly - 9, axisW, 18);
      ctx.fillStyle = col.bg;
      ctx.font = "bold 11px 'JetBrains Mono', monospace";
      ctx.fillText(last.c.toFixed(2), plotW + 8, ly + 4);
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(cv);
    return () => ro.disconnect();
  }, [candles, anns, visible, win, times, tf]);

  return <canvas ref={ref} className="h-full w-full block touch-none cursor-crosshair" />;
}
