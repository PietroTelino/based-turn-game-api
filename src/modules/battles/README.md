# Módulo de batalhas

Liga o motor (`src/game`) ao banco e ao HTTP. Todas as rotas exigem login
(`Authorization: Bearer <accessToken>`).

Existem dois tipos de batalha, e as rotas são as mesmas para os dois:

- **Contra a IA** (`mode: "ai"`): o jogador é o time **A** e a IA é o time **B**.
  Nasce em `POST /api/battles`.
- **Entre dois jogadores** (`mode: "pvp"`): quem criou a sala é o time **A** e
  quem entrou é o time **B**. Nasce no módulo de salas (`src/modules/rooms`),
  quando os dois avisam que estão prontos, ou na fila ranqueada
  (`src/modules/ranked`), quando dois jogadores são pareados; aí vem com
  `ranked: true`, vale pontos e tem prazo para jogar. Não há rota para criar
  uma direto.

Em toda resposta, `playerTeam` diz de que lado está quem fez a requisição.

## Antes de usar

Os models `Battle`, `BattlePick`, `Room` e `RankedTicket` ficam em
`prisma/schema.prisma`. Depois de qualquer mudança neles, crie a migração e
atualize o client gerado:

```bash
npx prisma migrate dev --name ranqueada
npx prisma generate
```

Até isso ser feito, `npm run build` acusa erro nos repositórios (o client
gerado ainda não conhece os campos novos) e as rotas de batalha, de sala, da
ranqueada e das estatísticas respondem 500. O resto da API não é afetado.

## Rotas

| Método | Rota | O que faz |
| --- | --- | --- |
| GET | `/api/battles/characters` | Catálogo de personagens, com as habilidades e as passivas de cada um. |
| POST | `/api/battles` | Cria uma batalha contra a IA. |
| GET | `/api/battles` | Lista as últimas 20 batalhas do jogador, de qualquer um dos lados (sem o estado). |
| GET | `/api/battles/:id` | Estado atual de uma batalha. |
| GET | `/api/battles/:id/events?after=N` | O que aconteceu depois do evento `N`. É como cada jogador acompanha as jogadas do outro. |
| GET | `/api/battles/:id/replay` | A batalha encerrada, do começo ao fim, para assistir de novo. |
| POST | `/api/battles/:id/actions` | Envia a jogada da unidade da vez. |
| POST | `/api/battles/:id/surrender` | Desiste: a batalha termina como derrota de quem desistiu. |
| POST | `/api/battles/:id/timeout` | Partida ranqueada: o adversário passou do prazo e quem espera pede a vitória. |

### Criar

```json
POST /api/battles
{ "team": ["piromante", "cavaleiro", "sacerdote", "driade", "arqueiro"] }
```

Toda batalha é 5 contra 5: `team` precisa ter exatamente 5 ids, sem repetir
(`TEAM_SIZE` em `battle.service.ts`). Qualquer outro tamanho responde 400 com
`INVALID_TEAM`. `enemyTeam` é opcional e segue a mesma regra; sem ele a IA
recebe cinco personagens sorteados. O motor (`src/game`) continua aceitando
times de 1 a 6, e é assim que os testes fazem batalhas pequenas.

### Batalha de treino (tutorial)

```json
POST /api/battles
{ "team": ["..."], "enemyTeam": ["..."], "training": true }
```

Com `training: true` a batalha nasce marcada como treino: `state.training`
vem `true` em todas as respostas. Nela a IA joga fraco de propósito
(`chooseTrainingAction`, em `src/game/ai.ts`): o time dela usa só uma
habilidade com custo por turno e os golpes miram em quem tem mais vida. É a
batalha que o tutorial do app cria, com os dois times fixos; a tela mostra o
guia quando vê a marca. A marca fica dentro do estado gravado, então não
existe coluna nova no banco para ela.

### Jogar

```json
POST /api/battles/:id/actions
{ "unitId": "A1", "skillId": "piromante.bola-de-fogo", "targetId": "B2" }
```

