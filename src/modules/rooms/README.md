# Módulo de salas

O multiplayer começa aqui. A sala é onde dois jogadores se encontram, cada um
escolhe o time sem o outro ver, e de onde nasce a batalha entre os dois. Depois
que a batalha começa, tudo acontece no módulo de batalhas
(`src/modules/battles`). Todas as rotas exigem login
(`Authorization: Bearer <accessToken>`).

## Antes de usar

O model `Room` e os campos novos de `Battle` (`opponentId`, `events`) ficam em
`prisma/schema.prisma`. Crie a migração e atualize o client gerado:

```bash
npx prisma migrate dev --name multiplayer
npx prisma generate
```

## Como funciona

1. Um jogador cria a sala e recebe um **código** de 6 caracteres.
2. O outro entra, digitando o código ou escolhendo a sala na lista de abertas.
3. Cada um monta o time na própria tela e avisa que está **pronto**. É só nessa
   hora que o time vai para o servidor.
4. Quando os dois estão prontos, o servidor cria a batalha e a sala passa a
   apontar para ela (`battleId`). As duas telas vão para `/battle/:id`.

Quem criou a sala (anfitrião) é o time **A** na batalha; quem entrou
(convidado) é o time **B**.

### O que um jogador vê do outro

A sala nunca devolve o time do adversário, em nenhuma rota e em nenhum
momento. Do outro só se sabe o nome e se ele já está pronto. Os times só
aparecem quando a batalha existe, no estado dela.

Não há WebSocket: a tela pergunta `GET /api/rooms/:code` a cada segundo e meio
para saber se alguém entrou, se o outro ficou pronto e se a batalha começou.

## Rotas

| Método | Rota | O que faz |
| --- | --- | --- |
| GET | `/api/rooms` | Salas esperando alguém entrar (fora a do próprio jogador). |
| POST | `/api/rooms` | Cria uma sala. Fecha a sala anterior do jogador, se ela ainda não começou. |
| GET | `/api/rooms/:code` | A sala, como quem pediu a enxerga. |
| POST | `/api/rooms/:code/join` | Entra na sala. |
| POST | `/api/rooms/:code/ready` | Confirma o time e avisa que está pronto. |
| POST | `/api/rooms/:code/unready` | Volta atrás para trocar o time. |
| POST | `/api/rooms/:code/leave` | Sai da sala. |

O código não diferencia maiúsculas de minúsculas e não usa `0`, `O`, `1`, `I`
nem `L`, para poder ser ditado sem confusão.

### Ficar pronto

```json
POST /api/rooms/K7QF2M/ready
{ "team": ["piromante", "cavaleiro", "sacerdote", "driade", "arqueiro"] }
```

O time segue a regra de qualquer batalha: exatamente 5 personagens, sem
repetir. Mandar de novo troca o time. Se o outro já estava pronto, a resposta
já vem com `status: "started"` e o `battleId`.

### Resposta de todas as rotas (menos a lista e `leave`)

```json
{
    "code": "K7QF2M",
    "status": "selecting",
    "role": "host",
    "you": { "ready": true, "team": ["piromante", "cavaleiro", "sacerdote", "driade", "arqueiro"] },
    "opponent": { "name": "Karinne", "ready": false },
    "battleId": null,
    "createdAt": "2026-10-03T14:00:00.000Z"
}
```

| `status` | Significado |
| --- | --- |
| `waiting` | Só o anfitrião está na sala. `opponent` é `null`. |
| `selecting` | Os dois estão na sala, escolhendo os times. |
| `starting` | Os dois estão prontos e a batalha está sendo criada (dura um instante). |
| `started` | A batalha existe: `battleId` está preenchido. |
| `closed` | O anfitrião saiu antes de a batalha começar. |

`you.team` só vem preenchido enquanto `you.ready` é verdadeiro. A lista
(`GET /api/rooms`) devolve `[{ "code", "hostName", "createdAt" }]`, da sala mais
nova para a mais antiga, e `leave` responde 204 sem corpo.

### Sair

- O **anfitrião** sai: a sala fecha (`closed`) e o convidado é avisado na
  próxima consulta.
- O **convidado** sai: a sala volta para `waiting` e reaparece na lista.
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
| 400 | `INVALID_ROOM_REQUEST` (corpo sem `team`), `INVALID_TEAM`, `UNKNOWN_CHARACTER` |
| 404 | `ROOM_NOT_FOUND` (inclui sala em que o jogador não está) |
| 409 | `ROOM_FULL`, `ROOM_CLOSED` |

As mensagens ficam em `locales/<idioma>/translation.json`, na seção `room`.

## Duas requisições ao mesmo tempo

Entrar na sala, ficar pronto e começar a batalha são gravações condicionais
(`updateMany` com o estado esperado no `where`), então:

- se dois jogadores tentam entrar juntos, só um entra e o outro recebe
  `ROOM_FULL`;
- se os dois ficam prontos no mesmo instante, só uma das requisições cria a
  batalha (`claimStart`), e nunca nascem duas.

## Arquivos

| Arquivo | Para que serve |
| --- | --- |
| `room.service.ts` | As regras da sala e o momento em que a batalha é criada. |
| `room.repository.ts` | Leitura e gravação com o Prisma. |
| `room.types.ts` | Formatos das respostas e a interface `RoomStore`. |
| `room.controller.ts` | Valida o corpo da requisição e traduz erros em respostas HTTP. |
| `room.routes.ts` | As rotas. |
| `room.errors.ts` | `RoomError`, com o código e o status HTTP de cada erro. |
| `tests/` | Testes do serviço e das rotas, com as salas guardadas em memória. |
