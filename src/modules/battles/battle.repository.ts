import { prisma } from '../../prisma';
import type { Battle, Prisma } from '../../generated/prisma/client';
import type { BattleState, TeamId } from '../../game';
import type { BattleRecord, BattleSnapshot, BattleStatus, BattleStore, BattleSummary } from './battle.types';

const SUMMARY_FIELDS = {
    id: true,
    userId: true,
    status: true,
    winner: true,
    turn: true,
    step: true,
    createdAt: true,
    updatedAt: true,
    finishedAt: true,
} as const;

type SummaryRow = Omit<Battle, 'state'>;

function toSummary(row: SummaryRow): BattleSummary {
    return {
        id: row.id,
        userId: row.userId,
        status: row.status as BattleStatus,
        winner: row.winner as TeamId | null,
        turn: row.turn,
        step: row.step,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        finishedAt: row.finishedAt,
    };
}

function toRecord(row: Battle): BattleRecord {
    // A coluna é Json: o Prisma devolve um objeto comum, que é exatamente o BattleState.
    return { ...toSummary(row), state: row.state as unknown as BattleState };
}

function toData(snapshot: BattleSnapshot) {
    return {
        status: snapshot.status,
        winner: snapshot.winner,
        turn: snapshot.turn,
        step: snapshot.step,
        state: snapshot.state as unknown as Prisma.InputJsonValue,
        finishedAt: snapshot.finishedAt,
    };
}

export class BattleRepository implements BattleStore {
    async create(userId: string, snapshot: BattleSnapshot): Promise<BattleRecord> {
        const row = await prisma.battle.create({
            data: { userId, ...toData(snapshot) },
        });

        return toRecord(row);
    }

    async findById(id: string): Promise<BattleRecord | null> {
        const row = await prisma.battle.findUnique({ where: { id } });

        return row ? toRecord(row) : null;
    }

    async findManyByUser(userId: string, limit: number): Promise<BattleSummary[]> {
        const rows = await prisma.battle.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            take: limit,
            select: SUMMARY_FIELDS,
        });

        return rows.map(toSummary);
    }

    async saveIfStep(id: string, expectedStep: number, snapshot: BattleSnapshot): Promise<BattleRecord | null> {
        // O "where" é a trava: se duas requisições chegarem juntas, só a
        // primeira encontra a linha ainda na vez esperada. E uma batalha
        // terminada (por desistência, por exemplo) nunca é regravada.
        const { count } = await prisma.battle.updateMany({
            where: { id, step: expectedStep, status: 'in_progress' },
            data: toData(snapshot),
        });

        if (count === 0) {
            return null;
        }

        return this.findById(id);
    }
}
