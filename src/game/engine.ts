import {
    ENERGY_GROWTH_PER_TURN,
    FURY_DAMAGE_PER_TURN,
    FURY_START_TURN,
    INITIAL_ENERGY,
    MAX_ENERGY,
    MAX_TEAM_SIZE,
    MIN_STAT_FACTOR,
} from './constants';
import { GameRuleError } from './errors';
import { nextRandom } from './rng';
import type {
    AvailableAction,
    BattleAction,
    BattleEvent,
    BattleResult,
    BattleState,
    BattleUnit,
    CharacterDefinition,
    FormDefinition,
    PassiveCondition,
    PassiveDefinition,
    PassiveEffect,
    SkillDefinition,
    SkillEffect,
    SkillPreview,
    Stats,
    StatusEffect,
    StatusKind,
    TeamId,
} from './types';

/**
 * O motor de batalha.
 *
 * As duas funções principais são puras: recebem dados e devolvem dados novos,
 * sem alterar o que receberam e sem tocar em banco, rede ou relógio.
 *
 *   createBattle(times)        -> estado inicial + eventos
 *   applyAction(estado, ação)  -> novo estado + eventos
 *
 * Dois nomes para não confundir:
 *
 *   - TURNO: uma rodada inteira. Cada unidade viva age uma vez, e só então o
 *     número do turno sobe. A batalha começa no turno 1.
 *   - VEZ: o momento de UMA unidade dentro do turno.
 *
 * No começo de cada turno a ordem é definida: mais veloz primeiro. Se duas
 * unidades têm a mesma velocidade, a sorte decide quem vai antes, e o sorteio
 * é refeito a cada turno. A ordem fica guardada em `state.order`.
 *
 * Se a velocidade de alguém mudar no meio do turno, a mudança vale na hora:
 * quem ainda não agiu é reordenado (quem já agiu não age de novo).
 *
 * A energia também é por turno: no começo de cada um, os dois times recebem
 * a energia daquele turno (3 no turno 1, mais 1 a cada turno, até 10). O que
 * sobrou do turno anterior não acumula.
 *
 * O ciclo de uma vez:
 *   1. chega a vez da unidade;
 *   2. queimadura e veneno causam dano;
 *   3. se a unidade está atordoada, perde a vez (volta ao passo 1 com a próxima);
 *   4. a passiva de começo de vez da unidade age, se ela tiver uma;
 *   5. a unidade age (applyAction);
 *   6. termina a vez: os status dela gastam um turno de duração.
 *
 * Quem tem a passiva de ação extra e se transforma no passo 5 repete o passo
 * 5 antes do 6: age de novo, já na forma nova.
 *
 * Passivas: cada unidade tem as suas (`unit.passives`). Ninguém as usa; o
 * motor as aplica sozinho. A maioria muda os golpes da própria unidade (ver
 * `getHitModifiers`); as de começo de vez agem no passo 4.
 */

export interface BattleSetup {
    teamA: CharacterDefinition[];
    teamB: CharacterDefinition[];
    /** Semente dos números aleatórios. Passe um valor fixo para repetir a mesma batalha. */
    seed?: number;
}

type StatusSkillEffect = Extract<SkillEffect, { type: 'status' }>;

/** Qual atributo cada modificador mexe, e para que lado. */
const STAT_MODIFIERS: Partial<Record<StatusKind, { stat: 'atk' | 'def' | 'speed'; sign: 1 | -1 }>> = {
    atk_up: { stat: 'atk', sign: 1 },
    atk_down: { stat: 'atk', sign: -1 },
    def_up: { stat: 'def', sign: 1 },
    def_down: { stat: 'def', sign: -1 },
    speed_up: { stat: 'speed', sign: 1 },
    speed_down: { stat: 'speed', sign: -1 },
};

/** Os status que atrapalham quem os carrega. São os que a purificação (efeito 'cleanse') remove. */
export const NEGATIVE_STATUSES: StatusKind[] = ['stun', 'burn', 'poison', 'bleed', 'heal_down', 'atk_down', 'def_down', 'speed_down'];

/** Os status que causam dano no começo da vez de quem os carrega. */
export const DAMAGE_STATUSES: StatusKind[] = ['burn', 'poison', 'bleed'];

/** O id da forma original de quem se transforma, em `unit.baseForm`. */
export const BASE_FORM = 'base';

/** Limite de segurança para o laço de "quem joga a seguir". */
const MAX_SKIPPED_ACTIVATIONS = 1000;

// ---------------------------------------------------------------------------
// Consultas (não alteram nada)
// ---------------------------------------------------------------------------

export function isAlive(unit: BattleUnit): boolean {
    return unit.hp > 0;
}

export function getUnit(state: BattleState, unitId: string): BattleUnit {
    const unit = state.units.find((u) => u.id === unitId);

    if (!unit) {
        throw new GameRuleError('UNIT_NOT_FOUND', `Unidade não encontrada: ${unitId}`);
    }

    return unit;
}

export function getActiveUnit(state: BattleState): BattleUnit | null {
    return state.activeUnitId === null ? null : getUnit(state, state.activeUnitId);
}

/**
 * Os status de uma unidade. Batalhas gravadas antes de os status existirem
 * não têm o campo no JSON, por isso o `?? []`.
 */
export function getStatuses(unit: BattleUnit): StatusEffect[] {
    return unit.statuses ?? [];
}

export function hasStatus(unit: BattleUnit, kind: StatusKind): boolean {
    return getStatuses(unit).some((status) => status.kind === kind);
}

/** Um cadáver: unidade derrotada que ainda pode ser erguida. Uma invocação que cai não deixa cadáver. */
export function isCorpse(unit: BattleUnit): boolean {
    return !isAlive(unit) && !unit.summoned;
}

/**
 * Por quanto a cura que a unidade recebe é multiplicada: 1 normalmente, menos
 * com o status heal_down (0.6 de redução = recebe 40% da cura).
 */
export function getHealingFactor(unit: BattleUnit): number {
    const reduction = getStatuses(unit).find((status) => status.kind === 'heal_down')?.value ?? 0;

    return Math.max(0, 1 - reduction);
}

/** As passivas de uma unidade. Batalhas gravadas antes de elas existirem não têm o campo. */
export function getPassives(unit: BattleUnit): PassiveDefinition[] {
    return unit.passives ?? [];
}

/** Todos os efeitos de passiva de uma unidade, um a um, cada qual com a passiva de que faz parte. */
function getPassiveEffects(unit: BattleUnit): { passive: PassiveDefinition; effect: PassiveEffect }[] {
    return getPassives(unit).flatMap((passive) => [passive.effect, ...(passive.also ?? [])].map((effect) => ({ passive, effect })));
}

