import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const TFS = ["1", "5", "15", "30", "60", "240", "1D"] as const;
type Tf = (typeof TFS)[number];
// Lookback in days. The window starts at a fixed UTC midnight so it only moves once
// per day: detection then sees the same history every poll and does not repaint.
const DAYS: Record<Tf, number> = { "1": 4, "5": 14, "15": 40, "30": 80, "60": 160, "240": 600, "1D": 4000 };
const anchor = (tf: Tf) => Math.floor(Date.now() / 86400000) * 86400 - DAYS[tf] * 86400;

type Row = { t: number; o: number; h: number; l: number; c: number };

async function readRange(tf: Tf, since: number): Promise<Row[]> {
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  const { count } = await db.from("candles").select("t", { count: "exact", head: true }).eq("tf", tf).gte("t", since);
  const pages = Math.max(1, Math.ceil((count ?? 0) / 1000));
  const parts = await Promise.all(Array.from({ length: pages }, (_, p) =>
    db.from("candles").select("t,o,h,l,c").eq("tf", tf).gte("t", since).order("t").range(p * 1000, p * 1000 + 999)));
  const map = new Map<number, Row>();
  for (const r of parts) for (const k of (r.data ?? []) as Row[]) map.set(k.t, k);
  return [...map.values()].sort((a, b) => a.t - b.t);
}

async function readHistory(tf: Tf) {
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  const { data } = await db.from("operations").select("key,type,dir,status,fvg_time,entry,stop,take")
    .eq("tf", tf).order("fvg_time", { ascending: false }).limit(500);
  return data ?? [];
}

/** Fast path: whatever is already stored, no TradingView round-trip. */
export const getStored = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ tf: z.enum(TFS) }).parse(d))
  .handler(async ({ data }) => {
    try {
      const [candles, history] = await Promise.all([readRange(data.tf, anchor(data.tf)), readHistory(data.tf)]);
      return { ok: true as const, candles, history, from: anchor(data.tf) };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e), candles: [] as Row[], history: [], from: 0 };
    }
  });

/** Pulls fresh bars from TradingView, saves them and returns only bars at/after `since`. */
export const syncCandles = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ tf: z.enum(TFS), since: z.number().int().min(0) }).parse(d))
  .handler(async ({ data }) => {
    const { fetchCandles } = await import("./tv.server");
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { detect } = await import("./detect");
    const tf = data.tf;
    try {
      const from = anchor(tf);
      const backfill = data.since < from + 3600;
      const tfSec = tf === "1D" ? 86400 : Number(tf) * 60;
      // Fetch enough bars to cover any gap since the last stored candle.
      const need = Math.min(8000, Math.ceil((Date.now() / 1000 - Math.max(data.since, from)) / tfSec) + 20);
      const fresh = await fetchCandles("OANDA:XAUUSD", tf, need).catch(() => [] as Row[]);
      for (let i = 0; i < fresh.length; i += 1000) {
        await db.from("candles").upsert(fresh.slice(i, i + 1000).map((k) => ({ tf, ...k })));
      }
      let saved = false;
      // Recompute finished operations only when a new candle closed.
      if (fresh.length && fresh[fresh.length - 1]!.t > data.since) {
        const all = await readRange(tf, from);
        const closed = all.slice(0, -1);
        const times = closed.map((k) => k.t);
        const done = detect(closed, tf === "1" ? { times } : {}).setups.filter((s) => s.status === "take" || s.status === "stop");
        if (done.length) {
          await db.from("operations").upsert(done.map((s) => ({
            key: `${tf}-${times[s.fvgAt]}-${s.dir}`, tf, type: s.type, dir: s.dir, status: s.status, strength: s.strength,
            fvg_time: times[s.fvgAt]!, closed_time: s.closedAt !== undefined ? times[s.closedAt] ?? null : null,
            entry: s.entry, stop: s.stop, take: s.take, reason: s.reason ?? null,
          })));
        }
        saved = true;
      }
      const since = backfill ? from : data.since;
      return { ok: true as const, candles: fresh.filter((k) => k.t >= since), history: saved ? await readHistory(tf) : null, from };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e), candles: [] as Row[], history: null, from: 0 };
    }
  });
