import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createBattle, getCharacter } from '../../../game';
import type { BattleState } from '../../../game';
import { BattleService } from '../../battles/battle.service';
import { InMemoryBattleStore } from '../../battles/tests/in-memory-store';
import { picksFromState } from '../picks-from-state';
import { StatsService } from '../stats.service';
import { InMemoryStatsStore } from './in-memory-stats-store';

const ANA = 'ana-id';
const BRUNO = 'bruno-id';

const A = ['barbaro', 'criomante', 'guardiao', 'sacerdote', 'arqueiro'];
const B = ['barbaro', 'ladino', 'vampiro', 'driade', 'banshee'];
const C = ['barbaro', 'criomante', 'vampiro', 'druida', 'necromante'];

/** As batalhas em memória e as estatísticas lendo as escolhas delas, como no jogo. */
function setup() {
    const store = new InMemoryBattleStore();
    const battles = new BattleService(store, () => 0);
    const stats = new StatsService(new InMemoryStatsStore(store));

    return { store, battles, stats };
}

describe('estatísticas: personagens mais usados', () => {
    it('sem nenhuma batalha, as duas listas vêm vazias', async () => {
        const { stats } = setup();

        assert.deepEqual(await stats.characters(ANA), { mine: { teams: 0, characters: [] }, global: { teams: 0, characters: [] } });
    });

    it('conta os times que o jogador montou, do personagem mais usado para o menos', async () => {
        const { battles, stats } = setup();

        await battles.create(ANA, { team: A, seed: 1 });
        await battles.create(ANA, { team: B, seed: 2 });
        await battles.create(ANA, { team: C, seed: 3 });

        const { mine } = await stats.characters(ANA);

        assert.equal(mine.teams, 3);
        // O Bárbaro esteve nos três times; a Criomante e o Vampiro, em dois.
        assert.deepEqual(mine.characters.slice(0, 3), [
            { characterId: 'barbaro', picks: 3, share: 1 },
            { characterId: 'criomante', picks: 2, share: 2 / 3 },
            { characterId: 'vampiro', picks: 2, share: 2 / 3 },
        ]);
        assert.equal(mine.characters.length, 11, 'só aparece quem foi usado');
        assert.ok(mine.characters.every((item, index, list) => index === 0 || (list[index - 1]?.picks ?? 0) >= item.picks));
    });

    it('a lista do jogo soma as escolhas de todos os jogadores, sem dizer quem escolheu', async () => {
        const { battles, stats } = setup();

        await battles.create(ANA, { team: A, seed: 1 });
        await battles.create(BRUNO, { team: B, seed: 2 });
        await battles.createVersus({ hostId: ANA, hostTeam: C, guestId: BRUNO, guestTeam: B });

        const asAna = await stats.characters(ANA);
        const asBruno = await stats.characters(BRUNO);

        assert.deepEqual(asAna.global, asBruno.global, 'a lista do jogo é a mesma para todo mundo');
        assert.equal(asAna.global.teams, 4);
        assert.deepEqual(asAna.global.characters[0], { characterId: 'barbaro', picks: 4, share: 1 });
        assert.deepEqual([asAna.mine.teams, asBruno.mine.teams], [2, 2]);
        assert.deepEqual(asBruno.mine.characters.find((item) => item.characterId === 'ladino'), { characterId: 'ladino', picks: 2, share: 1 });
        assert.equal(asAna.mine.characters.find((item) => item.characterId === 'ladino'), undefined, 'a Ana nunca usou o Ladino');

        const sent = JSON.stringify(asAna);

        assert.ok(!sent.includes(ANA) && !sent.includes(BRUNO), 'nenhum id de jogador sai na resposta');
    });

    it('o time sorteado para a IA e a batalha de treino não contam', async () => {
        const { battles, stats } = setup();

        await battles.create(ANA, { team: A, seed: 1 });
        await battles.create(ANA, { team: B, seed: 2, training: true });

        const { mine, global } = await stats.characters(ANA);

        assert.equal(mine.teams, 1);
        assert.deepEqual(mine.characters.map((item) => item.characterId).sort(), [...A].sort());
        assert.deepEqual(global, mine);
    });
});

describe('estatísticas: batalhas antigas', () => {
    function stateOf(teamA: string[], teamB: string[]): BattleState {
        return createBattle({ teamA: teamA.map(getCharacter), teamB: teamB.map(getCharacter), seed: 1 }).state;
    }

    it('contra a IA, só o time do jogador é lido do estado gravado', () => {
        const picks = picksFromState({ userId: ANA, opponentId: null, state: stateOf(A, B) });

        assert.deepEqual(picks, A.map((characterId) => ({ userId: ANA, characterId })));
    });

    it('entre dois jogadores, cada um fica com o seu time', () => {
        const picks = picksFromState({ userId: ANA, opponentId: BRUNO, state: stateOf(A, B) });

        assert.deepEqual(picks.filter((pick) => pick.userId === BRUNO).map((pick) => pick.characterId), B);
        assert.equal(picks.length, 10);
    });

    it('treino não conta, invocação fica de fora e o Clérigo antigo vira Sacerdote', () => {
        const training = stateOf(A, B);

        training.training = true;

        assert.deepEqual(picksFromState({ userId: ANA, opponentId: null, state: training }), []);

        const old = stateOf(A, B);
        const [first, second] = old.units;

        assert.ok(first && second);
        first.characterId = 'clerigo';
        second.characterId = 'esqueleto';
        second.summoned = true;

        assert.deepEqual(
            picksFromState({ userId: ANA, opponentId: null, state: old }).map((pick) => pick.characterId),
            ['sacerdote', ...A.slice(2)],
        );
    });
});
