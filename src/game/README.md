# Motor de batalha

Tudo o que é regra do jogo fica nesta pasta. Nada aqui importa Express, Prisma
ou qualquer coisa de fora: o motor recebe dados e devolve dados.

## A ideia

```ts
const { state, events } = createBattle({ teamA, teamB, seed });
const next = applyAction(state, { unitId, skillId, targetId });
```

- **`state`** é a fotografia da batalha (vida, energia, de quem é a vez). É JSON
  puro, então pode ir direto para o banco e para o front.
- **`events`** é a lista do que aconteceu naquela ação, em ordem. O front usa
  para animar e para escrever o log.
- `applyAction` **não altera** o estado recebido: devolve um novo. Se a ação for
  inválida, lança um `GameRuleError` com um código (`NOT_YOUR_TURN`,
  `NOT_ENOUGH_ENERGY`...) e nada muda.

## Regras atuais

| Regra | Como funciona | Onde mexer |
| --- | --- | --- |
| Ordem dos turnos | Cada unidade tem uma barra que enche conforme a velocidade. Joga quem encher primeiro. | `advanceGauges` em `engine.ts` |
| Energia | Compartilhada pelo time. Começa em 3, ganha 1 a cada turno de uma unidade do time, teto 8. | `constants.ts` |
| Habilidades | A primeira é o ataque básico (custo 0). As outras gastam energia. | `data/characters.ts` |
| Dano | `ATK x poder x 100 / (100 + DEF)`, vezes o multiplicador de crítico. | `calculateDamage` |
| Cura | `ATK x poder`, sem passar da vida máxima. | `calculateHeal` |
| Fúria | A partir do turno 50 o dano cresce 10% por turno, para toda batalha ter fim. | `constants.ts` |
| Status | Efeitos que ficam na unidade por alguns turnos dela. Veja a seção abaixo. | `applyEffect`, `startNextTurn`, `endTurn` |
| Vitória | Vence quem derrotar todas as unidades do outro time. | `findWinner` |

## Efeitos de status

Uma habilidade aplica um status com um efeito do tipo `status`:

```ts
{ type: 'status', status: 'burn', turns: 2, power: 0.3 }
{ type: 'status', status: 'stun', turns: 1, power: 0, chance: 0.3 }
{ type: 'status', status: 'def_up', turns: 2, power: 0.3, to: 'self' }
```

| Status | O que faz | `power` |
| --- | --- | --- |
| `stun` | A unidade perde a vez. | não usa (0) |
| `burn`, `poison` | Dano no começo de cada turno da unidade. Ignora defesa e escudo. | dano = ATK de quem aplicou x power |
| `shield` | Absorve dano antes da vida. Some quando zera ou quando a duração acaba. | pontos = ATK de quem aplicou x power |
| `atk_up`, `atk_down`, `def_up`, `def_down`, `speed_up`, `speed_down` | Aumenta ou reduz o atributo. Bônus e penalidades somam; o atributo nunca cai abaixo de 20%. | fração do atributo (0.3 = 30%) |

Regras de duração:

- `turns` conta os turnos **da unidade que carrega o status**, não os turnos da batalha.
- A duração é descontada no fim do turno da unidade. Um status aplicado no próprio turno só começa a contar no seguinte.
- Cada unidade tem no máximo um status de cada tipo. Reaplicar substitui o anterior.
- `chance` (0 a 1) é a chance de o status pegar. Sem ela, sempre pega.
- `to: 'self'` aplica em quem usou a habilidade, mesmo que ela mire em inimigos.

O ciclo de um turno fica assim: o time ganha energia, queimadura e veneno causam dano, a unidade atordoada perde a vez, a unidade age, os status dela gastam um turno.

Para a tela, o motor emite `status_applied`, `status_damage`, `status_expired` e `turn_skipped` (para animar) e `statuses_changed`, que traz a lista completa de status da unidade depois de qualquer mudança. A tela só copia essa lista.

## Arquivos

| Arquivo | Para que serve |
| --- | --- |
| `types.ts` | Os formatos dos dados: estado, unidade, habilidade, ação, eventos. |
| `engine.ts` | As regras: `createBattle`, `applyAction` e as consultas. |
| `data/characters.ts` | Os personagens e suas habilidades. |
| `constants.ts` | Os números de balanceamento globais. |
| `rng.ts` | Sorteio com semente, para a batalha ser reproduzível. |
| `ai.ts` | Uma IA simples que escolhe a ação da unidade da vez. |
| `demo.ts` | Batalha IA contra IA impressa no terminal. |
| `balance.ts` | Simula todas as combinações de times e mostra a taxa de vitória. |
| `tests/` | Testes das regras. |

## Comandos

```bash
npm test                  # roda os testes
npm run battle:demo       # assiste a uma batalha no terminal
npm run battle:demo -- 42 # a mesma coisa, com outra semente
npm run battle:balance    # relatório de balanceamento
```

## Como criar um personagem

Acrescente um objeto em `data/characters.ts`. A primeira habilidade precisa ser
o ataque básico (custo 0, alvo `single-enemy`). Os efeitos de uma habilidade
acontecem na ordem em que estão escritos. Depois rode `npm test` e
`npm run battle:balance` para ver se ele ficou forte ou fraco demais.
