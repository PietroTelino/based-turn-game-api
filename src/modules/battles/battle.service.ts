import {
    CHARACTERS,
    applyAction,
    chooseAction,
    createBattle,
    getActiveUnit,
    getAvailableActions,
    getFuryBonus,
    surrender,
    upgradeState,
} from '../../game';
import type { BattleAction, BattleEvent, BattleResult, BattleState, CharacterDefinition, TeamId } from '../../game';
import { BattleError } from './battle.errors';
import type {
    BattleRecord,
    BattleResponse,
    BattleSnapshot,
    BattleStore,
    BattleSummary,
    BattleView,
} from './battle.types';

/**
 * Contra a IA, o jogador é o time A e a IA é o time B. Entre dois jogadores,
 * quem criou a sala é o time A e quem entrou é o time B.
 */
export const PLAYER_TEAM: TeamId = 'A';
export const AI_TEAM: TeamId = 'B';

/** Toda batalha é 5 contra 5: os dois times entram com exatamente este número de personagens. */
export const TEAM_SIZE = 5;

const LIST_LIMIT = 20;
const MAX_AI_ACTIONS_IN_A_ROW = 100;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Os dois lados de uma batalha entre jogadores. Quem criou a sala fica com o time A. */
export interface CreateVersusInput {
    hostId: string;
    hostTeam: string[];
    guestId: string;
    guestTeam: string[];
    /** Semente do motor. Só os testes usam. */
    seed?: number;
}

export interface CreateBattleInput {
    /** Ids dos personagens do jogador: exatamente TEAM_SIZE, sem repetir. */
    team: string[];
    /** Ids dos personagens da IA, com a mesma regra. Se faltar, o time é sorteado. */
    enemyTeam?: string[];
    /** Semente do motor. Só os testes usam; a rota HTTP não aceita. */
    seed?: number;
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
 */
export class BattleService {
    private teamSize: number;

    constructor(
        private store: BattleStore,
        private random: () => number = Math.random,
        /**
         * `teamSize` troca o tamanho obrigatório dos times. O jogo nunca passa
         * isto (vale TEAM_SIZE); existe para os testes poderem usar batalhas
         * de 1 contra 1, que são muito mais fáceis de acompanhar.
         */
        options: { teamSize?: number } = {},
    ) {
        this.teamSize = options.teamSize ?? TEAM_SIZE;
    }

    listCharacters(): CharacterDefinition[] {
        return CHARACTERS;
    }

    async list(userId: string): Promise<BattleSummary[]> {
        const rows = await this.store.findManyByUser(userId, LIST_LIMIT);

        return rows.map(({ userId: ownerId, opponentId, ...row }) => ({
            ...row,
            mode: opponentId === null ? 'ai' : 'pvp',
            playerTeam: teamOf({ userId: ownerId, opponentId }, userId) ?? PLAYER_TEAM,
        }));
    }

    async create(userId: string, input: CreateBattleInput): Promise<BattleResponse> {
        const teamA = this.resolveTeam(input.team);
        const teamB = input.enemyTeam ? this.resolveTeam(input.enemyTeam) : this.pickEnemyTeam(teamA.length);

        const started = createBattle({
            teamA,
            teamB,
            ...(input.seed !== undefined && { seed: input.seed }),
        });

        // Se as unidades da IA forem as primeiras da ordem, ela já abre a batalha.
        const { state, events } = this.playAiActions(started);
        const record = await this.store.create(userId, toSnapshot(state));

        return { battle: toView(record, PLAYER_TEAM), events };
    }

    /**
     * Cria a batalha entre dois jogadores e devolve o id dela. Quem chama é o
     * módulo de salas, quando os dois avisam que estão prontos. Ninguém joga
     * aqui: a batalha nasce parada na vez da primeira unidade.
     */
    async createVersus(input: CreateVersusInput): Promise<string> {
        const started = createBattle({
            teamA: this.resolveTeam(input.hostTeam),
            teamB: this.resolveTeam(input.guestTeam),
            ...(input.seed !== undefined && { seed: input.seed }),
        });
        const record = await this.store.create(input.hostId, toSnapshot(started.state), {
            opponentId: input.guestId,
            events: started.events,
        });

        return record.id;
    }

    /** Confere um time sem criar nada: lança INVALID_TEAM ou UNKNOWN_CHARACTER. */
    validateTeam(ids: string[]): void {
        this.resolveTeam(ids);
    }

    async get(userId: string, battleId: string): Promise<BattleView> {
        const { record, team } = await this.findForPlayer(userId, battleId);

        return toView(record, team);
    }

    /**
     * O que aconteceu na batalha depois dos `after` primeiros eventos. É a
     * consulta que a tela repete numa batalha entre dois jogadores para ver as
     * jogadas do oponente. Contra a IA a lista vem sempre vazia.
     */
    async events(userId: string, battleId: string, after: number): Promise<BattleResponse> {
        const { record, team } = await this.findForPlayer(userId, battleId);

        return { battle: toView(record, team), events: record.events.slice(Math.max(0, after)) };
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

    /** Grava o resultado de uma jogada (ou desistência) e monta a resposta para quem jogou. */
    private async save(record: BattleRecord, team: TeamId, result: BattleResult): Promise<BattleResponse> {
        const saved = await this.store.saveIfStep(
            record.id,
            record.step,
            toSnapshot(result.state),
            // Entre dois jogadores, os eventos entram no histórico para o outro lado buscar.
            isVersus(record) ? [...record.events, ...result.events] : undefined,
        );

        if (!saved) {
            throw new BattleError('BATTLE_CONFLICT', 409, 'battle.conflict');
        }

        return { battle: toView(saved, team), events: result.events };
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

    /** Enquanto a vez for de uma unidade da IA, ela joga. Acumula os eventos de todas as jogadas. */
    private playAiActions(start: BattleResult): BattleResult {
        let state: BattleState = start.state;
        const events: BattleEvent[] = [...start.events];

        for (let i = 0; i < MAX_AI_ACTIONS_IN_A_ROW; i++) {
            const active = getActiveUnit(state);

            if (!active || active.team !== AI_TEAM) {
                return { state, events };
            }

            const result = applyAction(state, chooseAction(state));

            state = result.state;
            events.push(...result.events);
        }

        throw new Error('A IA jogou vezes demais em sequência');
    }
}

function toSnapshot(state: BattleState): BattleSnapshot {
    const finished = state.winner !== null;

    return {
        status: finished ? 'finished' : 'in_progress',
        winner: state.winner,
        turn: state.turn,
        step: state.step,
        state,
        finishedAt: finished ? new Date() : null,
    };
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

/** A batalha como `team` a enxerga. */
function toView(record: BattleRecord, team: TeamId): BattleView {
    // O gerador de números aleatórios e o que ele sorteou no turno ficam só no
    // servidor: com eles o jogador poderia prever os críticos.
    const { rngState: _rngState, draws: _draws, ...state } = record.state;
    const active = getActiveUnit(record.state);

    return {
        id: record.id,
        mode: isVersus(record) ? 'pvp' : 'ai',
        status: record.status,
        winner: record.winner,
        playerTeam: team,
        // A fúria é calculada a partir do turno; vai junto para a tela mostrar.
        state: { ...state, fury: getFuryBonus(state.turn) },
        // Na vez do outro jogador não há o que escolher.
        availableActions: active && active.team !== team ? [] : getAvailableActions(record.state),
        cursor: record.events.length,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        finishedAt: record.finishedAt,
    };
}
