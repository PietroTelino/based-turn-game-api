# Módulo de batalhas

Liga o motor (`src/game`) ao banco e ao HTTP. Todas as rotas exigem login
(`Authorization: Bearer <accessToken>`).

O jogador é sempre o time **A**; a IA é o time **B**.

## Antes de usar

O model `Battle` foi acrescentado ao `prisma/schema.prisma`. Crie a tabela e
atualize o client gerado:

```bash
npx prisma migrate dev --name add_battles
npx prisma generate
```

Até isso ser feito, `npm run build` acusa erro em `battle.repository.ts`
(o client gerado ainda não conhece `prisma.battle`) e as rotas de batalha
respondem 500. O resto da API não é afetado.

## Rotas

| Método | Rota | O que faz |
| --- | --- | --- |
| GET | `/api/battles/characters` | Catálogo de personagens e habilidades. |
| POST | `/api/battles` | Cria uma batalha contra a IA. |
| GET | `/api/battles` | Lista as últimas 20 batalhas do jogador (sem o estado). |
| GET | `/api/battles/:id` | Estado atual de uma batalha. |
| POST | `/api/battles/:id/actions` | Envia a jogada da unidade da vez. |

### Criar

```json
POST /api/battles
{ "team": ["brasa", "muralha", "brisa"] }
```

`team` aceita de 1 a 3 ids, sem repetir. `enemyTeam` é opcional; sem ele a IA
recebe um time sorteado do mesmo tamanho.

### Jogar

```json
POST /api/battles/:id/actions
{ "unitId": "A1", "skillId": "brasa.bola-de-fogo", "targetId": "B2" }
```

`targetId` só é necessário em habilidades de alvo único.

### Resposta de criar e de jogar

```json
{
    "battle": {
        "id": "...",
        "status": "in_progress",
        "winner": null,
        "playerTeam": "A",
        "state": { "units": [], "energy": { "A": 4, "B": 3 }, "activeUnitId": "A1", "turn": 2, "winner": null },
        "availableActions": [],
        "turnOrder": ["A1", "B1", "A2"]
    },
    "events": []
}
```

- `state` é o estado atual. É o que a tela desenha.
- `events` é o que aconteceu desde a resposta anterior, em ordem. É o que a tela anima.
- `availableActions` são os botões da unidade da vez: cada habilidade, se pode
  ser usada agora e em quem.

Depois da jogada do jogador a IA joga sozinha até a vez voltar para ele, então
uma única resposta pode trazer vários turnos em `events`. Quando a resposta
chega, ou é a vez do jogador ou a batalha acabou.

### Erros

```json
{ "code": "NOT_ENOUGH_ENERGY", "message": "Energia insuficiente" }
```

| Status | Códigos |
| --- | --- |
| 400 | `INVALID_TEAM`, `UNKNOWN_CHARACTER`, `INVALID_ACTION` e as regras do jogo: `NOT_YOUR_TURN`, `SKILL_NOT_FOUND`, `NOT_ENOUGH_ENERGY`, `TARGET_REQUIRED`, `INVALID_TARGET`, `UNIT_NOT_FOUND` |
| 403 | `NOT_YOUR_UNIT` |
| 404 | `BATTLE_NOT_FOUND` (inclui batalha de outro jogador) |
| 409 | `BATTLE_OVER`, `BATTLE_CONFLICT` (duas jogadas simultâneas no mesmo turno) |

As mensagens ficam em `locales/<idioma>/translation.json`, na seção `battle`.

## Arquivos

| Arquivo | Para que serve |
| --- | --- |
| `battle.service.ts` | Cria a batalha, aplica a jogada, faz a IA responder e grava. |
| `battle.repository.ts` | Leitura e gravação com o Prisma. |
| `battle.types.ts` | Formatos das respostas e a interface `BattleStore`. |
| `battle.controller.ts` | Valida o corpo da requisição e traduz erros em respostas HTTP. |
| `battle.routes.ts` | As rotas. |
| `tests/` | Testes do serviço e das rotas, com as batalhas guardadas em memória. |
