import {
    applyAction,
    calculateHeal,
    DAMAGE_STATUSES,
    getAvailableActions,
    getEffectiveStats,
    getHealingFactor,
    getStatuses,
    getStatusTickDamage,
    getUnit,
    hasStatus,
    isAlive,
    NEGATIVE_STATUSES,
    POSITIVE_STATUSES,
    SKIP_STATUSES,
} from './engine';
import type { AiDifficulty, AvailableAction, BattleAction, BattleState, BattleUnit, TeamId } from './types';

/**
 * A jogada da IA na batalha, conforme o nível dela: a de treino (o tutorial)
 * e a fácil jogam fraco de propósito, a normal é a de sempre e a difícil
 * pensa cada golpe. Quem chama não precisa saber qual é qual.
 */
export function chooseAiAction(state: BattleState): BattleAction {
    if (state.training) {
        return chooseTrainingAction(state);
    }

    return chooseActionFor(state, state.difficulty ?? 'normal');
}

/** A jogada de um nível específico, sem olhar o que está gravado no estado. */
export function chooseActionFor(state: BattleState, difficulty: AiDifficulty): BattleAction {
    switch (difficulty) {
        case 'easy':
            return chooseEasyAction(state);
        case 'hard':
            return chooseHardAction(state);
        default:
            return chooseAction(state);
    }
}

/**
 * IA simples e previsível, sem sorteio:
 *
 * 1. se algum aliado está com menos da metade da vida, usa a cura que
 *    recupera mais vida no total (em área só compensa com vários feridos);
 * 2. senão, se algum aliado está atordoado ou levando dano pesado de veneno
 *    ou queimadura, usa uma habilidade que purifica nele;
 * 3. senão, quem pode erguer ou reviver um cadáver o faz (uma unidade a mais
 *    no time vale mais que qualquer golpe); e quem pode se transformar se transforma: na forma mais resistente
 *    se está com menos da metade da vida, na de mais ataque se está bem;
 *    quem tem uma postura sem custo (um bônus em si mesma, como a Postura
 *    de Duelo) entra nela sempre que não está;
 * 4. senão, usa a habilidade mais cara que a energia do time permite (no
 *    empate, a provocação primeiro e depois o golpe de mais dano no
 *    total), pulando as de suporte (escudo, bônus)
 *    que não acrescentariam nada porque os alvos já estão com o efeito;
 * 5. ataques miram em quem tem menos vida (quem tira efeitos, em quem tem
 *    mais efeitos a perder); suporte vai para o aliado mais
 *    ferido que ainda não tem o efeito. Se um inimigo está provocando, o
 *    motor só oferece ele como alvo dos golpes de alvo único.
 *
 * Ela fica fora do motor de propósito: o motor não sabe quem escolheu a ação.
 * Para o motor, IA e jogador são a mesma coisa: alguém que manda uma BattleAction.
 */
export function chooseAction(state: BattleState): BattleAction {
    return decide(state, true);
}