function meets(condition: PassiveCondition | undefined, target: BattleUnit): boolean {
    if (!condition) {
        return true;
    }

    switch (condition.type) {
        case 'target_has_status':
            return condition.statuses.some((kind) => hasStatus(target, kind));
        case 'target_hp_below':
            return target.hp < target.stats.maxHp * condition.ratio;
        case 'target_hp_above':
            return target.hp > target.stats.maxHp * condition.ratio;
    }
}

/** O que as passivas de quem bate mudam num golpe. */
interface HitModifiers {
    /** Fração somada ao dano (0.3 = +30%). */
    damageBonus: number;
    /** Somado à chance de crítico. */
    critChanceBonus: number;
    /** Fração da defesa do alvo que o golpe ignora. */
    ignoreDefense: number;
    /** Fração do dano causado que volta como vida. */
    lifesteal: number;
    /** Energia que o time recupera se o golpe for crítico. */
    energyOnCrit: number;
    /** Status que o golpe também aplica no alvo, depois do dano. */
    statusOnHit: StatusSkillEffect[];
    /** As passivas que só valeram por causa deste alvo: são as que a tela anuncia. */
    announced: PassiveDefinition[];
}

/**
 * Junta o que as passivas de `attacker` fazem num golpe. Com `target`, conta
 * também as que dependem do alvo; sem ele (na prévia da habilidade), só as
 * que valem sempre.
 */
function getHitModifiers(attacker: BattleUnit, target?: BattleUnit): HitModifiers {
    const modifiers: HitModifiers = {
        damageBonus: 0,
        critChanceBonus: 0,
        ignoreDefense: 0,
        lifesteal: 0,
        energyOnCrit: 0,
        statusOnHit: [],
        announced: [],
    };

    for (const { passive, effect } of getPassiveEffects(attacker)) {
        switch (effect.type) {
            case 'damage_bonus':
            case 'crit_chance_bonus': {
                if (effect.when && (!target || !meets(effect.when, target))) {
                    break;
                }

                if (effect.type === 'damage_bonus') modifiers.damageBonus += effect.amount;
                else modifiers.critChanceBonus += effect.amount;

                if (effect.when) modifiers.announced.push(passive);

                break;
            }

            case 'ignore_defense':
                modifiers.ignoreDefense += effect.amount;
                break;

            case 'lifesteal':
                modifiers.lifesteal += effect.amount;
                break;

            case 'energy_on_crit':
                modifiers.energyOnCrit += effect.amount;
                break;

            case 'status_on_hit':
                modifiers.statusOnHit.push({
                    type: 'status',
                    status: effect.status,
                    turns: effect.turns,
                    power: effect.power,
                    ...(effect.chance !== undefined && { chance: effect.chance }),
                });
                break;

            // Cada carga acumulada soma ao dano. Vale em todo golpe: entra na prévia e não é anunciada aqui.
            case 'damage_per_drain':
                modifiers.damageBonus += effect.amount * (attacker.passiveStacks ?? 0);
                break;

            // Quanto mais ferida, mais forte: 1 ponto de bônus por ponto inteiro
            // de porcentagem da vida que falta.
            case 'damage_per_missing_hp':
                modifiers.damageBonus += (effect.amount * getMissingHpPercent(attacker)) / 100;
                break;

            // Não mudam o golpe aqui: entram no ataque (getAttackStats), no
            // valor dos status ou no começo da vez.
            case 'atk_from_def':
            case 'status_power':
            case 'status_growth':
            case 'extra_action_on_transform':
            case 'count_corpses':
            case 'turn_start':
                break;
        }
    }

    return modifiers;
}

/**
 * Quantos por cento da vida máxima a unidade já perdeu, em pontos inteiros
 * (0 a 100). A conta é feita com inteiros para não escorregar no arredondamento.
 */
export function getMissingHpPercent(unit: BattleUnit): number {
    return Math.max(0, Math.floor(((unit.stats.maxHp - unit.hp) * 100) / unit.stats.maxHp));
}

/**
 * Os atributos com que a unidade bate: os de `getEffectiveStats` mais o que
 * as passivas dela somam ao ataque dos golpes. Cura e status continuam usando
 * o ataque sem esse acréscimo.
 */
export function getAttackStats(unit: BattleUnit): Stats {
    const stats = getEffectiveStats(unit);
    let atk = stats.atk;

    for (const { effect } of getPassiveEffects(unit)) {
        if (effect.type === 'atk_from_def') {
            atk += stats.def * effect.amount;
        }
    }

    return { ...stats, atk };
}

/**
 * Atributos da unidade já com bônus e penalidades de status.
 * Todo cálculo de combate usa estes valores, nunca `unit.stats` direto.
 */
export function getEffectiveStats(unit: BattleUnit): Stats {
    const factor = { atk: 1, def: 1, speed: 1 };

    for (const status of getStatuses(unit)) {
        const modifier = STAT_MODIFIERS[status.kind];

        if (modifier) {
            factor[modifier.stat] += modifier.sign * status.value;
        }
    }

    return {
        ...unit.stats,
        atk: unit.stats.atk * Math.max(MIN_STAT_FACTOR, factor.atk),
        def: unit.stats.def * Math.max(MIN_STAT_FACTOR, factor.def),
        speed: unit.stats.speed * Math.max(MIN_STAT_FACTOR, factor.speed),
    };
}

/**
 * Dano = ATK x poder da habilidade, reduzido pela defesa do alvo.
 *
 * A redução é 100 / (100 + DEF): com 100 de DEF o alvo leva metade, com 300
 * leva um quarto. A defesa nunca zera o dano e cada ponto vale um pouco menos
 * que o anterior, o que evita personagens "imortais".
 */
export function calculateDamage(
    attacker: Stats,
    defender: Stats,
    power: number,
    critical: boolean,
    /** Tudo o que multiplica o dano por fora: a fúria e o bônus das passivas. */
    multiplier = 1,
): number {
    const raw = attacker.atk * power;
    const mitigation = 100 / (100 + defender.def);
    const critMultiplier = critical ? attacker.critDamage : 1;

    return Math.max(1, Math.round(raw * mitigation * critMultiplier * multiplier));
}

/**
 * O dano de um golpe antes da defesa do alvo e sem crítico: ATK x poder (x
 * fúria). É o número que a tela mostra na descrição da habilidade.
 */
export function calculateBaseDamage(attacker: Stats, power: number, multiplier = 1): number {
    return Math.max(1, Math.round(attacker.atk * power * multiplier));
}

