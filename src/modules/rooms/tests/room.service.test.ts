import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BattleError } from '../../battles/battle.errors';
import type { BattleErrorCode } from '../../battles/battle.errors';
import { BattleService } from '../../battles/battle.service';
import { InMemoryBattleStore } from '../../battles/tests/in-memory-store';
import { RoomError } from '../room.errors';
import type { RoomErrorCode } from '../room.errors';
import { RoomService } from '../room.service';
import { InMemoryRoomStore } from './in-memory-room-store';

const ANA = 'ana-id';
const BRUNO = 'bruno-id';
const CAIO = 'caio-id';

const ANA_TEAM = ['barbaro', 'criomante', 'guardiao', 'clerigo', 'arqueiro'];
const BRUNO_TEAM = ['cavaleiro', 'ladino', 'vampiro', 'driade', 'banshee'];

/** Salas e batalhas em memória, com o serviço de batalhas de verdade (times de cinco). */
function setup(options: { now?: () => Date } = {}) {
    const rooms = new InMemoryRoomStore({ [ANA]: 'Ana', [BRUNO]: 'Bruno', [CAIO]: 'Caio' });
    const battles = new BattleService(new InMemoryBattleStore(), () => 0);
    const codes = ['SALA01', 'SALA02', 'SALA03', 'SALA04'];
    const service = new RoomService(rooms, battles, { newCode: () => codes.shift() ?? 'ACABOU', ...options });

    return { rooms, battles, service };
}

function rejectsWith(promise: Promise<unknown>, code: RoomErrorCode): Promise<void> {
    return assert.rejects(promise, (error: unknown) => error instanceof RoomError && error.code === code, code);
}

function rejectsWithBattle(promise: Promise<unknown>, code: BattleErrorCode): Promise<void> {
    return assert.rejects(promise, (error: unknown) => error instanceof BattleError && error.code === code, code);
}

