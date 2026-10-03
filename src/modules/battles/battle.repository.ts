import { prisma } from '../../prisma';
import type { Battle, Prisma } from '../../generated/prisma/client';
import type { BattleEvent, BattleState, TeamId } from '../../game';
import type { BattleRecord, BattleSnapshot, BattleStatus, BattleStore, BattleSummaryRow } from './battle.types';

/** Tudo menos o estado e o histórico, que são grandes e a listagem não usa. */
const SUMMARY_FIELDS = {
    id: true,
    userId: true,
    opponentId: true,
    status: true,
    winner: true,
    turn: true,
    step: true,
    createdAt: true,
    updatedAt: true,
    finishedAt: true,
} as const;

type SummaryRow = Omit<Battle, 'state' | 'events'>;

function toSummary(row: SummaryRow): BattleSummaryRow {
    return {
        id: row.id,
        userId: row.userId,
        opponentId: row.opponentId,
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
    // As colunas são Json: o Prisma devolve objetos comuns, que são exatamente
    // o BattleState e a lista de eventos. Batalha contra a IA não tem histórico.
    return {
        ...toSummary(row),
        state: row.state as unknown as BattleState,
        events: (row.events ?? []) as unknown as BattleEvent[],
    };
}

function toJson(value: unknown): Prisma.InputJsonValue {
    return value as Prisma.InputJsonValue;
}

function toData(snapshot: BattleSnapshot) {
    return {
        status: snapshot.status,
        winner: snapshot.winner,
        turn: snapshot.turn,
        step: snapshot.step,
        state: toJson(snapshot.state),
        finishedAt: snapshot.finishedAt,
    };
}

export class BattleRepository implements BattleStore {
    async create(userId: string, snapshot: BattleSnapshot, versus?: { opponentId: string; events: BattleEvent[] }): Promise<BattleRecord> {
        const row = await prisma.battle.create({
            data: {
                userId,
                ...toData(snapshot),
                ...(versus && { opponentId: versus.opponentId, events: toJson(versus.events) }),
            },
        });

        return toRecord(row);
    }

    async findById(id: string): Promise<BattleRecord | null> {
        const row = await prisma.battle.findUnique({ where: { id } });

        return row ? toRecord(row) : null;
    }

    async findManyByUser(userId: string, limit: number): Promise<BattleSummaryRow[]> {
        const rows = await prisma.battle.findMany({
            where: { OR: [{ userId }, { opponentId: userId }] },
            orderBy: { createdAt: 'desc' },
            take: limit,
            select: SUMMARY_FIELDS,
        });

        return rows.map(toSummary);
    }

    async saveIfStep(id: string, expectedStep: number, snapshot: BattleSnapshot, events?: BattleEvent[]): Promise<BattleRecord | null> {
        // O "where" é a trava: se duas requisições chegarem juntas, só a
        // primeira encontra a linha ainda na vez esperada. E uma batalha
        // terminada (por desistência, por exemplo) nunca é regravada.
        const { count } = await prisma.battle.updateMany({
            where: { id, step: expectedStep, status: 'in_progress' },
            data: { ...toData(snapshot), ...(events && { events: toJson(events) }) },
        });

        if (count === 0) {
            return null;
        }

        return this.findById(id);
    }
}
