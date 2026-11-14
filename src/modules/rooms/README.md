# Módulo de salas

O multiplayer casual começa aqui. A sala é onde dois jogadores se encontram e,
assim que os dois estão nela, fazem a **seleção de personagens** no mesmo
formato da ranqueada (banimentos e escolhas alternados, com prazo). Quando a
seleção acaba, nasce a batalha entre os dois. Depois disso tudo acontece no
módulo de batalhas (`src/modules/battles`). Todas as rotas exigem login
(`Authorization: Bearer <accessToken>`).

## Antes de usar

O model `Room` (com `draftId`) e o campo `ranked` de `RankedDraft` ficam em
`prisma/schema.prisma`. Aplique as migrações e atualize o client gerado:

```bash
npx prisma migrate deploy
npx prisma generate
```

## Como funciona

1. Um jogador cria a sala e recebe um **código** de 6 caracteres.
2. O outro entra, digitando o código ou escolhendo a sala na lista de abertas.
3. Ao entrar, começa a seleção de personagens dos dois. É a mesma seleção da
   ranqueada (`src/modules/ranked/ranked.draft.ts`, guardada em
   `ranked_drafts` com `ranked = false`): um banimento de cada lado e depois
   as escolhas na ordem A, B, B, A, A, B, B, A, A, B, com 30 segundos por
   passo. Quem deixa o tempo acabar recebe uma escolha ao acaso.
4. Quando a seleção acaba, a batalha é criada (casual: **não vale pontos**) e a
   sala passa a apontar para ela (`battleId`). As duas telas vão para
   `/battle/:id`.

Quem criou a sala (anfitrião) é o time **A**: bane e escolhe primeiro. Quem
entrou (convidado) é o time **B**.

Não há WebSocket: a tela pergunta `GET /api/rooms/:code` a cada segundo e meio.
A resposta traz a seleção em dia (é essa consulta que aplica as escolhas por
tempo esgotado), e é assim que a tela fica sabendo que alguém entrou, que o
outro jogou e que a batalha começou.

## Rotas

| Método | Rota | O que faz |
| --- | --- | --- |
| GET | `/api/rooms` | Salas esperando alguém entrar (fora a do próprio jogador). |
| POST | `/api/rooms` | Cria uma sala. Fecha a sala anterior do jogador, se ela ainda não começou. |
| GET | `/api/rooms/:code` | A sala, como quem pediu a enxerga, com a seleção. |
| POST | `/api/rooms/:code/join` | Entra na sala (e começa a seleção). |
| POST | `/api/rooms/:code/draft` | Bane ou escolhe no passo da vez: `{ "characterId": "piromante" }`. |
| POST | `/api/rooms/:code/leave` | Sai da sala. |

O código não diferencia maiúsculas de minúsculas e não usa `0`, `O`, `1`, `I`
nem `L`, para poder ser ditado sem confusão.

### Resposta de todas as rotas (menos a lista e `leave`)

```json
{
    "code": "K7QF2M",
    "status": "selecting",
    "role": "host",
    "opponent": { "name": "Karinne" },
    "draft": { "id": "…", "status": "drafting", "you": "A", "current": { "index": 0, "team": "A", "kind": "ban", "timeLeftMs": 29000 }, "…": "…" },
    "battleId": null,
    "createdAt": "2026-10-03T14:00:00.000Z"
}
```

`draft` tem o mesmo formato de `GET /api/ranked/draft` e só vem enquanto
`status` é `selecting`.

| `status` | Significado |
| --- | --- |
| `waiting` | Só o anfitrião está na sala. `opponent` e `draft` são `null`. |
| `selecting` | Os dois estão na sala, na seleção de personagens. |
| `started` | A batalha existe: `battleId` está preenchido. |
| `closed` | O anfitrião saiu antes de a batalha começar. |

(`starting` só aparece em salas antigas, de antes da seleção.)

A lista (`GET /api/rooms`) devolve `[{ "code", "hostName", "createdAt" }]`, da
sala mais nova para a mais antiga, e `leave` responde 204 sem corpo.

### Sair

- O **anfitrião** sai: a sala fecha (`closed`) e o convidado é avisado na
  próxima consulta.
- O **convidado** sai (mesmo no meio da seleção): a sala volta para `waiting`,
  reaparece na lista e quem entrar depois começa uma seleção nova.
- Depois que a batalha começou, sair da sala não muda nada. Para abandonar a
  partida existe `POST /api/battles/:id/surrender`.

Fechar a aba não avisa o servidor: a sala fica como está. Por isso a lista só
mostra salas criadas há menos de 30 minutos, e criar uma sala nova fecha a
anterior do mesmo jogador.

### Erros

```json
{ "code": "ROOM_FULL", "message": "Essa sala já está cheia" }
```

| Status | Códigos |
| --- | --- |
| 400 | `INVALID_ROOM_REQUEST` (corpo sem `characterId`), `INVALID_DRAFT_CHOICE` |
| 404 | `ROOM_NOT_FOUND` (inclui sala em que o jogador não está) |
| 409 | `ROOM_FULL`, `ROOM_CLOSED`, `ROOM_NOT_DRAFTING`, `NOT_YOUR_DRAFT_TURN`, `DRAFT_CONFLICT` |

As mensagens ficam em `locales/<idioma>/translation.json`, nas seções `room`
e `ranked.draft`.

## Duas requisições ao mesmo tempo

Entrar na sala e ligar a seleção a ela são gravações condicionais
(`updateMany` com o estado esperado no `where`): se dois jogadores tentam
entrar juntos, só um entra e o outro recebe `ROOM_FULL`. Na seleção vale a
trava de versão da ranqueada: duas jogadas no mesmo passo, só uma grava, e a
batalha nasce uma vez só.

## Arquivos

| Arquivo | Para que serve |
| --- | --- |
| `room.service.ts` | As regras da sala; a seleção é a do `RankedService` (`startCasualDraft`, `draftById`, `draftActionById`). |
| `room.repository.ts` | Leitura e gravação com o Prisma. |
| `room.types.ts` | Formatos das respostas e a interface `RoomStore`. |
| `room.controller.ts` | Valida o corpo da requisição e traduz erros em respostas HTTP. |
| `room.routes.ts` | As rotas. |
| `room.errors.ts` | `RoomError`, com o código e o status HTTP de cada erro. |
| `tests/` | Testes do serviço e das rotas, com salas, seleção e batalhas em memória. |
