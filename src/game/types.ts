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
    /** Quantos turnos DA PRÓPRIA unidade o status ainda dura. */
    turns: number;
    /**
     * O significado depende do tipo: dano por turno (burn, poison), pontos
     * restantes (shield) ou fração do atributo (modificadores). Zero no stun.
     */
    value: number;
    sourceId: string;
    /** Turno em que foi aplicado. Um status não gasta duração no turno em que nasce. */
    appliedOnTurn: number;
}

/**
 * O que a habilidade faz. `power` multiplica o ATK de quem usa.
 *
 * No efeito 'status', `power` vira o valor do status: dano por turno e escudo
 * são ATK x power; nos modificadores é a própria fração (0.3 = 30%).
 * `chance` (0 a 1) é a chance de pegar; sem ela, sempre pega.
 * `to: 'self'` aplica em quem usou, mesmo que a habilidade mire em inimigos.
 */
export type SkillEffect =
    | { type: 'damage'; power: number }
    | { type: 'heal'; power: number }
    | { type: 'status'; status: StatusKind; turns: number; power: number; chance?: number; to?: 'target' | 'self' };

export interface SkillDefinition {
    id: string;
    name: string;
    description: string;
    /** Custo na energia compartilhada do time. Ataque básico custa 0. */
    energyCost: number;
    target: TargetType;
    effects: SkillEffect[];
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
    /** Barra de ação: vai de 0 a GAUGE_MAX. Quem enche primeiro joga. */
    actionGauge: number;
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
    /** Energia compartilhada de cada time. */
    energy: Record<TeamId, number>;
    /** De quem é a vez. Fica null quando a batalha acaba. */
    activeUnitId: string | null;
    /** Contador de turnos, começando em 1. */
    turn: number;
    winner: TeamId | null;
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
    | { type: 'turn_started'; turn: number; unitId: string; team: TeamId; energy: number }
    | { type: 'skill_used'; unitId: string; skillId: string; targetIds: string[]; team: TeamId; energy: number }
    /** `amount` é o dano total do golpe; `absorbed` é a parte que o escudo segurou. */
    | { type: 'damage'; sourceId: string; targetId: string; amount: number; absorbed: number; critical: boolean; hp: number }
    | { type: 'heal'; sourceId: string; targetId: string; amount: number; hp: number }
    | { type: 'status_applied'; sourceId: string; targetId: string; status: StatusKind; turns: number; value: number }
    /** Dano de queimadura ou veneno, no começo do turno de quem carrega o status. */
    | { type: 'status_damage'; targetId: string; status: StatusKind; amount: number; hp: number }
    | { type: 'status_expired'; unitId: string; status: StatusKind }
    /**
     * A lista completa de status da unidade depois de qualquer mudança
     * (aplicar, expirar, escudo gasto, duração contada). A tela só precisa
     * copiar essa lista: não tem que repetir as regras de duração.
     */
    | { type: 'statuses_changed'; unitId: string; statuses: StatusEffect[] }
    | { type: 'turn_skipped'; unitId: string; status: StatusKind }
    | { type: 'unit_defeated'; unitId: string }
    | { type: 'battle_ended'; winner: TeamId };

export interface BattleResult {
    state: BattleState;
    events: BattleEvent[];
}

/** Uma opção que a unidade da vez tem. Serve para a IA e para os botões do front. */
export interface AvailableAction {
    skill: SkillDefinition;
    /** false quando falta energia ou não há alvo possível. */
    usable: boolean;
    /** true quando o jogador precisa escolher um dos targetIds. */
    requiresTarget: boolean;
    /** Alvo único: as opções de escolha. Demais casos: todos os que serão atingidos. */
    targetIds: string[];
}
