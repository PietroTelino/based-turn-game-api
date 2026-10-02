import {
    ENERGY_PER_TURN,
    FURY_DAMAGE_PER_TURN,
    FURY_START_TURN,
    GAUGE_MAX,
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
 * Um "turno" é a vez de UMA unidade. A ordem não é fixa: cada unidade tem uma
 * barra de ação que enche na velocidade dela, e joga quem encher primeiro.
 *
 * O ciclo de um turno:
 *   1. começa o turno: o time ganha energia;
 *   2. queimadura e veneno causam dano;
 *   3. se a unidade está atordoada, perde a vez (volta ao passo 1 com a próxima);
 *   4. a unidade age (applyAction);
 *   5. termina o turno: os status dela gastam um turno de duração.
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
const MAX_SKIPPED_TURNS = 1000;

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
 * Multiplicador de dano da fúria no turno informado: 1 até FURY_START_TURN,
 * depois cresce a cada turno. Garante que toda batalha termina.
 */
export function getFuryMultiplier(turn: number): number {
    return 1 + Math.max(0, turn - FURY_START_TURN) * FURY_DAMAGE_PER_TURN;
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
            usable: hasEnergy && targetIds.length > 0,
            requiresTarget: requiresTarget(skill),
            targetIds,
        };
    });
}

/**
 * Prevê os próximos a jogar, começando por quem está na vez.
 * É a fila de retratos que aparece na tela. É só uma previsão: se alguém
 * morrer, for atordoado ou mudar de velocidade no caminho, a ordem real muda.
 */
export function previewTurnOrder(state: BattleState, count: number): string[] {
    if (state.activeUnitId === null || count <= 0) {
        return [];
    }

    const units = structuredClone(state.units.filter(isAlive));
    const order: string[] = [state.activeUnitId];
    let current = units.find((u) => u.id === state.activeUnitId);

    while (order.length < count) {
        if (current) {
            current.actionGauge = 0;
        }

        current = advanceGauges(units);
        order.push(current.id);
    }

    return order;
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
        energy: { A: INITIAL_ENERGY, B: INITIAL_ENERGY },
        activeUnitId: null,
        turn: 0,
        winner: null,
        rngState: seed >>> 0,
    };

    const events: BattleEvent[] = [];
    startNextTurn(state, events);

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
            actionGauge: 0,
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

    // 4. Encerrar o turno de quem jogou
    endTurn(state, actor, events);

    // 5. Acabou? Senão, descobrir quem joga a seguir
    const winner = findWinner(state);

    if (winner) {
        finishBattle(state, winner, events);
    } else {
        startNextTurn(state, events);
    }

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

            target.hp = Math.max(0, target.hp - (amount - absorbed));
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
                appliedOnTurn: state.turn,
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

/** Sorteia usando o gerador guardado no estado (e avança esse gerador). */
function rollChance(state: BattleState, chance: number): boolean {
    const roll = nextRandom(state.rngState);
    state.rngState = roll.rngState;

    return roll.value < chance;
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
// Começo e fim de turno
// ---------------------------------------------------------------------------

/**
 * Descobre quem joga a seguir e resolve o começo do turno dessa unidade.
 * Se ela morrer pelo dano de status ou estiver atordoada, passa para a
 * próxima. Quando esta função termina, ou há uma unidade pronta para agir
 * ou a batalha acabou.
 */
function startNextTurn(state: BattleState, events: BattleEvent[]): void {
    for (let skipped = 0; skipped < MAX_SKIPPED_TURNS; skipped++) {
        const unit = advanceGauges(state.units);

        state.activeUnitId = unit.id;
        state.turn += 1;
        state.energy[unit.team] = Math.min(MAX_ENERGY, state.energy[unit.team] + ENERGY_PER_TURN);

        events.push({
            type: 'turn_started',
            turn: state.turn,
            unitId: unit.id,
            team: unit.team,
            energy: state.energy[unit.team],
        });

        applyDamageOverTime(unit, events);

        if (!isAlive(unit)) {
            const winner = findWinner(state);

            if (winner) {
                finishBattle(state, winner, events);
                return;
            }

            unit.actionGauge = 0;
            continue;
        }

        if (hasStatus(unit, 'stun')) {
            events.push({ type: 'turn_skipped', unitId: unit.id, status: 'stun' });
            endTurn(state, unit, events);
            continue;
        }

        return;
    }

    throw new Error('Turnos demais foram pulados em sequência');
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
 * Fim do turno de uma unidade: a barra de ação zera e cada status dela gasta
 * um turno de duração. Um status aplicado neste mesmo turno (um bônus que a
 * unidade deu a si mesma, por exemplo) só começa a contar no próximo, para
 * que "dura 2 turnos" signifique duas vezes agindo com ele.
 */
function endTurn(state: BattleState, unit: BattleUnit, events: BattleEvent[]): void {
    unit.actionGauge = 0;

    if (!isAlive(unit)) {
        return;
    }

    const remaining: StatusEffect[] = [];
    let changed = false;

    for (const status of unit.statuses) {
        if (status.appliedOnTurn === state.turn) {
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

/**
 * Avança o "tempo" até a primeira barra de ação encher e devolve essa unidade.
 *
 * Cada barra enche `speed` pontos por unidade de tempo, então quem tem o dobro
 * de velocidade joga o dobro de vezes. Em vez de simular o tempo passo a
 * passo, calculamos direto quanto falta para cada uma e pulamos até lá.
 *
 * Empate: joga a mais rápida; se ainda empatar, a que vem antes na lista.
 */
function advanceGauges(units: BattleUnit[]): BattleUnit {
    const alive = units.filter(isAlive).map((unit) => ({ unit, speed: getEffectiveStats(unit).speed }));
    let next: { unit: BattleUnit; speed: number } | undefined;
    let shortestTime = Infinity;

    for (const entry of alive) {
        const time = Math.max(0, GAUGE_MAX - entry.unit.actionGauge) / entry.speed;
        const isSooner = time < shortestTime;
        const isTieButFaster = time === shortestTime && next !== undefined && entry.speed > next.speed;

        if (isSooner || isTieButFaster) {
            next = entry;
            shortestTime = time;
        }
    }

    if (!next) {
        throw new Error('Não há unidades vivas para jogar');
    }

    for (const { unit, speed } of alive) {
        unit.actionGauge = Math.min(GAUGE_MAX, unit.actionGauge + speed * shortestTime);
    }

    // Evita que um erro de arredondamento deixe a barra em 999.9999.
    next.unit.actionGauge = GAUGE_MAX;

    return next.unit;
}