/**
 * Multiplicador de dano da fúria no turno informado: 1 até FURY_START_TURN,
 * depois cresce a cada turno. Garante que toda batalha termina.
 */
export function getFuryMultiplier(turn: number): number {
    return 1 + getFuryBonus(turn);
}

/**
 * Quanto a fúria aumenta o dano no turno informado, como fração: 0 enquanto
 * ela não começou, 0.5 = +50%, 1 = +100%... É o número que a tela mostra.
 */
export function getFuryBonus(turn: number): number {
    return Math.max(0, turn - FURY_START_TURN) * FURY_DAMAGE_PER_TURN;
}

/**
 * A energia com que cada time começa o turno informado: INITIAL_ENERGY no
 * turno 1, crescendo a cada turno até MAX_ENERGY.
 */
export function getTurnEnergy(turn: number): number {
    return Math.min(MAX_ENERGY, INITIAL_ENERGY + Math.max(0, turn - 1) * ENERGY_GROWTH_PER_TURN);
}

export function calculateHeal(caster: Stats, power: number): number {
    return Math.max(1, Math.round(caster.atk * power));
}

/** O `value` que um status terá ao ser aplicado por quem tem os atributos `caster`. */
export function calculateStatusValue(caster: Stats, effect: StatusSkillEffect): number {
    switch (effect.status) {
        case 'burn':
        case 'poison':
        case 'bleed':
        case 'shield':
            return Math.max(1, Math.round(caster.atk * effect.power));
        case 'stun':
            return 0;
        default:
            return effect.power;
    }
}

/**
 * Quanto um status de dano por turno causa na próxima vez de quem o carrega.
 * Normalmente é o próprio valor; num status que cresce, o valor original mais
 * `growth` dele para cada vez que já causou dano.
 */
export function getStatusTickDamage(status: StatusEffect): number {
    return Math.max(1, Math.round(status.value * (1 + (status.growth ?? 0) * (status.ticks ?? 0))));
}

/** O que a unidade da vez pode fazer agora. */
export function getAvailableActions(state: BattleState): AvailableAction[] {
    const actor = getActiveUnit(state);

    if (!actor) {
        return [];
    }

    return actor.skills.map((skill) => {
        const targetIds = getCandidateTargets(state, actor, skill).map((u) => u.id);
        const hasEnergy = state.energy[actor.team] >= skill.energyCost;

        return {
            skill,
            preview: previewSkill(state, actor, skill),
            usable: hasEnergy && targetIds.length > 0,
            requiresTarget: requiresTarget(skill),
            targetIds,
        };
    });
}

/**
 * Quanto a habilidade causaria (ou curaria) em cada alvo se `actor` a usasse
 * agora, sem contar a defesa de ninguém. Se a habilidade tiver mais de um
 * efeito de dano (ou de cura), eles são somados.
 */
export function previewSkill(state: BattleState, actor: BattleUnit, skill: SkillDefinition): SkillPreview {
    const stats = getEffectiveStats(actor);
    // Só as passivas que valem em qualquer golpe: as que dependem do alvo não entram na prévia.
    const multiplier = getFuryMultiplier(state.turn) * (1 + getHitModifiers(actor).damageBonus);
    let damage: number | null = null;
    let heal: number | null = null;

    for (const effect of skill.effects) {
        if (effect.type === 'damage') {
            damage = (damage ?? 0) + calculateBaseDamage(getAttackStats(actor), effect.power, multiplier);
        } else if (effect.type === 'heal') {
            heal = (heal ?? 0) + calculateHeal(stats, effect.power);
        }
    }

    return { damage, heal };
}

// ---------------------------------------------------------------------------
// Criar a batalha
// ---------------------------------------------------------------------------

export function createBattle(setup: BattleSetup): BattleResult {
    // Este é o único ponto em que o acaso "de verdade" entra no jogo: se
    // ninguém informar a semente, sorteamos uma. Daí em diante tudo é
    // determinado por ela.
    const seed = setup.seed ?? Math.floor(Math.random() * 0x100000000);

    const state: BattleState = {
        units: [...buildTeam('A', setup.teamA), ...buildTeam('B', setup.teamB)],
        energy: { A: 0, B: 0 },
        turnEnergy: 0,
        activeUnitId: null,
        turn: 0,
        order: [],
        draws: {},
        step: 0,
        winner: null,
        rngState: seed >>> 0,
    };

    // Não há ordem ainda, então isto abre o turno 1 e chama a primeira unidade.
    const events: BattleEvent[] = [];
    activateNext(state, events);

    return { state, events };
}

function buildTeam(team: TeamId, characters: CharacterDefinition[]): BattleUnit[] {
    if (characters.length < 1 || characters.length > MAX_TEAM_SIZE) {
        throw new GameRuleError('INVALID_SETUP', `Um time precisa ter de 1 a ${MAX_TEAM_SIZE} personagens`);
    }

    return characters.map((character, index) => {
        if (character.stats.maxHp <= 0 || character.stats.speed <= 0 || character.skills.length === 0) {
            throw new GameRuleError('INVALID_SETUP', `Personagem inválido: ${character.id}`);
        }

        return {
            id: `${team}${index + 1}`,
            characterId: character.id,
            name: character.name,
            team,
            // structuredClone garante que a batalha não compartilha objetos
            // com o catálogo: mexer em um não afeta o outro.
            stats: structuredClone(character.stats),
            hp: character.stats.maxHp,
            statuses: [],
            skills: structuredClone(character.skills),
            passives: structuredClone(character.passives ?? []),
            ...(character.summons?.length && { summons: structuredClone(character.summons) }),
            // Quem se transforma leva junto as formas e a original, para voltar.
            ...(character.forms?.length && {
                forms: structuredClone(character.forms),
                baseForm: structuredClone({
                    id: BASE_FORM,
                    name: character.name,
                    stats: character.stats,
                    skills: character.skills,
                    passives: character.passives ?? [],
                }),
            }),
        };
    });
}

// ---------------------------------------------------------------------------
// Resolver uma ação
// ---------------------------------------------------------------------------

