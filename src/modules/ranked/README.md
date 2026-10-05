# Módulo da ranqueada

Partidas ranqueadas: uma fila com pareamento automático e os pontos que
definem o rank de cada jogador. Todas as rotas exigem login
(`Authorization: Bearer <accessToken>`).

A partida em si é uma batalha entre dois jogadores como as das salas
(`src/modules/battles`), marcada com `ranked: true`.

## Antes de usar

Os pontos ficam no model `User` (`rating`, `rankedWins`, `rankedLosses`) e a
fila no model `RankedTicket`, em `prisma/schema.prisma`. Depois de puxar este
módulo, crie a migração:

```bash
npx prisma migrate dev --name ranqueada
```

## Ranks e pontos

Todo jogador começa com 0 ponto. O rank sai dos pontos, de 100 em 100:

| Rank | Id | Pontos |
| --- | --- | --- |
| Bronze | `bronze` | 0 a 99 |
| Prata | `silver` | 100 a 199 |
| Ouro | `gold` | 200 a 299 |
| Platina | `platinum` | 300 a 399 |
| Diamante | `diamond` | 400 a 499 |
| Lendário | `legendary` | 500 ou mais |

Quanto vale uma partida depende da diferença de pontos entre os dois
(`ratingChange`, em `ranked.rules.ts`):

| Situação | Quem vence ganha | Quem perde perde |
| --- | --- | --- |
| Os dois com os mesmos pontos | 16 | 12 |
| Quem venceu tinha 100 pontos a menos | 24 | 18 |
| Quem venceu tinha 100 pontos a mais | 8 | 6 |
| Limites | de 6 a 32 | de 4 a 24 |

A vitória vale um pouco mais do que a derrota custa, de propósito: quem joga
sobe aos poucos mesmo ganhando metade das partidas. Ninguém fica com menos de
zero. Desistir ou deixar o prazo da vez acabar conta como derrota.

## Como a fila funciona

1. O jogador escolhe o time e entra na fila (`POST /api/ranked/queue`). O
   bilhete dele guarda o time e os pontos que ele tinha ao entrar.
2. Enquanto espera, a tela pergunta pela fila (`GET /api/ranked/queue`) a cada
   segundo e meio. Cada pergunta renova o bilhete e tenta parear.
3. O pareamento procura, entre quem está esperando, o jogador com os pontos
   mais próximos. A diferença aceita começa em 100 pontos e abre 100 a cada 5
   segundos de espera; depois de 20 segundos, aceita qualquer um
   (`searchWindow`).
4. Achou: a batalha é criada e os dois bilhetes passam a apontar para ela.
   Quem esperou mais fica com o time A. A tela de cada um descobre na pergunta
   seguinte (`status: "matched"`, com `battleId`) e vai para a batalha.
5. Quando a batalha acaba, os pontos dos dois são lançados, uma vez só.

Não há conexão aberta nem tarefa rodando no servidor: tudo acontece nas
requisições dos próprios jogadores, como nas salas.

- Quem fecha a tela para de perguntar: depois de 10 segundos sem sinal, o
  bilhete dele não é mais pareado com ninguém.
- Dois pareamentos simultâneos não criam duas partidas: cada bilhete é
  reservado com uma atualização condicional, sempre na mesma ordem.
- Quem tem uma ranqueada em andamento não entra em outra fila: precisa
  terminar a partida ou desistir dela (409, `ALREADY_IN_RANKED_BATTLE`, com o
  `battleId` na resposta).

## Rotas

| Método | Rota | O que faz |
| --- | --- | --- |
| GET | `/api/ranked` | Os pontos, o rank, o placar e a situação na fila de quem pediu. |
| POST | `/api/ranked/queue` | Entra na fila. Corpo: `{ "team": ["id", ...] }`, com 5 personagens. |
| GET | `/api/ranked/queue` | Como está a fila. É a consulta que a tela repete enquanto procura. |
| DELETE | `/api/ranked/queue` | Sai da fila. |

`GET /api/ranked`:

```json
{
    "points": 130,
    "rank": "silver",
    "rankFloor": 100,
    "next": { "rank": "gold", "at": 200 },
    "wins": 9,
    "losses": 4,
    "queue": { "status": "idle", "battleId": null, "waitedSeconds": 0, "team": null }
}
```

As três rotas da fila devolvem só o objeto `queue`. `status` é `idle` (fora da
fila), `searching` (procurando) ou `matched` (há uma partida ranqueada em
andamento, em `battleId`). Depois que a partida acaba, volta a `idle`.

### Erros

| Status | Códigos |
| --- | --- |
| 400 | `INVALID_RANKED_REQUEST` (faltou o time), `INVALID_TEAM`, `UNKNOWN_CHARACTER` |
| 404 | `PLAYER_NOT_FOUND` |
| 409 | `ALREADY_IN_RANKED_BATTLE` |

## Arquivos

| Arquivo | Para que serve |
| --- | --- |
| `ranked.rules.ts` | Os ranks, quanto vale uma partida e a janela de busca da fila. Sem banco. |
| `ranked.service.ts` | A fila, o pareamento e o lançamento dos pontos. |
| `ranked.repository.ts` | Leitura e gravação com o Prisma. |
| `ranked.types.ts` | Formatos das respostas e a interface `RankedStore`. |
| `ranked.controller.ts` | Valida o corpo da requisição e traduz erros em respostas HTTP. |
| `ranked.routes.ts` | As rotas. |
| `tests/` | Testes das regras, do serviço e das rotas, com a fila guardada em memória. |
