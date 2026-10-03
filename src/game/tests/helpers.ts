import assert from 'node:assert/strict';
import { GameRuleError } from '../errors';
import type { GameRuleErrorCode } from '../errors';
import { applyAction } from '../engine';
import type { BattleEvent, BattleResult, BattleState, CharacterDefinition, PassiveDefinition, SkillDefinition, Stats } from '../types';

const BASE_STATS: Stats = { maxHp: 1000, atk: 100, def: 100, speed: 100, critChance: 0, critDamage: 2 };

export function basicAttack(ownerId: string): SkillDefinition {
    return {
        id: `${ownerId}.basic`,
        name: 'Ataque',
        description: '',
        energyCost: 0,
        target: 'single-enemy',
        effects: [{ type: 'damage', power: 1 }],
    };
}

/** Personagem de teste: ataque básico + as habilidades extras informadas. Sem passiva, a não ser que o teste dê uma. */
export function makeCharacter(
    id: string,
    stats: Partial<Stats> = {},
    extraSkills: SkillDefinition[] = [],
    passives: PassiveDefinition[] = [],
): CharacterDefinition {
    return {
        id,
        name: id,
        role: 'fighter',
        stats: { ...BASE_STATS, ...stats },
        skills: [basicAttack(id), ...extraSkills],
        passives,
    };
}

/** A unidade da vez usa o ataque básico no primeiro inimigo vivo. */
export function basicAttackTurn(state: BattleState): BattleResult {
    const actor = state.units.find((u) => u.id === state.activeUnitId);
    assert.ok(actor, 'deveria haver uma unidade na vez');

    const target = state.units.find((u) => u.team !== actor.team && u.hp > 0);
    assert.ok(target, 'deveria haver um inimigo vivo');

    return applyAction(state, { unitId: actor.id, skillId: `${actor.characterId}.basic`, targetId: target.id });
}

export function eventsOfType<T extends BattleEvent['type']>(
    events: BattleEvent[],
    type: T,
): Extract<BattleEvent, { type: T }>[] {
    return events.filter((event): event is Extract<BattleEvent, { type: T }> => event.type === type);
}

export function assertRuleError(fn: () => unknown, code: GameRuleErrorCode): void {
    assert.throws(fn, (error: unknown) => error instanceof GameRuleError && error.code === code, `esperava ${code}`);
}
