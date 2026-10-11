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


## Regras do detector ao vivo

- Existem dois setups: continuação BOS + FVG, após tendência confirmada, e reversão CHoCH + FVG, quando a quebra contrária sucede a um BOS e há varredura de liquidez. O FVG do próprio CHoCH pode ser usado na reversão. Quebras fracas consomem o pivô e não são promovidas a sinal em uma vela posterior.
- Rompimento: corpo direcional de pelo menos 60% da amplitude e 0,7 × ATR. O ATR usa as 14 velas anteriores; a folga de fechamento é o maior valor entre 0,01 e 0,05 × ATR. Isso mede deslocamento de preço, não confirma volume negociado.
- No gráfico de 1 minuto, o alinhamento com a tendência de 5 minutos é definido por ação do preço, sem médias móveis: candles M5 completos formam pivôs, e o fechamento rompendo o último pivô confirma um BOS e fixa o viés naquela direção até um BOS contrário confirmado. Candles M5 incompletos não são usados. Sem BOS M5 confirmado, não há nova ordem; a estrutura de 1 minuto continua sendo atualizada.
- O gráfico de 1 minuto solicita 6.000 velas. O total realmente recebido aparece na interface; sessões, pausas e disponibilidade da fonte podem reduzir o histórico.
- A entrada padrão está a 15% de profundidade a partir da borda próxima do FVG (compra: borda superior; venda: borda inferior), usando a zona formada no impulso BOS/CHoCH. O teste histórico comparou profundidades de 15%, 25%, 30%, 40% e 50%; nessa amostra, 15% teve o maior número de trades e melhor resultado líquido entre as opções testadas. O reteste precisa fechar com rejeição a favor: pavio favorável de pelo menos 40% da amplitude e não menor que o corpo, pavio contrário de no máximo 40% e fechamento além do preço de entrada. A entrada só acontece na abertura da vela seguinte; a vela que ainda está formando não confirma retestes nem sinais.
- O stop fica além da borda distante do FVG. Para XAUUSD, o dimensionamento assume 100 oz por lote: o stop estrutural é preservado, sem impor risco mínimo, e o risco máximo é US$134 para o lote informado na tela. Se o stop estrutural exceder o máximo, o setup não é aberto.
- O alvo é dinâmico em 2R: a distância da entrada ao take é duas vezes a distância real da entrada ao stop, recalculada na abertura da vela de execução. Assim, o valor projetado varia proporcionalmente ao stop e ao lote; o stop estrutural mantém risco monetário máximo de US$134 por operação, com a distância de preço ajustada ao lote informado e à hipótese de 100 oz/lote. Confirme o contrato e a convenção de pontos da corretora.
- A tela do setup exibe o preço e o valor estimado em USD do stop e do take; as linhas do gráfico também exibem esses valores, e o histórico mostra o ganho ou a perda estimados por operação. Os cálculos usam o lote selecionado e a hipótese de 100 oz/lote; não incluem spread ou slippage.
- O CHoCH marca o pivô de liquidez efetivamente capturado e seu extremo antes da reversão. As marcações só são confirmadas junto com o CHoCH.
- Cancelamento antes da entrada bloqueia novos sinais na vela do cancelamento e nas cinco velas seguintes (cinco minutos em 1m). Expiração por tempo não inicia o bloqueio. Setups cancelados e expirados não são exibidos no histórico ou no gráfico. O lote padrão é 0,50 e pode ser alterado no painel.
- Estas regras pertencem ao modo Ao Vivo. O modo Treino continua sendo um gerador de exemplos sintéticos.

Validação: `npm test`, `npx tsc --noEmit` e `npm run build`.

### Continuação de tendência e reaproveitamento

- CHoCH indica mudança potencial de estrutura, mas não gera entrada contra a tendência anterior. A nova direção precisa de um BOS de continuação para liberar entradas.
- Cada BOS válido pode gerar novos FVGs: o detector acompanha o impulso por até três velas após o rompimento, além de buscar o FVG na vela do BOS. FVGs fora dessa janela não são entradas desta estratégia por não estarem ligados ao impulso estrutural confirmado; gaps de até 0,15 × ATR, zonas já violadas, operações com risco acima do teto e impulsos sem alinhamento M5 também são rejeitados.
- FVG tocado pode ser reutilizado por um BOS válido, desde que as velas posteriores à sua formação não tenham fechado além da borda distante nem violado o stop. Há uma única ordem/operação aberta por zona e direção.
- Um retorno ao nível rompido, ou alcançar o alvo antes da entrada, não cancela uma zona respeitada. Apenas uma quebra contrária com displacement altera o contexto; microquebras não cancelam ordens. Um toque executável na entrada não é apagado por uma quebra posterior na mesma vela. O cooldown continua aplicado às invalidações, não a toques válidos.
- O histórico recebido em vários pacotes é acumulado por timestamp, preservando as velas anteriores e atualizando a vela aberta.

### Contabilização de resultados — BOS/FVG v9

- Stop e alvo tocados na mesma vela ficam como Indeterminada, fora da taxa de takes/stops. Entrada e alvo tocados juntos na vela de entrada também ficam Indeterminada, pois OHLC de 1m não revela a ordem intrabar.
- A interface mostra operações executadas e seus resultados; cancelados e expirados não aparecem no histórico nem no gráfico. A contagem de takes considera somente takes e stops.
- No estudo exploratório de 6.878 candles fechados com entrada a 15% do FVG e alvo simulado em 2R, foram 7 takes e 8 stops (+6R antes de custos), em 15 operações. Na parte final separada cronologicamente para validação houve 2 takes e 3 stops (+1R), ainda uma amostra muito pequena. Backtests e testes sintéticos não são prova de assertividade nem garantia de resultado em mercado real.
