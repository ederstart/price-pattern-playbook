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
- Setup detection (CHoCH context / BOS entries + FVG, entry 38.2%, stop beyond impulse candle, take 5.00 or untouched liquidity within 5.00 and at least 1.5R) lives in src/lib/detect.ts and is shared by nothing else; the simulator uses src/lib/generator.ts.

