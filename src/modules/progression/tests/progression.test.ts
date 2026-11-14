import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { BattleRecord } from '../../battles/battle.types';
import type { Achievement } from '../progression.catalog';
import { ProgressionService } from '../progression.service';
import type { Currency, Metrics, ProgressionStore } from '../progression.service';

const ANA = 'ana';
const IDS = ['piromante', 'cavaleiro', 'sacerdote', 'barbaro', 'criomante', 'arqueiro', 'ladino', 'harpia', 'driade'];

/** Guarda tudo em memória; as métricas vêm de fora (o teste diz quantas vitórias o jogador tem). */
class MemoryStore implements ProgressionStore {
    gold = 0;
    diamonds = 0;
    chars = new Set<string>();
    done = new Map<string, Date>();
    paid = new Map<string, { gold: number; achievements: string[] }>();
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
    async payBattle(b: string, _u: string, gold: number) {
        if (this.paid.has(b)) return false;
        this.paid.set(b, { gold, achievements: [] });
        this.gold += gold;
        return true;
    }
    async setBattleAchievements(b: string, _u: string, list: string[]) { this.paid.get(b)!.achievements = list; }
    async battleReward(b: string) { return this.paid.get(b) ?? null; }
}

const battle = (over: Partial<BattleRecord>): BattleRecord => ({ id: 'b1', userId: ANA, opponentId: null, winner: 'A', difficulty: 'normal', campaignStage: null, ranked: false, ...over } as unknown as BattleRecord);

function setup() {
    const store = new MemoryStore();

    return { store, service: new ProgressionService(store, () => IDS) };
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

        assert.deepEqual(await service.battleReward('b1', ANA), { gold: 40, achievements: ['primeira-vitoria'] });
        assert.equal(store.gold, 40 + 100);
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
});
