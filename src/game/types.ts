/**
 * Tipos do motor de batalha.
 *
 * Regra de ouro desta pasta: nada aqui importa Express, Prisma ou qualquer
 * coisa de fora de src/game. O motor só conhece dados e regras.
 *
 * Tudo que fica dentro de BattleState é JSON puro (sem classes, funções ou
 * Date). Isso permite salvar a batalha no banco e enviar para o front sem
 * nenhuma conversão.
 */

export type TeamId = 'A' | 'B';

export interface Stats {
    maxHp: number;
    atk: number;
    def: number;
    /** Quanto maior, mais rápido a barra de ação enche. */
    speed: number;
    /** Chance de crítico, de 0 a 1. */
    critChance: number;
    /** Multiplicador do dano em caso de crítico (1.5 = +50%). */
    critDamage: number;
}

/**
 * Quem a habilidade atinge.
 * As "single-*" exigem que o jogador escolha um alvo; as outras não.
 *
 * 'corpse' é o cadáver de um aliado: uma unidade derrotada do próprio time que
 * ainda não foi erguida. O motor escolhe sozinho (o primeiro cadáver do time);
 * sem cadáver, a habilidade não pode ser usada.
 */
export type TargetType = 'single-enemy' | 'all-enemies' | 'single-ally' | 'all-allies' | 'self' | 'corpse';

/**
 * Os efeitos de status que uma unidade pode carregar.
 *
 * - stun: perde a vez.
 * - burn / poison / bleed: leva dano no começo de cada turno seu (queimadura,
 *   veneno e sangramento são três status separados: podem estar juntos).
 * - shield: absorve dano antes da vida.
 * - *_up / *_down: aumenta ou reduz um atributo em uma fração (0.3 = 30%).
 * - passive_up: a passiva de começo de vez da unidade cura e causa dano mais
 *   forte, em uma fração (0.8 = 80% a mais).
 * - taunt: provocação. Enquanto uma unidade provoca, as habilidades de alvo
 *   único dos inimigos só podem mirar nela (ou em outra que também provoque).
 *   Golpes em área e passivas que escolhem o alvo sozinhas não mudam.
 * - heal_down: a unidade recebe menos cura, em uma fração (0.6 = 60% a menos).
 *   Vale para toda cura: habilidades, passivas e roubo de vida.
 * - stealth: a unidade está escondida. As habilidades de alvo único dos
 *   inimigos não podem mirar nela (a não ser que todos os inimigos vivos
 *   estejam escondidos); golpes em área e passivas que escolhem o alvo
 *   sozinhas acertam normalmente. Acaba quando ela age ou leva dano.
 * - form: a unidade está transformada (ver FormDefinition). Quando o status
 *   acaba, ela volta à forma original.
 */
export type StatusKind =
    | 'stun'
    | 'burn'
    | 'poison'
    | 'shield'
    | 'atk_up'
    | 'atk_down'
    | 'def_up'
    | 'def_down'
    | 'speed_up'
    | 'speed_down'
    | 'passive_up'
    | 'taunt'
    | 'bleed'
    | 'heal_down'
    | 'stealth'
    | 'counter'
    | 'form';

/** Um status ativo em uma unidade. */
export interface StatusEffect {
    kind: StatusKind;
    /**
     * Quantos turnos o status ainda dura. A conta é feita na vez de quem o
     * carrega: cada vez que essa unidade termina de agir, gasta um.
     */
    turns: number;
    /**
     * O significado depende do tipo: dano por turno (burn, poison), pontos
     * restantes (shield) ou fração (modificadores de atributo, passive_up e heal_down).
     * Zero no stun, no taunt, no stealth, no counter e no form.
     */
    value: number;
    sourceId: string;
    /**
     * Só nos status de dano por turno que crescem (passiva `status_growth` de
     * quem aplicou): a cada vez que o status causa dano, o próximo dano sobe
     * esta fração do valor original (0.6 = +60% por turno). O dano de agora é
     * `value x (1 + growth x ticks)`.
     */
    growth?: number;
    /**
     * Quantas vezes o status que cresce já causou dano neste alvo. Renovar o
     * status enquanto ele está ativo mantém a conta; se ele acabar, o próximo
     * começa do zero.
     */
    ticks?: number;
    /**
     * A "vez" (BattleState.step) em que foi aplicado. Um status que a unidade
     * recebe durante a própria vez não gasta duração no fim dessa mesma vez.
     */
    appliedOnStep: number;
}

