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
 */
export type TargetType = 'single-enemy' | 'all-enemies' | 'single-ally' | 'all-allies' | 'self';

/**
 * Os efeitos de status que uma unidade pode carregar.
 *
 * - stun: perde a vez.
 * - burn / poison: leva dano no começo de cada turno seu.
 * - shield: absorve dano antes da vida.
 * - *_up / *_down: aumenta ou reduz um atributo em uma fração (0.3 = 30%).
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
    | 'speed_down';

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
     * restantes (shield) ou fração do atributo (modificadores). Zero no stun.
     */
    value: number;
    sourceId: string;
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
 */
export type SkillEffect =
    | { type: 'damage'; power: number; drain?: number }
    | { type: 'heal'; power: number }
    | { type: 'status'; status: StatusKind; turns: number; power: number; chance?: number; to?: 'target' | 'self' };

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

export type CharacterRole = 'attacker' | 'tank' | 'support' | 'assassin' | 'mage' | 'fighter';

/** A "ficha" de um personagem: o molde a partir do qual as unidades são criadas. */
export interface CharacterDefinition {
    id: string;
    name: string;
    role: CharacterRole;
    stats: Stats;
    /** A primeira habilidade é sempre o ataque básico (custo 0, alvo inimigo). */
    skills: SkillDefinition[];
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
     * Batalha de treino (o tutorial). O motor não usa: quem lê é quem escolhe as
     * jogadas da IA, para ela jogar fraco (`chooseTrainingAction`), e a tela,
     * para mostrar o guia. Fica no estado para acompanhar a batalha gravada.
     */
    training?: boolean;
    /** Estado do gerador de números aleatórios (ver rng.ts). */
    rngState: number;
}

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
    /** `amount` é o dano total do golpe; `absorbed` é a parte que o escudo segurou. */
    | { type: 'damage'; sourceId: string; targetId: string; amount: number; absorbed: number; critical: boolean; hp: number }
    | { type: 'heal'; sourceId: string; targetId: string; amount: number; hp: number }
    | { type: 'status_applied'; sourceId: string; targetId: string; status: StatusKind; turns: number; value: number }
    /** Dano de queimadura ou veneno, quando chega a vez de quem carrega o status. */
    | { type: 'status_damage'; targetId: string; status: StatusKind; amount: number; hp: number }
    | { type: 'status_expired'; unitId: string; status: StatusKind }
    /**
     * A lista completa de status da unidade depois de qualquer mudança
     * (aplicar, expirar, escudo gasto, duração contada). A tela só precisa
     * copiar essa lista: não tem que repetir as regras de duração.
     */
    | { type: 'statuses_changed'; unitId: string; statuses: StatusEffect[] }
    /** A unidade perdeu a vez (atordoada). */
    | { type: 'unit_skipped'; unitId: string; status: StatusKind }
    | { type: 'unit_defeated'; unitId: string }
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
 * quem usa (com bônus e penalidades) e a fúria, mas não a defesa nem o escudo
 * do alvo, nem o acerto crítico. `null` quando a habilidade não causa dano
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
