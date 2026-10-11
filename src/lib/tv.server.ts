// Minimal TradingView chart-socket client (unofficial protocol).
export type TvCandle = { t: number; o: number; h: number; l: number; c: number };

const URL_WS = "wss://data.tradingview.com/socket.io/websocket?type=chart";
const ORIGIN = "https://www.tradingview.com";

type Sock = { send(d: string): void; close(): void; onMessage(cb: (d: string) => void): void };

async function openSocket(): Promise<Sock> {
  // Edge runtime: outbound websocket via fetch upgrade (allows Origin header)
  try {
    const resp = (await fetch(URL_WS.replace("wss://", "https://"), {
      headers: { Upgrade: "websocket", Origin: ORIGIN },
    })) as Response & { webSocket?: any };
    if (resp.webSocket) {
      const ws = resp.webSocket;
      ws.accept();
      return {
        send: (d) => ws.send(d),
        close: () => { try { ws.close(); } catch { /* */ } },
        onMessage: (cb) => ws.addEventListener("message", (e: any) => cb(String(e.data))),
      };
    }
  } catch { /* fall through */ }
  // Node (dev): undici WebSocket accepts custom headers
  const WS: any = (globalThis as any).WebSocket;
  const ws = new WS(URL_WS, { headers: { Origin: ORIGIN } });
  await new Promise<void>((res, rej) => {
    ws.addEventListener("open", () => res());
    ws.addEventListener("error", (e: any) => rej(new Error("ws error " + (e?.message ?? ""))));
  });
  return {
    send: (d) => ws.send(d),
    close: () => { try { ws.close(); } catch { /* */ } },
    onMessage: (cb) => ws.addEventListener("message", (e: any) => cb(String(e.data))),
  };
}

const frame = (m: string, p: unknown[]) => {
  const s = JSON.stringify({ m, p });
  return `~m~${s.length}~m~${s}`;
};

function parse(raw: string): string[] {
  return raw.split(/~m~\d+~m~/).filter(Boolean);
}

export async function fetchCandles(symbol: string, tf: string, count: number): Promise<TvCandle[]> {
  const sock = await openSocket();
  const cs = "cs_" + Math.random().toString(36).slice(2, 14);
  return await new Promise<TvCandle[]>((resolve, reject) => {
    let out: TvCandle[] = [];
    const timer = setTimeout(() => { sock.close(); out.length ? resolve(out) : reject(new Error("timeout")); }, 12000);
    sock.onMessage((raw) => {
      for (const part of parse(raw)) {
        if (part.startsWith("~h~")) { sock.send(`~m~${part.length}~m~${part}`); continue; }
        let msg: any;
        try { msg = JSON.parse(part); } catch { continue; }
        if (msg.m === "timescale_update" || msg.m === "du") {
          const s = msg.p?.[1]?.sds_1?.s;
          if (Array.isArray(s)) {
            // History can arrive in multiple chunks; updates replace only matching timestamps.
            const merged = new Map(out.map(candle => [candle.t, candle]));
            for (const b of s) {
              const candle: TvCandle = { t: b.v[0], o: b.v[1], h: b.v[2], l: b.v[3], c: b.v[4] };
              merged.set(candle.t, candle);
            }
            out = [...merged.values()].sort((a, b) => a.t - b.t).slice(-count);
          }
        }
        if (msg.m === "series_completed") { clearTimeout(timer); sock.close(); resolve(out); }
        if (msg.m === "symbol_error" || msg.m === "series_error" || msg.m === "critical_error") {
          clearTimeout(timer); sock.close(); reject(new Error(msg.m + " " + JSON.stringify(msg.p)));
        }
      }
    });
    sock.send(frame("set_auth_token", ["unauthorized_user_token"]));
    sock.send(frame("chart_create_session", [cs, ""]));
    sock.send(frame("resolve_symbol", [cs, "sds_sym_1", "=" + JSON.stringify({ symbol, adjustment: "splits" })]));
    sock.send(frame("create_series", [cs, "sds_1", "s1", "sds_sym_1", tf, count, ""]));
  });
}