/**
 * O que a habilidade faz. `power` multiplica o ATK de quem usa.
 *
 * No efeito 'status', `power` vira o valor do status: dano por turno e escudo
 * são ATK x power; nos modificadores é a própria fração (0.3 = 30%).
 * `chance` (0 a 1) é a chance de pegar; sem ela, sempre pega.
 * `to: 'self'` aplica em quem usou, mesmo que a habilidade mire em inimigos.
 *
 * No efeito 'damage', `drain` é roubo de vida: quem usou recupera essa fração
 * do dano que o alvo de fato perdeu (0.5 = metade). O que o escudo segurou
 * não conta.
 *
 * `perTargetMissingHp` é o golpe de execução: para cada 1% da vida máxima que
 * o ALVO já perdeu, o golpe causa essa porcentagem a mais (1: num alvo com 40%
 * da vida perdida, +40% de dano). Conta em pontos inteiros de porcentagem e
 * soma com os bônus das passivas de quem bate.
 *
 * O efeito 'cleanse' é a purificação: tira do alvo todos os status que o
 * atrapalham (NEGATIVE_STATUSES, em engine.ts). Bônus e escudo ficam.
 *
 * O efeito 'transform' muda o alvo para uma das formas dele (`form` é o id em
 * CharacterDefinition.forms) por `turns` turnos: atributos, habilidades e
 * passivas passam a ser os da forma, e a vida mantém a mesma proporção.
 *
 * O efeito 'summon' ergue o cadáver de um aliado (alvo 'corpse') como uma
 * invocação de quem usou (`summon` é o id em CharacterDefinition.summons): a
 * unidade derrotada dá lugar a uma unidade nova, com vida cheia, no mesmo
 * lugar do time. Ela entra na fila de ação do turno em que é erguida e não
 * deixa cadáver.
 */
export type SkillEffect =
    | { type: 'damage'; power: number; drain?: number; perTargetMissingHp?: number }
    | { type: 'heal'; power: number }
    | { type: 'status'; status: StatusKind; turns: number; power: number; chance?: number; to?: 'target' | 'self' }
    | { type: 'cleanse' }
    | { type: 'transform'; form: string; turns: number }
    | { type: 'summon'; summon: string };

/**
 * Elemento de uma habilidade. Por enquanto não entra em nenhuma conta: serve
 * para a tela escolher o efeito visual e o som. Sem elemento, vale 'physical'.
 */
export type SkillElement = 'physical' | 'fire' | 'ice' | 'lightning' | 'nature' | 'light' | 'shadow';

export interface SkillDefinition {
    id: string;
    name: string;
    description: string;
    /** Custo na energia compartilhada do time. Ataque básico custa 0. */
    energyCost: number;
    target: TargetType;
    effects: SkillEffect[];
    element?: SkillElement;
    /**
     * Golpe à distância. Em alvo único, a tela mostra um projétil em vez de a
     * unidade avançar; em área, uma chuva de projéteis em vez do efeito do
     * elemento.
     */
    ranged?: boolean;
}

/**
 * Quando uma passiva de golpe vale, olhando para o alvo do golpe.
 * Uma passiva sem condição vale em todo golpe.
 */
export type PassiveCondition =
    /** O alvo carrega pelo menos um destes status. */
    | { type: 'target_has_status'; statuses: StatusKind[] }
    /** O alvo está com menos desta fração da vida (0.4 = abaixo de 40%). */
    | { type: 'target_hp_below'; ratio: number }
    /** O alvo está com mais desta fração da vida. */
    | { type: 'target_hp_above'; ratio: number };