/** `useStance`: se a unidade pode gastar a vez entrando em postura (a IA de treino não faz isso). */
function decide(state: BattleState, useStance: boolean): BattleAction {
    if (state.activeUnitId === null) {
        throw new Error('A batalha já terminou');
    }

    const actor = getUnit(state, state.activeUnitId);
    const options = getAvailableActions(state, { previews: false }).filter((option) => option.usable);

    const heal = chooseHeal(state, actor, options.filter(isHeal));

    if (heal) {
        return heal;
    }

    const purify = choosePurify(state, actor, options.filter(isPurify));

    if (purify) {
        return purify;
    }

    // Invocação ou ressurreição: só aparece como utilizável quando há cadáver e energia.
    const summon = options.find((option) => option.skill.effects.some((effect) => effect.type === 'summon' || effect.type === 'revive'));

    // Com mais de um caído, traz de volta o mais forte (maior ataque); para erguer um esqueleto, tanto faz qual.
    if (summon) {
        const corpse = [...summon.targetIds].map((id) => getUnit(state, id)).sort((a, b) => b.stats.atk - a.stats.atk)[0];

        return toAction(actor.id, summon, corpse?.id);
    }

    const shift = chooseForm(actor, options);

    if (shift) {
        return shift;
    }

    // Postura: um bônus em si mesma que não custa energia (a Postura de Duelo)
    // vale a vez sempre que a unidade ainda não o carrega.
    const stance = options.find(
        (option) => option.skill.energyCost === 0 && option.skill.target === 'self' && isSupport(option) && lacksStatus(option, actor, actor),
    );

    if (stance && useStance) {
        return toAction(actor.id, stance, undefined);
    }

    // No empate de custo, a provocação vem antes: sem isso o tanque gastaria a
    // energia sempre no escudo e nunca chamaria os golpes para si. Depois, o
    // golpe que causa mais dano no total: sem isso, entre duas habilidades
    // sem custo (a Mordida e o Dilacerar do lobo) ela ficaria sempre na primeira.
    const byCost = options
        .filter((option) => !isHeal(option))
        .sort(
            (a, b) =>
                b.skill.energyCost - a.skill.energyCost || Number(isTaunt(b)) - Number(isTaunt(a)) || totalPower(b) - totalPower(a),
        );

    for (const option of byCost) {
        if (!isSupport(option)) {
            // Quem tira efeitos (Julgamento) mira em quem tem mais efeitos a perder; no empate, no de menos vida.
            const target = isDispel(option)
                ? lowest(state, option.targetIds, (unit) => -positiveCount(unit) * 100000 + unit.hp)
                : lowest(state, option.targetIds, (unit) => unit.hp);

            return toAction(actor.id, option, target?.id);
        }

        // Suporte: só vale se alguém ainda não tem o efeito.
        const needy = option.targetIds.filter((id) => lacksStatus(option, actor, getUnit(state, id)));

        if (needy.length > 0) {
            const target = lowest(state, needy, hpRatio);

            return toAction(actor.id, option, target?.id);
        }
    }

    throw new Error(`Nenhuma ação disponível para ${actor.id}`);
}

/**
 * IA de treino: a adversária da batalha do tutorial. Joga mal de propósito,
 * para quem está aprendendo conseguir vencer errando bastante, mas ainda
 * mostra o jogo inteiro (habilidades com custo, cura, efeitos):
 *
 * 1. o time só usa uma habilidade com custo por turno. Enquanto a energia do
 *    turno está intacta, a unidade da vez escolhe como a IA normal; depois
 *    que alguém gastou, as outras ficam no ataque básico;
 * 2. os golpes miram em quem tem MAIS vida, em vez de terminar com os
 *    feridos: o dano se espalha e quase ninguém cai;
 * 3. ela não entra em postura: o Espadachim de treino nunca contra-ataca.
 *
 * Também não tem sorteio: a mesma batalha de treino se repete igual.
 */
export function chooseTrainingAction(state: BattleState): BattleAction {
    if (state.activeUnitId === null) {
        throw new Error('A batalha já terminou');
    }

    const actor = getUnit(state, state.activeUnitId);
    const options = getAvailableActions(state, { previews: false }).filter((option) => option.usable);
    const normal = decide(state, false);
    const hasSpent = state.energy[actor.team] < state.turnEnergy;

    let option = options.find((candidate) => candidate.skill.id === normal.skillId);

    if (hasSpent && option && option.skill.energyCost > 0) {
        // O ataque básico é sempre a primeira habilidade, sem custo (há um teste que garante).
        option = options.find((candidate) => candidate.skill.energyCost === 0) ?? option;
    }

    if (!option) {
        return normal;
    }

    const isAttack = option.skill.effects.some((effect) => effect.type === 'damage');

    if (option.requiresTarget && isAttack) {
        const healthiest = lowest(state, option.targetIds, (unit) => -unit.hp);

        return toAction(actor.id, option, healthiest?.id);
    }

    // Cura e suporte, ou golpe em área: como a IA normal escolheu.
    return option.skill.id === normal.skillId ? normal : toAction(actor.id, option, option.targetIds[0]);
}

