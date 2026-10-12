import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { getCandles } from "@/lib/market.functions";
import { CONTRACT_OUNCES_PER_LOT, DEFAULT_FVG_ENTRY_DEPTH, DEFAULT_LOT_SIZE, detect, DETECTOR_VERSION, RISK_REWARD_RATIO, STRENGTH_LABELS, type LiveSetup } from "@/lib/detect";
import { TrainerChart } from "@/components/TrainerChart";
import type { TvCandle } from "@/lib/tv.server";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "XAUUSD Ao Vivo — CHoCH, BOS e FVG em tempo real" },
      { name: "description", content: "Gráfico real do XAUUSD com detecção automática de CHoCH, BOS, FVG, entrada, stop e take." },
      { property: "og:title", content: "XAUUSD Ao Vivo — setups em tempo real" },
      { property: "og:description", content: "Velas reais do ouro com marcações automáticas da estratégia." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
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

const formatUsd = (amount: number) => new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
}).format(amount);

const STATUS: Record<LiveSetup["status"], { label: string; cls: string }> = {
  aguardando: { label: "Aguardando entrada", cls: "text-muted-foreground" },
  confirmada: { label: "Rejeição confirmada · aguardando próxima vela", cls: "text-primary" },
  ativa: { label: "Em operação", cls: "text-primary" },
  take: { label: "Take ✓", cls: "text-bull" },
  stop: { label: "Stop ✗", cls: "text-bear" },
  expirada: { label: "Expirada", cls: "text-muted-foreground" },
  indeterminada: { label: "Indeterminada", cls: "text-muted-foreground" },
  cancelada: { label: "Cancelada", cls: "text-muted-foreground" },
};

type Hist = { key: string; type: string; dir: number; status: string; fvg_time: number; entry: number; stop: number; take: number };

function beep() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [880, 1320].forEach((f, k) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.2, ctx.currentTime + k * 0.18);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + k * 0.18 + 0.16);
      o.start(ctx.currentTime + k * 0.18); o.stop(ctx.currentTime + k * 0.18 + 0.17);
    });
  } catch { /* */ }
}