/**
 * O que uma passiva faz. Ninguém "usa" uma passiva: ela vale o tempo todo
 * para a unidade que a tem, e o motor a aplica na hora certa.
 *
 * As primeiras mudam os golpes da própria unidade (os efeitos 'damage' das
 * habilidades dela):
 * - damage_bonus: o golpe causa mais dano (0.3 = +30%);
 * - crit_chance_bonus: soma à chance de crítico (0.3 = +30 pontos);
 * - ignore_defense: o golpe ignora esta fração da defesa do alvo;
 * - atk_from_def: soma ao ataque esta fração da defesa de quem bate;
 * - lifesteal: quem bate recupera esta fração do dano que o alvo perdeu
 *   (soma com o `drain` da habilidade);
 * - energy_on_crit: num acerto crítico, o time recupera esta energia;
 * - damage_per_drain: a passiva acumula cargas. Cada vez que a unidade
 *   recupera vida com roubo de vida (o `drain` de uma habilidade, ou
 *   `lifesteal`), ganha uma carga, e cada carga soma `amount` ao dano dos
 *   golpes dela até o fim da batalha (0.05 = +5% por carga). `max` limita as
 *   cargas; sem ele, não há limite. As cargas ficam em `unit.passiveStacks`;
 * - damage_per_missing_hp: quanto mais ferida a unidade, mais forte ela bate.
 *   Para cada 1% da vida máxima que ela perdeu, os golpes causam `amount`%
 *   a mais (amount 1: com 40% da vida perdida, +40% de dano). Conta em
 *   pontos inteiros de porcentagem e acompanha a vida: se ela é curada, o
 *   bônus cai.
 *
 * status_on_hit: todo golpe da unidade também aplica um status no alvo
 * (`power`, `turns` e `chance` como no efeito 'status' de uma habilidade). O
 * status é aplicado depois do dano, então não vale para o próprio golpe que o
 * aplicou. Se o alvo já carrega o mesmo status com valor maior, fica o maior.
 *
 * status_power aumenta o valor dos status que a unidade aplica (0.4 = +40%).
 *
 * status_growth faz o dano por turno (veneno, queimadura) que a unidade aplica
 * crescer com o tempo: o primeiro dano é o normal, e a cada turno que o alvo
 * continua com o status o dano sobe `amount` do valor original (0.6: 100%,
 * 160%, 220%...). Renovar o status antes de ele acabar mantém o crescimento,
 * mesmo que quem renove seja um aliado sem a passiva; se o status acabar, o
 * próximo começa do normal. A conta fica no próprio status (`growth`, `ticks`).
 *
 * extra_action_on_transform: quando a unidade se transforma (efeito
 * 'transform' de uma habilidade dela), a vez não acaba: ela age de novo, já
 * na forma nova. A vez da transformação conta como um dos turnos da forma.
 *
 * stealth_each_turn: no começo de cada turno a unidade fica escondida (status
 * `stealth`) até agir ou levar dano. Enquanto isso, os inimigos não podem
 * escolhê-la como alvo.
 *
 * damage_per_enemy_status: os golpes causam `amount` a mais de dano para cada
 * inimigo vivo que carrega algum dos `statuses` (0.1 com 'bleed' = +10% por
 * inimigo sangrando). A conta é feita uma vez por golpe, antes dele: num
 * golpe em área todos os alvos levam o mesmo bônus; numa habilidade de
 * vários golpes, cada golpe conta de novo.
 *
 * battle_start: age uma vez só, quando a batalha começa, antes da vez de
 * qualquer unidade: aplica os `effects` em todos os inimigos, como uma
 * habilidade em área sem custo.
 *
 * count_corpses: a passiva conta os cadáveres do time (aliados derrotados que
 * ainda não foram erguidos). O número fica em `unit.passiveStacks` e é só uma
 * conta para a tela mostrar: quem usa os cadáveres é o efeito 'summon'.
 *
 * turn_start é a passiva que age sozinha: no começo da vez da unidade (se ela
 * não estiver atordoada), os `effects` são aplicados no alvo indicado, como
 * se fossem uma habilidade sem custo.
 */
export type PassiveEffect =
    | { type: 'damage_bonus'; amount: number; when?: PassiveCondition }
    | { type: 'crit_chance_bonus'; amount: number; when?: PassiveCondition }
    | { type: 'ignore_defense'; amount: number }
    | { type: 'atk_from_def'; amount: number }
    | { type: 'lifesteal'; amount: number }
    | { type: 'energy_on_crit'; amount: number }
    | { type: 'status_on_hit'; status: StatusKind; turns: number; power: number; chance?: number }
    | { type: 'damage_per_drain'; amount: number; max?: number }
    | { type: 'damage_per_missing_hp'; amount: number }
    | { type: 'damage_per_enemy_status'; statuses: StatusKind[]; amount: number }
    | { type: 'status_power'; statuses: StatusKind[]; amount: number }
    | { type: 'status_growth'; statuses: StatusKind[]; amount: number }
    | { type: 'extra_action_on_transform' }
    | { type: 'count_corpses' }
    | { type: 'stealth_each_turn' }
    | { type: 'battle_start'; target: 'all-enemies'; effects: SkillEffect[] }
    | { type: 'turn_start'; target: 'all-allies' | 'fastest-enemy'; effects: SkillEffect[] };

