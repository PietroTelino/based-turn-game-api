import {
    ARENAS,
    CHARACTERS,
    applyAction,
    chooseAction,
    chooseTrainingAction,
    createBattle,
    getActiveUnit,
    getAvailableActions,
    getFuryBonus,
    surrender,
    upgradeState,
} from '../../game';
import type { ArenaId, BattleAction, BattleEvent, BattleResult, BattleState, CharacterDefinition, TeamId } from '../../game';
import { BattleError } from './battle.errors';
import type {
    BattlePick,
    BattleRecord,
    BattleResponse,
    BattleSnapshot,
    BattleStore,
    BattleSummary,
    BattleView,
    PublicBattleState,
    ReplayResponse,
} from './battle.types';

/**
 * Contra a IA, o jogador é o time A e a IA é o time B. Entre dois jogadores,
 * quem criou a sala é o time A e quem entrou é o time B.
 */
export const PLAYER_TEAM: TeamId = 'A';
export const AI_TEAM: TeamId = 'B';

/** Toda batalha é 5 contra 5: os dois times entram com exatamente este número de personagens. */
export const TEAM_SIZE = 5;

/**
 * Partida ranqueada: quanto tempo quem está na vez tem para jogar. Passado o
 * prazo, o outro lado pode pedir a vitória (`claimTimeout`). Sem isto, quem
 * está perdendo só fecharia a tela e a partida nunca valeria pontos.
 */
export const RANKED_TURN_LIMIT_MS = 90_000;

const LIST_LIMIT = 20;
const MAX_AI_ACTIONS_IN_A_ROW = 100;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Os dois lados de uma batalha entre jogadores. Quem criou a sala fica com o time A. */
export interface CreateVersusInput {
    hostId: string;
    hostTeam: string[];
    guestId: string;
    guestTeam: string[];
    /** Partida ranqueada: veio da fila de pareamento, vale pontos e tem prazo para jogar. */
    ranked?: boolean;
    /** Semente do motor. Só os testes usam. */
    seed?: number;
}

/** Quem quer saber quando uma batalha acaba (a ranqueada, para lançar os pontos). */
export type BattleFinishedListener = (record: BattleRecord) => Promise<void>;

export interface CreateBattleInput {
    /** Ids dos personagens do jogador: exatamente TEAM_SIZE, sem repetir. */
    team: string[];
    /** Ids dos personagens da IA, com a mesma regra. Se faltar, o time é sorteado. */
    enemyTeam?: string[];
    /** Semente do motor. Só os testes usam; a rota HTTP não aceita. */
    seed?: number;
    /** Batalha de treino (o tutorial): a IA joga fraco de propósito. */
    training?: boolean;
}

/**
 * Liga o motor (src/game) ao banco.
 *
 * O motor resolve uma ação de cada vez. Aqui está o que é próprio de cada
 * tipo de partida:
 *
 * - Contra a IA: depois da jogada do jogador, a IA joga sozinha até a vez
 *   voltar para ele, e só então o resultado é gravado e devolvido.
 * - Entre dois jogadores: cada um só mexe nas próprias unidades, na vez
 *   delas. O que acontece vai para o histórico da batalha (`events`), e é
 *   por ele que o outro lado acompanha as jogadas (`events()`, mais abaixo).
 *
 * Toda batalha guarda o estado inicial e o histórico inteiro: com ela
 * encerrada, é o que o replay mostra (`replay()`).
 */
export class BattleService {
    private teamSize: number;
    private now: () => Date;
    private finishedListeners: BattleFinishedListener[] = [];

    constructor(
        private store: BattleStore,
        private random: () => number = Math.random,
        /**
         * `teamSize` troca o tamanho obrigatório dos times. O jogo nunca passa
         * isto (vale TEAM_SIZE); existe para os testes poderem usar batalhas
         * de 1 contra 1, que são muito mais fáceis de acompanhar. `now` é o
         * relógio, que os testes de prazo também trocam.
         */
        options: { teamSize?: number; now?: () => Date } = {},
    ) {
        this.teamSize = options.teamSize ?? TEAM_SIZE;
        this.now = options.now ?? (() => new Date());
    }

    /**
     * Registra quem deve ser avisado quando uma batalha acaba. O aviso
     * acontece depois da gravação e antes da resposta, então a resposta de
     * quem deu o último golpe já traz o que o ouvinte mudou (os pontos).
     */
    onFinished(listener: BattleFinishedListener): void {
        this.finishedListeners.push(listener);
    }

