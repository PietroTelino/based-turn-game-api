import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GameRuleError, chooseAction } from '../../../game';
import type { GameRuleErrorCode } from '../../../game';
import { BattleError } from '../battle.errors';
import type { BattleErrorCode } from '../battle.errors';
import { BattleService } from '../battle.service';
import { InMemoryBattleStore } from './in-memory-store';

const PLAYER = 'jogador-1';
const OTHER_PLAYER = 'jogador-2';

function setup() {
    const store = new InMemoryBattleStore();
    // random fixo em 0: o time sorteado da IA é sempre o começo do catálogo.
    const service = new BattleService(store, () => 0);

    return { store, service };
}

function rejectsWith(promise: Promise<unknown>, code: BattleErrorCode): Promise<void> {
    return assert.rejects(promise, (error: unknown) => error instanceof BattleError && error.code === code, code);
}

function rejectsWithRule(promise: Promise<unknown>, code: GameRuleErrorCode): Promise<void> {
    return assert.rejects(promise, (error: unknown) => error instanceof GameRuleError && error.code === code, code);
}

describe('BattleService: criar batalha', () => {
    it('cria, grava e devolve a batalha já na vez do jogador', async () => {
        const { store, service } = setup();

        const { battle, events } = await service.create(PLAYER, { team: ['faisca'], enemyTeam: ['muralha'], seed: 1 });
        const stored = await store.findById(battle.id);

        assert.equal(battle.status, 'in_progress');
        assert.equal(battle.playerTeam, 'A');
        assert.equal(battle.state.activeUnitId, 'A1');
        assert.deepEqual(battle.turnOrder.slice(0, 1), ['A1']);
        assert.deepEqual(
            battle.availableActions.map((a) => a.skill.id),
            ['faisca.choque', 'faisca.relampago'],
        );
        assert.deepEqual(events.map((e) => e.type), ['turn_started']);

        assert.equal(stored?.userId, PLAYER);
        assert.equal(stored?.turn, battle.state.turn);
    });

    it('quando a IA é mais rápida, ela joga antes e os eventos vêm juntos', async () => {
        const { service } = setup();

        const { battle, events } = await service.create(PLAYER, { team: ['muralha'], enemyTeam: ['faisca'], seed: 1 });

        const last = events[events.length - 1];

        assert.equal(battle.state.activeUnitId, 'A1');
        assert.deepEqual(events[0], { type: 'turn_started', turn: 1, unitId: 'B1', team: 'B', energy: 4 });
        assert.ok(last?.type === 'turn_started' && last.unitId === 'A1', 'a resposta termina na vez do jogador');
        assert.deepEqual(events[1], {
            type: 'skill_used',
            unitId: 'B1',
            skillId: 'faisca.relampago',
            targetIds: ['A1'],
            team: 'B',
            energy: 1,
        });
    });

    it('não envia o gerador de números aleatórios para o cliente', async () => {
        const { store, service } = setup();

        const { battle } = await service.create(PLAYER, { team: ['brasa'], seed: 1 });
        const stored = await store.findById(battle.id);

        assert.equal('rngState' in battle.state, false);
        assert.equal(typeof stored?.state.rngState, 'number');
    });

    it('sorteia para a IA um time do mesmo tamanho, sem repetir personagem', async () => {
        const { service } = setup();

        const { battle } = await service.create(PLAYER, { team: ['faisca', 'geada', 'espinho'], seed: 1 });
        const enemies = battle.state.units.filter((u) => u.team === 'B').map((u) => u.characterId);

        assert.equal(enemies.length, 3);
        assert.equal(new Set(enemies).size, 3);
    });

    it('recusa times inválidos', async () => {
        const { service } = setup();

        await rejectsWith(service.create(PLAYER, { team: [] }), 'INVALID_TEAM');
        await rejectsWith(service.create(PLAYER, { team: ['brasa', 'brasa'] }), 'INVALID_TEAM');
        await rejectsWith(service.create(PLAYER, { team: ['brasa', 'muralha', 'brisa', 'geada'] }), 'INVALID_TEAM');
        await rejectsWith(service.create(PLAYER, { team: ['nao-existe'] }), 'UNKNOWN_CHARACTER');
        await rejectsWith(service.create(PLAYER, { team: ['brasa'], enemyTeam: ['nao-existe'] }), 'UNKNOWN_CHARACTER');
    });
});

