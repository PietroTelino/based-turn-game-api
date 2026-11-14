import {
    AI_DIFFICULTIES,
    ARENAS,
    CAMPAIGN,
    CHARACTERS,
    applyAction,
    chooseAction,
    chooseAiAction,
    createBattle,
    getCampaignStage,
    getActiveUnit,
    getBoss,
    towerFloor,
    applyTowerModifiers,
    dailyChallenge,
    eventOf,
    raidOf,
    raidBossDefinition,
    getAvailableActions,
    getFuryBonus,
    surrender,
    upgradeState,
} from '../../game';
import type { AiDifficulty, ArenaId, BattleAction, BattleEvent, BattleResult, BattleState, CharacterDefinition, TeamId } from '../../game';
import { BattleError } from './battle.errors';
import type {
    BattlePick,
    BattleRecord,
    BattleResponse,
    BattleSnapshot,
    BattleStore,
    BattleSummary,
    BattleView,
    CampaignStageView,
    PublicBattleState,
    ReplayResponse,
    TowerView,
    ChallengeView,
    RaidView,
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
 * Entre dois jogadores (casual ou ranqueada): quanto tempo quem está na vez
 * tem para jogar. Passado o prazo, a jogada é feita ao acaso por ele
 * (`playExpiredTurn`), e a vez seguinte começa com o prazo cheio. Assim
 * ninguém trava a partida fechando a tela.
 */
export const PVP_TURN_LIMIT_MS = 30_000;
/**
 * Semente fixa da batalha de treino. O tutorial do app é um roteiro, jogada
 * por jogada (src/battle/tutorial.ts no app): com a mesma semente, os mesmos
 * times e a IA de treino, que não sorteia nada, a batalha guiada sai sempre
 * igual, e cada passo do roteiro encontra a situação que ele explica.
 * Se mudar a semente, os times ou a IA de treino, confira o roteiro no app.
 */
export const TUTORIAL_SEED = 4;

const LIST_LIMIT = 50;
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
    /** Batalha de treino (o tutorial): a IA joga fraco de propósito, e o nível não conta. */
    training?: boolean;
    /** O nível da IA. Sem ele, 'normal'. */
    difficulty?: AiDifficulty;
    /**
     * Uma fase da campanha: o time inimigo e o cenário são os da fase (o
     * `enemyTeam` é ignorado). A fase precisa estar aberta para o jogador.
     */
    campaignStage?: number;
    /** Um andar da torre: o próximo que o jogador ainda não venceu. Time, cenário e nível são os do andar. */
    towerFloor?: number;
    /** O desafio do dia: time inimigo, cenário, nível e modificadores são os do desafio. */
    challenge?: boolean;
    /** Partida caos: os dois times são sorteados (o `team` pedido é ignorado). */
    chaos?: boolean;
    /** O chefe semanal: o time inimigo é o chefe e os lacaios dele. */
    raid?: boolean;
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

    private lockedOf: ((userId: string, team: string[]) => Promise<string | null>) | null = null;
    private canWatch: ((viewerId: string, playerIds: string[]) => Promise<boolean>) | null = null;

    /**
     * Quem diz se alguém pode assistir às batalhas de outros jogadores (é amigo
     * deles: src/modules/friends). Sem isto (nos testes), ninguém assiste.
     */
    setViewerCheck(canWatch: (viewerId: string, playerIds: string[]) => Promise<boolean>): void {
        this.canWatch = canWatch;
    }

    /**
     * Quem diz se o jogador já tem os personagens (src/modules/progression).
     * Sem isto (nos testes), todos os personagens valem para todos.
     */
    setAccessCheck(lockedOf: (userId: string, team: string[]) => Promise<string | null>): void {
        this.lockedOf = lockedOf;
    }

    /** Lança CHARACTER_LOCKED se o jogador ainda não desbloqueou algum personagem do time. */
    async assertOwned(userId: string, team: string[]): Promise<void> {
        const locked = this.lockedOf ? await this.lockedOf(userId, team) : null;

        if (locked) {
            throw new BattleError('CHARACTER_LOCKED', 403, 'battle.characterLocked', { id: locked });
        }
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

    /** A campanha como o jogador a vê: cada fase, se já abriu e em que níveis ele já venceu. */
    async campaign(userId: string): Promise<CampaignStageView[]> {
        const wins = await this.store.findCampaignWins(userId);

        return CAMPAIGN.map((stage) => ({
            stage: stage.stage,
            key: stage.key,
            arena: stage.arena,
            enemyTeam: [...stage.enemyTeam],
            unlocked: stage.stage === 1 || wins.some((win) => win.stage === stage.stage - 1),
            clearedOn: AI_DIFFICULTIES.filter((difficulty) => wins.some((win) => win.stage === stage.stage && win.difficulty === difficulty)),
            boss: stage.boss ? { slot: stage.boss.slot, name: getBoss(stage.boss.id)?.name ?? stage.boss.id } : null,
        }));
    }

    /** O chefe semanal: a vida total, o dano de todos, o do jogador e as tentativas de hoje. */
    async raid(userId: string, limit = 10): Promise<RaidView> {
        const raid = raidOf(this.now());
        const results = await this.store.findRaidDamage(raid.week);
        const damage = Math.min(raid.totalHp, results.reduce((sum, row) => sum + row.damage, 0));
        const used = await this.store.countRaidAttempts(userId, raid.week, new Date(Date.parse(`${this.today()}T00:00:00Z`)));

        return {
            week: raid.week,
            bossId: raid.bossId,
            characterId: raid.characterId,
            name: raid.name,
            minions: raid.minions,
            totalHp: raid.totalHp,
            damage,
            defeated: damage >= raid.totalHp,
            yourDamage: results.find((row) => row.userId === userId)?.damage ?? 0,
            attemptsLeft: Math.max(0, raid.attemptsPerDay - used),
            attemptsPerDay: raid.attemptsPerDay,
            battleHp: raid.battleHp,
            reward: raid.reward,
            top: results.slice(0, limit).map((row, index) => ({ position: index + 1, ...row })),
            endsAt: raid.endsAt,
        };
    }

    /** O desafio do dia, com a melhor vitória do jogador e o placar. */
    async challenge(userId: string, limit = 20): Promise<ChallengeView> {
        const today = this.today();
        const challenge = dailyChallenge(today, CHARACTERS.map((character) => character.id));
        const results = await this.store.findChallengeResults(today);
        const mine = results.findIndex((row) => row.userId === userId);

        return {
            day: today,
            enemyTeam: challenge.enemyTeam,
            arena: challenge.arena,
            difficulty: challenge.difficulty,
            modifiers: challenge.modifiers,
            scalePercent: Math.round((challenge.scale - 1) * 100),
            reward: challenge.reward,
            best: mine >= 0 ? results[mine]!.turns : null,
            leaderboard: results.slice(0, limit).map((row, index) => ({ position: index + 1, ...row })),
            you: mine >= 0 ? { position: mine + 1, turns: results[mine]!.turns } : null,
            resetsAt: new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000),
        };
    }

    /** O dia de hoje em UTC ("2026-11-14"): é por ele que o desafio troca. */
    private today(): string {
        return this.now().toISOString().slice(0, 10);
    }

    /** A torre: o andar mais alto vencido e o próximo, com o time e os modificadores dele. */
    async tower(userId: string): Promise<TowerView> {
        const best = await this.store.findTowerBest(userId);
        const floor = towerFloor(best + 1, CHARACTERS.map((character) => character.id));

        return {
            best,
            next: {
                floor: floor.floor,
                enemyTeam: floor.enemyTeam,
                arena: floor.arena,
                difficulty: floor.difficulty,
                modifiers: floor.modifiers,
                scalePercent: Math.round((floor.scale - 1) * 100),
                reward: floor.reward,
            },
        };
    }

    async create(userId: string, input: CreateBattleInput): Promise<BattleResponse> {
        // Na partida caos o time do jogador também é sorteado (com todos os personagens).
        const teamA = input.chaos ? this.pickEnemyTeam(this.teamSize) : this.resolveTeam(input.team);

        // O treino tem o time dele, que o jogador não escolhe.
        if (!input.training && !input.chaos) {
            await this.assertOwned(userId, input.team);
        }

        const raid = input.raid ? await this.openRaid(userId) : undefined;

        const stage = input.campaignStage !== undefined ? await this.openStage(userId, input.campaignStage) : undefined;
        const floor = input.towerFloor !== undefined && !stage ? await this.openFloor(userId, input.towerFloor) : undefined;
        const challenge = input.challenge && !stage && !floor && !raid ? dailyChallenge(this.today(), CHARACTERS.map((character) => character.id)) : undefined;
        // A fase e o andar têm o time deles. Nos testes de 1 contra 1, entram só os primeiros.
        let teamB = raid
            ? [raidBossDefinition(raid), ...raid.minions.map((id) => CHARACTERS.find((c) => c.id === id)!)].slice(0, this.teamSize)
            : stage
            ? this.resolveTeam(stage.enemyTeam.slice(0, this.teamSize))
            : floor
              ? applyTowerModifiers(this.resolveTeam(floor.enemyTeam.slice(0, this.teamSize)), floor)
              : challenge
                ? applyTowerModifiers(this.resolveTeam(challenge.enemyTeam.slice(0, this.teamSize)), challenge)
                : input.enemyTeam
                ? this.resolveTeam(input.enemyTeam)
                : this.pickEnemyTeam(teamA.length);

        // O chefe da fase entra no lugar do personagem dele.
        const boss = stage?.boss ? getBoss(stage.boss.id) : undefined;

        if (stage?.boss && boss && stage.boss.slot < teamB.length) {
            teamB = teamB.map((character, index) => (index === stage.boss!.slot ? boss : character));
        }

        const difficulty = input.training ? undefined : floor ? floor.difficulty : challenge ? challenge.difficulty : (input.difficulty ?? 'normal');

        // O treino sai sempre igual (TUTORIAL_SEED), para o roteiro do tutorial bater.
        const seed = input.seed ?? (input.training ? TUTORIAL_SEED : undefined);
        const started = createBattle({
            teamA,
            teamB,
            ...(seed !== undefined && { seed }),
        });

        // A marca de treino fica no estado: é ela que diz, em cada jogada desta
        // batalha, que a IA deve jogar fraco, e à tela, que deve mostrar o guia.
        if (input.training) {
            started.state.training = true;
        }

        // O nível fica no estado: é por ele que, em cada jogada, a IA sabe como jogar.
        if (difficulty) {
            started.state.difficulty = difficulty;
        }

        if (stage) {
            started.state.campaignStage = stage.stage;
        }

        if (floor) {
            started.state.towerFloor = floor.floor;
            started.state.towerModifiers = floor.modifiers;
        }

        if (challenge) {
            started.state.challengeDay = challenge.day;
            started.state.towerModifiers = challenge.modifiers;
        }

        if (raid) {
            started.state.raidWeek = raid.week;
        }

        if (input.chaos) {
            started.state.chaos = true;
        }

        // O evento da semana vale em toda batalha de verdade (o treino fica igual, para o roteiro do tutorial).
        if (!input.training) {
            this.applyEvent(started.state);
        }

        // O cenário é sorteado depois do time da IA, para não mudar o time que sai de um mesmo sorteio.
        // A fase da campanha e o andar da torre têm o seu.
        started.state.arena = stage ? stage.arena : floor ? floor.arena : challenge ? challenge.arena : this.pickArena();

        // Se as unidades da IA forem as primeiras da ordem, ela já abre a batalha.
        const { state, events } = this.playAiActions(started);
        const record = await this.store.create(userId, this.toSnapshot(state), {
            events,
            initialState: started.state,
            // O treino tem sempre o mesmo time: não é escolha do jogador e não entra nas estatísticas.
            picks: input.training ? [] : picksOf(userId, teamA),
            ...(difficulty && { difficulty }),
            ...(stage && { campaignStage: stage.stage }),
            ...(floor && { towerFloor: floor.floor }),
            ...(challenge && { challengeDay: challenge.day }),
            ...(raid && { raidWeek: raid.week }),
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
        this.applyEvent(started.state);

        const record = await this.store.create(input.hostId, this.toSnapshot(started.state), {
            opponentId: input.guestId,
            events: started.events,
            initialState: started.state,
            ...(input.ranked && { ranked: true }),
            picks: [...picksOf(input.hostId, teamA), ...picksOf(input.guestId, teamB)],
        });

        return record.id;
    }

    /** A fase pedida, se existe e o jogador já pode jogá-la (a anterior foi vencida). */
    private async openStage(userId: string, number: number) {
        const stage = getCampaignStage(number);

        if (!stage) {
            throw new BattleError('UNKNOWN_STAGE', 400, 'battle.unknownStage', { stage: String(number) });
        }

        if (stage.stage > 1) {
            const wins = await this.store.findCampaignWins(userId);

            if (!wins.some((win) => win.stage === stage.stage - 1)) {
                throw new BattleError('STAGE_LOCKED', 403, 'battle.stageLocked');
            }
        }

        return stage;
    }

    /** Marca no estado o evento da semana e o bônus de dano do elemento dele. */
    private applyEvent(state: BattleState): void {
        const event = eventOf(this.now());

        state.eventId = event.id;
        state.elementBonus = { element: event.element, amount: event.bonus };
    }

    /** O chefe da semana, se o jogador ainda tem tentativa hoje. */
    private async openRaid(userId: string) {
        const raid = raidOf(this.now());
        const used = await this.store.countRaidAttempts(userId, raid.week, new Date(Date.parse(`${this.today()}T00:00:00Z`)));

        if (used >= raid.attemptsPerDay) {
            throw new BattleError('RAID_LIMIT', 409, 'battle.raidLimit', { count: String(raid.attemptsPerDay) });
        }

        return raid;
    }

    /** O andar pedido, se é o próximo do jogador (o mais alto vencido + 1). */
    private async openFloor(userId: string, number: number) {
        if (!Number.isInteger(number) || number < 1) {
            throw new BattleError('UNKNOWN_FLOOR', 400, 'battle.unknownFloor', { floor: String(number) });
        }

        if (number !== (await this.store.findTowerBest(userId)) + 1) {
            throw new BattleError('TOWER_LOCKED', 403, 'battle.towerLocked');
        }

        return towerFloor(number, CHARACTERS.map((character) => character.id));
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

        return this.toView(await this.playExpiredTurn(record), team);
    }

    /**
     * A batalha encerrada, do começo ao fim: o estado de quando ela foi
     * criada e tudo o que aconteceu depois. Só quem jogou a batalha pode ver,
     * (ou é amigo de quem jogou), e só as que guardaram o começo (as criadas
     * antes do replay não têm).
     */
    async replay(userId: string, battleId: string): Promise<ReplayResponse> {
        const { record, team } = await this.findForViewer(userId, battleId);
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
        const found = await this.findForPlayer(userId, battleId);
        // As telas dos dois perguntam por aqui o tempo todo: é aqui que o prazo vencido vira jogada automática.
        const record = await this.playExpiredTurn(found.record);

        return { battle: this.toView(record, found.team), events: record.events.slice(Math.max(0, after)) };
    }

    /**
     * Assistir: a batalha de um amigo (ou a própria), vista do lado A, sem
     * poder jogar, e o que aconteceu depois dos `after` primeiros eventos. É a
     * consulta que a tela do espectador repete.
     */
    async watch(userId: string, battleId: string, after: number): Promise<BattleResponse> {
        const found = await this.findForViewer(userId, battleId);
        const record = await this.playExpiredTurn(found.record);

        return { battle: this.toView(record, found.team, found.spectating), events: record.events.slice(Math.max(0, after)) };
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
     * Entre dois jogadores: se o prazo de quem está na vez acabou, faz uma
     * jogada ao acaso por ele (uma habilidade que ele pode usar, num alvo
     * possível), com um evento turn_timed_out antes, para as telas mostrarem o
     * que houve. Devolve a batalha como ficou. Quem chama são as consultas
     * (get e events), que as telas repetem; se duas chegarem juntas, só uma
     * grava e a outra lê o que ela gravou.
     */
    private async playExpiredTurn(record: BattleRecord): Promise<BattleRecord> {
        const active = getActiveUnit(record.state);

        if (!isVersus(record) || record.status !== 'in_progress' || !active || this.turnTimeLeft(record) > 0) {
            return record;
        }

        const played = applyAction(record.state, this.randomAction(record.state));
        const result: BattleResult = {
            state: played.state,
            events: [{ type: 'turn_timed_out', unitId: active.id, team: active.team }, ...played.events],
        };
        const saved = await this.commit(record, result);

        if (saved) {
            return saved;
        }

        const fresh = await this.store.findById(record.id);

        return fresh ? { ...fresh, state: upgradeState(fresh.state) } : record;
    }

    /** Uma jogada qualquer que a unidade da vez pode fazer: a habilidade e o alvo saem do sorteio do serviço. */
    private randomAction(state: BattleState): BattleAction {
        const options = getAvailableActions(state, { previews: false }).filter((option) => option.usable);
        const option = options[Math.floor(this.random() * options.length)];

        if (!option || state.activeUnitId === null) {
            return chooseAction(state);
        }

        const targetId = option.requiresTarget ? option.targetIds[Math.floor(this.random() * option.targetIds.length)] : undefined;

        return { unitId: state.activeUnitId, skillId: option.skill.id, ...(targetId !== undefined && { targetId }) };
    }

    /** Grava o resultado de uma jogada (ou desistência) e monta a resposta para quem jogou. */
    private async save(record: BattleRecord, team: TeamId, result: BattleResult): Promise<BattleResponse> {
        const saved = await this.commit(record, result);

        if (!saved) {
            throw new BattleError('BATTLE_CONFLICT', 409, 'battle.conflict');
        }

        return { battle: this.toView(saved, team), events: result.events };
    }

    /**
     * Grava o resultado no histórico da batalha, só se ninguém gravou antes
     * (devolve null nesse caso), e avisa os ouvintes quando ela acaba.
     */
    private async commit(record: BattleRecord, result: BattleResult): Promise<BattleRecord | null> {
        // Os eventos entram no histórico: é por ele que o outro jogador acompanha
        // a partida, e é ele que o replay mostra depois.
        let saved = await this.store.saveIfStep(record.id, record.step, this.toSnapshot(result.state), [...record.events, ...result.events]);

        if (!saved) {
            return null;
        }

        // Batalha contra o chefe semanal: o dano que ele levou conta para a vida total da semana.
        if (saved.status === 'finished' && saved.raidWeek) {
            const boss = saved.state.units.find((unit) => unit.team === AI_TEAM && unit.boss);
            const damage = boss ? Math.max(0, boss.stats.maxHp - Math.max(0, boss.hp)) : 0;

            await this.store.setRaidDamage(saved.id, damage);
            saved = { ...saved, raidDamage: damage };
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

        return saved;
    }

    /** Quanto falta do prazo de quem está na vez, em ms (0 quando acabou). O relógio zera a cada jogada gravada. */
    private turnTimeLeft(record: BattleRecord): number {
        return Math.max(0, PVP_TURN_LIMIT_MS - (this.now().getTime() - record.updatedAt.getTime()));
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
    private toView(record: BattleRecord, team: TeamId, spectating = false): BattleView {
        const active = getActiveUnit(record.state);
        const hasDeadline = isVersus(record) && record.status === 'in_progress';

        return {
            id: record.id,
            mode: isVersus(record) ? 'pvp' : 'ai',
            status: record.status,
            winner: record.winner,
            playerTeam: team,
            state: toPublicState(record.state),
            // Na vez do outro jogador não há o que escolher.
            availableActions: spectating || (active && active.team !== team) ? [] : getAvailableActions(record.state),
            cursor: record.events.length,
            hasReplay: record.hasReplay,
            ranked: record.ranked,
            ratingChange: team === 'A' ? record.ratingDeltaA : record.ratingDeltaB,
            difficulty: record.difficulty,
            campaignStage: record.campaignStage,
            towerFloor: record.towerFloor,
            challengeDay: record.challengeDay,
            raidWeek: record.raidWeek,
            spectating,
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

    /** Como findForPlayer, mas também aceita quem só assiste (amigo de quem joga): o lado mostrado é o A. */
    private async findForViewer(userId: string, battleId: string): Promise<{ record: BattleRecord; team: TeamId; spectating: boolean }> {
        const record = UUID_PATTERN.test(battleId) ? await this.store.findById(battleId) : null;
        const team = record ? teamOf(record, userId) : null;

        if (record && team) {
            return { record: { ...record, state: upgradeState(record.state) }, team, spectating: false };
        }

        const players = record ? [record.userId, ...(record.opponentId ? [record.opponentId] : [])] : [];

        // O treino não tem graça de assistir e não aparece para os outros.
        if (!record || record.state.training || !this.canWatch || !(await this.canWatch(userId, players))) {
            throw new BattleError('BATTLE_NOT_FOUND', 404, 'battle.notFound');
        }

        return { record: { ...record, state: upgradeState(record.state) }, team: 'A', spectating: true };
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

            // O treino e o nível da batalha ficam no estado: chooseAiAction lê dali como jogar.
            const result = applyAction(state, chooseAiAction(state));

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

