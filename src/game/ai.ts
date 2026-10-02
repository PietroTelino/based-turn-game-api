import { calculateHeal, getAvailableActions, getEffectiveStats, getUnit, hasStatus } from './engine';
import type { AvailableAction, BattleAction, BattleState, BattleUnit } from './types';

/**
 * IA simples e previsível, sem sorteio:
 *
 * 1. se algum aliado está com menos da metade da vida, usa a cura que
 *    recupera mais vida no total (em área só compensa com vários feridos);
 * 2. senão, usa a habilidade mais cara que a energia do time permite,
 *    pulando as de suporte (escudo, bônus) que não acrescentariam nada
 *    porque os alvos já estão com o efeito;
 * 3. ataques miram em quem tem menos vida; suporte vai para o aliado mais
 *    ferido que ainda não tem o efeito.
 *
 * Ela fica fora do motor de propósito: o motor não sabe quem escolheu a ação.
 * Para o motor, IA e jogador são a mesma coisa: alguém que manda uma BattleAction.
 */
export function chooseAction(state: BattleState): BattleAction {
    if (state.activeUnitId === null) {
        throw new Error('A batalha já terminou');
    }

    const actor = getUnit(state, state.activeUnitId);
    const options = getAvailableActions(state).filter((option) => option.usable);

    const heal = chooseHeal(state, actor, options.filter(isHeal));

    if (heal) {
        return heal;
    }

    const byCost = options.filter((option) => !isHeal(option)).sort((a, b) => b.skill.energyCost - a.skill.energyCost);

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

function isHeal(option: AvailableAction): boolean {
    return option.skill.effects.some((effect) => effect.type === 'heal');
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
            total += Math.min(amount, target.stats.maxHp - target.hp);
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