export interface PassiveDefinition {
    /** "<personagem>.<passiva>", como nas habilidades. */
    id: string;
    name: string;
    description: string;
    effect: PassiveEffect;
    /** Outros efeitos da mesma passiva, quando ela faz mais de uma coisa. */
    also?: PassiveEffect[];
    /** Como em SkillDefinition: só para a tela escolher o efeito visual e o som. */
    element?: SkillElement;
    ranged?: boolean;
}

export type CharacterRole = 'attacker' | 'tank' | 'support' | 'assassin' | 'mage' | 'fighter' | 'shapeshifter';

/**
 * Uma forma em que o personagem pode se transformar (o urso e o lobo do
 * Druida). Na forma, ele troca os atributos, as habilidades e as passivas
 * pelos dela; o resto (vida em proporção, status, energia do time) continua.
 */
export interface FormDefinition {
    /** Único dentro do personagem: 'urso', 'lobo'. A tela usa para escolher a ilustração (<personagem>-<forma>). */
    id: string;
    name: string;
    stats: Stats;
    /** Como no personagem: a primeira é o ataque básico. */
    skills: SkillDefinition[];
    passives: PassiveDefinition[];
}

/** A "ficha" de um personagem: o molde a partir do qual as unidades são criadas. */
export interface CharacterDefinition {
    id: string;
    name: string;
    role: CharacterRole;
    stats: Stats;
    /** A primeira habilidade é sempre o ataque básico (custo 0, alvo inimigo). */
    skills: SkillDefinition[];
    /** Todo personagem tem pelo menos uma passiva. */
    passives: PassiveDefinition[];
    /** As formas em que ele pode se transformar. A maioria não tem nenhuma. */
    forms?: FormDefinition[];
    /**
     * O que ele invoca com o efeito 'summon' (o Guerreiro Esqueleto do
     * Necromante). Tem o mesmo formato de uma forma: id, nome, atributos,
     * habilidades e passivas. O id vira o `characterId` da unidade invocada,
     * que é o que a tela usa para achar a ilustração.
     */
    summons?: FormDefinition[];
}

/** Um personagem dentro de uma batalha específica. */
export interface BattleUnit {
    /** Único dentro da batalha: 'A1', 'A2', 'B1'... */
    id: string;
    characterId: string;
    name: string;
    team: TeamId;
    stats: Stats;
    hp: number;
    /** Status ativos. No máximo um de cada tipo: reaplicar substitui. */
    statuses: StatusEffect[];
    /**
     * Cópia das habilidades no momento em que a batalha começou. Assim o
     * estado é autossuficiente: mudar o balanceamento depois não altera uma
     * batalha em andamento, e o front recebe tudo o que precisa mostrar.
     */
    skills: SkillDefinition[];
    /**
     * Cópia das passivas, como as habilidades. Batalhas gravadas antes de as
     * passivas existirem não têm o campo: nelas ninguém tem passiva.
     */
    passives?: PassiveDefinition[];
    /**
     * O número que a passiva da unidade guarda: cargas acumuladas
     * (damage_per_drain) ou cadáveres do time (count_corpses).
     */
    passiveStacks?: number;
    /** Só em quem invoca: cópia das invocações dele (CharacterDefinition.summons). */
    summons?: FormDefinition[];
    /** A unidade foi invocada (um esqueleto erguido). Quando cai, não deixa cadáver. */
    summoned?: boolean;
    /**
     * Só em quem se transforma. `form` é o id da forma em que a unidade está
     * agora (ausente = forma original). Enquanto transformada, `stats`,
     * `skills` e `passives` são os da forma. `forms` e `baseForm` são cópias
     * de todas as formas e da original (id 'base'), para o estado continuar
     * autossuficiente e a unidade saber para o que voltar.
     */
    form?: string;
    forms?: FormDefinition[];
    baseForm?: FormDefinition;
}