export function applyAction(current: BattleState, action: BattleAction): BattleResult {
    if (current.winner !== null) {
        throw new GameRuleError('BATTLE_OVER', 'A batalha já terminou');
    }

    // Trabalhamos numa cópia. O estado recebido fica intacto, então se
    // qualquer validação abaixo falhar nada foi alterado pela metade.
    const state = structuredClone(current);
    const events: BattleEvent[] = [];

    for (const unit of state.units) {
        unit.statuses = getStatuses(unit);
    }

    // 1. Validar
    const actor = getUnit(state, action.unitId);

    if (state.activeUnitId !== actor.id) {
        throw new GameRuleError('NOT_YOUR_TURN', `Não é a vez de ${actor.name}`);
    }

    const skill = actor.skills.find((s) => s.id === action.skillId);

    if (!skill) {
        throw new GameRuleError('SKILL_NOT_FOUND', `${actor.name} não tem a habilidade ${action.skillId}`);
    }

    if (state.energy[actor.team] < skill.energyCost) {
        throw new GameRuleError('NOT_ENOUGH_ENERGY', `Energia insuficiente para ${skill.name}`);
    }

    const targets = resolveTargets(state, actor, skill, action.targetId);

    // Habilidade sem ninguém para atingir (erguer um cadáver sem cadáver no time) não pode ser usada.
    if (targets.length === 0) {
        throw new GameRuleError('INVALID_TARGET', `${skill.name} não tem alvo`);
    }

    // 2. Pagar o custo
    state.energy[actor.team] -= skill.energyCost;

    events.push({
        type: 'skill_used',
        unitId: actor.id,
        skillId: skill.id,
        targetIds: targets.map((t) => t.id),
        team: actor.team,
        energy: state.energy[actor.team],
    });

    // 3. Aplicar os efeitos, na ordem em que aparecem na habilidade
    const stacksBefore = actor.passiveStacks ?? 0;
    // A passiva de ação extra é a da forma em que a unidade está ANTES de se transformar.
    const extraOnTransform = getPassiveEffects(actor).some(({ effect }) => effect.type === 'extra_action_on_transform');
    const formBefore = actor.form;

    for (const effect of skill.effects) {
        const receivers = effect.type === 'status' && effect.to === 'self' ? [actor] : targets;

        for (const receiver of receivers) {
            applyEffect(state, actor, receiver, effect, events);
        }
    }

    announceStacks(actor, stacksBefore, events);

    // Ação extra: quem se transformou agora (e tem a passiva) não encerra a
    // vez. Passa a valer uma "vez" nova da mesma unidade (o relógio anda, para
    // a trava contra jogada dupla e para a transformação contar este turno),
    // sem dano de status nem passiva de começo de vez de novo.
    if (extraOnTransform && actor.form !== formBefore && isAlive(actor) && findWinner(state) === null) {
        state.step += 1;
        events.push({ type: 'extra_action', unitId: actor.id });
        reorderWaiting(state, events);

        return { state, events };
    }

    // 4. Encerrar a vez de quem jogou
    endActivation(state, actor, events);

    // 5. Acabou? Senão, a habilidade pode ter mudado a velocidade de alguém:
    //    reordenar quem ainda não agiu e chamar a próxima unidade (ou abrir
    //    um turno novo).
    const winner = findWinner(state);

    if (winner) {
        finishBattle(state, winner, events);
    } else {
        reorderWaiting(state, events);
        activateNext(state, events);
    }

    return { state, events };
}

/**
 * Um time desiste: a batalha termina na hora, com vitória do outro time.
 * Pode acontecer a qualquer momento, mesmo fora da vez de quem desiste.
 * As unidades ficam como estavam: ninguém é derrotado pela desistência.
 */
export function surrender(current: BattleState, team: TeamId): BattleResult {
    if (current.winner !== null) {
        throw new GameRuleError('BATTLE_OVER', 'A batalha já terminou');
    }

    const state = structuredClone(current);
    const events: BattleEvent[] = [{ type: 'surrendered', team }];

    state.surrenderedBy = team;
    finishBattle(state, team === 'A' ? 'B' : 'A', events);

    return { state, events };
}

function requiresTarget(skill: SkillDefinition): boolean {
    return skill.target === 'single-enemy' || skill.target === 'single-ally';
}

/**
 * Todas as unidades que a habilidade PODE atingir (apenas vivas).
 *
 * Provocação: se algum inimigo está provocando, as habilidades de alvo único
 * só podem mirar em quem provoca. Golpes em área continuam pegando todos.
 */
function getCandidateTargets(state: BattleState, actor: BattleUnit, skill: SkillDefinition): BattleUnit[] {
    switch (skill.target) {
        case 'single-enemy': {
            const enemies = state.units.filter((u) => u.team !== actor.team && isAlive(u));
            const taunting = enemies.filter((u) => hasStatus(u, 'taunt'));

            return taunting.length > 0 ? taunting : enemies;
        }
        case 'all-enemies':
            return state.units.filter((u) => u.team !== actor.team && isAlive(u));
        case 'single-ally':
        case 'all-allies':
            return state.units.filter((u) => u.team === actor.team && isAlive(u));
        case 'self':
            return [actor];
        // Um cadáver por vez: o primeiro aliado derrotado que ainda não foi erguido.
        case 'corpse':
            return state.units.filter((u) => u.team === actor.team && isCorpse(u)).slice(0, 1);
    }
}

/** As unidades que a habilidade VAI atingir nesta ação. */
function resolveTargets(
    state: BattleState,
    actor: BattleUnit,
    skill: SkillDefinition,
    targetId: string | undefined,
): BattleUnit[] {
    const candidates = getCandidateTargets(state, actor, skill);

    if (!requiresTarget(skill)) {
        return candidates;
    }

    if (targetId === undefined) {
        throw new GameRuleError('TARGET_REQUIRED', `${skill.name} precisa de um alvo`);
    }

    const target = candidates.find((u) => u.id === targetId);

    if (!target) {
        throw new GameRuleError('INVALID_TARGET', `Alvo inválido para ${skill.name}: ${targetId}`);
    }

    return [target];
}