`targetId` só é necessário em habilidades de alvo único.

### Desistir

```
POST /api/battles/:id/surrender
```

Sem corpo. Pode ser chamada a qualquer momento enquanto a batalha está em
andamento, mesmo fora da própria vez. A batalha fica `finished`, o outro lado
vence e `state.surrenderedBy` guarda o time de quem desistiu; os eventos são
`surrendered` e `battle_ended`. Em batalha já terminada responde 409
(`BATTLE_OVER`).

### Resposta de criar, de jogar e de desistir

```json
{
    "battle": {
        "id": "...",
        "status": "in_progress",
        "winner": null,
        "mode": "ai",
        "playerTeam": "A",
        "state": {
            "units": [],
            "energy": { "A": 2, "B": 4 },
            "turnEnergy": 4,
            "fury": 0,
            "turn": 2,
            "order": ["B1", "A1", "A2"],
            "activeUnitId": "A1",
            "step": 5,
            "winner": null
        },
        "availableActions": [],
        "cursor": 14,
        "hasReplay": true,
        "ranked": false,
        "ratingChange": null,
        "turnTimeLeftMs": null
    },
    "events": []
}
```

- `state` é o estado atual. É o que a tela desenha. `energy` é o que cada time ainda tem para gastar neste turno e `turnEnergy` é com quanto os dois começaram o turno. `turn` é o turno (a rodada em que todos agem uma vez), `order` é a ordem de ação desse turno (pode mudar no meio dele, se a velocidade de alguém mudar) e `activeUnitId` diz de quem é a vez; quem vem antes dele em `order` já agiu. `fury` é quanto a fúria aumenta o dano das habilidades no turno atual (0 = ainda não começou, 0.5 = +50%); a tela mostra como "Berserk +50%".
- `events` é o que aconteceu desde a resposta anterior, em ordem. É o que a tela anima. Inclui `passive_triggered` (a passiva de uma unidade agiu) e `energy_gained` (um time recuperou energia no meio do turno); os tipos todos estão em `BattleEvent`, em `src/game/types.ts`.
- `availableActions` são os botões da unidade da vez: cada habilidade, se pode
  ser usada agora e em quem.
- Cada item de `availableActions` traz também `preview: { damage, heal }`: o dano base e a cura base da habilidade para quem está na vez agora (ATK atual x poder, com a fúria, sem a defesa do alvo e sem crítico). `null` quando a habilidade não causa dano ou não cura. É o número que a tela mostra junto da descrição.

Contra a IA, depois da jogada do jogador a IA joga sozinha até a vez voltar
para ele, então uma única resposta pode trazer várias jogadas (e até a virada
de turno) em `events`. Quando a resposta chega, ou é a vez do jogador ou a
batalha acabou.

### Batalha entre dois jogadores

Ninguém joga pelo outro: a resposta de uma jogada traz só o que ela causou, e a
vez pode ter passado para o adversário. Enquanto não é a vez de quem pediu,
`availableActions` vem vazio e jogar com a unidade do outro responde 403
(`NOT_YOUR_UNIT`).

Para a tela de um jogador mostrar o que o outro fez, a batalha guarda a lista
completa de eventos, desde a abertura, e cada resposta traz `cursor`: quantos
eventos existiam naquele momento. Quem está esperando pergunta de tempos em
tempos pelo que veio depois:

```
GET /api/battles/:id/events?after=12
```

```json
{ "battle": { "cursor": 15 }, "events": ["evento 12", "evento 13", "evento 14"] }
```

`battle` é a mesma visão das outras rotas (aqui só com `cursor`, para
encurtar) e `events` são os eventos de número `after` em diante, no mesmo
formato das outras respostas. Se nada
aconteceu, `events` vem vazio e `cursor` é igual a `after`. `after=0` devolve a
batalha inteira, e é assim que a tela anima a abertura ao entrar. A batalha
contra a IA também guarda a lista (é o que o replay mostra), mas a tela não
precisa perguntar por ela: os eventos vêm na resposta de cada jogada.

### Replay

