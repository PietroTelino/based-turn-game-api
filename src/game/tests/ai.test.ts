import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chooseAction } from '../ai';
import { CHARACTERS, getCharacter } from '../data/characters';
import { applyAction, createBattle, getUnit } from '../engine';

describe('catálogo de personagens', () => {
    it('ids de personagens e de habilidades são únicos', () => {
        const characterIds = CHARACTERS.map((c) => c.id);
        const skillIds = CHARACTERS.flatMap((c) => c.skills.map((s) => s.id));

        assert.equal(new Set(characterIds).size, characterIds.length);
        assert.equal(new Set(skillIds).size, skillIds.length);
    });

    it('todo personagem começa com um ataque básico: custo 0 e alvo inimigo', () => {
        for (const character of CHARACTERS) {
            const [basic] = character.skills;

            assert.equal(basic?.energyCost, 0, character.id);
            assert.equal(basic?.target, 'single-enemy', character.id);
        }
    });

    it('toda habilidade tem elemento, e só golpe em inimigos é à distância', () => {
        for (const skill of CHARACTERS.flatMap((c) => c.skills)) {
            assert.ok(skill.element, skill.id);

            if (skill.ranged) {
                assert.ok(skill.target === 'single-enemy' || skill.target === 'all-enemies', skill.id);
            }
        }
    });
});

describe('IA', () => {
    it('cura o aliado ferido quando tem energia', () => {
        const { state } = createBattle({
            teamA: [getCharacter('clerigo'), getCharacter('cavaleiro')],
            teamB: [getCharacter('cavaleiro')],
            seed: 1,
        });

        assert.equal(state.activeUnitId, 'A1');
        getUnit(state, 'A2').hp = 100;

        assert.deepEqual(chooseAction(state), { unitId: 'A1', skillId: 'clerigo.toque-curativo', targetId: 'A2' });
    });

    it('prefere a cura em área quando vários aliados estão feridos', () => {
        const { state } = createBattle({
            teamA: [getCharacter('clerigo'), getCharacter('cavaleiro'), getCharacter('guardiao')],
            teamB: [getCharacter('cavaleiro')],
            seed: 1,
        });

        assert.equal(state.activeUnitId, 'A1');
        // A cura em área custa 4: a energia do turno 1 (3) não paga, a do turno 2 sim.
        state.energy.A = 4;
        getUnit(state, 'A1').hp = 100;
        getUnit(state, 'A2').hp = 100;
        getUnit(state, 'A3').hp = 100;

        assert.deepEqual(chooseAction(state), { unitId: 'A1', skillId: 'clerigo.luz-restauradora' });
    });

    it('usa suporte em quem ainda não tem o efeito e não repete à toa', () => {
        const { state } = createBattle({
            teamA: [getCharacter('clerigo'), getCharacter('cavaleiro')],
            teamB: [getCharacter('cavaleiro')],
            seed: 1,
        });

        assert.equal(state.activeUnitId, 'A1');
        assert.deepEqual(chooseAction(state), { unitId: 'A1', skillId: 'clerigo.bencao' });

        for (const unit of state.units.filter((u) => u.team === 'A')) {
            unit.statuses = [
                { kind: 'speed_up', turns: 2, value: 0.3, sourceId: 'A1', appliedOnStep: 0 },
                { kind: 'atk_up', turns: 2, value: 0.2, sourceId: 'A1', appliedOnStep: 0 },
            ];
        }

        assert.deepEqual(chooseAction(state), { unitId: 'A1', skillId: 'clerigo.raio-de-luz', targetId: 'B1' });
    });

    it('dá o escudo ao aliado mais ferido que ainda não tem um', () => {
        const { state } = createBattle({
            teamA: [getCharacter('cavaleiro'), getCharacter('guardiao'), getCharacter('criomante')],
            teamB: [getCharacter('cavaleiro')],
            seed: 1,
        });

        state.activeUnitId = 'A1';
        state.energy.A = 2;
        getUnit(state, 'A2').hp = 600;
        getUnit(state, 'A3').hp = 600;
        getUnit(state, 'A3').statuses = [{ kind: 'shield', turns: 2, value: 100, sourceId: 'A1', appliedOnStep: 0 }];

        assert.deepEqual(chooseAction(state), { unitId: 'A1', skillId: 'cavaleiro.juramento-de-guarda', targetId: 'A2' });
    });

    it('sem ninguém ferido, ataca o inimigo com menos vida', () => {
        const { state } = createBattle({
            teamA: [getCharacter('barbaro')],
            teamB: [getCharacter('cavaleiro'), getCharacter('clerigo')],
            seed: 1,
        });

        assert.equal(state.activeUnitId, 'A1');

        assert.deepEqual(chooseAction(state), { unitId: 'A1', skillId: 'barbaro.golpe-trovejante', targetId: 'B2' });
    });

    it('IA contra IA sempre chega a um vencedor, com qualquer dupla de personagens', () => {
        for (const first of CHARACTERS) {
            for (const second of CHARACTERS) {
                let { state } = createBattle({ teamA: [first, second], teamB: [second, first], seed: 99 });

                while (state.winner === null) {
                    assert.ok(state.turn < 500, `batalha sem fim: ${first.id} + ${second.id}`);
                    state = applyAction(state, chooseAction(state)).state;
                }
            }
        }
    });
});