function applyEffect(
    state: BattleState,
    actor: BattleUnit,
    target: BattleUnit,
    effect: SkillEffect,
    events: BattleEvent[],
): void {
    // Erguer um cadáver é o único efeito que age sobre uma unidade derrotada.
    if (effect.type === 'summon') {
        raiseCorpse(state, actor, target, effect.summon, events);

        return;
    }

    // Um alvo pode ter morrido para um efeito anterior da mesma habilidade.
    if (!isAlive(target)) {
        return;
    }

    switch (effect.type) {
        case 'damage': {
            const modifiers = getHitModifiers(actor, target);

            // Uma passiva que só valeu por causa do alvo é anunciada antes do
            // dano que ela mudou, uma vez por ação.
            for (const passive of modifiers.announced) {
                announcePassive(actor, passive, [target.id], events);
            }

            // Sempre um sorteio por golpe, com ou sem passiva: a sequência de
            // números aleatórios da batalha não depende de quem tem o quê.
            const critical = rollChance(state, actor.stats.critChance + modifiers.critChanceBonus);
            const defender = getEffectiveStats(target);
            // Golpe de execução: quanto mais vida o alvo já perdeu, mais forte.
            const executeBonus = ((effect.perTargetMissingHp ?? 0) * getMissingHpPercent(target)) / 100;
            const amount = calculateDamage(
                getAttackStats(actor),
                { ...defender, def: defender.def * Math.max(0, 1 - modifiers.ignoreDefense) },
                effect.power,
                critical,
                getFuryMultiplier(state.turn) * (1 + modifiers.damageBonus + executeBonus),
            );
            const absorbed = absorbWithShield(target, amount);
            const lost = Math.min(target.hp, amount - absorbed);

            target.hp -= lost;
            events.push({
                type: 'damage',
                sourceId: actor.id,
                targetId: target.id,
                amount,
                absorbed,
                critical,
                hp: target.hp,
            });

            if (absorbed > 0) {
                if (!hasStatus(target, 'shield')) {
                    events.push({ type: 'status_expired', unitId: target.id, status: 'shield' });
                }

                pushStatusesChanged(target, events);
            }

            // Roubo de vida: quem bateu recupera uma fração do que o alvo
            // perdeu. O da habilidade e o da passiva se somam.
            const drain = (effect.drain ?? 0) + modifiers.lifesteal;

            if (drain > 0 && lost > 0) {
                const healed = Math.min(actor.stats.maxHp - actor.hp, Math.round(lost * drain * getHealingFactor(actor)));

                if (healed > 0) {
                    actor.hp += healed;
                    events.push({ type: 'heal', sourceId: actor.id, targetId: actor.id, amount: healed, hp: actor.hp });
                    gainDrainStack(actor);
                }
            }

            // Passiva de energia: o acerto crítico devolve energia ao time.
            if (critical && modifiers.energyOnCrit > 0) {
                gainEnergy(state, actor, modifiers.energyOnCrit, events);
            }

            if (!isAlive(target)) {
                defeat(state, target, events);

                return;
            }

            // Passiva de status no golpe: o alvo que ficou de pé recebe o
            // status. Se já tem o mesmo status mais forte, fica o que tem.
            for (const onHit of modifiers.statusOnHit) {
                const current = target.statuses.find((status) => status.kind === onHit.status);

                if (!current || current.value <= calculateStatusValue(getEffectiveStats(actor), onHit)) {
                    applyEffect(state, actor, target, onHit, events);
                }
            }

            return;
        }

        case 'heal': {
            const missing = target.stats.maxHp - target.hp;
            // Com a cura reduzida (heal_down), o alvo recebe só uma parte.
            const amount = Math.min(missing, Math.round(calculateHeal(getEffectiveStats(actor), effect.power) * getHealingFactor(target)));

            target.hp += amount;
            events.push({ type: 'heal', sourceId: actor.id, targetId: target.id, amount, hp: target.hp });

            return;
        }

        case 'status': {
            // Só sorteia quando a habilidade tem chance: efeitos garantidos
            // não gastam números aleatórios.
            if (effect.chance !== undefined && !rollChance(state, effect.chance)) {
                return;
            }

            // Status que cresce: se o alvo já carrega o mesmo status crescendo,
            // renovar não zera a conta (e o crescimento continua mesmo que quem
            // renove não tenha a passiva).
            const previous = target.statuses.find((s) => s.kind === effect.status);
            const growth = Math.max(getStatusGrowth(actor, effect.status), previous?.growth ?? 0);

            const status: StatusEffect = {
                kind: effect.status,
                turns: effect.turns,
                value: withStatusPower(actor, effect.status, calculateStatusValue(getEffectiveStats(actor), effect)),
                sourceId: actor.id,
                ...(growth > 0 && { growth, ticks: previous?.ticks ?? 0 }),
                appliedOnStep: state.step,
            };

            // Um de cada tipo por unidade: reaplicar substitui o anterior.
            target.statuses = [...target.statuses.filter((s) => s.kind !== status.kind), status];

            events.push({
                type: 'status_applied',
                sourceId: actor.id,
                targetId: target.id,
                status: status.kind,
                turns: status.turns,
                value: status.value,
            });
            pushStatusesChanged(target, events);

            return;
        }

        case 'cleanse': {
            const removed = target.statuses.filter((status) => NEGATIVE_STATUSES.includes(status.kind)).map((status) => status.kind);

            // Nada a tirar: a purificação passa em branco, sem evento.
            if (removed.length === 0) {
                return;
            }

            target.statuses = target.statuses.filter((status) => !NEGATIVE_STATUSES.includes(status.kind));
            events.push({ type: 'cleansed', sourceId: actor.id, targetId: target.id, statuses: removed });
            pushStatusesChanged(target, events);

            return;
        }

        case 'transform': {
            setForm(target, effect.form, events);

            // O prazo da forma é um status: a tela mostra quanto falta e, quando
            // ele acaba (endActivation), a unidade volta à forma original.
            target.statuses = [
                ...target.statuses.filter((status) => status.kind !== 'form'),
                { kind: 'form', turns: effect.turns, value: 0, sourceId: actor.id, appliedOnStep: state.step },
            ];
            pushStatusesChanged(target, events);

            return;
        }
    }
}

/**
 * Ergue o cadáver `corpse` como a invocação `summonId` de `actor`. A unidade
 * derrotada dá lugar a uma unidade nova no mesmo lugar do time (mesmo id),
 * com a vida cheia e sem nada do que ela era: atributos, habilidades e
 * passivas são os da invocação.
 *
 * A invocação entra na fila de ação do turno em que é erguida: vai para o
 * meio de quem ainda não agiu, no lugar que a velocidade dela der (com um
 * sorteio próprio para os empates). Vale mesmo que o aliado derrotado já
 * tivesse agido neste turno: a invocação é outra unidade.
 */
function raiseCorpse(state: BattleState, actor: BattleUnit, corpse: BattleUnit, summonId: string, events: BattleEvent[]): void {
    const summon = actor.summons?.find((item) => item.id === summonId);

    if (!summon) {
        throw new Error(`${actor.name} não tem a invocação ${summonId}`);
    }

    if (!isCorpse(corpse)) {
        return;
    }

    const raised: BattleUnit = {
        id: corpse.id,
        characterId: summon.id,
        name: summon.name,
        team: corpse.team,
        stats: structuredClone(summon.stats),
        hp: summon.stats.maxHp,
        statuses: [],
        skills: structuredClone(summon.skills),
        passives: structuredClone(summon.passives),
        summoned: true,
    };

    state.units = state.units.map((unit) => (unit.id === corpse.id ? raised : unit));
    events.push({ type: 'summoned', sourceId: actor.id, unitId: raised.id, unit: structuredClone(raised) });

    // Sai de onde o cadáver estava na fila (se estava) e entra entre os que
    // ainda vão agir; reorderWaiting põe no lugar certo pela velocidade.
    const before = state.order;

    state.order = [...before.filter((unitId) => unitId !== raised.id), raised.id];
    state.draws[raised.id] = roll(state);
    reorderWaiting(state, []);
    events.push({ type: 'order_changed', order: [...state.order] });

    syncCorpseCounts(state, raised.team, events);
}