Toda batalha guarda o estado de quando foi criada (`initial_state`) e todos os
eventos. Com ela encerrada, quem jogou pode assistir de novo:

```
GET /api/battles/:id/replay
```

```json
{ "battle": { "status": "finished" }, "initial": { "turn": 1, "units": [] }, "events": [] }
```

`battle` é a batalha como terminou (a mesma visão das outras rotas), `initial`
é o estado do começo, sem o gerador de números aleatórios, e `events` é tudo o
que aconteceu, em ordem. A tela parte de `initial` e aplica os eventos, do
mesmo jeito que anima uma batalha de verdade.

Responde 409 (`REPLAY_UNAVAILABLE`) enquanto a batalha está em andamento e
para as batalhas criadas antes de o replay existir, que não guardaram o
começo. A listagem (`GET /api/battles`) e cada batalha trazem `hasReplay`.

### Partida ranqueada: pontos e prazo

Uma batalha com `ranked: true` nasce na fila ranqueada e muda duas coisas:

- **Pontos.** Quando ela acaba, o serviço avisa a ranqueada
  (`BattleService.onFinished`), que lança os pontos dos dois jogadores. A
  batalha passa a trazer `ratingChange`: quantos pontos quem pediu ganhou ou
  perdeu (negativo). Desistência e tempo esgotado contam como derrota.
- **Prazo.** Quem está na vez tem 90 segundos para jogar
  (`RANKED_TURN_LIMIT_MS`); o relógio zera a cada jogada gravada.
  `turnTimeLeftMs` diz quanto falta. Passado o prazo, quem está esperando
  chama `POST /api/battles/:id/timeout` e vence: a batalha termina como uma
  desistência do time que travou, com `state.timedOut: true`. Antes do prazo a
  rota responde 409 (`TIMEOUT_TOO_EARLY`); em batalha que não é ranqueada, já
  acabou, ou na própria vez de quem pediu, 409 (`TIMEOUT_NOT_ALLOWED`).

Não há tarefa rodando sozinha no servidor: quem pede a vitória é a tela do
jogador que está esperando, quando o relógio dela chega a zero.

### Personagens escolhidos

Ao criar uma batalha, o serviço grava em `battle_picks` os personagens que
cada jogador levou. É o que alimenta as estatísticas de personagens mais
usados (`src/modules/stats`). O time sorteado para a IA e a batalha de treino
não são gravados.

### Erros

```json
{ "code": "NOT_ENOUGH_ENERGY", "message": "Energia insuficiente" }
```

| Status | Códigos |
| --- | --- |
| 400 | `INVALID_TEAM`, `UNKNOWN_CHARACTER`, `INVALID_ACTION` e as regras do jogo: `NOT_YOUR_TURN`, `SKILL_NOT_FOUND`, `NOT_ENOUGH_ENERGY`, `TARGET_REQUIRED`, `INVALID_TARGET`, `UNIT_NOT_FOUND` |
| 403 | `NOT_YOUR_UNIT` |
| 404 | `BATTLE_NOT_FOUND` (inclui batalha de outro jogador) |
| 409 | `BATTLE_OVER`, `BATTLE_CONFLICT` (duas jogadas simultâneas na mesma vez), `REPLAY_UNAVAILABLE`, `TIMEOUT_TOO_EARLY`, `TIMEOUT_NOT_ALLOWED` |

As mensagens ficam em `locales/<idioma>/translation.json`, na seção `battle`.

## Arquivos

| Arquivo | Para que serve |
| --- | --- |
| `battle.service.ts` | Cria a batalha (contra a IA ou entre jogadores), aplica a jogada, faz a IA responder e grava. |
| `battle.repository.ts` | Leitura e gravação com o Prisma. |
| `battle.types.ts` | Formatos das respostas e a interface `BattleStore`. |
| `battle.controller.ts` | Valida o corpo da requisição e traduz erros em respostas HTTP. |
| `battle.routes.ts` | As rotas. |
| `tests/` | Testes do serviço e das rotas, com as batalhas guardadas em memória. |