describe('RoomService: criar e entrar', () => {
    it('quem cria vira anfitrião de uma sala vazia, com um código para passar adiante', async () => {
        const { service } = setup();
        const room = await service.create(ANA);

        assert.deepEqual(
            { code: room.code, status: room.status, role: room.role, you: room.you, opponent: room.opponent, battleId: room.battleId },
            { code: 'SALA01', status: 'waiting', role: 'host', you: { ready: false, team: null }, opponent: null, battleId: null },
        );
    });

    it('o outro jogador entra pelo código, do jeito que digitar, e cada um passa a ver o nome do outro', async () => {
        const { service } = setup();
        const { code } = await service.create(ANA);
        const joined = await service.join(BRUNO, '  sala01 ');
        const host = await service.get(ANA, code);

        assert.deepEqual([joined.role, joined.status, joined.opponent], ['guest', 'selecting', { name: 'Ana', ready: false }]);
        assert.deepEqual([host.role, host.status, host.opponent], ['host', 'selecting', { name: 'Bruno', ready: false }]);
    });

    it('a sala é só dos dois: um terceiro não entra nem consegue olhar', async () => {
        const { service } = setup();
        const { code } = await service.create(ANA);

        await rejectsWith(service.get(BRUNO, code), 'ROOM_NOT_FOUND');
        await service.join(BRUNO, code);
        await rejectsWith(service.join(CAIO, code), 'ROOM_FULL');
        await rejectsWith(service.get(CAIO, code), 'ROOM_NOT_FOUND');
        await rejectsWith(service.join(CAIO, 'NAOEXISTE'), 'ROOM_NOT_FOUND');
    });

    it('dois tentando entrar ao mesmo tempo: só um consegue', async () => {
        const { service } = setup();
        const { code } = await service.create(ANA);
        const results = await Promise.allSettled([service.join(BRUNO, code), service.join(CAIO, code)]);

        assert.deepEqual(results.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
    });

    it('quem já está na sala e entra de novo pelo código só recebe a sala de volta', async () => {
        const { service } = setup();
        const { code } = await service.create(ANA);

        await service.join(BRUNO, code);

        assert.equal((await service.join(ANA, code)).role, 'host');
        assert.equal((await service.join(BRUNO, code)).role, 'guest');
    });

    it('a lista mostra as salas esperando alguém, menos a do próprio jogador, as cheias e as antigas', async () => {
        let clock = new Date('2026-10-03T12:00:00Z');
        const { service } = setup({ now: () => clock });

        await service.create(ANA);
        await service.create(BRUNO);

        assert.deepEqual((await service.listOpen(CAIO)).map((r) => r.hostName).sort(), ['Ana', 'Bruno']);
        assert.deepEqual((await service.listOpen(ANA)).map((r) => r.hostName), ['Bruno'], 'a própria sala não aparece');

        await service.join(CAIO, 'SALA01');
        assert.deepEqual((await service.listOpen(CAIO)).map((r) => r.hostName), ['Bruno'], 'sala cheia sai da lista');

        clock = new Date(Date.now() + 31 * 60 * 1000);
        assert.deepEqual(await service.listOpen(CAIO), [], 'sala esquecida aberta sai da lista depois de meia hora');
    });

    it('criar outra sala fecha a anterior do mesmo anfitrião', async () => {
        const { service } = setup();
        const first = await service.create(ANA);

        await service.join(BRUNO, first.code);

        const second = await service.create(ANA);

        assert.notEqual(second.code, first.code);
        assert.equal((await service.get(BRUNO, first.code)).status, 'closed', 'o convidado da sala antiga fica sabendo');
        await rejectsWith(service.join(CAIO, first.code), 'ROOM_CLOSED');
    });
});

describe('RoomService: escolher o time e começar', () => {
    async function roomWithTwo() {
        const context = setup();
        const { code } = await context.service.create(ANA);

        await context.service.join(BRUNO, code);

        return { ...context, code };
    }

    it('o time de um jogador nunca aparece para o outro: só o aviso de que ele está pronto', async () => {
        const { service, code } = await roomWithTwo();
        const mine = await service.ready(ANA, code, ANA_TEAM);
        const theirs = await service.get(BRUNO, code);

        assert.deepEqual(mine.you, { ready: true, team: ANA_TEAM });
        assert.deepEqual(theirs.opponent, { name: 'Ana', ready: true });
        assert.deepEqual(theirs.you, { ready: false, team: null });

        const seenByBruno = JSON.stringify(theirs);

        for (const character of ANA_TEAM) {
            assert.ok(!seenByBruno.includes(character), `o convidado não pode ver "${character}" antes de a batalha começar`);
        }

        assert.equal(theirs.battleId, null, 'com um só pronto a batalha não começa');
    });

    it('quando os dois estão prontos a batalha começa, com o anfitrião no time A e o convidado no B', async () => {
        const { service, battles, code } = await roomWithTwo();

        await service.ready(ANA, code, ANA_TEAM);

        const started = await service.ready(BRUNO, code, BRUNO_TEAM);
        const host = await service.get(ANA, code);

        assert.equal(started.status, 'started');
        assert.ok(started.battleId);
        assert.equal(host.battleId, started.battleId, 'os dois recebem a mesma batalha');

        const asHost = await battles.get(ANA, started.battleId);
        const asGuest = await battles.get(BRUNO, started.battleId);
        const idsOf = (team: string) => asHost.state.units.filter((u) => u.team === team).map((u) => u.characterId);

        assert.deepEqual([asHost.mode, asHost.playerTeam, asGuest.playerTeam], ['pvp', 'A', 'B']);
        assert.deepEqual(idsOf('A'), ANA_TEAM);
        assert.deepEqual(idsOf('B'), BRUNO_TEAM);
    });

    it('os dois "pronto" chegando juntos criam uma batalha só', async () => {
        const { service, battles, code } = await roomWithTwo();

        await Promise.all([service.ready(ANA, code, ANA_TEAM), service.ready(BRUNO, code, BRUNO_TEAM)]);

        const room = await service.get(ANA, code);

        assert.equal(room.status, 'started');
        assert.equal((await battles.list(ANA)).length, 1);
        assert.equal((await battles.list(BRUNO)).length, 1);
    });

    it('o anfitrião pode ficar pronto antes de alguém entrar; a batalha espera o convidado', async () => {
        const { service } = setup();
        const { code } = await service.create(ANA);

        assert.equal((await service.ready(ANA, code, ANA_TEAM)).status, 'waiting');
        await service.join(BRUNO, code);
        assert.equal((await service.ready(BRUNO, code, BRUNO_TEAM)).status, 'started');
    });

    it('recusa time que não tem exatamente cinco personagens válidos, e o jogador continua sem estar pronto', async () => {
        const { service, code } = await roomWithTwo();

        await rejectsWithBattle(service.ready(ANA, code, ['barbaro']), 'INVALID_TEAM');
        await rejectsWithBattle(service.ready(ANA, code, ['barbaro', 'barbaro', 'guardiao', 'clerigo', 'arqueiro']), 'INVALID_TEAM');
        await rejectsWithBattle(service.ready(ANA, code, ['barbaro', 'criomante', 'guardiao', 'clerigo', 'dragao']), 'UNKNOWN_CHARACTER');

        assert.equal((await service.get(ANA, code)).you.ready, false);
    });

    it('dá para voltar atrás e trocar o time enquanto o outro não está pronto; depois de começar, não', async () => {
        const { service, code } = await roomWithTwo();

        await service.ready(ANA, code, ANA_TEAM);

        const back = await service.unready(ANA, code);

        assert.deepEqual(back.you, { ready: false, team: null });
        assert.equal((await service.get(BRUNO, code)).opponent?.ready, false);

        // O convidado fica pronto, mas a batalha não começa: o anfitrião voltou atrás.
        assert.equal((await service.ready(BRUNO, code, BRUNO_TEAM)).status, 'selecting');

        const swapped = [...ANA_TEAM.slice(0, 4), 'piromante'];

        assert.equal((await service.ready(ANA, code, swapped)).status, 'started');
        await rejectsWith(service.unready(ANA, code), 'ROOM_CLOSED');
        await rejectsWith(service.ready(ANA, code, ANA_TEAM), 'ROOM_CLOSED');
    });

    it('o convidado sai e a sala volta a esperar outro, que não herda nada do anterior', async () => {
        const { service, code } = await roomWithTwo();

        await service.ready(BRUNO, code, BRUNO_TEAM);
        await service.leave(BRUNO, code);

        const host = await service.get(ANA, code);

        assert.deepEqual([host.status, host.opponent], ['waiting', null]);
        await rejectsWith(service.get(BRUNO, code), 'ROOM_NOT_FOUND');

        const newcomer = await service.join(CAIO, code);

        assert.deepEqual(newcomer.you, { ready: false, team: null });
        assert.deepEqual((await service.get(ANA, code)).opponent, { name: 'Caio', ready: false });

        // O anfitrião fica pronto, mas a batalha não começa com o time que o Bruno deixou para trás.
        assert.equal((await service.ready(ANA, code, ANA_TEAM)).status, 'selecting');
    });

    it('o anfitrião sai e a sala fecha para os dois', async () => {
        const { service, code } = await roomWithTwo();

        await service.leave(ANA, code);

        assert.equal((await service.get(BRUNO, code)).status, 'closed');
        await rejectsWith(service.ready(BRUNO, code, BRUNO_TEAM), 'ROOM_CLOSED');
    });

    it('sair da sala depois que a batalha começou não desfaz nada', async () => {
        const { service, code } = await roomWithTwo();

        await service.ready(ANA, code, ANA_TEAM);
        await service.ready(BRUNO, code, BRUNO_TEAM);
        await service.leave(ANA, code);
        await service.leave(BRUNO, code);

        const room = await service.get(BRUNO, code);

        assert.equal(room.status, 'started');
        assert.ok(room.battleId);
    });

    it('se a criação da batalha falhar, a sala volta a aceitar o "pronto" em vez de ficar presa', async () => {
        const rooms = new InMemoryRoomStore({ [ANA]: 'Ana', [BRUNO]: 'Bruno' });
        const real = new BattleService(new InMemoryBattleStore(), () => 0);
        let fail = true;
        const flaky = {
            validateTeam: (ids: string[]) => real.validateTeam(ids),
            createVersus: async (input: Parameters<BattleService['createVersus']>[0]) => {
                if (fail) throw new Error('banco fora do ar');

                return real.createVersus(input);
            },
        };
        const service = new RoomService(rooms, flaky, { newCode: () => 'SALA01' });
        const { code } = await service.create(ANA);

        await service.join(BRUNO, code);
        await service.ready(ANA, code, ANA_TEAM);
        await assert.rejects(service.ready(BRUNO, code, BRUNO_TEAM), /banco fora do ar/);

        assert.deepEqual([(await service.get(ANA, code)).status, (await service.get(ANA, code)).you.ready], ['selecting', false]);

        fail = false;
        await service.ready(ANA, code, ANA_TEAM);
        assert.equal((await service.ready(BRUNO, code, BRUNO_TEAM)).status, 'started');
    });
});