/**
 * Atualiza a conta de cadáveres de quem tem a passiva count_corpses no time
 * (o número fica em `passiveStacks`) e avisa a tela quando ele muda.
 */
function syncCorpseCounts(state: BattleState, team: TeamId, events: BattleEvent[]): void {
    const corpses = state.units.filter((unit) => unit.team === team && isCorpse(unit)).length;

    for (const unit of state.units) {
        if (unit.team !== team || !isAlive(unit)) continue;

        for (const { passive, effect } of getPassiveEffects(unit)) {
            if (effect.type === 'count_corpses' && (unit.passiveStacks ?? 0) !== corpses) {
                unit.passiveStacks = corpses;
                events.push({ type: 'passive_triggered', unitId: unit.id, passiveId: passive.id, targetIds: [], stacks: corpses });
            }
        }
    }
}

/**
 * Põe a unidade numa forma (`null` = de volta à original): atributos,
 * habilidades e passivas passam a ser os da forma. A vida mantém a proporção
 * que tinha (metade da vida de humano vira metade da vida de urso).
 */
function setForm(unit: BattleUnit, formId: string | null, events: BattleEvent[]): void {
    const form: FormDefinition | undefined = formId === null ? unit.baseForm : unit.forms?.find((item) => item.id === formId);

    if (!form) {
        throw new Error(`${unit.name} não tem a forma ${formId ?? BASE_FORM}`);
    }

    const ratio = unit.hp / unit.stats.maxHp;

    unit.stats = structuredClone(form.stats);
    unit.skills = structuredClone(form.skills);
    unit.passives = structuredClone(form.passives);
    unit.hp = Math.max(1, Math.round(ratio * unit.stats.maxHp));

    if (formId === null) {
        delete unit.form;
    } else {
        unit.form = formId;
    }

    events.push({ type: 'transformed', unitId: unit.id, form: formId, hp: unit.hp });
}

/** Avisa que a passiva agiu. Uma passiva de golpe avisa uma vez por ação, mesmo acertando vários alvos. */
function announcePassive(unit: BattleUnit, passive: PassiveDefinition, targetIds: string[], events: BattleEvent[]): void {
    const already = events.some((event) => event.type === 'passive_triggered' && event.unitId === unit.id && event.passiveId === passive.id);

    if (!already) {
        events.push({ type: 'passive_triggered', unitId: unit.id, passiveId: passive.id, targetIds });
    }
}

/**
 * A unidade recuperou vida com roubo de vida: se a passiva dela acumula
 * cargas com isso, ganha uma (até o limite da passiva). A carga já vale para
 * o próximo golpe, mesmo dentro da mesma habilidade.
 */
function gainDrainStack(unit: BattleUnit): void {
    for (const { effect } of getPassiveEffects(unit)) {
        if (effect.type === 'damage_per_drain') {
            unit.passiveStacks = Math.min(effect.max ?? Infinity, (unit.passiveStacks ?? 0) + 1);
        }
    }
}

/** Avisa a tela, uma vez por ação, que a passiva de `unit` ganhou cargas e quantas ela tem agora. */
function announceStacks(unit: BattleUnit, stacksBefore: number, events: BattleEvent[]): void {
    const stacks = unit.passiveStacks ?? 0;

    if (stacks === stacksBefore) {
        return;
    }

    for (const { passive, effect } of getPassiveEffects(unit)) {
        if (effect.type === 'damage_per_drain') {
            events.push({ type: 'passive_triggered', unitId: unit.id, passiveId: passive.id, targetIds: [], stacks });
        }
    }
}

/** O valor de um status aplicado por `actor`, com o aumento que as passivas dele dão a esse tipo de status. */
function withStatusPower(actor: BattleUnit, kind: StatusKind, value: number): number {
    let factor = 1;

    for (const { effect } of getPassiveEffects(actor)) {
        if (effect.type === 'status_power' && effect.statuses.includes(kind)) {
            factor += effect.amount;
        }
    }

    return factor === 1 ? value : Math.round(value * factor);
}

/** Quanto o dano por turno de um status aplicado por `actor` cresce a cada turno (0 = não cresce). */
function getStatusGrowth(actor: BattleUnit, kind: StatusKind): number {
    let growth = 0;

    for (const { effect } of getPassiveEffects(actor)) {
        if (effect.type === 'status_growth' && effect.statuses.includes(kind)) {
            growth += effect.amount;
        }
    }

    return growth;
}

/**
 * O time de `unit` recupera energia no meio do turno, até o máximo do jogo.
 * Pode passar da energia com que o turno começou; no turno seguinte ela volta
 * ao valor normal, como sempre.
 */
function gainEnergy(state: BattleState, unit: BattleUnit, amount: number, events: BattleEvent[]): void {
    const gained = Math.min(amount, MAX_ENERGY - state.energy[unit.team]);

    if (gained <= 0) {
        return;
    }

    state.energy[unit.team] += gained;

    for (const { passive, effect } of getPassiveEffects(unit)) {
        if (effect.type === 'energy_on_crit') {
            announcePassive(unit, passive, [], events);
        }
    }

    events.push({ type: 'energy_gained', team: unit.team, unitId: unit.id, amount: gained, energy: state.energy[unit.team] });
}

/**
 * As passivas de começo de vez de `unit`: aplicam os efeitos delas no alvo
 * indicado, como uma habilidade sem custo que ninguém escolheu.
 *
 * - all-allies: os aliados vivos. Se a passiva só cura, quem está com a vida
 *   cheia fica de fora (e, se ninguém precisa, ela nem é anunciada).
 * - fastest-enemy: o inimigo vivo mais veloz agora.
 *
 * Se a unidade carrega o status passive_up, a cura e o dano da passiva saem
 * mais fortes (o valor do status é a fração: 0.8 = 80% a mais). Os status que
 * a passiva aplica não mudam.
 */