/**
 * IA fácil: a mesma da batalha de treino, mas aqui contra qualquer time. Só
 * gasta energia uma vez por turno, espalha os golpes em quem tem mais vida e
 * não entra em postura. Dá para vencer mesmo errando bastante.
 */
export function chooseEasyAction(state: BattleState): BattleAction {
    return chooseTrainingAction(state);
}

/**
 * IA difícil: pensa antes de jogar. Para cada jogada possível da unidade da
 * vez (cada habilidade em cada alvo), ela imagina como a batalha segue: faz a
 * jogada numa cópia do campo e deixa os dois times jogarem mais algumas vezes
 * como a IA normal jogaria. No fim, olha quem ficou melhor (veja `evaluate`)
 * e escolhe a jogada que levou ao melhor campo, na média de alguns futuros.
 *
 * Ela não espia a sorte da batalha: cada futuro imaginado usa um sorteio
 * próprio, então os críticos e chances dela são tão incertos quanto os do
 * jogador. No empate, fica com o que a IA normal faria.
 */
export function chooseHardAction(state: BattleState): BattleAction {
    if (state.activeUnitId === null) {
        throw new Error('A batalha já terminou');
    }

    const actor = getUnit(state, state.activeUnitId);
    const normal = decide(state, true);
    let best = { action: normal, score: imagine(state, normal, actor.team) };

    for (const action of candidates(state, actor)) {
        if (sameAction(action, normal)) continue;

        const score = imagine(state, action, actor.team);

        if (score > best.score) {
            best = { action, score };
        }
    }

    return best.action;
}

/** Quantas vezes a IA difícil deixa a batalha seguir, depois da jogada, antes de olhar o resultado. */
const HARD_LOOKAHEAD = 12;

/** Quantos futuros diferentes ela imagina para cada jogada (cada um com um sorteio próprio). */
const HARD_FUTURES = 3;

/** Todas as jogadas que a unidade da vez pode fazer: cada habilidade utilizável, em cada alvo possível. */
function candidates(state: BattleState, actor: BattleUnit): BattleAction[] {
    const actions: BattleAction[] = [];

    for (const option of getAvailableActions(state, { previews: false }).filter((item) => item.usable)) {
        if (option.requiresTarget) {
            for (const targetId of option.targetIds) actions.push({ unitId: actor.id, skillId: option.skill.id, targetId });
        } else {
            actions.push({ unitId: actor.id, skillId: option.skill.id });
        }
    }

    return actions;
}

function sameAction(a: BattleAction, b: BattleAction): boolean {
    return a.skillId === b.skillId && a.targetId === b.targetId;
}

/** A nota média do campo depois de `action`, vista por `team`, em alguns futuros imaginados. */
function imagine(state: BattleState, action: BattleAction, team: TeamId): number {
    let total = 0;

    for (let future = 0; future < HARD_FUTURES; future++) {
        // Um sorteio que não é o da batalha: a IA não sabe quais golpes vão ser críticos.
        let sim: BattleState = { ...state, rngState: (state.rngState ^ Math.imul(future + 1, 0x9e3779b1)) >>> 0 };

        sim = applyAction(sim, action).state;

        for (let step = 0; step < HARD_LOOKAHEAD && sim.winner === null; step++) {
            sim = applyAction(sim, decide(sim, true)).state;
        }

        total += evaluate(sim, team);
    }

    return total / HARD_FUTURES;
}

/**
 * Quão bem `team` está: o perigo de cada unidade viva (veja `threat`), meio
 * pela presença e meio pela vida que ainda tem, do time menos o do adversário,
 * e um pouco pela energia guardada. Vencer vale mais que qualquer campo.
 */
