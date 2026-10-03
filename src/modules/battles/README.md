# Módulo de batalhas

Liga o motor (`src/game`) ao banco e ao HTTP. Todas as rotas exigem login
(`Authorization: Bearer <accessToken>`).

Existem dois tipos de batalha, e as rotas são as mesmas para os dois:

- **Contra a IA** (`mode: "ai"`): o jogador é o time **A** e a IA é o time **B**.
  Nasce em `POST /api/battles`.
- **Entre dois jogadores** (`mode: "pvp"`): quem criou a sala é o time **A** e
  quem entrou é o time **B**. Nasce no módulo de salas (`src/modules/rooms`),
  quando os dois avisam que estão prontos. Não há rota para criar uma direto.

Em toda resposta, `playerTeam` diz de que lado está quem fez a requisição.

## Antes de usar

Os models `Battle` e `Room` ficam em `prisma/schema.prisma`. Depois de qualquer
mudança neles, crie a migração e atualize o client gerado:

```bash
npx prisma migrate dev --name multiplayer
npx prisma generate
```

Até isso ser feito, `npm run build` acusa erro em `battle.repository.ts` e em
`room.repository.ts` (o client gerado ainda não conhece os campos novos) e as
rotas de batalha e de sala respondem 500. O resto da API não é afetado.

## Rotas

| Método | Rota | O que faz |
| --- | --- | --- |
| GET | `/api/battles/characters` | Catálogo de personagens e habilidades. |
| POST | `/api/battles` | Cria uma batalha contra a IA. |
| GET | `/api/battles` | Lista as últimas 20 batalhas do jogador, de qualquer um dos lados (sem o estado). |
| GET | `/api/battles/:id` | Estado atual de uma batalha. |
| GET | `/api/battles/:id/events?after=N` | O que aconteceu depois do evento `N`. Só tem conteúdo em batalha entre jogadores. |
| POST | `/api/battles/:id/actions` | Envia a jogada da unidade da vez. |
| POST | `/api/battles/:id/surrender` | Desiste: a batalha termina como derrota de quem desistiu. |

### Criar

```json
POST /api/battles
{ "team": ["piromante", "cavaleiro", "clerigo", "driade", "arqueiro"] }
```

Toda batalha é 5 contra 5: `team` precisa ter exatamente 5 ids, sem repetir
(`TEAM_SIZE` em `battle.service.ts`). Qualquer outro tamanho responde 400 com
`INVALID_TEAM`. `enemyTeam` é opcional e segue a mesma regra; sem ele a IA
recebe cinco personagens sorteados. O motor (`src/game`) continua aceitando
times de 1 a 6, e é assim que os testes fazem batalhas pequenas.

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
        "cursor": 0
    },
    "events": []
}
```

- `state` é o estado atual. É o que a tela desenha. `energy` é o que cada time ainda tem para gastar neste turno e `turnEnergy` é com quanto os dois começaram o turno. `turn` é o turno (a rodada em que todos agem uma vez), `order` é a ordem de ação desse turno (pode mudar no meio dele, se a velocidade de alguém mudar) e `activeUnitId` diz de quem é a vez; quem vem antes dele em `order` já agiu. `fury` é quanto a fúria aumenta o dano das habilidades no turno atual (0 = ainda não começou, 0.5 = +50%); a tela mostra como "Berserk +50%".
- `events` é o que aconteceu desde a resposta anterior, em ordem. É o que a tela anima.
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
batalha inteira, e é assim que a tela anima a abertura ao entrar. Em batalha
contra a IA a lista não é guardada: `cursor` é sempre 0 e `events` vem vazio.

### Erros

```json
{ "code": "NOT_ENOUGH_ENERGY", "message": "Energia insuficiente" }
```

| Status | Códigos |
| --- | --- |
| 400 | `INVALID_TEAM`, `UNKNOWN_CHARACTER`, `INVALID_ACTION` e as regras do jogo: `NOT_YOUR_TURN`, `SKILL_NOT_FOUND`, `NOT_ENOUGH_ENERGY`, `TARGET_REQUIRED`, `INVALID_TARGET`, `UNIT_NOT_FOUND` |
| 403 | `NOT_YOUR_UNIT` |
| 404 | `BATTLE_NOT_FOUND` (inclui batalha de outro jogador) |
| 409 | `BATTLE_OVER`, `BATTLE_CONFLICT` (duas jogadas simultâneas na mesma vez) |

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
