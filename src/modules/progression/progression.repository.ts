import { prisma } from '../../prisma';
import type { Achievement } from './progression.catalog';
import type { Currency, FinishedBattle, Metrics, ProgressionStore } from './progression.service';

/** Partidas que contam: terminadas e fora do treino (o treino não tem nível nem adversário). */
const counted = { status: 'finished', OR: [{ difficulty: { not: null } }, { opponentId: { not: null } }] };
const wonBy = (userId: string) => ({ OR: [{ userId, winner: 'A' }, { opponentId: userId, winner: 'B' }] });

/** Sinal interno para desfazer a compra quando o saldo não dá. */
class InsufficientDiamonds extends Error {}

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

    async payBattle(battleId: string, userId: string, gold: number, xp: number) {
        return prisma.$transaction(async (tx) => {
            const created = await tx.battleReward.createMany({ data: [{ battleId, userId, gold, xp }], skipDuplicates: true });

            if (created.count === 0) return false;

            await tx.user.update({ where: { id: userId }, data: { gold: { increment: gold }, xp: { increment: xp } } });

            return true;
        });
    }

    async setBattleAchievements(battleId: string, userId: string, achievements: string[]) {
        await prisma.battleReward.update({ where: { battleId_userId: { battleId, userId } }, data: { achievements } });
    }

    async finishedSince(userId: string, since: Date): Promise<FinishedBattle[]> {
        const rows = await prisma.battle.findMany({
            where: { AND: [counted, { OR: [{ userId }, { opponentId: userId }] }, { finishedAt: { gte: since } }] },
            select: {
                userId: true,
                opponentId: true,
                winner: true,
                ranked: true,
                difficulty: true,
                campaignStage: true,
                towerFloor: true,
                finishedAt: true,
                picks: { where: { userId }, select: { characterId: true } },
            },
        });

        return rows.map((row) => ({
            won: row.winner === (row.userId === userId ? 'A' : 'B'),
            versus: row.opponentId !== null,
            ranked: row.ranked,
            difficulty: row.difficulty,
            campaign: row.campaignStage !== null,
            tower: row.towerFloor !== null,
            characterIds: row.picks.map((pick) => pick.characterId),
            finishedAt: row.finishedAt ?? since,
        }));
    }

    async campaignClears(userId: string) {
        const rows = await prisma.battle.findMany({
            where: { userId, opponentId: null, campaignStage: { not: null }, status: 'finished', winner: 'A' },
            distinct: ['campaignStage', 'difficulty'],
            select: { campaignStage: true, difficulty: true },
        });

        return rows.map((row) => ({ stage: row.campaignStage ?? 0, difficulty: row.difficulty ?? 'normal' }));
    }

    async claimed(userId: string, keys: string[]) {
        if (!keys.length) return [];

        return (await prisma.userClaim.findMany({ where: { userId, key: { in: keys } }, select: { key: true } })).map((row) => row.key);
    }

    async claim(userId: string, key: string, gold: number, diamonds: number) {
        return prisma.$transaction(async (tx) => {
            const created = await tx.userClaim.createMany({ data: [{ userId, key, gold, diamonds }], skipDuplicates: true });

            if (created.count === 0) return false;

            if (gold || diamonds) await tx.user.update({ where: { id: userId }, data: { gold: { increment: gold }, diamonds: { increment: diamonds } } });

            return true;
        });
    }

    async userXp(userId: string) {
        return (await prisma.user.findUnique({ where: { id: userId }, select: { xp: true } }))?.xp ?? 0;
    }

    async xpSince(userId: string, since: Date) {
        const row = await prisma.battleReward.aggregate({ where: { userId, createdAt: { gte: since } }, _sum: { xp: true } });

        return row._sum?.xp ?? 0;
    }

    async buyWithDiamonds(userId: string, key: string, price: number) {
        try {
            return await prisma.$transaction(async (tx) => {
                const created = await tx.userClaim.createMany({ data: [{ userId, key, diamonds: -price }], skipDuplicates: true });

                if (created.count === 0) return 'owned' as const;

                // Só debita se o saldo der; senão desfaz a transação inteira (a chave também).
                const paid = await tx.user.updateMany({ where: { id: userId, diamonds: { gte: price } }, data: { diamonds: { decrement: price } } });

                if (paid.count === 0) throw new InsufficientDiamonds();

                return 'ok' as const;
            });
        } catch (error) {
            if (error instanceof InsufficientDiamonds) return 'insufficient' as const;
            throw error;
        }
    }

    async loginState(userId: string) {
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { loginStreak: true, loginLastDay: true } });

        return { streak: user?.loginStreak ?? 0, lastDay: user?.loginLastDay ?? null };
    }

    async saveLogin(userId: string, expectedLastDay: string | null, streak: number, today: string, gold: number, diamonds: number) {
        const { count } = await prisma.user.updateMany({
            where: { id: userId, loginLastDay: expectedLastDay },
            data: { loginStreak: streak, loginLastDay: today, gold: { increment: gold }, diamonds: { increment: diamonds } },
        });

        return count === 1;
    }

    async battleReward(battleId: string, userId: string) {
        const row = await prisma.battleReward.findUnique({ where: { battleId_userId: { battleId, userId } } });

        return row ? { gold: row.gold, xp: row.xp, achievements: (row.achievements as string[]) ?? [] } : null;
    }
}