function evaluate(state: BattleState, team: TeamId): number {
    if (state.winner !== null) {
        return state.winner === team ? 1e9 : -1e9;
    }

    let score = 0;

    for (const unit of state.units) {
        if (!isAlive(unit)) continue;

        const value = threat(unit) * (0.5 + 0.5 * hpRatio(unit));

        score += unit.team === team ? value : -value;
    }

    const other: TeamId = team === 'A' ? 'B' : 'A';

    return score + ENERGY_VALUE * (state.energy[team] - state.energy[other]);
}

/** Quanto vale um ponto de energia guardado, na mesma escala de `threat`. */
const ENERGY_VALUE = 20;

/** Quem cura, purifica ou revive vale este tanto a mais: tirá-lo cedo muda a batalha. */
const SUPPORT_THREAT_BONUS = 0.35;

/** Quanto uma unidade pesa na batalha: o dano esperado por golpe, mais rápido valendo mais, e um bônus para quem cura ou revive. */
function threat(unit: BattleUnit): number {
    const stats = getEffectiveStats(unit);
    const perHit = stats.atk * (1 + stats.critChance * (stats.critDamage - 1));
    const support = unit.skills.some((skill) => skill.effects.some((effect) => effect.type === 'heal' || effect.type === 'revive' || effect.type === 'cleanse'));
    const toughness = stats.maxHp / 800;

    return perHit * (1 + stats.speed / 400) * toughness * (support ? 1 + SUPPORT_THREAT_BONUS : 1);
}

function isHeal(option: AvailableAction): boolean {
    return option.skill.effects.some((effect) => effect.type === 'heal');
}

function isPurify(option: AvailableAction): boolean {
    return option.requiresTarget && option.skill.effects.some((effect) => effect.type === 'cleanse');
}

/** A partir de quanto da vida máxima por turno o veneno ou a queimadura valem uma purificação. */
const PURIFY_DAMAGE_RATIO = 0.1;

/**
 * Quanto vale purificar a unidade: 0 se não compensa. Atordoamento e sono
 * valem mais que tudo (devolvem a vez); o torpor prestes a virar sono vem
 * logo atrás; dano por turno conta a partir de 10% da vida máxima por turno,
 * e quanto maior, mais urgente. Só conta o que a purificação tira (a
 * maldição, não).
 */
function purifyUrgency(unit: BattleUnit): number {
    const statuses = getStatuses(unit).filter((status) => NEGATIVE_STATUSES.includes(status.kind));
    const perTurn = statuses
        .filter((status) => DAMAGE_STATUSES.includes(status.kind))
        .reduce((total, status) => total + getStatusTickDamage(status), 0);
    const ratio = perTurn / unit.stats.maxHp;
    const skips = statuses.some((status) => SKIP_STATUSES.includes(status.kind));
    const drowsy = statuses.some((status) => status.kind === 'drowsy' && status.turns <= 1);

    return (skips ? 10 : 0) + (drowsy ? 5 : 0) + (ratio >= PURIFY_DAMAGE_RATIO ? ratio : 0);
}

/** Purifica o aliado que mais precisa, com a habilidade mais barata que faz isso. */
function choosePurify(state: BattleState, actor: BattleUnit, options: AvailableAction[]): BattleAction | null {
    const option = [...options].sort((a, b) => a.skill.energyCost - b.skill.energyCost)[0];

    if (!option) {
        return null;
    }

    const target = lowest(state, option.targetIds, (unit) => -purifyUrgency(unit));

    return target && purifyUrgency(target) > 0 ? toAction(actor.id, option, target.id) : null;
}

/**
 * Transformação: entre as habilidades que transformam, escolhe pela forma.
 * Ferida (menos da metade da vida), a unidade vai para a forma com mais vida;
 * inteira, para a de mais ataque.
 */
