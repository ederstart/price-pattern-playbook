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

- A primeira quebra expressiva estabelece a direção; pelo menos um BOS de continuação é necessário antes de um CHoCH. Quebras fracas consomem o pivô e não são promovidas a sinal em uma vela posterior.
- Rompimento: corpo direcional de pelo menos 60% da amplitude e 0,7 × ATR. O ATR usa as 14 velas anteriores; a folga de fechamento é o maior valor entre 0,01 e 0,05 × ATR. Isso mede deslocamento de preço, não confirma volume negociado. A vela aberta também entra no detector; seu preço atual é usado como fechamento provisório. Os sinais intrabar são recalculados a cada consulta e podem mudar até o fechamento.
- O gráfico de 1 minuto solicita 6.000 velas. O total realmente recebido aparece na interface; sessões, pausas e disponibilidade da fonte podem reduzir o histórico.
- Entrada a 38,2% do FVG, arredondada a duas casas. O primeiro retorno fica Moderado / Fraco abaixo de 50%. Forte / Ideal exige profundidade máxima de 50%–70%, vela direcional, pavio de rejeição de pelo menos 25% da amplitude e fechamento de volta além da borda próxima do FVG. Retornos mais profundos ou sem rejeição recebem Sem rejeição ideal. A classificação não antecipa o retorno nem é melhorada após encerrar esse primeiro reteste.
- Take padrão: 5,00 de variação no XAUUSD (500 pontos de 0,01, não lucro líquido da conta). Uma liquidez ainda não capturada pode antecipar o alvo se estiver a até 5,00 e oferecer pelo menos 1,5R.
- O CHoCH marca o pivô de liquidez efetivamente capturado e seu extremo antes da reversão. As marcações só são confirmadas junto com o CHoCH.
- Cancelamento antes da entrada bloqueia novos sinais na vela do cancelamento e nas dez velas seguintes (dez minutos em 1m). Expiração por tempo não inicia o bloqueio. Violação do stop ou fechamento além do FVG antes da ativação cancela o setup. Com OHLC não se conhece a ordem intrabar: violação tem prioridade, operações ativas priorizam stop e não há take na própria vela de entrada.
- Estas regras pertencem ao modo Ao Vivo. O modo Treino continua sendo um gerador de exemplos sintéticos.

Validação: `npm test`, `npx tsc --noEmit` e `npm run build`.

### Continuação de tendência e reaproveitamento

- CHoCH indica mudança potencial de estrutura, mas não gera entrada contra a tendência anterior. A nova direção precisa de um BOS de continuação para liberar entradas.
- Cada BOS válido pode gerar novos FVGs: o detector acompanha o impulso por até três velas após o rompimento, além de buscar o FVG na vela do BOS.
- FVG tocado pode ser reutilizado por um BOS válido, desde que as velas posteriores à sua formação não tenham fechado além da borda distante nem violado o stop. Há uma única ordem/operação aberta por zona e direção.
- Um retorno ao nível rompido, ou alcançar o alvo antes da entrada, não cancela uma zona respeitada. Uma quebra contrária cancela ordens pendentes antes de avaliar novas ativações. O cooldown continua aplicado às invalidações, não a toques válidos.
- O histórico recebido em vários pacotes é acumulado por timestamp, preservando as velas anteriores e atualizando a vela aberta.