export interface BattleState {
    units: BattleUnit[];
    /** Energia que cada time ainda tem para gastar neste turno. É compartilhada pelas unidades do time. */
    energy: Record<TeamId, number>;
    /**
     * Com quanta energia cada time começou este turno: 3 no turno 1, mais 1
     * a cada turno, até o máximo. A tela usa para mostrar o quanto já foi gasto.
     */
    turnEnergy: number;
    /** De quem é a vez. Fica null quando a batalha acaba. */
    activeUnitId: string | null;
    /**
     * Turno atual, começando em 1. Um turno é uma rodada: cada unidade viva
     * age uma vez. O número só sobe depois que todas agiram.
     */
    turn: number;
    /**
     * A ordem de ação do turno atual, do primeiro ao último: mais veloz
     * primeiro, empate decidido na sorte. É definida no começo do turno e,
     * se a velocidade de alguém mudar no meio dele, quem ainda não agiu é
     * reordenado. Quem está antes de `activeUnitId` nesta lista já agiu.
     */
    order: string[];
    /**
     * O número que cada unidade tirou na sorte neste turno (de 0 a 1). Entre
     * duas unidades com a mesma velocidade, age antes a que tirou o menor.
     * Fica guardado porque um empate pode aparecer no meio do turno.
     */
    draws: Record<string, number>;
    /**
     * Quantas "vezes" já aconteceram na batalha inteira (a vez de uma
     * unidade, mesmo perdida, conta uma). Só cresce. Serve de relógio fino:
     * a duração dos status e a trava contra jogada dupla usam este número.
     */
    step: number;
    winner: TeamId | null;
    /** Preenchido quando a batalha acabou porque um time desistiu. */
    surrenderedBy?: TeamId;
    /**
     * A desistência foi por tempo esgotado: numa partida ranqueada, o time de
     * `surrenderedBy` passou do prazo sem jogar e o outro pediu a vitória. O
     * motor não usa: quem marca é o serviço de batalhas, para a tela dizer o
     * que aconteceu.
     */
    timedOut?: boolean;
    /**
     * Batalha de treino (o tutorial). O motor não usa: quem lê é quem escolhe as
     * jogadas da IA, para ela jogar fraco (`chooseTrainingAction`), e a tela,
     * para mostrar o guia. Fica no estado para acompanhar a batalha gravada.
     */
    training?: boolean;
    /**
     * O cenário da batalha, sorteado quando ela é criada. O motor não usa: é só
     * a tela que desenha. Fica no estado para os dois jogadores e o replay verem
     * o mesmo. Batalhas criadas antes de haver cenários não têm (vale a muralha).
     */
    arena?: ArenaId;
    /** Estado do gerador de números aleatórios (ver rng.ts). */
    rngState: number;
}

/** Os cenários onde a batalha acontece. A lista em ordem fica em ARENAS (constants.ts). */
export type ArenaId = 'muralha' | 'floresta' | 'lago-gelado';

/** O que um jogador (ou a IA) pede para fazer. */
export interface BattleAction {
    unitId: string;
    skillId: string;
    /** Obrigatório apenas para habilidades de alvo único. */
    targetId?: string;
}

/**
 * Tudo o que aconteceu ao resolver uma ação, em ordem.
 * O front usa essa lista para animar: "fulano usou X", "ciclano levou 120"...
 */
