import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { BattleRecord } from '../../battles/battle.types';
import type { Achievement } from '../progression.catalog';
import { DAILY_MISSIONS, dailyPeriod, missionsFor } from '../progression.missions';
import { ProgressionService } from '../progression.service';
import type { Currency, FinishedBattle, Metrics, ProgressionStore } from '../progression.service';

const ANA = 'ana';
const IDS = ['piromante', 'cavaleiro', 'sacerdote', 'barbaro', 'criomante', 'arqueiro', 'ladino', 'harpia', 'driade'];

/** Guarda tudo em memória; as métricas vêm de fora (o teste diz quantas vitórias o jogador tem). */
class MemoryStore implements ProgressionStore {
    gold = 0;
    diamonds = 0;
    chars = new Set<string>();
    done = new Map<string, Date>();
    paid = new Map<string, { gold: number; xp: number; achievements: string[] }>();
    xp = 0;
    async userXp() { return this.xp; }
    async xpSince() { return this.xp; }
    async buyWithDiamonds(_u: string, key: string, price: number) {
        if (this.claims.has(key)) return 'owned' as const;
        if (this.diamonds < price) return 'insufficient' as const;
        this.diamonds -= price;
        this.claims.add(key);
        return 'ok' as const;
    }
    m: Metrics = { wins: 0, played: 0, winsHard: 0, campaign: 0, campaignHard: 0, pvpWins: 0, rankedWins: 0, characterWins: {} };

    async wallet() { return { gold: this.gold, diamonds: this.diamonds }; }
    async unlocked() { return [...this.chars]; }
    async completed() { return [...this.done].map(([achievementId, completedAt]) => ({ achievementId, completedAt })); }
    async metrics() { return this.m; }
    async complete(_u: string, a: Achievement, refund: number) {
        if (this.done.has(a.id)) return false;
        this.done.set(a.id, new Date());
        if (a.reward.character && !refund) this.chars.add(a.reward.character);
        this.gold += (a.reward.gold ?? 0) + refund;
        this.diamonds += a.reward.diamonds ?? 0;
        return true;
    }
    async purchase(_u: string, id: string, currency: Currency, price: number) {
        if (this.chars.has(id)) return 'owned' as const;
        if (this[currency] < price) return 'insufficient' as const;
        this[currency] -= price;
        this.chars.add(id);
        return 'ok' as const;
    }
    async addFunds(_u: string, g: number, d: number) { this.gold = Math.max(0, this.gold + g); this.diamonds = Math.max(0, this.diamonds + d); }
    async unlock(_u: string, id: string) { this.chars.add(id); }
    async payBattle(b: string, _u: string, gold: number, xp: number) {
        if (this.paid.has(b)) return false;
        this.paid.set(b, { gold, xp, achievements: [] });
        this.gold += gold;
        this.xp += xp;
        return true;
    }
    async setBattleAchievements(b: string, _u: string, list: string[]) { this.paid.get(b)!.achievements = list; }
    async battleReward(b: string) { return this.paid.get(b) ?? null; }
    finished: FinishedBattle[] = [];
    clears: { stage: number; difficulty: string }[] = [];
    claims = new Set<string>();
    loginStreak = 0;
    loginLastDay: string | null = null;
    async loginState() { return { streak: this.loginStreak, lastDay: this.loginLastDay }; }
    async saveLogin(_u: string, expected: string | null, streak: number, today: string, gold: number, diamonds: number) {
        if (this.loginLastDay !== expected) return false;
        this.loginStreak = streak;
        this.loginLastDay = today;
        this.gold += gold;
        this.diamonds += diamonds;
        return true;
    }
    async finishedSince(_u: string, since: Date) { return this.finished.filter((b) => b.finishedAt >= since); }
    async campaignClears() { return this.clears; }
    async claimed(_u: string, keys: string[]) { return keys.filter((k) => this.claims.has(k)); }
    async claim(_u: string, key: string, gold: number, diamonds: number) {
        if (this.claims.has(key)) return false;
        this.claims.add(key);
        this.gold += gold;
        this.diamonds += diamonds;
        return true;
    }
}