    listCharacters(): CharacterDefinition[] {
        return CHARACTERS;
    }

    async list(userId: string): Promise<BattleSummary[]> {
        const rows = await this.store.findManyByUser(userId, LIST_LIMIT);

        return rows.map(({ userId: ownerId, opponentId, ratingDeltaA, ratingDeltaB, ...row }) => {
            const playerTeam = teamOf({ userId: ownerId, opponentId }, userId) ?? PLAYER_TEAM;

            return {
                ...row,
                mode: opponentId === null ? 'ai' : 'pvp',
                playerTeam,
                ratingChange: playerTeam === 'A' ? ratingDeltaA : ratingDeltaB,
            };
        });
    }

    async create(userId: string, input: CreateBattleInput): Promise<BattleResponse> {
        const teamA = this.resolveTeam(input.team);
        const teamB = input.enemyTeam ? this.resolveTeam(input.enemyTeam) : this.pickEnemyTeam(teamA.length);

        const started = createBattle({
            teamA,
            teamB,
            ...(input.seed !== undefined && { seed: input.seed }),
        });

        // A marca de treino fica no estado: é ela que diz, em cada jogada desta
        // batalha, que a IA deve jogar fraco, e à tela, que deve mostrar o guia.
        if (input.training) {
            started.state.training = true;
        }

        // O cenário é sorteado depois do time da IA, para não mudar o time que sai de um mesmo sorteio.
        started.state.arena = this.pickArena();

        // Se as unidades da IA forem as primeiras da ordem, ela já abre a batalha.
        const { state, events } = this.playAiActions(started);
        const record = await this.store.create(userId, this.toSnapshot(state), {
            events,
            initialState: started.state,
            // O treino tem sempre o mesmo time: não é escolha do jogador e não entra nas estatísticas.
            picks: input.training ? [] : picksOf(userId, teamA),
        });

        return { battle: this.toView(record, PLAYER_TEAM), events };
    }

    /**
     * Cria a batalha entre dois jogadores e devolve o id dela. Quem chama é o
     * módulo de salas, quando os dois avisam que estão prontos. Ninguém joga
     * aqui: a batalha nasce parada na vez da primeira unidade.
     */
    async createVersus(input: CreateVersusInput): Promise<string> {
        const teamA = this.resolveTeam(input.hostTeam);
        const teamB = this.resolveTeam(input.guestTeam);
        const started = createBattle({
            teamA,
            teamB,
            ...(input.seed !== undefined && { seed: input.seed }),
        });

        // Sorteado aqui, uma vez, e gravado no estado: os dois jogadores veem o mesmo cenário.
        started.state.arena = this.pickArena();

        const record = await this.store.create(input.hostId, this.toSnapshot(started.state), {
            opponentId: input.guestId,
            events: started.events,
            initialState: started.state,
            ...(input.ranked && { ranked: true }),
            picks: [...picksOf(input.hostId, teamA), ...picksOf(input.guestId, teamB)],
        });

        return record.id;
    }

    /** `true` enquanto a batalha existe e ainda não acabou. A fila ranqueada usa para saber se o jogador está ocupado. */
    async isInProgress(battleId: string): Promise<boolean> {
        const record = UUID_PATTERN.test(battleId) ? await this.store.findById(battleId) : null;

        return record?.status === 'in_progress';
    }

    /** Confere um time sem criar nada: lança INVALID_TEAM ou UNKNOWN_CHARACTER. */
    validateTeam(ids: string[]): void {
        this.resolveTeam(ids);
    }

    async get(userId: string, battleId: string): Promise<BattleView> {
        const { record, team } = await this.findForPlayer(userId, battleId);

        return this.toView(record, team);
    }

    /**
     * A batalha encerrada, do começo ao fim: o estado de quando ela foi
     * criada e tudo o que aconteceu depois. Só quem jogou a batalha pode ver,
     * e só as que guardaram o começo (as criadas antes do replay não têm).
     */
    async replay(userId: string, battleId: string): Promise<ReplayResponse> {
        const { record, team } = await this.findForPlayer(userId, battleId);
        const initial = record.status === 'finished' && record.hasReplay ? await this.store.findInitialState(record.id) : null;

        if (!initial) {
            throw new BattleError('REPLAY_UNAVAILABLE', 409, 'battle.replayUnavailable');
        }

        return { battle: this.toView(record, team), initial: toPublicState(upgradeState(initial)), events: record.events };
    }

