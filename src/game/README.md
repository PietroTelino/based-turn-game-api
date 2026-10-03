# Motor de batalha

Tudo o que é regra do jogo fica nesta pasta. Nada aqui importa Express, Prisma
ou qualquer coisa de fora: o motor recebe dados e devolve dados.

## A ideia

```ts
const { state, events } = createBattle({ teamA, teamB, seed });
const next = applyAction(state, { unitId, skillId, targetId });
```

- **`state`** é a fotografia da batalha (vida, energia, turno, de quem é a vez). É
  JSON puro, então pode ir direto para o banco e para o front.
- **`events`** é a lista do que aconteceu naquela ação, em ordem. O front usa
  para animar e para escrever o log.
- `applyAction` **não altera** o estado recebido: devolve um novo. Se a ação for
  inválida, lança um `GameRuleError` com um código (`NOT_YOUR_TURN`,
  `NOT_ENOUGH_ENERGY`...) e nada muda.

## Turno e vez

São duas coisas diferentes, e o código usa sempre os mesmos nomes:

- **Turno** (`state.turn`): uma rodada inteira. Cada unidade viva age **uma vez**, e só então o número do turno sobe. A batalha começa no turno 1.
- **Vez**: o momento de uma unidade dentro do turno (`state.activeUnitId` diz de quem é).

No começo de cada turno o motor define a ordem e guarda em `state.order`:

1. quem tem mais velocidade age antes (a velocidade já conta bônus e penalidades de status);
2. se duas unidades têm a **mesma velocidade**, a sorte decide quem vai antes. O sorteio é refeito a cada turno, então elas têm 50% de chance de trocar de lugar de um turno para o outro.

Se a velocidade de alguém mudar **no meio do turno** (um bônus ou uma penalidade de velocidade), a mudança vale na hora: quem ainda não agiu é reordenado pela velocidade nova (`reorderWaiting`). Quem já agiu fica onde está e não age de novo. Se a mudança criar um empate, vale o mesmo sorteio do começo do turno, guardado em `state.draws`.

Quem é derrotado antes da própria vez simplesmente não age.

Velocidade, portanto, só decide **quem age antes**. Ninguém age mais vezes por ser mais veloz.

A **energia** segue o turno: quando um turno começa, os dois times recebem a energia daquele turno (`state.turnEnergy`: 3 no turno 1, 4 no turno 2... até 10) e o que sobrou do turno anterior é descartado. As unidades do time gastam dessa mesma reserva ao longo do turno.

`state.step` é um contador interno de vezes (sobe 1 a cada vez, mesmo perdida). É ele que a duração dos status e a trava do banco usam, porque o turno fica parado enquanto as unidades agem.

## Regras atuais

| Regra | Como funciona | Onde mexer |
| --- | --- | --- |
| Ordem de ação | Definida a cada turno: mais veloz primeiro, empate na sorte; reordenada se a velocidade mudar. Veja a seção acima. | `startTurn` e `reorderWaiting` em `engine.ts` |
| Energia | Compartilhada pelo time e reabastecida a cada turno: 3 no turno 1, mais 1 por turno, até 10. O que sobra não acumula. | `constants.ts`, `getTurnEnergy` |
| Habilidades | A primeira é o ataque básico (custo 0). As outras gastam energia. | `data/characters.ts` |
| Dano | `ATK x poder x 100 / (100 + DEF)`, vezes o multiplicador de crítico. | `calculateDamage` |
| Dano base | `ATK x poder` (com a fúria), sem a defesa do alvo e sem crítico. É o número mostrado na descrição da habilidade durante a batalha, junto com a cura base. | `calculateBaseDamage`, `previewSkill` |
| Cura | `ATK x poder`, sem passar da vida máxima. | `calculateHeal` |
| Roubo de vida | Um efeito de dano com `drain` cura quem bateu numa fração da vida que o alvo perdeu (o que o escudo segurou não conta). Ex.: `{ type: 'damage', power: 1.5, drain: 0.5 }`. | `applyEffect` |
| Golpes seguidos | Uma habilidade com vários efeitos de dano acerta várias vezes; cada golpe tem seu próprio crítico e eles param quando o alvo cai. | `data/characters.ts` |
| Fúria | Depois do turno 8 o dano cresce 50% por turno, para toda batalha ter fim. | `constants.ts` |
| Status | Efeitos que ficam na unidade por alguns turnos. Veja a seção abaixo. | `applyEffect`, `activateNext`, `endActivation` |
| Vitória | Vence quem derrotar todas as unidades do outro time. | `findWinner` |
| Desistência | Um time pode desistir a qualquer momento; o outro vence na hora. | `surrender` |

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
| `burn`, `poison` | Dano quando chega a vez da unidade. Ignora defesa e escudo. | dano = ATK de quem aplicou x power |
| `shield` | Absorve dano antes da vida. Some quando zera ou quando a duração acaba. | pontos = ATK de quem aplicou x power |
| `atk_up`, `atk_down`, `def_up`, `def_down`, `speed_up`, `speed_down` | Aumenta ou reduz o atributo. Bônus e penalidades somam; o atributo nunca cai abaixo de 20%. | fração do atributo (0.3 = 30%) |

Regras de duração:

- `turns` é contado **na vez da unidade que carrega o status**: cada vez que ela termina de agir (ou perde a vez), gasta um. Como cada unidade age uma vez por turno, "2 turnos" são duas vezes dela.
- Um status que a unidade recebe durante a própria vez só começa a contar na vez seguinte.
- Por isso o momento importa: um atordoamento que pega antes da vez do alvo tira a vez dele neste turno; se pegar depois, tira a do turno seguinte.
- Cada unidade tem no máximo um status de cada tipo. Reaplicar substitui o anterior.
- `chance` (0 a 1) é a chance de o status pegar. Sem ela, sempre pega.
- `to: 'self'` aplica em quem usou a habilidade, mesmo que ela mire em inimigos.

O ciclo de uma vez fica assim: queimadura e veneno causam dano, a unidade atordoada perde a vez, a unidade age, os status dela gastam um turno.

Para a tela, o motor emite `turn_started` (turno novo, com a ordem), `order_changed` (a ordem mudou no meio do turno), `unit_activated` (chegou a vez de alguém), `status_applied`, `status_damage`, `status_expired` e `unit_skipped` (para animar) e `statuses_changed`, que traz a lista completa de status da unidade depois de qualquer mudança. A tela só copia essa lista.

## Elemento das habilidades

Cada habilidade do catálogo tem um `element` (`physical`, `fire`, `ice`, `lightning`, `nature`, `light` ou `shadow`) e pode ter `ranged: true`. Os dois campos **não entram em nenhuma conta**: existem para a tela escolher o efeito visual e o som. `ranged` só vale em golpe contra inimigos: num alvo só, a tela mostra um projétil em vez de a unidade avançar; em área, uma chuva de projéteis. Se um dia houver fraqueza por elemento, o dado já está aqui.

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
| `balance.ts` | Simula confrontos entre times e mostra a taxa de vitória. Quando há combinações demais, sorteia 6.000 delas (sempre as mesmas). |
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

A arte fica no front, em `src/assets/characters/`, com o `id` do personagem
no nome do arquivo.
