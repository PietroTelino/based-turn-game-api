import { BOSSES } from './bosses';
import { weekKey, weekStart } from './events';
import type { CharacterDefinition } from '../types';

/**
 * O chefe semanal cooperativo: um chefe com uma vida enorme dividida entre
 * todos os jogadores da semana. Cada um enfrenta o chefe (com dois lacaios)
 * em batalhas próprias; todo dano que o chefe leva conta para a vida total.
 * Quando ela chega a zero, quem participou resgata o prêmio.
 */
export interface RaidBoss {
    week: string;
    bossId: string;
    /** O personagem de base do chefe (é por ele que a tela acha o modelo). */
    characterId: string;
    name: string;
    minions: string[];
    /** A vida do chefe em cada batalha. */
    battleHp: number;
    /** A vida total da semana, somando todos os jogadores. */
    totalHp: number;
    /** Quantas batalhas contra o chefe cada jogador pode fazer por dia. */
    attemptsPerDay: number;
    reward: { gold: number; diamonds: number };
    endsAt: Date;
}

const ROTATION: { bossId: string; minions: string[] }[] = [
    { bossId: 'rei-lich', minions: ['banshee', 'vampiro'] },
    { bossId: 'rainha-do-gelo', minions: ['guardiao', 'sacerdote'] },
];

export function raidOf(date: Date): RaidBoss {
    const start = weekStart(date);
    const index = Math.floor(start.getTime() / 86_400_000 / 7);
    const pick = ROTATION[((index % ROTATION.length) + ROTATION.length) % ROTATION.length]!;
    const boss = BOSSES[pick.bossId]!;

    return {
        week: weekKey(date),
        bossId: pick.bossId,
        characterId: boss.id,
        name: boss.name,
        minions: pick.minions,
        battleHp: 9000,
        totalHp: 150_000,
        attemptsPerDay: 3,
        reward: { gold: 500, diamonds: 20 },
        endsAt: new Date(start.getTime() + 7 * 86_400_000),
    };
}

/** O chefe como ele entra na batalha: o chefe da campanha, com a vida da batalha semanal. */
export function raidBossDefinition(raid: RaidBoss): CharacterDefinition {
    const boss = structuredClone(BOSSES[raid.bossId]!);

    return { ...boss, stats: { ...boss.stats, maxHp: raid.battleHp } };
}
