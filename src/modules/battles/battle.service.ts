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

/** O jogador é sempre o time A; a IA é o time B. */
export const PLAYER_TEAM: TeamId = 'A';
export const AI_TEAM: TeamId = 'B';

/** Toda batalha é 5 contra 5: os dois times entram com exatamente este número de personagens. */
export const TEAM_SIZE = 5;

const LIST_LIMIT = 20;
const MAX_AI_ACTIONS_IN_A_ROW = 100;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
 * O motor resolve uma ação de cada vez. Aqui está o que é próprio de uma
 * partida contra a IA: depois da jogada do jogador, a IA joga sozinha até a
 * vez voltar para ele, e só então o resultado é gravado e devolvido.
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

    list(userId: string): Promise<BattleSummary[]> {
        return this.store.findManyByUser(userId, LIST_LIMIT);
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

        return { battle: toView(record), events };
    }

    async get(userId: string, battleId: string): Promise<BattleView> {
        return toView(await this.findOwned(userId, battleId));
    }

    async act(userId: string, battleId: string, action: BattleAction): Promise<BattleResponse> {
        const record = await this.findOwned(userId, battleId);
        const actor = record.state.units.find((unit) => unit.id === action.unitId);

        if (actor && actor.team !== PLAYER_TEAM) {
            throw new BattleError('NOT_YOUR_UNIT', 403, 'battle.notYourUnit');
        }

        // applyAction valida o resto (vez, energia, alvo...) e lança GameRuleError.
        const { state, events } = this.playAiActions(applyAction(record.state, action));
        const saved = await this.store.saveIfStep(record.id, record.step, toSnapshot(state));

        if (!saved) {
            throw new BattleError('BATTLE_CONFLICT', 409, 'battle.conflict');
        }

        return { battle: toView(saved), events };
    }

    /** O jogador desiste: a batalha termina agora, com vitória da IA. */
    async surrender(userId: string, battleId: string): Promise<BattleResponse> {
        const record = await this.findOwned(userId, battleId);

        // surrender lança GameRuleError (BATTLE_OVER) se a batalha já acabou.
        const { state, events } = surrender(record.state, PLAYER_TEAM);
        const saved = await this.store.saveIfStep(record.id, record.step, toSnapshot(state));

        if (!saved) {
            throw new BattleError('BATTLE_CONFLICT', 409, 'battle.conflict');
        }

        return { battle: toView(saved), events };
    }

    /** Busca a batalha e garante que ela é de quem pediu. */
    private async findOwned(userId: string, battleId: string): Promise<BattleRecord> {
        const record = UUID_PATTERN.test(battleId) ? await this.store.findById(battleId) : null;

        // Batalha de outro jogador responde igual a batalha inexistente, para
        // não revelar quais ids existem.
        if (!record || record.userId !== userId) {
            throw new BattleError('BATTLE_NOT_FOUND', 404, 'battle.notFound');
        }

        // Batalha gravada no formato antigo (antes dos turnos por rodada) é
        // convertida ao ser lida; as atuais passam direto.
        return { ...record, state: upgradeState(record.state) };
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

function toView(record: BattleRecord): BattleView {
    // O gerador de números aleatórios e o que ele sorteou no turno ficam só no
    // servidor: com eles o jogador poderia prever os críticos.
    const { rngState: _rngState, draws: _draws, ...state } = record.state;

    return {
        id: record.id,
        status: record.status,
        winner: record.winner,
        playerTeam: PLAYER_TEAM,
        // A fúria é calculada a partir do turno; vai junto para a tela mostrar.
        state: { ...state, fury: getFuryBonus(state.turn) },
        availableActions: getAvailableActions(record.state),
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        finishedAt: record.finishedAt,
    };
}