    /**
     * O que aconteceu na batalha depois dos `after` primeiros eventos. É a
     * consulta que a tela repete numa batalha entre dois jogadores para ver as
     * jogadas do oponente. Contra a IA a lista vem sempre vazia.
     */
    async events(userId: string, battleId: string, after: number): Promise<BattleResponse> {
        const { record, team } = await this.findForPlayer(userId, battleId);

        return { battle: this.toView(record, team), events: record.events.slice(Math.max(0, after)) };
    }

    async act(userId: string, battleId: string, action: BattleAction): Promise<BattleResponse> {
        const { record, team } = await this.findForPlayer(userId, battleId);
        const actor = record.state.units.find((unit) => unit.id === action.unitId);

        if (actor && actor.team !== team) {
            throw new BattleError('NOT_YOUR_UNIT', 403, 'battle.notYourUnit');
        }

        // applyAction valida o resto (vez, energia, alvo...) e lança GameRuleError.
        const played = applyAction(record.state, action);

        return this.save(record, team, isVersus(record) ? played : this.playAiActions(played));
    }

    /** O jogador desiste: a batalha termina agora, com vitória do outro lado. */
    async surrender(userId: string, battleId: string): Promise<BattleResponse> {
        const { record, team } = await this.findForPlayer(userId, battleId);

        // surrender lança GameRuleError (BATTLE_OVER) se a batalha já acabou.
        return this.save(record, team, surrender(record.state, team));
    }

    /**
     * Partida ranqueada: o adversário passou do prazo sem jogar, e quem está
     * esperando pede a vitória. Vale como desistência do time que travou, com
     * a marca de tempo esgotado no estado. Só quem NÃO está na vez pode pedir,
     * e só depois que o prazo acabou.
     */
    async claimTimeout(userId: string, battleId: string): Promise<BattleResponse> {
        const { record, team } = await this.findForPlayer(userId, battleId);
        const active = getActiveUnit(record.state);

        if (!record.ranked || record.status !== 'in_progress' || !active || active.team === team) {
            throw new BattleError('TIMEOUT_NOT_ALLOWED', 409, 'battle.timeoutNotAllowed');
        }

        if (this.turnTimeLeft(record) > 0) {
            throw new BattleError('TIMEOUT_TOO_EARLY', 409, 'battle.timeoutTooEarly');
        }

        const result = surrender(record.state, active.team);

        result.state.timedOut = true;

        return this.save(record, team, result);
    }

    /** Grava o resultado de uma jogada (ou desistência) e monta a resposta para quem jogou. */
    private async save(record: BattleRecord, team: TeamId, result: BattleResult): Promise<BattleResponse> {
        // Os eventos entram no histórico: é por ele que o outro jogador acompanha
        // a partida, e é ele que o replay mostra depois.
        let saved = await this.store.saveIfStep(record.id, record.step, this.toSnapshot(result.state), [...record.events, ...result.events]);

        if (!saved) {
            throw new BattleError('BATTLE_CONFLICT', 409, 'battle.conflict');
        }

        // Só uma requisição consegue gravar o fim da batalha (a trava é o
        // saveIfStep), então os ouvintes são avisados uma vez só.
        if (saved.status === 'finished' && this.finishedListeners.length > 0) {
            for (const listener of this.finishedListeners) {
                await listener(saved);
            }

            // O ouvinte pode ter mudado a batalha (os pontos da ranqueada).
            saved = (await this.store.findById(saved.id)) ?? saved;
        }

        return { battle: this.toView(saved, team), events: result.events };
    }

    /** Quanto falta do prazo de quem está na vez, em ms (0 quando acabou). O relógio zera a cada jogada gravada. */
    private turnTimeLeft(record: BattleRecord): number {
        return Math.max(0, RANKED_TURN_LIMIT_MS - (this.now().getTime() - record.updatedAt.getTime()));
    }

    private toSnapshot(state: BattleState): BattleSnapshot {
        const finished = state.winner !== null;

        return {
            status: finished ? 'finished' : 'in_progress',
            winner: state.winner,
            turn: state.turn,
            step: state.step,
            state,
            finishedAt: finished ? this.now() : null,
        };
    }