function Live() {
  const [tf, setTf] = useState<Tf>("1");
  const [raw, setRaw] = useState<TvCandle[]>([]);
  const [history, setHistory] = useState<Hist[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [notify, setNotify] = useState(false);
  const seen = useRef<Set<string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [follow, setFollow] = useState(true);
  const [lotSize, setLotSize] = useState(DEFAULT_LOT_SIZE);
  const [view, setView] = useState({ end: 0, win: 120 });
  useEffect(() => {
    const saved = Number(localStorage.getItem("lotSize"));
    if (Number.isFinite(saved) && saved > 0) setLotSize(saved);
    const savedTf = localStorage.getItem("tf");
    if (savedTf && TFS.some((t) => t.v === savedTf)) setTf(savedTf as Tf);
    setNotify(typeof Notification !== "undefined" && Notification.permission === "granted");
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => { localStorage.setItem("lotSize", String(lotSize)); }, [lotSize]);
  useEffect(() => { localStorage.setItem("tf", tf); seen.current = null; }, [tf]);
  const tfRef = useRef(tf);
  tfRef.current = tf;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setRaw([]);
    setFollow(true);
    const load = async () => {
      const r = await getCandles({ data: { tf } }).catch((e) => ({ ok: false as const, error: String(e), candles: [], history: [] }));
      if (!alive || tfRef.current !== tf) return;
      setLoading(false);
      if (r.ok && r.candles.length) { setRaw(r.candles); setHistory(r.history as Hist[]); setError(null); }
      else if (!r.ok) setError(r.error);
    };
    load();
    const t = setInterval(load, tf === "1" ? 4000 : 8000);
    return () => { alive = false; clearInterval(t); };
  }, [tf]);

  const candles = useMemo(() => raw.map(({ o, h, l, c }) => ({ o, h, l, c })), [raw]);
  const times = useMemo(() => raw.map((c) => c.t), [raw]);
  // The provider's last candle is still forming; signals and retests require a close.
  const confirmedCandles = useMemo(() => candles.slice(0, -1), [candles]);
  const confirmedTimes = useMemo(() => times.slice(0, -1), [times]);
  const { anns, setups, cooldownRemaining } = useMemo(
    () => detect(confirmedCandles, { lotSize, ...(tf === "1" ? { times: confirmedTimes } : {}) }),
    [confirmedCandles, confirmedTimes, lotSize, tf],
  );
  // Alert once per setup when it confirms or enters; the first load only primes the list.
  useEffect(() => {
    if (!times.length) return;
    const live = setups.filter((s) => s.status === "confirmada" || s.status === "ativa");
    const keys = live.map((s) => `${times[s.fvgAt]}-${s.dir}-${s.status}`);
    if (seen.current === null) { seen.current = new Set(keys); return; }
    for (const [n, s] of live.entries()) {
      if (seen.current.has(keys[n]!)) continue;
      seen.current.add(keys[n]!);
      const msg = `${s.dir === 1 ? "COMPRA" : "VENDA"} · ${s.type === "choch" ? "CHoCH" : "BOS"} + FVG · ${s.status === "ativa" ? "entrou" : "rejeição confirmada"} · ${s.entry.toFixed(2)}`;
      beep();
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        try { new Notification(`XAUUSD ${TFS.find((t) => t.v === tf)?.l}`, { body: msg, tag: keys[n]! }); } catch { /* */ }
      }
    }
  }, [setups, times, tf]);

  const tfSec = tf === "1D" ? 86400 : Number(tf) * 60;
  const lastT = raw[raw.length - 1]?.t;
  const remain = lastT ? Math.max(0, lastT + tfSec - Math.floor(now / 1000)) : 0;
  const clock = `${remain >= 3600 ? `${Math.floor(remain / 3600)}:` : ""}${String(Math.floor((remain % 3600) / 60)).padStart(2, "0")}:${String(remain % 60).padStart(2, "0")}`;

  const end = follow ? candles.length + 5 : view.end;

  const jump = (s: LiveSetup) => {
    setFollow(false);
    setView((v) => ({ ...v, end: Math.min(candles.length + 5, (s.closedAt ?? s.fvgAt) + 25) }));
  };

  const recent = [...setups].reverse().slice(0, 12);
  const closed = history;
  const uncertain = setups.filter(s => s.status === "indeterminada").length;
  const wins = closed.filter((s) => s.status === "take").length;
  const open = [...setups].reverse().find((s) => s.status === "aguardando" || s.status === "confirmada" || s.status === "ativa");
  const last = raw[raw.length - 1];
  const stale = last ? Date.now() / 1000 - last.t > 60 * 30 && tf !== "1D" : false;

  return (
    <main className="min-h-screen bg-background text-foreground p-4 lg:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="font-display text-2xl tracking-tight">
            <span className="text-primary">XAUUSD</span> Ao Vivo
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {TFS.map((t) => (
            <button key={t.v} onClick={() => setTf(t.v)} className={`chip ${tf === t.v ? "chip-active" : ""}`}>{t.l}</button>
          ))}
          <span className="w-px h-6 bg-border mx-1" />
          <button className={`chip ${follow ? "chip-active" : ""}`} onClick={() => setFollow(true)}>⟶ Tempo real</button>
          <button
            className={`chip ${notify ? "chip-active" : ""}`}
            onClick={async () => {
              beep();
              if (typeof Notification === "undefined") return;
              setNotify((await Notification.requestPermission()) === "granted");
            }}
          >{notify ? "Alertas ativos ✓" : "Ativar alertas"}</button>
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
            {DETECTOR_VERSION} · OANDA:XAUUSD · {TFS.find((t) => t.v === tf)?.l} {stale ? "· mercado fechado" : <>· vela fecha em <b className="text-foreground">{clock}</b></>}
          </div>
          {loading && <div className="absolute inset-0 grid place-items-center text-muted-foreground">Carregando velas reais…</div>}
          {error && !raw.length && (
            <div className="absolute inset-0 grid place-items-center p-6 text-center text-bear">Não foi possível buscar os dados agora. Tentando de novo…</div>
          )}
          <div className="absolute right-20 bottom-7 text-[10px] text-muted-foreground">arraste para mover · roda do mouse para zoom</div>
        </div>

        <aside className="space-y-3">
          <div className="panel flex items-center justify-between gap-3">
            <label htmlFor="lot-size" className="text-sm font-medium">Tamanho do lote</label>
            <input
              id="lot-size"
              type="number"
              min="0.01"
              step="0.01"
              value={lotSize}
              onChange={(event) => {
                const value = event.currentTarget.valueAsNumber;
                if (Number.isFinite(value) && value > 0) setLotSize(value);
              }}
              className="w-24 rounded border border-border bg-background px-2 py-1 text-right font-mono"
            />
          </div>
          <div className="panel">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Setup atual</div>
            {open ? (
              <>
                <div className="mt-1 font-semibold">
                  {open.dir === 1 ? "Compra" : "Venda"} · {open.type === "choch" ? "CHoCH" : "BOS"} + FVG
                </div>
                <div className={`text-sm ${STATUS[open.status].cls}`}>{STATUS[open.status].label}</div>
                <div className="text-xs mt-1 text-muted-foreground">{STRENGTH_LABELS[open.strength]} · entrada {Math.round(DEFAULT_FVG_ENTRY_DEPTH * 100)}% da borda próxima do FVG · execução após rejeição</div>
                <div className="grid grid-cols-3 gap-2 text-center mt-3">
                  <div className="stat stat-entry"><span>Entrada</span><b>{open.entry.toFixed(2)}</b></div>
                  <div className="stat stat-stop"><span>Perda no stop · −{formatUsd(Math.abs(open.entry - open.stop) * CONTRACT_OUNCES_PER_LOT * lotSize)}</span><b>{open.stop.toFixed(2)}</b></div>
                  <div className="stat stat-take"><span>Ganho no take · +{formatUsd(Math.abs(open.take - open.entry) * CONTRACT_OUNCES_PER_LOT * lotSize)}</span><b>{open.take.toFixed(2)}</b></div>
                </div>
                <p className="mt-2 text-[10px] text-muted-foreground">
                  Alvo de {RISK_REWARD_RATIO}R · estimativa baseada em {CONTRACT_OUNCES_PER_LOT} oz/lote.
                </p>
              </>
            ) : (
              <div className="mt-1 text-sm text-muted-foreground">Nenhum setup aberto — aguardando quebra de estrutura com FVG.</div>
            )}
          </div>

          <div className="panel">
            <div className="flex justify-between text-xs uppercase tracking-widest text-muted-foreground">
              <span>Histórico salvo</span>
              <span>{wins}/{closed.length} takes</span>
            </div>
            <p className="text-xs text-muted-foreground mt-2">{DETECTOR_VERSION} · {raw.length.toLocaleString("pt-BR")} velas salvas · {closed.length} operações · lote {lotSize.toLocaleString("pt-BR")}{cooldownRemaining > 0 ? ` · Bloqueio: ${cooldownRemaining} velas restantes` : ""}</p>
            {uncertain > 0 && <p className="text-xs text-muted-foreground mt-1">{uncertain} entradas indeterminadas (fora da estatística)</p>}
            <ul className="mt-2 divide-y divide-border text-sm">
              {recent.map((s) => (
                <li key={s.id}>
                  <button onClick={() => jump(s)} className="w-full flex justify-between py-1.5 hover:text-primary text-left">
                    <span>{s.dir === 1 ? "▲" : "▼"} {s.type === "choch" ? "CHoCH" : "BOS"} · {times[s.fvgAt] ? new Date(times[s.fvgAt]! * 1000).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : ""}</span>
                    <span className="text-right">
                      <span className={STATUS[s.status].cls}>
                        {STATUS[s.status].label}
                        {s.status === "take" && ` · +${formatUsd(Math.abs(s.take - s.entry) * CONTRACT_OUNCES_PER_LOT * lotSize)}`}
                        {s.status === "stop" && ` · −${formatUsd(Math.abs(s.entry - s.stop) * CONTRACT_OUNCES_PER_LOT * lotSize)}`}
                      </span>
                      <small className="block text-muted-foreground" title={s.reason}>{s.reason ?? STRENGTH_LABELS[s.strength]}</small>
                    </span>
                  </button>
                </li>
              ))}
              {!recent.length && <li className="py-2 text-muted-foreground">Nenhum setup ainda.</li>}
            </ul>
          </div>
          <p className="text-xs text-muted-foreground">Valores em USD estimados pelo lote informado e hipótese de {CONTRACT_OUNCES_PER_LOT} oz/lote; o histórico usa o risco/alvo calculado no setup. Sinais e retestes só são confirmados em velas fechadas. Dados não oficiais do TradingView; use para estudo.</p>
        </aside>
      </div>
    </main>
  );
}
