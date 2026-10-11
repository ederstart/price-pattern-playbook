import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const TFS = ["1", "5", "15", "30", "60", "240", "1D"] as const;

export const getCandles = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ tf: z.enum(TFS), count: z.number().min(50).max(2000) }).parse(d))
  .handler(async ({ data }) => {
    const { fetchCandles } = await import("./tv.server");
    try {
      const candles = await fetchCandles("OANDA:XAUUSD", data.tf, data.count);
      return { ok: true as const, candles };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e), candles: [] };
    }
  });