export type BattleEvent =
    /**
     * Um turno novo começou. `order` é a ordem de ação dele, já sorteada, e
     * `energy` é a energia com que os dois times começam o turno.
     * `fury` é quanto o dano das habilidades está aumentado neste turno
     * (0 = sem fúria, 0.5 = +50%).
     */
    | { type: 'turn_started'; turn: number; order: string[]; energy: number; fury: number }
    /** A velocidade de alguém mudou no meio do turno e quem ainda não agiu foi reordenado. */
    | { type: 'order_changed'; order: string[] }
    /** Chegou a vez de uma unidade. */
    | { type: 'unit_activated'; unitId: string; team: TeamId }
    | { type: 'skill_used'; unitId: string; skillId: string; targetIds: string[]; team: TeamId; energy: number }
    /**
     * Contra-ataque: `unitId` carrega o status `counter`, foi atingida por um
     * golpe e revida com o ataque básico (`skillId`) em `targetIds[0]`: quem
     * bateu ou, se há um inimigo provocando, quem provoca. É fora da vez e
     * sem gastar energia. Os eventos do golpe vêm logo depois.
     */
    | { type: 'counter_attack'; unitId: string; skillId: string; targetIds: string[] }
    /** `amount` é o dano total do golpe; `absorbed` é a parte que o escudo segurou. */
    | { type: 'damage'; sourceId: string; targetId: string; amount: number; absorbed: number; critical: boolean; hp: number }
    | { type: 'heal'; sourceId: string; targetId: string; amount: number; hp: number }
    | { type: 'status_applied'; sourceId: string; targetId: string; status: StatusKind; turns: number; value: number }
    /** Dano de queimadura ou veneno, quando chega a vez de quem carrega o status. */
    | { type: 'status_damage'; targetId: string; status: StatusKind; amount: number; hp: number }
    | { type: 'status_expired'; unitId: string; status: StatusKind }
    /** `sourceId` purificou `targetId`: `statuses` são os status que saíram. Vem seguido de statuses_changed. */
    | { type: 'cleansed'; sourceId: string; targetId: string; statuses: StatusKind[] }
    /**
     * A lista completa de status da unidade depois de qualquer mudança
     * (aplicar, expirar, escudo gasto, duração contada). A tela só precisa
     * copiar essa lista: não tem que repetir as regras de duração.
     */
    | { type: 'statuses_changed'; unitId: string; statuses: StatusEffect[] }
    /** A unidade perdeu a vez (atordoada). */
    | { type: 'unit_skipped'; unitId: string; status: StatusKind }
    | { type: 'unit_defeated'; unitId: string }
    /**
     * A unidade mudou de forma. `form` é o id da forma nova, ou null quando
     * ela voltou à original. Atributos, habilidades e passivas passam a ser os
     * da forma (estão em `unit.forms` / `unit.baseForm`); `hp` é a vida depois
     * da troca, na mesma proporção de antes.
     */
    | { type: 'transformed'; unitId: string; form: string | null; hp: number }
    /**
     * `sourceId` ergueu um cadáver: no lugar da unidade `unitId` (derrotada)
     * entra `unit`, a invocação, com o mesmo id. A tela troca uma pela outra.
     */
    | { type: 'summoned'; sourceId: string; unitId: string; unit: BattleUnit }
    /** A vez da unidade não acabou: ela vai agir de novo (passiva extra_action_on_transform). */
    | { type: 'extra_action'; unitId: string }
    /**
     * A passiva de uma unidade fez diferença agora. Para as passivas de golpe,
     * vem antes do dano que ela mudou, uma vez por ação, e `targetIds` é o
     * alvo desse golpe. Para as de começo de vez, vem antes dos efeitos dela, e
     * `targetIds` é quem ela atingiu. Passivas que valem em todo golpe (como
     * roubo de vida) não avisam: o resultado já aparece nos outros eventos.
     *
     * Numa passiva que acumula cargas, o aviso vem depois dos golpes da ação
     * em que ela ganhou carga, e `stacks` é quantas cargas ela tem agora.
     */
    | { type: 'passive_triggered'; unitId: string; passiveId: string; targetIds: string[]; stacks?: number }
    /** O time recuperou energia no meio do turno, por causa de `unitId`. `energy` é quanto ele tem agora. */
    | { type: 'energy_gained'; team: TeamId; unitId: string; amount: number; energy: number }
    /** Um time desistiu. Vem sempre seguido de battle_ended. */
    | { type: 'surrendered'; team: TeamId }
    | { type: 'battle_ended'; winner: TeamId };

export interface BattleResult {
    state: BattleState;
    events: BattleEvent[];
}

/**
 * Os números de uma habilidade para quem vai usá-la agora: é o que a tela
 * mostra junto da descrição. São valores "base": já contam o ataque atual de
 * quem usa (com bônus e penalidades), a fúria e as passivas que valem em todo
 * golpe, mas não a defesa nem o escudo do alvo, nem o acerto crítico, nem as
 * passivas que dependem do alvo. `null` quando a habilidade não causa dano
 * (ou não cura).
 */
export interface SkillPreview {
    /** Dano em cada alvo, antes da defesa. */
    damage: number | null;
    /** Cura em cada alvo (limitada, na hora, pela vida que falta ao alvo). */
    heal: number | null;
}

/** Uma opção que a unidade da vez tem. Serve para a IA e para os botões do front. */
export interface AvailableAction {
    skill: SkillDefinition;
    preview: SkillPreview;
    /** false quando falta energia ou não há alvo possível. */
    usable: boolean;
    /** true quando o jogador precisa escolher um dos targetIds. */
    requiresTarget: boolean;
    /** Alvo único: as opções de escolha. Demais casos: todos os que serão atingidos. */
    targetIds: string[];
}
