import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { getCandles } from "@/lib/market.functions";
import { detect, type LiveSetup } from "@/lib/detect";
import { TrainerChart } from "@/components/TrainerChart";
import type { TvCandle } from "@/lib/tv.server";

export const Route = createFileRoute("/ao-vivo")({
  head: () => ({
    meta: [
      { title: "XAUUSD Ao Vivo — CHoCH, BOS e FVG em tempo real" },
      { name: "description", content: "Gráfico real do XAUUSD com detecção automática de CHoCH, BOS, FVG, entrada, stop e take." },
      { property: "og:title", content: "XAUUSD Ao Vivo — setups em tempo real" },
      { property: "og:description", content: "Velas reais do ouro com marcações automáticas da estratégia." },
    ],
  }),
  component: Live,
});

const TFS = [
  { v: "1", l: "1m" },
  { v: "5", l: "5m" },
  { v: "15", l: "15m" },
  { v: "30", l: "30m" },
  { v: "60", l: "1h" },
  { v: "240", l: "4h" },
  { v: "1D", l: "1D" },
] as const;
type Tf = (typeof TFS)[number]["v"];

const STATUS: Record<LiveSetup["status"], { label: string; cls: string }> = {
  aguardando: { label: "Aguardando entrada", cls: "text-muted-foreground" },
  ativa: { label: "Em operação", cls: "text-primary" },
  take: { label: "Take ✓", cls: "text-bull" },
  stop: { label: "Stop ✗", cls: "text-bear" },
  expirada: { label: "Expirada", cls: "text-muted-foreground" },
  cancelada: { label: "Cancelada", cls: "text-muted-foreground" },
};

function Live() {
  const [tf, setTf] = useState<Tf>("1");
  const [raw, setRaw] = useState<TvCandle[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [follow, setFollow] = useState(true);
  const [view, setView] = useState({ end: 0, win: 120 });
  const tfRef = useRef(tf);
  tfRef.current = tf;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setRaw([]);
    setFollow(true);
    const load = async () => {
      const r = await getCandles({ data: { tf, count: 1500 } }).catch((e) => ({ ok: false as const, error: String(e), candles: [] }));
      if (!alive || tfRef.current !== tf) return;
      setLoading(false);
      if (r.ok && r.candles.length) { setRaw(r.candles); setError(null); }
      else if (!r.ok) setError(r.error);
    };
    load();
    const t = setInterval(load, tf === "1" ? 4000 : 8000);
    return () => { alive = false; clearInterval(t); };
  }, [tf]);

  const candles = useMemo(() => raw.map(({ o, h, l, c }) => ({ o, h, l, c })), [raw]);
  const times = useMemo(() => raw.map((c) => c.t), [raw]);
  const { anns, setups } = useMemo(() => detect(candles), [candles]);
  const end = follow ? candles.length + 5 : view.end;

  const jump = (s: LiveSetup) => {
    setFollow(false);
    setView((v) => ({ ...v, end: Math.min(candles.length + 5, (s.closedAt ?? s.fvgAt) + 25) }));
  };

  const recent = [...setups].reverse().slice(0, 12);
  const closed = setups.filter((s) => s.status === "take" || s.status === "stop");
  const wins = closed.filter((s) => s.status === "take").length;
  const open = [...setups].reverse().find((s) => s.status === "aguardando" || s.status === "ativa");
  const last = raw[raw.length - 1];
  const stale = last ? Date.now() / 1000 - last.t > 60 * 30 && tf !== "1D" : false;

  return (
    <main className="min-h-screen bg-background text-foreground p-4 lg:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="font-display text-2xl tracking-tight">
            <span className="text-primary">XAUUSD</span> Ao Vivo
          </h1>
          <nav className="flex gap-3 text-sm">
            <Link to="/" className="text-muted-foreground hover:text-foreground">Treino (simulado)</Link>
            <span className="text-primary">Ao vivo</span>
          </nav>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {TFS.map((t) => (
            <button key={t.v} onClick={() => setTf(t.v)} className={`chip ${tf === t.v ? "chip-active" : ""}`}>{t.l}</button>
          ))}
          <span className="w-px h-6 bg-border mx-1" />
          <button className={`chip ${follow ? "chip-active" : ""}`} onClick={() => setFollow(true)}>⟶ Tempo real</button>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="panel h-[72vh] overflow-hidden p-0 relative">
          <TrainerChart
            candles={candles}
            anns={anns}
            visible={end}
            window={view.win}
            times={times}
            tf={tf}
            onView={(e, w) => {
              setView({ end: e, win: w });
              setFollow(e >= candles.length + 3);
            }}
          />
          <div className="absolute left-3 top-2 font-mono text-xs text-muted-foreground">
            OANDA:XAUUSD · {TFS.find((t) => t.v === tf)?.l} {stale && "· mercado fechado"}
          </div>
          {loading && <div className="absolute inset-0 grid place-items-center text-muted-foreground">Carregando velas reais…</div>}
          {error && !raw.length && (
            <div className="absolute inset-0 grid place-items-center p-6 text-center text-bear">Não foi possível buscar os dados agora. Tentando de novo…</div>
          )}
          <div className="absolute right-20 bottom-7 text-[10px] text-muted-foreground">arraste para mover · roda do mouse para zoom</div>
        </div>

        <aside className="space-y-3">
          <div className="panel">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Setup atual</div>
            {open ? (
              <>
                <div className="mt-1 font-semibold">
                  {open.dir === 1 ? "Compra" : "Venda"} · {open.type === "choch" ? "CHoCH" : "BOS"} + FVG
                </div>
                <div className={`text-sm ${STATUS[open.status].cls}`}>{STATUS[open.status].label}</div>
                <div className="grid grid-cols-3 gap-2 text-center mt-3">
                  <div className="stat stat-entry"><span>Entrada</span><b>{open.entry.toFixed(2)}</b></div>
                  <div className="stat stat-stop"><span>Stop</span><b>{open.stop.toFixed(2)}</b></div>
                  <div className="stat stat-take"><span>Take</span><b>{open.take.toFixed(2)}</b></div>
                </div>
              </>
            ) : (
              <div className="mt-1 text-sm text-muted-foreground">Nenhum setup aberto — aguardando quebra de estrutura com FVG.</div>
            )}
          </div>

          <div className="panel">
            <div className="flex justify-between text-xs uppercase tracking-widest text-muted-foreground">
              <span>Histórico no gráfico</span>
              <span>{wins}/{closed.length} takes</span>
            </div>
            <ul className="mt-2 divide-y divide-border text-sm">
              {recent.map((s) => (
                <li key={s.id}>
                  <button onClick={() => jump(s)} className="w-full flex justify-between py-1.5 hover:text-primary text-left">
                    <span>{s.dir === 1 ? "▲" : "▼"} {s.type === "choch" ? "CHoCH" : "BOS"} · {times[s.fvgAt] ? new Date(times[s.fvgAt]! * 1000).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : ""}</span>
                    <span className={STATUS[s.status].cls}>{STATUS[s.status].label}</span>
                  </button>
                </li>
              ))}
              {!recent.length && <li className="py-2 text-muted-foreground">Nenhum setup ainda.</li>}
            </ul>
          </div>
          <p className="text-xs text-muted-foreground">Dados não oficiais do TradingView. Marcações automáticas podem errar — use para estudo.</p>
        </aside>
      </div>
    </main>
  );
}
