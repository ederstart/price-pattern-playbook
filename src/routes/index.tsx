import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { generate, type SetupType } from "@/lib/generator";
import { TrainerChart } from "@/components/TrainerChart";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "XAUUSD Screen Time — Treino de CHoCH, BOS e FVG" },
      { name: "description", content: "Gráfico fictício de XAUUSD com setups de CHoCH e BOS + FVG marcados para treinar o olho." },
      { property: "og:title", content: "XAUUSD Screen Time — Treino de setups" },
      { property: "og:description", content: "Treine leitura de CHoCH, BOS, FVG, entrada, stop e take em gráfico simulado." },
    ],
  }),
  component: Index,
});

const INFO = {
  choch: {
    title: "Reversão — CHoCH + FVG",
    ctx: "Preço vem em tendência e faz um CHoCH. O FVG criado no impulso de reversão vira a zona de entrada.",
    cond: ["CHoCH confirmado na estrutura", "FVG formado no impulso do CHoCH", "Retorno do preço ao FVG", "Confluência: sessão + liquidez varrida"],
    alvo: "Próx. estrutura",
  },
  bos: {
    title: "Continuação — BOS + FVG",
    ctx: "Tendência já definida com BOS confirmado. O FVG de impulso vira a zona de re-entrada na mesma direção.",
    cond: ["BOS confirmado — tendência estabelecida", "FVG deixado no impulso do BOS", "Pullback limpo ao FVG", "Sem CHoCH entre o BOS e a entrada"],
    alvo: "Próx. liquidez",
  },
} as const;

const SPEEDS = [1, 2, 4, 8, 16];

function Index() {
  const [mode, setMode] = useState<"both" | SetupType>("both");
  const [seed, setSeed] = useState(0);
  const data = useMemo(() => generate(mode), [mode, seed]);
  const [visible, setVisible] = useState(60);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(2);

  useEffect(() => setVisible(60), [data]);
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setVisible((v) => (v >= data.candles.length ? v : v + 1));
    }, 1000 / speed);
    return () => clearInterval(t);
  }, [playing, speed, data]);

  const current = [...data.setups].reverse().find((s) => s.start < visible);
  const done = data.setups.filter((s) => s.end < visible).length;
  const finished = visible >= data.candles.length;
  let phase = "Aguardando formação…";
  if (current) {
    if (visible > current.end) phase = "Alvo atingido ✓";
    else if (visible > current.entryAt) phase = "Em operação → alvo";
    else if (visible > current.fvgAt) phase = "FVG formado — aguardando retorno a 50%";
    else phase = "Estrutura se formando…";
  }
  const info = current ? INFO[current.type] : null;

  return (
    <main className="min-h-screen bg-background text-foreground p-4 lg:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="font-display text-2xl tracking-tight">
            <span className="text-primary">XAUUSD</span> Screen Time
          </h1>
          <p className="text-sm text-muted-foreground">Gráfico simulado · dados fictícios · treino de leitura</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(["both", "choch", "bos"] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} className={`chip ${mode === m ? "chip-active" : ""}`}>
              {m === "both" ? "Ambas" : m === "choch" ? "CHoCH" : "BOS"}
            </button>
          ))}
          <span className="w-px h-6 bg-border mx-1" />
          <button className="chip" onClick={() => setPlaying((p) => !p)}>{playing ? "❚❚ Pausar" : "▶ Play"}</button>
          <button className="chip" onClick={() => setVisible((v) => Math.min(data.candles.length, v + 1))}>+1 vela</button>
          {SPEEDS.map((s) => (
            <button key={s} onClick={() => setSpeed(s)} className={`chip ${speed === s ? "chip-active" : ""}`}>{s}x</button>
          ))}
          <button className="chip chip-active" onClick={() => setSeed((s) => s + 1)}>↻ Novo gráfico</button>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="panel h-[70vh] overflow-hidden p-0 relative">
          <TrainerChart candles={data.candles} anns={data.anns} visible={visible} window={120} />
          <div className="absolute left-3 top-2 font-mono text-xs text-muted-foreground">XAUUSD · M5 (sim)</div>
          {finished && (
            <div className="absolute inset-0 grid place-items-center bg-background/70">
              <button className="chip chip-active text-base px-5 py-2" onClick={() => setSeed((s) => s + 1)}>Fim do gráfico — gerar outro</button>
            </div>
          )}
        </div>

        <aside className="space-y-3">
          <div className="panel">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Status</div>
            <div className="mt-1 font-semibold">{phase}</div>
            {current && (
              <div className="mt-1 text-sm text-muted-foreground">
                {current.dir === 1 ? "Compra" : "Venda"} · {current.type === "choch" ? "CHoCH" : "BOS"}
              </div>
            )}
            <div className="mt-2 text-xs text-muted-foreground">Setups concluídos: {done}/{data.setups.length}</div>
          </div>
          {info && current && (
            <>
              <div className="panel">
                <h2 className="font-display text-primary text-lg">{info.title}</h2>
                <p className="text-sm mt-1 text-muted-foreground">{info.ctx}</p>
                <ul className="mt-3 text-sm list-disc pl-5 space-y-1">
                  {info.cond.map((c) => <li key={c}>{c}</li>)}
                </ul>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="stat stat-entry"><span>Entrada</span><b>50% FVG</b><i>{visible > current.fvgAt ? current.entry.toFixed(2) : "—"}</i></div>
                <div className="stat stat-stop"><span>Stop</span><b>Além FVG</b><i>{visible > current.fvgAt ? current.stop.toFixed(2) : "—"}</i></div>
                <div className="stat stat-take"><span>Alvo</span><b>{info.alvo}</b><i>{visible > current.fvgAt ? current.take.toFixed(2) : "—"}</i></div>
              </div>
            </>
          )}
        </aside>
      </div>
    </main>
  );
}
