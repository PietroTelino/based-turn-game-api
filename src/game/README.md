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
| Dano base | `ATK x poder` (com a fúria e as passivas que valem em todo golpe), sem a defesa do alvo, sem crítico e sem as passivas que dependem do alvo. É o número mostrado na descrição da habilidade durante a batalha, junto com a cura base. | `calculateBaseDamage`, `previewSkill` |
| Cura | `ATK x poder`, sem passar da vida máxima. | `calculateHeal` |
| Roubo de vida | Um efeito de dano com `drain` cura quem bateu numa fração da vida que o alvo perdeu (o que o escudo segurou não conta). Ex.: `{ type: 'damage', power: 1.5, drain: 0.5 }`. | `applyEffect` |
| Golpe de execução | Um efeito de dano com `perTargetMissingHp` bate mais forte em alvo ferido: para cada 1% da vida máxima que o alvo já perdeu, essa porcentagem a mais de dano (pontos inteiros; soma com os bônus das passivas). Ex.: `{ type: 'damage', power: 2.3, perTargetMissingHp: 1 }`, o Golpe Fatal do Ladino. Não entra no dano base da prévia, que não conhece o alvo. | `applyEffect`, `getMissingHpPercent` |
| Golpes seguidos | Uma habilidade com vários efeitos de dano acerta várias vezes; cada golpe tem seu próprio crítico e eles param quando o alvo cai. | `data/characters.ts` |
| Fúria | Depois do turno 8 o dano das habilidades cresce 50% por turno (turno 9: +50%, turno 10: +100%...), para toda batalha ter fim. Queimadura e veneno não aumentam. Na tela aparece como "Berserk +50%". | `constants.ts`, `getFuryBonus` |
| Status | Efeitos que ficam na unidade por alguns turnos. Veja a seção abaixo. | `applyEffect`, `activateNext`, `endActivation` |
| Passivas | Todo personagem tem pelo menos uma. Ninguém as usa: valem sozinhas. Veja a seção "Passivas". | `data/characters.ts`, `getHitModifiers`, `applyTurnStartPassives` |
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
| `burn`, `poison` | Dano quando chega a vez da unidade. Ignora defesa e escudo. Se quem aplicou tem a passiva `status_growth`, o dano cresce a cada turno (veja "Passivas"). | dano = ATK de quem aplicou x power |
| `shield` | Absorve dano antes da vida. Some quando zera ou quando a duração acaba. | pontos = ATK de quem aplicou x power |
| `atk_up`, `atk_down`, `def_up`, `def_down`, `speed_up`, `speed_down` | Aumenta ou reduz o atributo. Bônus e penalidades somam; o atributo nunca cai abaixo de 20%. | fração do atributo (0.3 = 30%) |
| `passive_up` | A passiva de começo de vez de quem o carrega cura e causa dano mais forte. É o que a Bênção dá ao Clérigo: a Aura Restauradora cura 80% a mais nas duas vezes seguintes. | fração a mais (0.8 = 80%) |

Regras de duração:

- `turns` é contado **na vez da unidade que carrega o status**: cada vez que ela termina de agir (ou perde a vez), gasta um. Como cada unidade age uma vez por turno, "2 turnos" são duas vezes dela.
- Um status que a unidade recebe durante a própria vez só começa a contar na vez seguinte.
- Por isso o momento importa: um atordoamento que pega antes da vez do alvo tira a vez dele neste turno; se pegar depois, tira a do turno seguinte.
- Cada unidade tem no máximo um status de cada tipo. Reaplicar substitui o anterior.
- `chance` (0 a 1) é a chance de o status pegar. Sem ela, sempre pega.
- `to: 'self'` aplica em quem usou a habilidade, mesmo que ela mire em inimigos.

O ciclo de uma vez fica assim: queimadura e veneno causam dano, a unidade atordoada perde a vez, a passiva de começo de vez age, a unidade age, os status dela gastam um turno.

Para a tela, o motor emite `turn_started` (turno novo, com a ordem, a energia e quanto a fúria vale), `order_changed` (a ordem mudou no meio do turno), `unit_activated` (chegou a vez de alguém), `status_applied`, `status_damage`, `status_expired` e `unit_skipped` (para animar) e `statuses_changed`, que traz a lista completa de status da unidade depois de qualquer mudança. A tela só copia essa lista.

## Passivas

Cada personagem tem uma lista `passives` em `data/characters.ts`. Uma passiva
não aparece entre as jogadas: o motor a aplica sozinho, e a descrição dela é
mostrada na carta e no painel da batalha. O campo `effect` diz o que ela faz:

| `effect.type` | O que faz | Quem usa |
| --- | --- | --- |
| `damage_bonus` | Os golpes causam mais dano (`amount`: 0.3 = +30%). Com `when`, só contra o alvo que está na condição. | Piromante, Criomante, Banshee, Arqueiro |
| `crit_chance_bonus` | Soma à chance de crítico. Também aceita `when`. | Ladino |
| `ignore_defense` | Os golpes ignoram uma fração da defesa do alvo. | Espadachim |
| `atk_from_def` | Os golpes somam ao ataque uma fração da defesa de quem bate. Cura e status não mudam. | Cavaleiro |
| `lifesteal` | Todo golpe devolve como vida uma fração do dano que o alvo perdeu. Soma com o `drain` da habilidade. | ninguém, por enquanto |
| `damage_per_drain` | Passiva que acumula cargas: cada vez que a unidade recupera vida com roubo de vida, ganha uma carga, e cada carga soma `amount` ao dano dos golpes dela até o fim da batalha (0.05 = +5%). Cura que não aconteceu (vida cheia) não conta. `max` limita as cargas. Elas ficam em `unit.passiveStacks`. | Vampiro |
| `damage_per_missing_hp` | Quanto mais ferida a unidade, mais forte ela bate: para cada 1% da vida máxima perdida, `amount`% a mais de dano (amount 1 = 1% por 1%). Conta pontos inteiros de porcentagem e acompanha a vida: com cura, o bônus cai. | Bárbaro |
| `energy_on_crit` | Um acerto crítico devolve energia ao time, até o máximo de 10 (pode passar da energia do turno). | Bárbaro |
| `status_on_hit` | Todo golpe da unidade também aplica um status no alvo (`status`, `turns`, `power`, `chance`, como no efeito de uma habilidade). É aplicado depois do dano, então não vale para o próprio golpe; se o alvo já tem o mesmo status mais forte, fica o mais forte. | Arqueiro |
| `status_power` | Os status dos tipos listados que a unidade aplica valem mais (`amount`: 0.6 = +60%). | ninguém, por enquanto |
| `status_growth` | O dano por turno dos status listados que a unidade aplica cresce com o tempo: o primeiro dano é o normal e cada turno seguinte soma `amount` do valor original (0.6: 100%, 160%, 220%...). O status guarda `growth` e `ticks` (quantas vezes já causou dano); o dano de agora é `getStatusTickDamage`. Renovar o status antes de ele acabar mantém a conta, mesmo que quem renove seja um aliado sem a passiva; se ele acabar, o próximo recomeça do normal. Depois de cada dano o motor emite `statuses_changed`. | Guardião |
| `turn_start` | Age sozinha no começo da vez da unidade, se ela não estiver atordoada: aplica `effects` em `target`, como uma habilidade sem custo. `all-allies` (se só cura, pula quem está com a vida cheia) ou `fastest-enemy`. | Clérigo, Dríade |

Uma passiva pode fazer mais de uma coisa: o efeito principal fica em `effect`
e os outros em `also` (a do Arqueiro soma dano com condição e redução de
defesa no golpe).

Condições (`when`), sempre sobre o alvo do golpe: `target_has_status` (tem
pelo menos um dos status), `target_hp_below` e `target_hp_above` (fração da
vida máxima).

As passivas do Clérigo e da Dríade eram habilidades ativas de 3 de energia
(Luz Restauradora e Raízes Enredantes). Viraram versões que acontecem a
cada vez, sem custo.

Para a tela, o motor emite `passive_triggered` quando uma passiva faz
diferença: antes do dano que uma passiva com condição mudou (uma vez por
ação) e antes dos efeitos de uma passiva de começo de vez. As que valem em
todo golpe não avisam. Numa passiva que acumula cargas, o aviso vem uma vez
por ação, depois dos golpes, com `stacks` (quantas cargas ela tem agora).
`energy_gained` avisa que a energia de um time subiu no meio do turno.

A sequência de números aleatórios não depende das passivas: cada golpe gasta
um sorteio de crítico, com ou sem bônus. Uma batalha gravada antes de as
passivas existirem (unidades sem o campo `passives`) continua como estava,
sem passiva para ninguém.

Para criar um tipo novo de passiva: acrescente-o em `PassiveEffect`
(`types.ts`), trate-o em `getHitModifiers` (ou no ponto do motor em que ele
age) e escreva um teste em `tests/passives.test.ts`.

## Elemento das habilidades

Cada habilidade do catálogo tem um `element` (`physical`, `fire`, `ice`, `lightning`, `nature`, `light` ou `shadow`) e pode ter `ranged: true`. Os dois campos **não entram em nenhuma conta**: existem para a tela escolher o efeito visual e o som. `ranged` só vale em golpe contra inimigos: num alvo só, a tela mostra um projétil em vez de a unidade avançar; em área, uma chuva de projéteis. Se um dia houver fraqueza por elemento, o dado já está aqui.

## Arquivos

| Arquivo | Para que serve |
| --- | --- |
| `types.ts` | Os formatos dos dados: estado, unidade, habilidade, ação, eventos. |
| `engine.ts` | As regras: `createBattle`, `applyAction` e as consultas. |
| `data/characters.ts` | Os personagens, suas habilidades e suas passivas. |
| `constants.ts` | Os números de balanceamento globais. |
| `rng.ts` | Sorteio com semente, para a batalha ser reproduzível. |
| `ai.ts` | Uma IA simples que escolhe a ação da unidade da vez (`chooseAction`) e a IA de treino do tutorial, que joga fraco de propósito (`chooseTrainingAction`). |
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
acontecem na ordem em que estão escritos. Todo personagem precisa de pelo
menos uma passiva, e a descrição dela tem que dizer os mesmos números do
`effect` (há um teste que confere). Depois rode `npm test` e
`npm run battle:balance` para ver se ele ficou forte ou fraco demais.

A arte fica no front, em `src/assets/characters/`, com o `id` do personagem
no nome do arquivo.
