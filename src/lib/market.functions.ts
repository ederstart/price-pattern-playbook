import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const TFS = ["1", "5", "15", "30", "60", "240", "1D"] as const;
// How many stored candles are sent to the chart per timeframe.
const KEEP: Record<(typeof TFS)[number], number> = { "1": 12000, "5": 4000, "15": 3000, "30": 2000, "60": 2000, "240": 1500, "1D": 1500 };

type Row = { t: number; o: number; h: number; l: number; c: number };

export const getCandles = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ tf: z.enum(TFS) }).parse(d))
  .handler(async ({ data }) => {
    const { fetchCandles } = await import("./tv.server");
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { detect } = await import("./detect");
    const tf = data.tf;
    try {
      const { count } = await db.from("candles").select("t", { count: "exact", head: true }).eq("tf", tf);
      // First load backfills a long history; afterwards only the latest bars are fetched.
      const fresh = await fetchCandles("OANDA:XAUUSD", tf, (count ?? 0) < 500 ? (tf === "1" ? 8000 : 2000) : 300).catch(() => [] as Row[]);
      for (let i = 0; i < fresh.length; i += 1000) {
        await db.from("candles").upsert(fresh.slice(i, i + 1000).map((k) => ({ tf, ...k })));
      }
      const rows: Row[] = [];
      for (let from = 0; from < KEEP[tf]; from += 1000) {
        const { data: page, error } = await db.from("candles").select("t,o,h,l,c").eq("tf", tf)
          .order("t", { ascending: false }).range(from, Math.min(from + 999, KEEP[tf] - 1));
        if (error) throw error;
        rows.push(...(page as Row[]));
        if (page.length < 1000) break;
      }
      const candles = rows.reverse();
      if (!candles.length) return { ok: false as const, error: "sem dados", candles: [], history: [] };

      // Persist finished operations (last candle is still forming).
      const closed = candles.slice(0, -1);
      const times = closed.map((k) => k.t);
      const { setups } = detect(closed, tf === "1" ? { times } : {});
      const done = setups.filter((s) => s.status === "take" || s.status === "stop");
      if (done.length) {
        await db.from("operations").upsert(done.map((s) => ({
          key: `${tf}-${times[s.fvgAt]}-${s.dir}`, tf, type: s.type, dir: s.dir, status: s.status, strength: s.strength,
          fvg_time: times[s.fvgAt]!, closed_time: s.closedAt !== undefined ? times[s.closedAt] ?? null : null,
          entry: s.entry, stop: s.stop, take: s.take, reason: s.reason ?? null,
        })));
      }
      const { data: history } = await db.from("operations").select("key,type,dir,status,fvg_time,entry,stop,take")
        .eq("tf", tf).order("fvg_time", { ascending: false }).limit(500);
      return { ok: true as const, candles, history: history ?? [] };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e), candles: [], history: [] };
    }
  });