function chooseForm(actor: BattleUnit, options: AvailableAction[]): BattleAction | null {
    let best: { option: AvailableAction; score: number } | null = null;
    const wounded = hpRatio(actor) < 0.5;

    for (const option of options) {
        for (const effect of option.skill.effects) {
            const form = effect.type === 'transform' ? actor.forms?.find((item) => item.id === effect.form) : undefined;

            if (!form) continue;

            const score = wounded ? form.stats.maxHp : form.stats.atk;

            if (!best || score > best.score) {
                best = { option, score };
            }
        }
    }

    return best ? toAction(actor.id, best.option, actor.id) : null;
}

/** A força dos golpes da habilidade somada, vezes quantos alvos ela atinge. */
function totalPower(option: AvailableAction): number {
    const power = option.skill.effects.reduce((total, effect) => total + (effect.type === 'damage' ? effect.power : 0), 0);

    return power * (option.requiresTarget ? 1 : option.targetIds.length);
}

function isDispel(option: AvailableAction): boolean {
    return option.requiresTarget && option.skill.effects.some((effect) => effect.type === 'dispel');
}

/** Quantos status que ajudam a unidade ela carrega (os que o efeito 'dispel' tira). */
function positiveCount(unit: BattleUnit): number {
    return getStatuses(unit).filter((status) => POSITIVE_STATUSES.includes(status.kind)).length;
}

function isTaunt(option: AvailableAction): boolean {
    return option.skill.effects.some((effect) => effect.type === 'status' && effect.status === 'taunt');
}

/** Habilidade que não causa dano nem cura: só aplica status. */
function isSupport(option: AvailableAction): boolean {
    return option.skill.effects.every((effect) => effect.type === 'status');
}

/** true se a habilidade daria a `target` algum status que ele ainda não tem. */
function lacksStatus(option: AvailableAction, actor: BattleUnit, target: BattleUnit): boolean {
    return option.skill.effects.some(
        (effect) => effect.type === 'status' && !hasStatus(effect.to === 'self' ? actor : target, effect.status),
    );
}

function hpRatio(unit: BattleUnit): number {
    return unit.hp / unit.stats.maxHp;
}

function chooseHeal(state: BattleState, actor: BattleUnit, heals: AvailableAction[]): BattleAction | null {
    let best: { action: BattleAction; restored: number; cost: number } | null = null;

    for (const option of heals) {
        // Alvo único: o aliado mais ferido. Demais casos: todos os atingidos.
        const mostWounded = lowest(state, option.targetIds, hpRatio);
        const targetIds = option.requiresTarget ? (mostWounded ? [mostWounded.id] : []) : option.targetIds;
        const targets = targetIds.map((id) => getUnit(state, id));

        if (!targets.some((unit) => hpRatio(unit) < 0.5)) {
            continue;
        }

        const restored = totalRestored(actor, option, targets);
        const cost = option.skill.energyCost;

        if (!best || restored > best.restored || (restored === best.restored && cost < best.cost)) {
            best = { action: toAction(actor.id, option, mostWounded?.id), restored, cost };
        }
    }

    return best ? best.action : null;
}

/** Quanta vida a habilidade recupera de verdade (cura além do máximo é desperdício). */
function totalRestored(actor: BattleUnit, option: AvailableAction, targets: BattleUnit[]): number {
    let total = 0;

    for (const effect of option.skill.effects) {
        if (effect.type !== 'heal') continue;

        const amount = calculateHeal(getEffectiveStats(actor), effect.power);

        for (const target of targets) {
            // Quem está com a cura reduzida recebe menos.
            total += Math.min(Math.round(amount * getHealingFactor(target)), target.stats.maxHp - target.hp);
        }
    }

    return total;
}

function lowest(state: BattleState, unitIds: string[], score: (unit: BattleUnit) => number): BattleUnit | undefined {
    return unitIds
        .map((id) => getUnit(state, id))
        .sort((a, b) => score(a) - score(b))[0];
}

function toAction(unitId: string, option: AvailableAction, targetId: string | undefined): BattleAction {
    if (option.requiresTarget && targetId !== undefined) {
        return { unitId, skillId: option.skill.id, targetId };
    }

    return { unitId, skillId: option.skill.id };
}
