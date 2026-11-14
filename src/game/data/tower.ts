import { ARENAS } from '../constants';
import type { AiDifficulty, ArenaId, CharacterDefinition } from '../types';

/**
 * A torre: andares sem fim, cada um mais difícil. O andar N só abre depois de
 * vencer o N-1. Tudo sai do número do andar (sem sorteio na hora), então o
 * andar 7 é o mesmo para todos os jogadores.
 *
 * - O time inimigo: 5 personagens escolhidos pelo número do andar.
 * - A escala: vida e ataque dos inimigos sobem 4% por andar.
 * - Os modificadores: a partir do andar 3, um; a partir do 15, dois.
 * - A cada 10 andares, o primeiro inimigo vira chefe (vida x2).
 */
export interface TowerModifier {
    id: string;
    /** Multiplicadores dos atributos dos inimigos. */
    hp?: number;
    atk?: number;
    def?: number;
    speed?: number;
}

export const TOWER_MODIFIERS: readonly TowerModifier[] = [
    { id: 'fortificado', hp: 1.3 },
    { id: 'feroz', atk: 1.2 },
    { id: 'veloz', speed: 1.15 },
    { id: 'blindado', def: 1.6 },
    { id: 'furioso', atk: 1.1, speed: 1.08 },
];

export interface TowerFloor {
    floor: number;
    enemyTeam: string[];
    arena: ArenaId;
    difficulty: AiDifficulty;
    /** Ids de TOWER_MODIFIERS, mais 'chefe' nos andares múltiplos de 10. */
    modifiers: string[];
    /** Quanto a vida e o ataque dos inimigos crescem (1 no andar 1). */
    scale: number;
    /** O que vencer o andar paga (uma vez só: o andar não se repete). */
    reward: { gold: number; diamonds: number };
}

const TEAM = 5;

/** O mesmo gerador simples do relatório de balanceamento, com semente fixa. */
function sampler(seed: number): () => number {
    let state = seed >>> 0;

    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;

        return state / 0x100000000;
    };
}

export function towerFloor(floor: number, characterIds: readonly string[]): TowerFloor {
    const next = sampler(floor * 7919 + 13);
    const pool = [...characterIds];
    const enemyTeam: string[] = [];

    while (enemyTeam.length < Math.min(TEAM, pool.length)) {
        enemyTeam.push(pool.splice(Math.floor(next() * pool.length), 1)[0]!);
    }

    const modifiers: string[] = [];
    const count = TOWER_MODIFIERS.length;

    if (floor >= 3) modifiers.push(TOWER_MODIFIERS[(floor * 7) % count]!.id);
    if (floor >= 15) {
        const second = TOWER_MODIFIERS[(floor * 3 + 1) % count]!.id;

        modifiers.push(second === modifiers[0] ? TOWER_MODIFIERS[(floor * 3 + 2) % count]!.id : second);
    }
    if (floor % 10 === 0) modifiers.push('chefe');

    return {
        floor,
        enemyTeam,
        arena: ARENAS[floor % ARENAS.length]!,
        difficulty: floor <= 3 ? 'easy' : floor <= 10 ? 'normal' : 'hard',
        modifiers,
        scale: Math.round((1 + 0.04 * (floor - 1)) * 100) / 100,
        reward: { gold: 40 + 10 * floor, diamonds: floor % 10 === 0 ? 10 : 0 },
    };
}

/** O time inimigo com a escala e os modificadores do andar aplicados (cópias: o catálogo não muda). */
export function applyTowerModifiers(team: CharacterDefinition[], floor: Pick<TowerFloor, 'modifiers' | 'scale'>): CharacterDefinition[] {
    const mods = TOWER_MODIFIERS.filter((mod) => floor.modifiers.includes(mod.id));
    const factor = (key: 'hp' | 'atk' | 'def' | 'speed') => mods.reduce((total, mod) => total * (mod[key] ?? 1), 1);

    return team.map((character, index) => {
        const copy = structuredClone(character);
        const boss = index === 0 && floor.modifiers.includes('chefe');

        copy.stats = {
            ...copy.stats,
            maxHp: Math.round(copy.stats.maxHp * floor.scale * factor('hp') * (boss ? 2 : 1)),
            atk: Math.round(copy.stats.atk * floor.scale * factor('atk')),
            def: Math.round(copy.stats.def * factor('def')),
            speed: Math.round(copy.stats.speed * factor('speed')),
        };

        return boss ? { ...copy, boss: true } : copy;
    });
}
