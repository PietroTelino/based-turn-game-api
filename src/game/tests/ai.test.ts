import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chooseAction, chooseTrainingAction } from '../ai';
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

    it('todo personagem tem pelo menos uma passiva, com id próprio, nome e descrição', () => {
        const passiveIds = CHARACTERS.flatMap((c) => c.passives.map((p) => p.id));
        const skillIds = CHARACTERS.flatMap((c) => c.skills.map((s) => s.id));

        assert.equal(new Set([...passiveIds, ...skillIds]).size, passiveIds.length + skillIds.length);

        for (const character of CHARACTERS) {
            assert.ok(character.passives.length >= 1, character.id);

            for (const passive of character.passives) {
                assert.ok(passive.id.startsWith(`${character.id}.`), passive.id);
                assert.ok(passive.name && passive.description && passive.element, passive.id);
            }
        }
    });

    it('a descrição de um golpe de execução diz quanto ele cresce com a vida que o alvo perdeu', () => {
        const executes = CHARACTERS.flatMap((c) => c.skills).filter((skill) => skill.effects.some((effect) => effect.type === 'damage' && effect.perTargetMissingHp));

        assert.deepEqual(executes.map((skill) => skill.id), ['ladino.golpe-fatal']);

        for (const skill of executes) {
            for (const effect of skill.effects) {
                if (effect.type === 'damage' && effect.perTargetMissingHp) {
                    assert.ok(skill.description.includes(`${effect.perTargetMissingHp}% a mais`), `${skill.id}: a descrição deveria dizer o bônus`);
                }
            }
        }
    });

    it('a descrição de cada passiva diz os mesmos números que o efeito dela', () => {
        const percent = (fraction: number) => `${Math.round(fraction * 100)}%`;

        // Uma passiva pode ter mais de um efeito (`also`): a descrição precisa dizer os números de todos.
        const entries = CHARACTERS.flatMap((c) => c.passives).flatMap((passive) =>
            [passive.effect, ...(passive.also ?? [])].map((effect) => ({ id: passive.id, description: passive.description, effect })),
        );

        for (const { id, description, effect } of entries) {
            // Os números que precisam aparecer no texto, conforme o tipo do efeito.
            const numbers: string[] = [];

            if (effect.type === 'energy_on_crit') {
                numbers.push(`${effect.amount} de energia`);
            } else if (effect.type === 'damage_per_missing_hp') {
                // "Para cada 1% de vida perdida, N% a mais."
                numbers.push(`${effect.amount}% a mais`);
            } else if (effect.type === 'status_on_hit') {
                numbers.push(percent(effect.power), `${effect.turns} turno`);
            } else if (effect.type === 'turn_start') {
                for (const item of effect.effects) {
                    numbers.push(percent(item.power));
                    if (item.type === 'status') numbers.push(`${item.turns} turno`);
                }
            } else {
                numbers.push(percent(effect.amount));

                if (effect.type === 'damage_per_drain' && effect.max !== undefined) {
                    numbers.push(`${effect.max} vezes`);
                }

                if ('when' in effect && effect.when && effect.when.type !== 'target_has_status') {
                    numbers.push(percent(effect.when.ratio));
                }
            }

            for (const number of numbers) {
                assert.ok(description.includes(number), `${id}: a descrição deveria dizer "${number}"`);
            }
        }
    });

    it('ninguém tem mais de três habilidades ativas: a quarta virou passiva', () => {
        for (const character of CHARACTERS) {
            assert.ok(character.skills.length <= 3, character.id);
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
            teamA: [getCharacter('driade'), getCharacter('cavaleiro'), getCharacter('guardiao')],
            teamB: [getCharacter('cavaleiro')],
            seed: 1,
        });

        assert.equal(state.activeUnitId, 'A1');
        getUnit(state, 'A1').hp = 100;
        getUnit(state, 'A2').hp = 100;
        getUnit(state, 'A3').hp = 100;

        assert.deepEqual(chooseAction(state), { unitId: 'A1', skillId: 'driade.florescer' });
    });

    it('usa suporte em quem ainda não tem o efeito e não repete à toa', () => {
        const { state } = createBattle({
            teamA: [getCharacter('clerigo'), getCharacter('cavaleiro')],
            teamB: [getCharacter('cavaleiro')],
            seed: 1,
        });

        assert.equal(state.activeUnitId, 'A1');
        assert.deepEqual(chooseAction(state), { unitId: 'A1', skillId: 'clerigo.bencao' });

        // O time como fica depois da Bênção: todos com os bônus, e o Clérigo com a passiva fortalecida.
        for (const unit of state.units.filter((u) => u.team === 'A')) {
            unit.statuses = [
                { kind: 'speed_up', turns: 2, value: 0.3, sourceId: 'A1', appliedOnStep: 0 },
                { kind: 'atk_up', turns: 2, value: 0.2, sourceId: 'A1', appliedOnStep: 0 },
            ];
        }

        getUnit(state, 'A1').statuses.push({ kind: 'passive_up', turns: 2, value: 0.8, sourceId: 'A1', appliedOnStep: 0 });

        assert.deepEqual(chooseAction(state), { unitId: 'A1', skillId: 'clerigo.raio-de-luz', targetId: 'B1' });
    });

    it('dá o escudo ao aliado mais ferido que ainda não tem um', () => {
        const { state } = createBattle({
            teamA: [getCharacter('cavaleiro'), getCharacter('guardiao'), getCharacter('criomante')],
            teamB: [getCharacter('cavaleiro')],
            seed: 1,
        });

        state.activeUnitId = 'A1';
        // Energia só para o Juramento de Guarda (1): o Brado de Guerra (2) fica de fora.
        state.energy.A = 1;
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

    it('de treino: mira em quem tem mais vida e só usa uma habilidade com custo por turno', () => {
        let { state } = createBattle({
            teamA: [getCharacter('cavaleiro'), getCharacter('clerigo')],
            teamB: [getCharacter('barbaro'), getCharacter('piromante')],
            seed: 1,
        });

        // O Bárbaro (B1) é o mais rápido e abre o turno com a energia intacta.
        assert.equal(state.activeUnitId, 'B1');
        getUnit(state, 'A1').hp = 300;

        const first = chooseTrainingAction(state);

        // A IA normal bateria no Cavaleiro ferido; a de treino vai no Clérigo, que está inteiro.
        assert.equal(chooseAction(state).targetId, 'A1');
        assert.equal(first.targetId, 'A2');
        assert.equal(first.skillId, 'barbaro.golpe-trovejante');

        // Depois que o time gastou energia no turno, os outros ficam no ataque básico.
        state = applyAction(state, first).state;

        while (state.activeUnitId !== 'B2') {
            state = applyAction(state, chooseAction(state)).state;
        }

        assert.equal(state.turn, 1);
        assert.ok(state.energy.B < state.turnEnergy);
        assert.equal(chooseTrainingAction(state).skillId, getCharacter('piromante').skills[0]?.id);
    });

    it('de treino: perde para um jogador que só usa o ataque básico', () => {
        // É a batalha do tutorial (os times ficam em src/battle/tutorial.ts, no app).
        const player = ['cavaleiro', 'barbaro', 'piromante', 'arqueiro', 'clerigo'].map(getCharacter);
        const enemy = ['guardiao', 'vampiro', 'espadachim', 'criomante', 'driade'].map(getCharacter);

        for (const seed of [1, 2, 3, 4, 5]) {
            let { state } = createBattle({ teamA: player, teamB: enemy, seed });

            // O jogador age primeiro: é assim que a lição do tutorial começa.
            assert.equal(getUnit(state, state.activeUnitId ?? '').team, 'A');

            for (let i = 0; state.winner === null && i < 2000; i++) {
                const actor = getUnit(state, state.activeUnitId ?? '');
                const firstEnemy = state.units.find((unit) => unit.team === 'B' && unit.hp > 0);
                const action =
                    actor.team === 'A'
                        ? { unitId: actor.id, skillId: actor.skills[0]?.id ?? '', targetId: firstEnemy?.id ?? '' }
                        : chooseTrainingAction(state);

                state = applyAction(state, action).state;
            }

            assert.equal(state.winner, 'A', `semente ${seed}`);
        }
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
