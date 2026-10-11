# Price Pattern Playbook

quero criar um aplicativo, que é um gráfico do XAUUSD, não com o preço real, pode ser com valores e movimentações ficticias, mas que sempre durante o gráfico tenha, alguns padrões desse setup que está na imagem, e também as marcações, qual é a finalidade? ganhar tempo de tela, para eu me acostumar a ver no gráfico o contexto da estratégia para que eu possa replicar quando eu ver sendo feito no gráfico real.

quero que mostre a entrada, CHOC, BOS, marque o retangulo no FVG, marque o take profit, o stop loss aonde seria com base no que está na imagem.

São 2 estratégias diferente.

Direto do TradingView (não oficiais)

tvdatafeed (fork mantido): https://github.com/rongardF/tvdatafeed

tvdatafeed (original, parado): https://github.com/StreamAlpha/tvdatafeed

TradingView-API (Node.js): https://github.com/Mathieu2301/TradingView-API. É a mais completa, com candles, indicadores e tempo real.

tradingview-scraper (Python): https://github.com/mnwato/tradingview-scraper

TradingView-Screener (Python): https://github.com/shner-elmo/TradingView-Screener. Usa a API do screener, então serve para pegar o preço atual e o OHLC do dia, mas não histórico longo de candles.

Alternativas com dados de XAU/USD

dukascopy-node: https://github.com/Leo4815162342/dukascopy-node. Baixa histórico gratuito de XAUUSD em vários timeframes, inclusive ticks, direto da Dukascopy. Para histórico longo, costuma ser a melhor opção.

yfinance: https://github.com/ranaroussi/yfinance. Use os tickers GC=F (futuro) ou XAUUSD=X (spot).

Twelve Data (Python): https://github.com/twelvedata/twelvedata-python. Tem plano gratuito com chave de API.

Alpha Vantage (Python): https://github.com/RomelTorres/alpha_vantage

OANDA v20 (Python): https://github.com/hootnot/oanda-api-v20. Precisa de conta, mas a demo é gratuita e o instrumento é XAU_USD.

Recomendação rápida

Para os mesmos dados que você vê no TradingView, comece pelo rongardF/tvdatafeed (Python) ou pelo Mathieu2301/TradingView-API (Node).

Para histórico grande e estável, use dukascopy-node.

Para um projeto simples, yfinance resolve com poucas linhas.

Talvez você consiga pesquisar alguma coisa.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/6a15a610-d560-41b6-b131-de765ba371e9).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
