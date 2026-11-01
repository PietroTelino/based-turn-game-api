# Módulo da ranqueada

Partidas ranqueadas: uma fila com pareamento automático, a seleção de
personagens à vista do adversário e os pontos que definem o rank de cada
jogador. Todas as rotas exigem login
(`Authorization: Bearer <accessToken>`).

A partida em si é uma batalha entre dois jogadores como as das salas
(`src/modules/battles`), marcada com `ranked: true`.

## Antes de usar

Os pontos ficam no model `User` (`rating`, `rankedWins`, `rankedLosses`), a
fila no model `RankedTicket` e a seleção de personagens no model
`RankedDraft`, em `prisma/schema.prisma`. Depois de puxar este
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

1. O jogador entra na fila (`POST /api/ranked/queue`), sem time: o time é
   montado depois, na seleção. O bilhete guarda os pontos que ele tinha ao
   entrar.
2. Enquanto espera, a tela pergunta pela fila (`GET /api/ranked/queue`) a cada
   segundo e meio. Cada pergunta renova o bilhete e tenta parear.
3. O pareamento procura, entre quem está esperando, o jogador com os pontos
   mais próximos. A diferença aceita começa em 100 pontos e abre 100 a cada 5
   segundos de espera; depois de 20 segundos, aceita qualquer um
   (`searchWindow`).
4. Achou: começa a seleção de personagens dos dois, e os bilhetes passam a
   apontar para ela (`status: "drafting"`, com `draftId`). Quem esperou mais
   fica com o time A e começa.
5. Quando a seleção acaba, a batalha é criada com os dois times, e a tela de
   cada um vai para ela (`status: "matched"`, com `battleId`).
6. Quando a batalha acaba, os pontos dos dois são lançados, uma vez só.

## Seleção de personagens

As regras ficam em `ranked.draft.ts`:

1. Cada um bane um personagem: primeiro o time A, depois o B. O banido não
   pode ser escolhido por ninguém.
2. Depois escolhem alternando, na ordem A, B, B, A, A, B, B, A, A, B (cinco
   cada). Quem começa tem a primeira escolha; o outro responde com duas.
3. O mesmo personagem pode estar nos dois times; dentro de um time, não
   repete. A ordem das escolhas é a ordem em que entram em campo.
4. Cada passo tem 30 segundos (`DRAFT_TURN_MS`). Se o tempo acaba, o jogo
   escolhe ao acaso por quem estava na vez. Isso é aplicado na próxima
   pergunta de qualquer um dos dois, um passo por prazo vencido: se ninguém
   pergunta por um tempo, os passos vencidos são todos resolvidos de uma vez.
5. Duas jogadas ao mesmo tempo não se atropelam: a seleção tem uma versão, e
   só grava quem ainda está na versão que leu (`DRAFT_CONFLICT` para o outro).
   A criação da partida no fim também é reservada por uma requisição só.

Não há conexão aberta nem tarefa rodando no servidor: tudo acontece nas
requisições dos próprios jogadores, como nas salas.

- Quem fecha a tela para de perguntar: depois de 10 segundos sem sinal, o
  bilhete dele não é mais pareado com ninguém.
- Dois pareamentos simultâneos não criam duas partidas: cada bilhete é
  reservado com uma atualização condicional, sempre na mesma ordem.
- Quem tem uma ranqueada em andamento (ou a seleção dela) não entra em outra
  fila: precisa terminar a partida ou desistir dela (409,
  `ALREADY_IN_RANKED_BATTLE`, com o `battleId` ou o `draftId` na resposta).

## Rotas

| Método | Rota | O que faz |
| --- | --- | --- |
| GET | `/api/ranked` | Os pontos, o rank, o placar e a situação na fila de quem pediu. |
| POST | `/api/ranked/queue` | Entra na fila. Sem corpo. |
| GET | `/api/ranked/queue` | Como está a fila. É a consulta que a tela repete enquanto procura. |
| DELETE | `/api/ranked/queue` | Sai da fila. |
| GET | `/api/ranked/draft` | A seleção de personagens de quem pediu. É a consulta que a tela repete durante a seleção. |
| POST | `/api/ranked/draft` | Bane ou escolhe no passo da vez. Corpo: `{ "characterId": "barbaro" }`. |

`GET /api/ranked`:

```json
{
    "points": 130,
    "rank": "silver",
    "rankFloor": 100,
    "next": { "rank": "gold", "at": 200 },
    "wins": 9,
    "losses": 4,
    "queue": { "status": "idle", "draftId": null, "battleId": null, "waitedSeconds": 0 }
}
```

As três rotas da fila devolvem só o objeto `queue`. `status` é `idle` (fora da
fila), `searching` (procurando), `drafting` (na seleção de personagens, em
`draftId`) ou `matched` (há uma partida ranqueada em andamento, em
`battleId`). Depois que a partida acaba, volta a `idle`.

As duas rotas da seleção devolvem a seleção como quem pediu a enxerga:

```json
{
    "id": "…",
    "status": "drafting",
    "you": "A",
    "players": { "A": "Ana", "B": "Bruno" },
    "order": [{ "team": "A", "kind": "ban" }, { "team": "B", "kind": "ban" }, { "team": "A", "kind": "pick" }],
    "actions": [{ "team": "A", "kind": "ban", "characterId": "necromante", "auto": false }],
    "current": { "index": 1, "team": "B", "kind": "ban", "timeLeftMs": 27400 },
    "banned": ["necromante"],
    "teams": { "A": [], "B": [] },
    "choices": [],
    "battleId": null
}
```

`choices` são os personagens que valem agora, só na vez de quem pediu.
`status` vai de `drafting` para `starting` (criando a partida) e `done`, com
o `battleId`.

### Erros

| Status | Códigos |
| --- | --- |
| 400 | `INVALID_RANKED_REQUEST` (faltou o personagem), `INVALID_DRAFT_CHOICE` (banido, já banido, já no time ou desconhecido) |
| 403 | `TUTORIAL_REQUIRED` (entrar na fila sem ter feito o tutorial) |
| 404 | `PLAYER_NOT_FOUND`, `NOT_IN_DRAFT` |
| 409 | `ALREADY_IN_RANKED_BATTLE`, `NOT_YOUR_DRAFT_TURN`, `DRAFT_CONFLICT` |

## Arquivos

| Arquivo | Para que serve |
| --- | --- |
| `ranked.rules.ts` | Os ranks, quanto vale uma partida e a janela de busca da fila. Sem banco. |
| `ranked.draft.ts` | As regras da seleção de personagens: a ordem, os banimentos e o que vale escolher. Sem banco. |
| `ranked.service.ts` | A fila, o pareamento, a seleção (prazos e criação da partida) e o lançamento dos pontos. |
| `ranked.repository.ts` | Leitura e gravação com o Prisma. |
| `ranked.types.ts` | Formatos das respostas e a interface `RankedStore`. |
| `ranked.controller.ts` | Valida o corpo da requisição e traduz erros em respostas HTTP. |
| `ranked.routes.ts` | As rotas. |
| `tests/` | Testes das regras, do serviço e das rotas, com a fila guardada em memória. |
