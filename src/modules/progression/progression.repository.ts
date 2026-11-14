import { prisma } from '../../prisma';
import type { Achievement } from './progression.catalog';
import type { Currency, Metrics, ProgressionStore } from './progression.service';

/** Partidas que contam: terminadas e fora do treino (o treino não tem nível nem adversário). */
const counted = { status: 'finished', OR: [{ difficulty: { not: null } }, { opponentId: { not: null } }] };
const wonBy = (userId: string) => ({ OR: [{ userId, winner: 'A' }, { opponentId: userId, winner: 'B' }] });

export class ProgressionRepository implements ProgressionStore {
    async wallet(userId: string) {
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { gold: true, diamonds: true } });

        return { gold: user?.gold ?? 0, diamonds: user?.diamonds ?? 0 };
    }

    async unlocked(userId: string) {
        return (await prisma.userCharacter.findMany({ where: { userId }, select: { characterId: true } })).map((row) => row.characterId);
    }

    async completed(userId: string) {
        return prisma.userAchievement.findMany({ where: { userId }, select: { achievementId: true, completedAt: true } });
    }

    async metrics(userId: string, characterIds: string[]): Promise<Metrics> {
        const mine = { OR: [{ userId }, { opponentId: userId }] };
        const [wins, played, winsHard, campaignRows, pvpWins, user, characterWins] = await Promise.all([
            prisma.battle.count({ where: { AND: [counted, wonBy(userId)] } }),
            prisma.battle.count({ where: { AND: [counted, mine] } }),
            prisma.battle.count({ where: { userId, status: 'finished', winner: 'A', difficulty: 'hard' } }),
            prisma.battle.findMany({ where: { userId, status: 'finished', winner: 'A', campaignStage: { not: null } }, select: { campaignStage: true, difficulty: true } }),
            prisma.battle.count({ where: { AND: [{ status: 'finished', opponentId: { not: null } }, wonBy(userId)] } }),
            prisma.user.findUnique({ where: { id: userId }, select: { rankedWins: true } }),
            Promise.all(
                characterIds.map((characterId) =>
                    prisma.battlePick.count({ where: { userId, characterId, battle: { AND: [counted, wonBy(userId)] } } }).then((count) => [characterId, count] as const),
                ),
            ),
        ]);
        const stages = campaignRows.map((row) => ({ stage: row.campaignStage ?? 0, hard: row.difficulty === 'hard' }));

        return {
            wins,
            played,
            winsHard,
            campaign: Math.max(0, ...stages.map((s) => s.stage)),
            campaignHard: Math.max(0, ...stages.filter((s) => s.hard).map((s) => s.stage)),
            pvpWins,
            rankedWins: user?.rankedWins ?? 0,
            characterWins: Object.fromEntries(characterWins),
        };
    }

    async complete(userId: string, achievement: Achievement, refundGold: number) {
        return prisma.$transaction(async (tx) => {
            const created = await tx.userAchievement.createMany({ data: [{ userId, achievementId: achievement.id }], skipDuplicates: true });

            if (created.count === 0) return false;

            const { gold = 0, diamonds = 0, character } = achievement.reward;

            if (character && !refundGold) {
                await tx.userCharacter.createMany({ data: [{ userId, characterId: character, source: 'achievement' }], skipDuplicates: true });
            }

            await tx.user.update({ where: { id: userId }, data: { gold: { increment: gold + refundGold }, diamonds: { increment: diamonds } } });

            return true;
        });
    }

    async purchase(userId: string, characterId: string, currency: Currency, price: number) {
        return prisma.$transaction(async (tx) => {
            if (await tx.userCharacter.findUnique({ where: { userId_characterId: { userId, characterId } } })) return 'owned' as const;

            // Só debita se o saldo der (a condição vai no próprio UPDATE, então duas compras ao mesmo tempo não passam do saldo).
            const paid = await tx.user.updateMany({ where: { id: userId, [currency]: { gte: price } }, data: { [currency]: { decrement: price } } });

            if (paid.count === 0) return 'insufficient' as const;

            await tx.userCharacter.create({ data: { userId, characterId, source: currency } });

            return 'ok' as const;
        });
    }

    async addFunds(userId: string, gold: number, diamonds: number) {
        await prisma.$transaction(async (tx) => {
            await tx.user.update({ where: { id: userId }, data: { gold: { increment: gold }, diamonds: { increment: diamonds } } });
            // Tirar mais do que o jogador tem deixa em zero.
            await tx.user.updateMany({ where: { id: userId, gold: { lt: 0 } }, data: { gold: 0 } });
            await tx.user.updateMany({ where: { id: userId, diamonds: { lt: 0 } }, data: { diamonds: 0 } });
        });
    }

    async unlock(userId: string, characterId: string, source: string) {
        await prisma.userCharacter.createMany({ data: [{ userId, characterId, source }], skipDuplicates: true });
    }

    async payBattle(battleId: string, userId: string, gold: number) {
        return prisma.$transaction(async (tx) => {
            const created = await tx.battleReward.createMany({ data: [{ battleId, userId, gold }], skipDuplicates: true });

            if (created.count === 0) return false;

            await tx.user.update({ where: { id: userId }, data: { gold: { increment: gold } } });

            return true;
        });
    }

    async setBattleAchievements(battleId: string, userId: string, achievements: string[]) {
        await prisma.battleReward.update({ where: { battleId_userId: { battleId, userId } }, data: { achievements } });
    }

    async battleReward(battleId: string, userId: string) {
        const row = await prisma.battleReward.findUnique({ where: { battleId_userId: { battleId, userId } } });

        return row ? { gold: row.gold, achievements: (row.achievements as string[]) ?? [] } : null;
    }
}
