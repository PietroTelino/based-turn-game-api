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

/** Um personagem que um jogador levou para uma batalha: é o que alimenta as estatísticas de uso. */
export interface BattlePick {
    userId: string;
    characterId: string;
}

/** O que acompanha uma batalha quando ela é criada, além do primeiro estado gravado. */
export interface NewBattle {
    /** Quem controla o time B, numa batalha entre dois jogadores. */
    opponentId?: string;
    /** Os eventos de abertura e, contra a IA, as jogadas que ela já fez. */
    events: BattleEvent[];
    /** O estado como saiu de createBattle, antes de qualquer jogada: é de onde o replay começa. */
    initialState: BattleState;
    /** Partida ranqueada: veio da fila de pareamento e vale pontos. */
    ranked?: boolean;
    /** Os personagens que cada jogador escolheu. Vazio na batalha de treino. */
    picks: BattlePick[];
}

/** Uma batalha como está guardada no banco. */
export interface BattleRecord extends BattleSnapshot {
    id: string;
    /** Quem controla o time A. Contra a IA, é o único jogador. */
    userId: string;
    /** Quem controla o time B. `null` quando o time B é da IA. */
    opponentId: string | null;
    /**
     * Tudo o que aconteceu na batalha, em ordem. Entre dois jogadores, é por
     * aqui que cada um fica sabendo do que o outro jogou; com a batalha
     * encerrada, é o que o replay mostra. Contra a IA, as batalhas criadas
     * antes de o replay existir não têm os eventos do começo.
     */
    events: BattleEvent[];
    /** Tem o estado inicial e os eventos desde o começo: dá para assistir de novo. */
    hasReplay: boolean;
    /** Partida ranqueada (veio da fila de pareamento). */
    ranked: boolean;
    /** Os pontos que cada lado ganhou ou perdeu. `null` até o resultado ser lançado. */
    ratingDeltaA: number | null;
    ratingDeltaB: number | null;
    createdAt: Date;
    updatedAt: Date;
}

/** Uma batalha sem o estado completo nem o histórico, como o banco devolve nas listagens. */
export type BattleSummaryRow = Omit<BattleRecord, 'state' | 'events'>;

/** Uma batalha na listagem de um jogador: sem os ids dos dois lados, e com o time que é o dele. */
export interface BattleSummary extends Omit<BattleSummaryRow, 'userId' | 'opponentId' | 'ratingDeltaA' | 'ratingDeltaB'> {
    mode: BattleMode;
    playerTeam: TeamId;
    /** Partida ranqueada encerrada: quantos pontos o jogador ganhou (ou perdeu, negativo). */
    ratingChange: number | null;
}

/**
 * Onde as batalhas ficam guardadas. O serviço só conhece esta interface:
 * em produção ela é o Prisma (battle.repository.ts), nos testes é um objeto
 * em memória. Por isso os testes não precisam de banco.
 */
export interface BattleStore {
    create(userId: string, snapshot: BattleSnapshot, extra: NewBattle): Promise<BattleRecord>;
    findById(id: string): Promise<BattleRecord | null>;
    /** O estado de quando a batalha foi criada. `null` nas batalhas sem replay. */
    findInitialState(id: string): Promise<BattleState | null>;
    /** As batalhas em que o jogador está, de qualquer lado, da mais nova para a mais antiga. */
    findManyByUser(userId: string, limit: number): Promise<BattleSummaryRow[]>;
    /**
     * Grava só se a batalha ainda estiver em andamento e na vez esperada.
     * Devolve null quando outra requisição gravou antes. `events` passa a ser
     * o histórico inteiro da batalha.
     */
    saveIfStep(id: string, expectedStep: number, snapshot: BattleSnapshot, events: BattleEvent[]): Promise<BattleRecord | null>;
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
     * as jogadas do oponente.
     */
    cursor: number;
    /** Dá para assistir de novo depois que acabar (as batalhas antigas não guardaram o começo). */
    hasReplay: boolean;
    /** Partida ranqueada: vale pontos e tem prazo para jogar. */
    ranked: boolean;
    /** Partida ranqueada encerrada: os pontos que o jogador ganhou (ou perdeu, negativo). */
    ratingChange: number | null;
    /**
     * Partida ranqueada em andamento: quanto tempo quem está na vez ainda tem
     * para jogar, em ms. Em zero, o outro lado pode pedir a vitória. `null`
     * quando não há prazo (batalha comum ou encerrada).
     */
    turnTimeLeftMs: number | null;
    createdAt: Date;
    updatedAt: Date;
    finishedAt: Date | null;
}

export interface BattleResponse {
    battle: BattleView;
    /** O que aconteceu desde a última resposta, em ordem, para o front animar. */
    events: BattleEvent[];
}

/** Uma batalha encerrada, do começo ao fim, para assistir de novo. */
export interface ReplayResponse {
    /** A batalha como terminou. */
    battle: BattleView;
    /** O estado de quando ela foi criada: a tela parte dele e aplica os eventos. */
    initial: PublicBattleState;
    /** Tudo o que aconteceu, em ordem. */
    events: BattleEvent[];
}
