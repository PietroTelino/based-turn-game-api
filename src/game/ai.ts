import {
    calculateHeal,
    DAMAGE_STATUSES,
    getAvailableActions,
    getEffectiveStats,
    getHealingFactor,
    getStatuses,
    getStatusTickDamage,
    getUnit,
    hasStatus,
} from './engine';
import type { AvailableAction, BattleAction, BattleState, BattleUnit } from './types';

/**
 * IA simples e previsível, sem sorteio:
 *
 * 1. se algum aliado está com menos da metade da vida, usa a cura que
 *    recupera mais vida no total (em área só compensa com vários feridos);
 * 2. senão, se algum aliado está atordoado ou levando dano pesado de veneno
 *    ou queimadura, usa uma habilidade que purifica nele;
 * 3. senão, quem pode erguer um cadáver ergue (uma unidade a mais no time
 *    vale mais que qualquer golpe); e quem pode se transformar se transforma: na forma mais resistente
 *    se está com menos da metade da vida, na de mais ataque se está bem;
 *    quem tem uma postura sem custo (um bônus em si mesma, como a Postura
 *    de Duelo) entra nela sempre que não está;
 * 4. senão, usa a habilidade mais cara que a energia do time permite (no
 *    empate, a provocação primeiro e depois o golpe de mais dano no
 *    total), pulando as de suporte (escudo, bônus)
 *    que não acrescentariam nada porque os alvos já estão com o efeito;
 * 5. ataques miram em quem tem menos vida; suporte vai para o aliado mais
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
    const options = getAvailableActions(state).filter((option) => option.usable);

    const heal = chooseHeal(state, actor, options.filter(isHeal));

    if (heal) {
        return heal;
    }

    const purify = choosePurify(state, actor, options.filter(isPurify));

    if (purify) {
        return purify;
    }

    // Invocação: só aparece como utilizável quando há cadáver e energia.
    const summon = options.find((option) => option.skill.effects.some((effect) => effect.type === 'summon'));

    if (summon) {
        return toAction(actor.id, summon, undefined);
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
            const target = lowest(state, option.targetIds, (unit) => unit.hp);

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
    const options = getAvailableActions(state).filter((option) => option.usable);
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

function isHeal(option: AvailableAction): boolean {
    return option.skill.effects.some((effect) => effect.type === 'heal');
}

function isPurify(option: AvailableAction): boolean {
    return option.requiresTarget && option.skill.effects.some((effect) => effect.type === 'cleanse');
}

/** A partir de quanto da vida máxima por turno o veneno ou a queimadura valem uma purificação. */
const PURIFY_DAMAGE_RATIO = 0.1;

/**
 * Quanto vale purificar a unidade: 0 se não compensa. Atordoamento vale mais
 * que tudo (devolve a vez); dano por turno conta a partir de 10% da vida
 * máxima por turno, e quanto maior, mais urgente.
 */
function purifyUrgency(unit: BattleUnit): number {
    const perTurn = getStatuses(unit)
        .filter((status) => DAMAGE_STATUSES.includes(status.kind))
        .reduce((total, status) => total + getStatusTickDamage(status), 0);
    const ratio = perTurn / unit.stats.maxHp;

    return (hasStatus(unit, 'stun') ? 10 : 0) + (ratio >= PURIFY_DAMAGE_RATIO ? ratio : 0);
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