describe('BattleService: jogar', () => {
    it('aplica a ação do jogador, deixa a IA responder e grava o resultado', async () => {
        const { store, service } = setup();
        const created = await service.create(PLAYER, { team: ['faisca'], enemyTeam: ['muralha'], seed: 1 });

        const { battle, events } = await service.act(PLAYER, created.battle.id, {
            unitId: 'A1',
            skillId: 'faisca.choque',
            targetId: 'B1',
        });
        const stored = await store.findById(battle.id);
        const actors = events.flatMap((e) => (e.type === 'skill_used' ? [e.unitId] : []));

        assert.deepEqual(actors, ['A1', 'B1'], 'jogador e depois a IA');
        assert.equal(events[events.length - 1]?.type, 'turn_started');
        assert.equal(battle.state.activeUnitId, 'A1');
        assert.ok(battle.state.turn > created.battle.state.turn);
        assert.equal(stored?.turn, battle.state.turn);
        assert.deepEqual(await service.get(PLAYER, battle.id), battle);
    });

    it('recusa mexer na unidade da IA e em batalha de outro jogador', async () => {
        const { service } = setup();
        const { battle } = await service.create(PLAYER, { team: ['faisca'], enemyTeam: ['muralha'], seed: 1 });
        const action = { unitId: 'A1', skillId: 'faisca.choque', targetId: 'B1' };

        await rejectsWith(
            service.act(PLAYER, battle.id, { unitId: 'B1', skillId: 'muralha.pancada', targetId: 'A1' }),
            'NOT_YOUR_UNIT',
        );
        await rejectsWith(service.act(OTHER_PLAYER, battle.id, action), 'BATTLE_NOT_FOUND');
        await rejectsWith(service.get(OTHER_PLAYER, battle.id), 'BATTLE_NOT_FOUND');
        await rejectsWith(service.get(PLAYER, 'isso-nao-e-um-uuid'), 'BATTLE_NOT_FOUND');
        await rejectsWith(service.get(PLAYER, '00000000-0000-4000-8000-000000000000'), 'BATTLE_NOT_FOUND');
    });

    it('uma ação que quebra regra do jogo não altera a batalha gravada', async () => {
        const { store, service } = setup();
        const { battle } = await service.create(PLAYER, { team: ['faisca'], enemyTeam: ['muralha'], seed: 1 });
        const before = await store.findById(battle.id);

        await rejectsWithRule(service.act(PLAYER, battle.id, { unitId: 'A1', skillId: 'faisca.choque' }), 'TARGET_REQUIRED');
        await rejectsWithRule(
            service.act(PLAYER, battle.id, { unitId: 'A1', skillId: 'nao-existe', targetId: 'B1' }),
            'SKILL_NOT_FOUND',
        );

        assert.deepEqual(await store.findById(battle.id), before);
    });

    it('duas ações simultâneas no mesmo turno: só uma vale', async () => {
        const { service } = setup();
        const { battle } = await service.create(PLAYER, { team: ['faisca'], enemyTeam: ['muralha'], seed: 1 });
        const action = { unitId: 'A1', skillId: 'faisca.choque', targetId: 'B1' };

        const results = await Promise.allSettled([
            service.act(PLAYER, battle.id, action),
            service.act(PLAYER, battle.id, action),
        ]);
        const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');

        assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
        assert.equal(rejected.length, 1);
        assert.ok(rejected[0]?.reason instanceof BattleError && rejected[0].reason.code === 'BATTLE_CONFLICT');
    });

    it('a batalha chega ao fim, registra o vencedor e não aceita mais ações', async () => {
        const { store, service } = setup();
        let { battle } = await service.create(PLAYER, {
            team: ['brasa', 'muralha', 'brisa'],
            enemyTeam: ['faisca', 'geada', 'espinho'],
            seed: 1,
        });

        for (let i = 0; battle.status === 'in_progress'; i++) {
            assert.ok(i < 300, 'a batalha deveria terminar');

            const stored = await store.findById(battle.id);
            assert.ok(stored);

            // O "jogador" deste teste escolhe as jogadas com a mesma IA.
            ({ battle } = await service.act(PLAYER, battle.id, chooseAction(stored.state)));
        }

        const stored = await store.findById(battle.id);

        assert.equal(battle.status, 'finished');
        assert.ok(battle.winner === 'A' || battle.winner === 'B');
        assert.ok(battle.finishedAt instanceof Date);
        assert.deepEqual(battle.availableActions, []);
        assert.deepEqual(battle.turnOrder, []);
        assert.equal(stored?.status, 'finished');
        assert.equal(stored?.winner, battle.winner);

        await rejectsWithRule(
            service.act(PLAYER, battle.id, { unitId: 'A1', skillId: 'brasa.soco-flamejante', targetId: 'B1' }),
            'BATTLE_OVER',
        );
    });

    it('lista só as batalhas do próprio jogador, sem o estado completo', async () => {
        const { service } = setup();

        await service.create(PLAYER, { team: ['brasa'], seed: 1 });
        await service.create(PLAYER, { team: ['geada'], seed: 2 });
        await service.create(OTHER_PLAYER, { team: ['brisa'], seed: 3 });

        const battles = await service.list(PLAYER);

        assert.equal(battles.length, 2);
        assert.ok(battles.every((b) => b.userId === PLAYER && !('state' in b)));
    });
});