const NOW = new Date('2026-11-14T15:00:00Z');
/** Uma data na semana do evento das sombras (ouro em dobro só no PvP): os testes de ouro contra a IA não mudam. */
const SOMBRAS = new Date('2026-11-17T12:00:00Z');
const ROLES: Record<string, string> = { piromante: 'mage', criomante: 'mage', cavaleiro: 'tank', sacerdote: 'support', ladino: 'assassin' };

const battle = (over: Partial<BattleRecord>): BattleRecord => ({ id: 'b1', userId: ANA, opponentId: null, winner: 'A', difficulty: 'normal', campaignStage: null, ranked: false, createdAt: SOMBRAS, ...over } as unknown as BattleRecord);

function setup() {
    const store = new MemoryStore();

    return { store, service: new ProgressionService(store, () => IDS, { now: () => NOW, roleOf: (id) => ROLES[id] }) };
}

describe('ProgressionService', () => {
    it('o jogador começa só com os seis personagens iniciais', async () => {
        const { service } = setup();

        assert.equal(await service.lockedOf(ANA, ['piromante', 'cavaleiro', 'sacerdote', 'barbaro', 'arqueiro']), null);
        assert.equal(await service.lockedOf(ANA, ['piromante', 'ladino']), 'ladino');
    });

    it('a vitória paga ouro uma vez só e completa a primeira conquista', async () => {
        const { store, service } = setup();

        store.m.wins = 1;
        await service.onBattleFinished(battle({}));
        await service.onBattleFinished(battle({}));

        assert.deepEqual(await service.battleReward('b1', ANA), { gold: 40, xp: 100, achievements: ['primeira-vitoria'] });
        // 40 da vitória + 100 da conquista + 100 do nível 2 (a vitória deu 100 de experiência).
        assert.equal(store.gold, 40 + 100 + 100);
    });

    it('o treino não paga nada', async () => {
        const { store, service } = setup();

        await service.onBattleFinished(battle({ difficulty: null }));

        assert.equal(store.gold, 0);
    });

    it('a conquista desbloqueia o personagem; se já foi comprado, devolve ouro', async () => {
        const { store, service } = setup();

        store.gold = 600;
        await service.buy(ANA, 'ladino', 'gold');
        assert.equal(store.gold, 0);

        store.m.wins = 5;
        const view = await service.view(ANA);

        assert.ok(view.owned.includes('ladino'));
        // 100 (primeira vitória) + 50 + 300 de devolução (cinco vitórias, que daria o Ladino)
        assert.equal(store.gold, 450);
    });

    it('não compra sem saldo nem o que já tem', async () => {
        const { service } = setup();

        await assert.rejects(service.buy(ANA, 'harpia', 'diamonds'), /insufficient/);
        await assert.rejects(service.buy(ANA, 'piromante', 'gold'), /notForSale/);
    });

    it('as missões do dia são 3, sempre as mesmas no mesmo dia, e contam só as batalhas de hoje', async () => {
        const { store, service } = setup();
        const won = (finishedAt: Date): FinishedBattle => ({ won: true, versus: false, ranked: false, difficulty: 'normal', campaign: false, tower: false, characterIds: ['piromante', 'cavaleiro', 'sacerdote', 'ladino', 'barbaro'], finishedAt });

        store.finished = [won(new Date('2026-11-14T10:00:00Z')), won(new Date('2026-11-13T10:00:00Z'))];

        const first = (await service.view(ANA)).missions;
        const again = (await service.view(ANA)).missions;

        assert.equal(first.daily.length, 3);
        assert.equal(first.weekly.length, 3);
        assert.deepEqual(first.daily.map((m) => m.id), again.daily.map((m) => m.id));
        assert.deepEqual(first.daily.map((m) => m.id), missionsFor(ANA, dailyPeriod(NOW), DAILY_MISSIONS).map((m) => m.id));

        // Uma vitória hoje com mago, tanque, suporte e assassino: as missões de categoria contam 1.
        for (const mission of first.daily) {
            if (mission.metric === 'winRole') assert.equal(mission.progress, 1);
            if (mission.metric === 'play') assert.equal(mission.progress, 1, 'a de ontem não conta no dia');
        }

        assert.equal(first.dailyResetsAt.toISOString(), '2026-11-15T00:00:00.000Z');
        assert.equal(first.weeklyResetsAt.toISOString(), '2026-11-16T00:00:00.000Z');
    });

    it('resgata a missão completa uma vez só; a incompleta não', async () => {
        const { store, service } = setup();
        const missions = missionsFor(ANA, dailyPeriod(NOW), DAILY_MISSIONS);

        store.finished = Array.from({ length: 3 }, () => ({ won: true, versus: true, ranked: true, difficulty: 'hard', campaign: true, tower: true, characterIds: ['piromante', 'cavaleiro', 'sacerdote', 'ladino'], finishedAt: NOW }));

        const target = missions[0]!;
        const view = await service.claim(ANA, { type: 'daily', id: target.id });

        assert.equal(view.missions.daily.find((m) => m.id === target.id)?.claimed, true);
        assert.equal(store.gold, target.reward.gold);
        await assert.rejects(service.claim(ANA, { type: 'daily', id: target.id }), /alreadyClaimed/);
        await assert.rejects(service.claim(ANA, { type: 'daily', id: 'nao-existe' }), /unknownReward/);

        store.finished = [];
        await assert.rejects(service.claim(ANA, { type: 'daily', id: missions[1]!.id }), /notCompleted/);
    });

    it('as estrelas da campanha valem a melhor vitória de cada fase, e os baús abrem a cada 10', async () => {
        const { store, service } = setup();

        store.clears = [
            { stage: 1, difficulty: 'easy' },
            { stage: 1, difficulty: 'hard' },
            { stage: 2, difficulty: 'normal' },
            { stage: 3, difficulty: 'hard' },
            { stage: 4, difficulty: 'hard' },
        ];

        const { stars } = await service.view(ANA);

        assert.deepEqual(stars.byStage, { 1: 3, 2: 2, 3: 3, 4: 3 });
        assert.equal(stars.total, 11);
        assert.equal(stars.max, 36);

        await service.claim(ANA, { type: 'chest', at: 10 });
        assert.equal(store.gold, 200);
        await assert.rejects(service.claim(ANA, { type: 'chest', at: 20 }), /notCompleted/);
    });

    it('o login diário segue a sequência de 7 dias, uma vez por dia, e recomeça quando o jogador pula um dia', async () => {
        const { store, service } = setup();

        assert.deepEqual([(await service.view(ANA)).login.day, (await service.view(ANA)).login.claimedToday], [1, false]);

        let view = await service.claimLogin(ANA);

        assert.deepEqual([view.login.day, view.login.claimedToday, store.gold], [1, true, 50]);
        await assert.rejects(service.claimLogin(ANA), /alreadyClaimed/);

        // Ontem foi o 6º dia: hoje é o 7º, o do baú grande.
        store.loginStreak = 6;
        store.loginLastDay = '2026-11-13';
        view = await service.claimLogin(ANA);
        assert.equal(view.login.day, 7);
        assert.equal(store.diamonds, 10);

        // Depois do 7º, recomeça no 1º.
        store.loginStreak = 7;
        store.loginLastDay = '2026-11-13';
        assert.equal((await service.view(ANA)).login.day, 1);

        // Pulou um dia: volta para o 1º.
        store.loginStreak = 4;
        store.loginLastDay = '2026-11-10';
        assert.equal((await service.view(ANA)).login.day, 1);
    });

    it('vencer o desafio do dia paga o prêmio só na primeira vitória', async () => {
        const { store, service } = setup();

        await service.onBattleFinished(battle({ id: 'c1', challengeDay: '2026-11-14', difficulty: 'hard' }));
        // 60 da vitória no difícil + 150 do desafio + 100 do nível 2, e 5 diamantes.
        assert.deepEqual([store.gold, store.diamonds], [310, 5]);

        await service.onBattleFinished(battle({ id: 'c2', challengeDay: '2026-11-14', difficulty: 'hard' }));
        assert.equal(store.gold, 370);
    });

    it('toda partida dá experiência; cada nível novo paga o prêmio dele', async () => {
        const { store, service } = setup();

        await service.onBattleFinished(battle({ id: 'x1' }));
        // 100 de experiência: chega ao nível 2 (o nível 1 pede 100). 40 da vitória + 100 do nível 2.
        assert.equal(store.xp, 100);
        assert.equal(store.gold, 140);
        assert.equal(store.claims.has('nivel:2'), true);

        await service.onBattleFinished(battle({ id: 'x2', winner: 'B' }));
        assert.equal(store.xp, 140, 'a derrota também dá experiência');

        const { level } = await service.view(ANA);

        assert.deepEqual([level.level, level.xpIntoLevel, level.xpForNext, level.title], [2, 40, 150, 'recruta']);
    });

    it('o evento da semana multiplica o ouro do modo dele', async () => {
        const { store, service } = setup();

        // Semana do fogo: ouro em dobro na campanha (40 x 1,5 da campanha = 60, em dobro = 120).
        await service.onBattleFinished(battle({ id: 'e1', campaignStage: 1, createdAt: new Date('2026-11-12T12:00:00Z') }));
        assert.equal(store.paid.get('e1')?.gold, 120);

        // Na mesma semana, a partida rápida não muda.
        await service.onBattleFinished(battle({ id: 'e2', createdAt: new Date('2026-11-12T12:00:00Z') }));
        assert.equal(store.paid.get('e2')?.gold, 40);
    });

    it('o passe: degraus pela experiência do mês, trilha gratuita para todos e premium comprada com diamantes', async () => {
        const { store, service } = setup();

        store.xp = 950;

        let { pass } = await service.view(ANA);

        assert.deepEqual([pass.season, pass.tier, pass.premium], ['2026-11', 3, false]);
        await service.claim(ANA, { type: 'pass', tier: 3, track: 'free' });
        assert.equal(store.gold, 100);
        await assert.rejects(service.claim(ANA, { type: 'pass', tier: 4, track: 'free' }), /notCompleted/);
        await assert.rejects(service.claim(ANA, { type: 'pass', tier: 1, track: 'premium' }), /passNeeded/);
        await assert.rejects(service.buyPass(ANA), /insufficient/);

        store.diamonds = 300;
        pass = (await service.buyPass(ANA)).pass;
        assert.deepEqual([pass.premium, store.diamonds], [true, 50]);
        await service.claim(ANA, { type: 'pass', tier: 3, track: 'premium' });
        assert.deepEqual([store.gold, store.diamonds], [350, 65]);
        await assert.rejects(service.buyPass(ANA), /passOwned/);
    });

    it('o prêmio do chefe semanal: só depois de derrotado e para quem causou dano', async () => {
        const store = new MemoryStore();
        let status = { week: 'W2026-11-09', defeated: false, damage: 1200, reward: { gold: 500, diamonds: 20 } };
        const service = new ProgressionService(store, () => IDS, { now: () => NOW, raidStatus: async () => status });

        await assert.rejects(service.claim(ANA, { type: 'raid' }), /notCompleted/);
        status = { ...status, defeated: true };
        await service.claim(ANA, { type: 'raid' });
        assert.deepEqual([store.gold, store.diamonds], [500, 20]);
        await assert.rejects(service.claim(ANA, { type: 'raid' }), /alreadyClaimed/);
    });

    it('vencer um andar da torre paga o prêmio do andar uma vez só', async () => {
        const { store, service } = setup();

        await service.onBattleFinished(battle({ id: 't1', towerFloor: 10, difficulty: 'normal' }));
        // 40 da vitória no normal + 40 + 10 x 10 do andar + 100 do nível 2; o andar 10 dá 10 diamantes.
        assert.equal(store.gold, 280);
        assert.equal(store.diamonds, 10);

        await service.onBattleFinished(battle({ id: 't2', towerFloor: 10, difficulty: 'normal' }));
        assert.equal(store.gold, 320, 'o andar repetido só paga a vitória');
    });
});