function applyTurnStartPassives(state: BattleState, unit: BattleUnit, events: BattleEvent[]): void {
    for (const { passive, effect } of getPassiveEffects(unit)) {
        if (effect.type !== 'turn_start' || !isAlive(unit)) {
            continue;
        }

        let targets: BattleUnit[];

        if (effect.target === 'all-allies') {
            const onlyHeals = effect.effects.every((item) => item.type === 'heal');

            targets = state.units.filter((ally) => ally.team === unit.team && isAlive(ally) && (!onlyHeals || ally.hp < ally.stats.maxHp));
        } else {
            targets = sortBySpeed(state, state.units.filter((enemy) => enemy.team !== unit.team && isAlive(enemy))).slice(0, 1);
        }

        if (targets.length === 0) {
            continue;
        }

        events.push({ type: 'passive_triggered', unitId: unit.id, passiveId: passive.id, targetIds: targets.map((target) => target.id) });

        const boost = 1 + (getStatuses(unit).find((status) => status.kind === 'passive_up')?.value ?? 0);

        for (const item of effect.effects) {
            const boosted = item.type === 'damage' || item.type === 'heal' ? { ...item, power: item.power * boost } : item;

            for (const target of item.type === 'status' && item.to === 'self' ? [unit] : targets) {
                applyEffect(state, unit, target, boosted, events);
            }
        }
    }
}

/** Desconta o dano do escudo do alvo e devolve quanto foi absorvido. */
function absorbWithShield(target: BattleUnit, damage: number): number {
    const shield = target.statuses.find((status) => status.kind === 'shield');

    if (!shield) {
        return 0;
    }

    const absorbed = Math.min(shield.value, damage);
    const remaining = shield.value - absorbed;

    target.statuses =
        remaining > 0
            ? target.statuses.map((status) => (status === shield ? { ...shield, value: remaining } : status))
            : target.statuses.filter((status) => status !== shield);

    return absorbed;
}

function pushStatusesChanged(unit: BattleUnit, events: BattleEvent[]): void {
    events.push({ type: 'statuses_changed', unitId: unit.id, statuses: structuredClone(unit.statuses) });
}

function defeat(state: BattleState, unit: BattleUnit, events: BattleEvent[]): void {
    events.push({ type: 'unit_defeated', unitId: unit.id });

    // Quem caiu não carrega mais nenhum status.
    if (unit.statuses.length > 0) {
        unit.statuses = [];
        pushStatusesChanged(unit, events);
    }

    // Mais um cadáver para quem os conta no time (se quem caiu deixa um).
    syncCorpseCounts(state, unit.team, events);
}

/** Sorteia um número de 0 a 1 usando o gerador guardado no estado (e avança esse gerador). */
function roll(state: BattleState): number {
    const next = nextRandom(state.rngState);
    state.rngState = next.rngState;

    return next.value;
}

function rollChance(state: BattleState, chance: number): boolean {
    return roll(state) < chance;
}

function findWinner(state: BattleState): TeamId | null {
    const aliveA = state.units.some((u) => u.team === 'A' && isAlive(u));
    const aliveB = state.units.some((u) => u.team === 'B' && isAlive(u));

    if (!aliveB) return 'A';
    if (!aliveA) return 'B';

    return null;
}

function finishBattle(state: BattleState, winner: TeamId, events: BattleEvent[]): void {
    state.winner = winner;
    state.activeUnitId = null;
    events.push({ type: 'battle_ended', winner });
}

// ---------------------------------------------------------------------------
// Turnos e vezes
// ---------------------------------------------------------------------------

/**
 * Abre um turno novo: sobe o número e define a ordem de ação.
 *
 * A ordem é por velocidade (já contando bônus e penalidades), da maior para a
 * menor. Para o empate, cada unidade tira um número na sorte e quem tirar o
 * menor vai antes. Como o sorteio é refeito a cada turno, duas unidades com a
 * mesma velocidade têm 50% de chance de trocar de lugar de um turno para o
 * outro.
 */
function startTurn(state: BattleState, events: BattleEvent[]): void {
    const alive = state.units.filter(isAlive);

    state.draws = {};

    for (const unit of alive) {
        state.draws[unit.id] = roll(state);
    }

    state.turn += 1;
    state.order = sortBySpeed(state, alive).map((unit) => unit.id);

    // A energia não acumula: os dois times recomeçam com a energia do turno.
    state.turnEnergy = getTurnEnergy(state.turn);
    state.energy = { A: state.turnEnergy, B: state.turnEnergy };

    events.push({
        type: 'turn_started',
        turn: state.turn,
        order: [...state.order],
        energy: state.turnEnergy,
        fury: getFuryBonus(state.turn),
    });
}

/** Mais veloz primeiro; com a mesma velocidade, quem tirou o menor número no sorteio do turno. */
function sortBySpeed(state: BattleState, units: BattleUnit[]): BattleUnit[] {
    return units
        .map((unit) => ({ unit, speed: getEffectiveStats(unit).speed, draw: state.draws[unit.id] ?? 0 }))
        .sort((a, b) => b.speed - a.speed || a.draw - b.draw)
        .map((entry) => entry.unit);
}

/**
 * Reordena quem ainda não agiu neste turno, pela velocidade de agora. É
 * chamada depois de cada habilidade: se ela deixou alguém mais rápido ou mais
 * lento, a mudança já vale neste turno.
 *
 * Quem já agiu (e quem está na vez) fica onde está. Unidades derrotadas
 * continuam na posição em que estavam: elas não agem de qualquer forma. O
 * desempate usa o mesmo sorteio do começo do turno, então um empate que
 * apareça agora também é decidido na sorte.
 */
function reorderWaiting(state: BattleState, events: BattleEvent[]): void {
    const position = state.activeUnitId === null ? -1 : state.order.indexOf(state.activeUnitId);
    const waiting = state.order.slice(position + 1).map((unitId) => getUnit(state, unitId));
    const sorted = sortBySpeed(state, waiting.filter(isAlive));
    const reordered = waiting.map((unit) => (isAlive(unit) ? sorted.shift() ?? unit : unit).id);
    const order = [...state.order.slice(0, position + 1), ...reordered];

    if (order.some((unitId, index) => unitId !== state.order[index])) {
        state.order = order;
        events.push({ type: 'order_changed', order: [...order] });
    }
}

/**
 * Chama a próxima unidade da ordem e resolve o começo da vez dela. Se a
 * ordem acabou, abre um turno novo. Se a unidade morrer pelo dano de status
 * ou estiver atordoada, passa para a seguinte. Quando esta função termina,
 * ou há uma unidade pronta para agir ou a batalha acabou.
 */