    /** A batalha como `team` a enxerga. */
    private toView(record: BattleRecord, team: TeamId): BattleView {
        const active = getActiveUnit(record.state);
        const hasDeadline = record.ranked && record.status === 'in_progress';

        return {
            id: record.id,
            mode: isVersus(record) ? 'pvp' : 'ai',
            status: record.status,
            winner: record.winner,
            playerTeam: team,
            state: toPublicState(record.state),
            // Na vez do outro jogador não há o que escolher.
            availableActions: active && active.team !== team ? [] : getAvailableActions(record.state),
            cursor: record.events.length,
            hasReplay: record.hasReplay,
            ranked: record.ranked,
            ratingChange: team === 'A' ? record.ratingDeltaA : record.ratingDeltaB,
            turnTimeLeftMs: hasDeadline ? this.turnTimeLeft(record) : null,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
            finishedAt: record.finishedAt,
        };
    }

    /** Busca a batalha, garante que quem pediu joga nela e diz de que lado. */
    private async findForPlayer(userId: string, battleId: string): Promise<{ record: BattleRecord; team: TeamId }> {
        const record = UUID_PATTERN.test(battleId) ? await this.store.findById(battleId) : null;
        const team = record ? teamOf(record, userId) : null;

        // Batalha de outros jogadores responde igual a batalha inexistente,
        // para não revelar quais ids existem.
        if (!record || !team) {
            throw new BattleError('BATTLE_NOT_FOUND', 404, 'battle.notFound');
        }

        // Batalha gravada no formato antigo (antes dos turnos por rodada) é
        // convertida ao ser lida; as atuais passam direto.
        return { record: { ...record, state: upgradeState(record.state) }, team };
    }

    private resolveTeam(ids: string[]): CharacterDefinition[] {
        const hasDuplicates = new Set(ids).size !== ids.length;

        if (ids.length !== this.teamSize || hasDuplicates) {
            throw new BattleError('INVALID_TEAM', 400, 'battle.invalidTeam', { size: String(this.teamSize) });
        }

        return ids.map((id) => {
            const character = CHARACTERS.find((c) => c.id === id);

            if (!character) {
                throw new BattleError('UNKNOWN_CHARACTER', 400, 'battle.unknownCharacter', { id });
            }

            return character;
        });
    }

    /** Sorteia `size` personagens diferentes para a IA. */
    private pickEnemyTeam(size: number): CharacterDefinition[] {
        const pool = [...CHARACTERS];
        const team: CharacterDefinition[] = [];

        while (team.length < size && pool.length > 0) {
            const index = Math.floor(this.random() * pool.length);
            team.push(...pool.splice(index, 1));
        }

        return team;
    }

    /** Um dos cenários, ao acaso. */
    private pickArena(): ArenaId {
        return ARENAS[Math.floor(this.random() * ARENAS.length)] ?? 'muralha';
    }

    /** Enquanto a vez for de uma unidade da IA, ela joga. Acumula os eventos de todas as jogadas. */
    private playAiActions(start: BattleResult): BattleResult {
        let state: BattleState = start.state;
        const events: BattleEvent[] = [...start.events];

        for (let i = 0; i < MAX_AI_ACTIONS_IN_A_ROW; i++) {
            const active = getActiveUnit(state);

            if (!active || active.team !== AI_TEAM) {
                return { state, events };
            }

            const result = applyAction(state, state.training ? chooseTrainingAction(state) : chooseAction(state));

            state = result.state;
            events.push(...result.events);
        }

        throw new Error('A IA jogou vezes demais em sequência');
    }
}

/** Os personagens de um time, como escolhas do jogador (para as estatísticas de uso). */
function picksOf(userId: string, team: CharacterDefinition[]): BattlePick[] {
    return team.map((character) => ({ userId, characterId: character.id }));
}

/**
 * O estado sem o que fica só no servidor: com o gerador de números aleatórios
 * e o que ele sorteou no turno, o jogador poderia prever os críticos. A fúria
 * é calculada a partir do turno e vai junto para a tela mostrar.
 */
function toPublicState(full: BattleState): PublicBattleState {
    const { rngState: _rngState, draws: _draws, ...state } = full;

    return { ...state, fury: getFuryBonus(state.turn) };
}

/** De que lado `userId` joga: A para quem criou a batalha, B para o oponente, null se ele não está nela. */
function teamOf(battle: { userId: string; opponentId: string | null }, userId: string): TeamId | null {
    if (battle.userId === userId) return 'A';
    if (battle.opponentId === userId) return 'B';

    return null;
}

function isVersus(record: BattleRecord): boolean {
    return record.opponentId !== null;
}

