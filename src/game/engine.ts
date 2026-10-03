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
 *   4. a unidade age (applyAction);
 *   5. termina a vez: os status dela gastam um turno de duração.
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
    furyMultiplier = 1,
): number {
    const raw = attacker.atk * power;
    const mitigation = 100 / (100 + defender.def);
    const critMultiplier = critical ? attacker.critDamage : 1;

    return Math.max(1, Math.round(raw * mitigation * critMultiplier * furyMultiplier));
}

/**
 * O dano de um golpe antes da defesa do alvo e sem crítico: ATK x poder (x
 * fúria). É o número que a tela mostra na descrição da habilidade.
 */
export function calculateBaseDamage(attacker: Stats, power: number, furyMultiplier = 1): number {
    return Math.max(1, Math.round(attacker.atk * power * furyMultiplier));
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
        case 'shield':
            return Math.max(1, Math.round(caster.atk * effect.power));
        case 'stun':
            return 0;
        default:
            return effect.power;
    }
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
    const fury = getFuryMultiplier(state.turn);
    let damage: number | null = null;
    let heal: number | null = null;

    for (const effect of skill.effects) {
        if (effect.type === 'damage') {
            damage = (damage ?? 0) + calculateBaseDamage(stats, effect.power, fury);
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
    for (const effect of skill.effects) {
        const receivers = effect.type === 'status' && effect.to === 'self' ? [actor] : targets;

        for (const receiver of receivers) {
            applyEffect(state, actor, receiver, effect, events);
        }
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

/** Todas as unidades que a habilidade PODE atingir (apenas vivas). */
function getCandidateTargets(state: BattleState, actor: BattleUnit, skill: SkillDefinition): BattleUnit[] {
    switch (skill.target) {
        case 'single-enemy':
        case 'all-enemies':
            return state.units.filter((u) => u.team !== actor.team && isAlive(u));
        case 'single-ally':
        case 'all-allies':
            return state.units.filter((u) => u.team === actor.team && isAlive(u));
        case 'self':
            return [actor];
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
    // Um alvo pode ter morrido para um efeito anterior da mesma habilidade.
    if (!isAlive(target)) {
        return;
    }

    switch (effect.type) {
        case 'damage': {
            const critical = rollChance(state, actor.stats.critChance);
            const fury = getFuryMultiplier(state.turn);
            const amount = calculateDamage(
                getEffectiveStats(actor),
                getEffectiveStats(target),
                effect.power,
                critical,
                fury,
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

            // Roubo de vida: quem bateu recupera uma fração do que o alvo perdeu.
            if (effect.drain !== undefined && lost > 0) {
                const healed = Math.min(actor.stats.maxHp - actor.hp, Math.round(lost * effect.drain));

                if (healed > 0) {
                    actor.hp += healed;
                    events.push({ type: 'heal', sourceId: actor.id, targetId: actor.id, amount: healed, hp: actor.hp });
                }
            }

            if (!isAlive(target)) {
                defeat(target, events);
            }

            return;
        }

        case 'heal': {
            const missing = target.stats.maxHp - target.hp;
            const amount = Math.min(missing, calculateHeal(getEffectiveStats(actor), effect.power));

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

            const status: StatusEffect = {
                kind: effect.status,
                turns: effect.turns,
                value: calculateStatusValue(getEffectiveStats(actor), effect),
                sourceId: actor.id,
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

function defeat(unit: BattleUnit, events: BattleEvent[]): void {
    events.push({ type: 'unit_defeated', unitId: unit.id });

    // Quem caiu não carrega mais nenhum status.
    if (unit.statuses.length > 0) {
        unit.statuses = [];
        pushStatusesChanged(unit, events);
    }
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

        applyDamageOverTime(unit, events);

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

        return;
    }

    throw new Error('Vezes demais foram puladas em sequência');
}

/** Queimadura e veneno: dano direto na vida, sem passar por defesa nem escudo. */
function applyDamageOverTime(unit: BattleUnit, events: BattleEvent[]): void {
    for (const status of getStatuses(unit)) {
        if (status.kind !== 'burn' && status.kind !== 'poison') {
            continue;
        }

        const amount = Math.min(unit.hp, status.value);

        unit.hp -= amount;
        events.push({ type: 'status_damage', targetId: unit.id, status: status.kind, amount, hp: unit.hp });

        if (!isAlive(unit)) {
            defeat(unit, events);
            return;
        }
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
        }
    }

    if (changed) {
        unit.statuses = remaining;
        pushStatusesChanged(unit, events);
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