function activateNext(state: BattleState, events: BattleEvent[]): void {
    let position = state.activeUnitId === null ? -1 : state.order.indexOf(state.activeUnitId);

    for (let skipped = 0; skipped < MAX_SKIPPED_ACTIVATIONS; skipped++) {
        position += 1;

        // Todo mundo já agiu: o turno acabou e começa o próximo.
        if (position >= state.order.length) {
            startTurn(state, events);
            position = 0;
        }

        const unitId = state.order[position];
        const unit = unitId === undefined ? undefined : getUnit(state, unitId);

        // Foi derrotada antes de chegar a vez dela neste turno.
        if (!unit || !isAlive(unit)) {
            continue;
        }

        state.activeUnitId = unit.id;
        state.step += 1;

        events.push({ type: 'unit_activated', unitId: unit.id, team: unit.team });

        applyDamageOverTime(state, unit, events);

        if (!isAlive(unit)) {
            const winner = findWinner(state);

            if (winner) {
                finishBattle(state, winner, events);
                return;
            }

            continue;
        }

        if (hasStatus(unit, 'stun')) {
            events.push({ type: 'unit_skipped', unitId: unit.id, status: 'stun' });
            endActivation(state, unit, events);
            continue;
        }

        // A unidade vai agir: antes, a passiva de começo de vez dela.
        applyTurnStartPassives(state, unit, events);

        // A passiva pode ter derrubado o último inimigo...
        const winner = findWinner(state);

        if (winner) {
            finishBattle(state, winner, events);
            return;
        }

        // ...ou mudado a velocidade de quem ainda não agiu neste turno.
        reorderWaiting(state, events);

        return;
    }

    throw new Error('Vezes demais foram puladas em sequência');
}

/**
 * Queimadura, veneno e sangramento: dano direto na vida, sem passar por defesa nem escudo.
 * Um status que cresce conta mais uma vez depois de causar dano, e a tela é
 * avisada para mostrar quanto ele vai causar na próxima.
 */
function applyDamageOverTime(state: BattleState, unit: BattleUnit, events: BattleEvent[]): void {
    let grew = false;

    for (const status of getStatuses(unit)) {
        if (!DAMAGE_STATUSES.includes(status.kind)) {
            continue;
        }

        const amount = Math.min(unit.hp, getStatusTickDamage(status));

        unit.hp -= amount;
        events.push({ type: 'status_damage', targetId: unit.id, status: status.kind, amount, hp: unit.hp });

        if (!isAlive(unit)) {
            defeat(state, unit, events);
            return;
        }

        if (status.growth) {
            unit.statuses = unit.statuses.map((item) => (item === status ? { ...status, ticks: (status.ticks ?? 0) + 1 } : item));
            grew = true;
        }
    }

    if (grew) {
        pushStatusesChanged(unit, events);
    }
}

/**
 * Fim da vez de uma unidade: cada status dela gasta um turno de duração. Um
 * status aplicado nesta mesma vez (um bônus que a unidade deu a si mesma, por
 * exemplo) só começa a contar na próxima, para que "dura 2 turnos" signifique
 * duas vezes agindo com ele.
 */
function endActivation(state: BattleState, unit: BattleUnit, events: BattleEvent[]): void {
    if (!isAlive(unit)) {
        return;
    }

    const remaining: StatusEffect[] = [];
    let changed = false;
    let formEnded = false;

    for (const status of unit.statuses) {
        if (status.appliedOnStep === state.step) {
            remaining.push(status);
            continue;
        }

        changed = true;

        if (status.turns > 1) {
            remaining.push({ ...status, turns: status.turns - 1 });
        } else {
            events.push({ type: 'status_expired', unitId: unit.id, status: status.kind });
            formEnded ||= status.kind === 'form';
        }
    }

    if (changed) {
        unit.statuses = remaining;
        pushStatusesChanged(unit, events);
    }

    // O prazo da transformação acabou: a unidade volta à forma original.
    if (formEnded && unit.form !== undefined) {
        setForm(unit, null, events);
    }
}

// ---------------------------------------------------------------------------
// Batalhas gravadas no formato antigo
// ---------------------------------------------------------------------------

/**
 * Antes dos turnos por rodada, cada unidade tinha uma barra de ação e o
 * "turno" contava cada vez. Uma batalha gravada naquele formato não tem
 * `order` nem `step`. Esta função a converte para o formato atual, para que
 * continue abrindo (e, se estava em andamento, possa ser terminada):
 *
 *   - o turno antigo vira `step`;
 *   - o turno em andamento é montado com quem está na vez primeiro e os
 *     demais vivos por velocidade;
 *   - o número do turno é estimado pela quantidade de vezes que já passaram.
 *
 * Também completa o que foi criado depois, em batalhas gravadas antes:
 *
 *   - o sorteio do turno (`draws`): cada unidade recebe um número conforme a
 *     posição que já tinha na ordem, o que mantém os empates como estavam;
 *   - a energia do turno (`turnEnergy`): a batalha segue com a energia que
 *     tinha, e passa a ser reabastecida a partir do turno seguinte.
 *
 * Um estado que já está no formato atual volta como veio.
 */
export function upgradeState(saved: BattleState): BattleState {
    const hasRounds = Array.isArray(saved.order) && typeof saved.step === 'number';

    if (hasRounds && saved.draws && typeof saved.turnEnergy === 'number') {
        return saved;
    }

    const state = structuredClone(saved);

    if (hasRounds) {
        state.draws ??= drawsFromOrder(state.order);
        state.turnEnergy ??= getTurnEnergy(state.turn);

        return state;
    }

    const step = state.turn;

    for (const unit of state.units) {
        const legacy = unit as BattleUnit & { actionGauge?: number };

        delete legacy.actionGauge;
        unit.statuses = getStatuses(unit).map((status) => {
            const { appliedOnTurn, ...rest } = status as StatusEffect & { appliedOnTurn?: number };

            return { ...rest, appliedOnStep: status.appliedOnStep ?? appliedOnTurn ?? 0 };
        });
    }

    const waiting = state.units
        .filter((unit) => isAlive(unit) && unit.id !== state.activeUnitId)
        .sort((a, b) => getEffectiveStats(b).speed - getEffectiveStats(a).speed)
        .map((unit) => unit.id);

    state.step = step;
    state.turn = Math.max(1, Math.ceil(step / Math.max(1, state.units.length)));
    state.order = state.activeUnitId === null ? [] : [state.activeUnitId, ...waiting];
    state.draws = drawsFromOrder(state.order);
    state.turnEnergy = getTurnEnergy(state.turn);

    return state;
}

function drawsFromOrder(order: string[]): Record<string, number> {
    return Object.fromEntries(order.map((unitId, index) => [unitId, index / Math.max(1, order.length)]));
}
