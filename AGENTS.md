<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Real XAUUSD candles come from the unofficial TradingView chart websocket in src/lib/tv.server.ts (fetch-upgrade on edge, undici WebSocket in dev); user chose it over official feeds.
- Live setup detection (BOS continuation and swept-liquidity CHoCH reversals + FVG) lives in src/lib/detect.ts. The simulator page was removed; generator.ts only supplies shared chart types. Live entries use 15% penetration from the near FVG edge, require a closed, strong rejection candle and a 5m structure/BOS bias on 1m charts (no moving averages), with a dynamic 2R target and structural stop risk capped at $134 per trade, scaled to the selected lot using the 100 oz per lot assumption. There is no minimum monetary stop.
- Candles and closed take/stop operations persist in Cloud tables (candles, operations); getCandles upserts fresh TradingView bars, serves stored history and runs detect server-side to save results, so the browser never writes to the database.
- FVGs are filtered relative to the mean of the last 10 bull + 10 bear gaps (too small or too large are skipped).
- Signal alerts use the browser Notification API + a WebAudio beep and only fire while a tab with the site is open.
