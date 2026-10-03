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

/** Contra quem a batalha é jogada: a IA ou outro jogador. */
export type BattleMode = 'ai' | 'pvp';

/** Uma batalha como está guardada no banco. */
export interface BattleRecord extends BattleSnapshot {
    id: string;
    /** Quem controla o time A. Contra a IA, é o único jogador. */
    userId: string;
    /** Quem controla o time B. `null` quando o time B é da IA. */
    opponentId: string | null;
    /**
     * Tudo o que aconteceu na batalha, em ordem. Só as batalhas entre dois
     * jogadores guardam isto: é por aqui que cada um fica sabendo do que o
     * outro jogou. Contra a IA fica vazio (os eventos vão na própria resposta).
     */
    events: BattleEvent[];
    createdAt: Date;
    updatedAt: Date;
}

/** Uma batalha sem o estado completo nem o histórico, como o banco devolve nas listagens. */
export type BattleSummaryRow = Omit<BattleRecord, 'state' | 'events'>;

/** Uma batalha na listagem de um jogador: sem os ids dos dois lados, e com o time que é o dele. */
export interface BattleSummary extends Omit<BattleSummaryRow, 'userId' | 'opponentId'> {
    mode: BattleMode;
    playerTeam: TeamId;
}

/**
 * Onde as batalhas ficam guardadas. O serviço só conhece esta interface:
 * em produção ela é o Prisma (battle.repository.ts), nos testes é um objeto
 * em memória. Por isso os testes não precisam de banco.
 */
export interface BattleStore {
    /** `versus` só é informado em batalha entre dois jogadores: o dono do time B e os eventos de abertura. */
    create(userId: string, snapshot: BattleSnapshot, versus?: { opponentId: string; events: BattleEvent[] }): Promise<BattleRecord>;
    findById(id: string): Promise<BattleRecord | null>;
    /** As batalhas em que o jogador está, de qualquer lado, da mais nova para a mais antiga. */
    findManyByUser(userId: string, limit: number): Promise<BattleSummaryRow[]>;
    /**
     * Grava só se a batalha ainda estiver em andamento e na vez esperada.
     * Devolve null quando outra requisição gravou antes. `events`, quando
     * informado, passa a ser o histórico inteiro da batalha.
     */
    saveIfStep(id: string, expectedStep: number, snapshot: BattleSnapshot, events?: BattleEvent[]): Promise<BattleRecord | null>;
}

/**
 * O estado que o front enxerga: sem o gerador de números aleatórios e sem os
 * números sorteados no turno (são saídas do mesmo gerador), e com a fúria do
 * turno atual já calculada (0 = sem fúria, 0.5 = dano +50%).
 */
export type PublicBattleState = Omit<BattleState, 'rngState' | 'draws'> & { fury: number };

export interface BattleView {
    id: string;
    mode: BattleMode;
    status: BattleStatus;
    winner: TeamId | null;
    /** O time controlado por quem fez a requisição. */
    playerTeam: TeamId;
    state: PublicBattleState;
    /** Opções da unidade da vez. Vazio quando a batalha acabou ou quando a vez é do outro jogador. */
    availableActions: AvailableAction[];
    /**
     * Quantos eventos a batalha já teve. Entre dois jogadores, a tela guarda
     * este número e pergunta "o que aconteceu depois dele?" para acompanhar
     * as jogadas do oponente. Contra a IA é sempre 0.
     */
    cursor: number;
    createdAt: Date;
    updatedAt: Date;
    finishedAt: Date | null;
}

export interface BattleResponse {
    battle: BattleView;
    /** O que aconteceu desde a última resposta, em ordem, para o front animar. */
    events: BattleEvent[];
}
