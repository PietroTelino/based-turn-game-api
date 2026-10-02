import type { AvailableAction, BattleEvent, BattleState, TeamId } from '../../game';

export type BattleStatus = 'in_progress' | 'finished';

/** O que muda numa batalha a cada gravação. */
export interface BattleSnapshot {
    status: BattleStatus;
    winner: TeamId | null;
    /** Cópia de state.turn: o turno (rodada) em que a batalha está. Aparece no histórico. */
    turn: number;
    /** Cópia de state.step: cresce a cada vez jogada. É a "versão" da batalha, usada na trava. */
    step: number;
    state: BattleState;
    finishedAt: Date | null;
}

/** Uma batalha como está guardada no banco. */
export interface BattleRecord extends BattleSnapshot {
    id: string;
    userId: string;
    createdAt: Date;
    updatedAt: Date;
}

/** Uma batalha sem o estado completo, para listagens. */
export type BattleSummary = Omit<BattleRecord, 'state'>;

/**
 * Onde as batalhas ficam guardadas. O serviço só conhece esta interface:
 * em produção ela é o Prisma (battle.repository.ts), nos testes é um objeto
 * em memória. Por isso os testes não precisam de banco.
 */
export interface BattleStore {
    create(userId: string, snapshot: BattleSnapshot): Promise<BattleRecord>;
    findById(id: string): Promise<BattleRecord | null>;
    findManyByUser(userId: string, limit: number): Promise<BattleSummary[]>;
    /**
     * Grava só se a batalha ainda estiver em andamento e na vez esperada.
     * Devolve null quando outra requisição gravou antes.
     */
    saveIfStep(id: string, expectedStep: number, snapshot: BattleSnapshot): Promise<BattleRecord | null>;
}

/**
 * O estado que o front enxerga: sem o gerador de números aleatórios e sem os
 * números sorteados no turno (são saídas do mesmo gerador).
 */
export type PublicBattleState = Omit<BattleState, 'rngState' | 'draws'>;

export interface BattleView {
    id: string;
    status: BattleStatus;
    winner: TeamId | null;
    /** O time controlado por quem fez a requisição. */
    playerTeam: TeamId;
    state: PublicBattleState;
    /** Opções da unidade da vez. Vazio quando a batalha acabou. */
    availableActions: AvailableAction[];
    createdAt: Date;
    updatedAt: Date;
    finishedAt: Date | null;
}

export interface BattleResponse {
    battle: BattleView;
    /** O que aconteceu desde a última resposta, em ordem, para o front animar. */
    events: BattleEvent[];
}
