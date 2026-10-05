import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chooseAction, chooseTrainingAction } from '../ai';
import { CHARACTERS, getCharacter } from '../data/characters';
import { applyAction, createBattle, getUnit } from '../engine';

/**
 * Cada conjunto de habilidades e passivas do catálogo: o de cada personagem,
 * o de cada forma de quem se transforma e o de cada invocação. As regras
 * valem para todos.
 */
const KITS = CHARACTERS.flatMap((character) => [
    { owner: character.id, label: character.id, skills: character.skills, passives: character.passives },
    ...(character.forms ?? []).map((form) => ({ owner: character.id, label: `${character.id} (${form.id})`, skills: form.skills, passives: form.passives })),
    // Uma invocação é uma unidade própria: os ids das habilidades dela levam o id dela.
    ...(character.summons ?? []).map((summon) => ({ owner: summon.id, label: `${character.id} > ${summon.id}`, skills: summon.skills, passives: summon.passives })),
]);

describe('catálogo de personagens', () => {
    it('ids de personagens e de habilidades são únicos', () => {
        const characterIds = CHARACTERS.map((c) => c.id);
        const skillIds = KITS.flatMap((kit) => kit.skills.map((s) => s.id));

        assert.equal(new Set(characterIds).size, characterIds.length);
        assert.equal(new Set(skillIds).size, skillIds.length);
    });

    it('todo personagem (e toda forma) começa com um ataque básico: custo 0 e alvo inimigo', () => {
        for (const kit of KITS) {
            const [basic] = kit.skills;

            assert.equal(basic?.energyCost, 0, kit.label);
            assert.equal(basic?.target, 'single-enemy', kit.label);
        }
    });

    it('todo personagem (e toda forma) tem pelo menos uma passiva, com id próprio, nome e descrição', () => {
        const passiveIds = KITS.flatMap((kit) => kit.passives.map((p) => p.id));
        const skillIds = KITS.flatMap((kit) => kit.skills.map((s) => s.id));

        assert.equal(new Set([...passiveIds, ...skillIds]).size, passiveIds.length + skillIds.length);

        for (const kit of KITS) {
            assert.ok(kit.passives.length >= 1, kit.label);

            for (const item of [...kit.skills, ...kit.passives]) {
                assert.ok(item.id.startsWith(`${kit.owner}.`), item.id);
                assert.ok(item.name && item.description && item.element, item.id);
            }
        }
    });

    it('as formas têm id único no personagem, e toda transformação aponta para uma forma que existe', () => {
        for (const character of CHARACTERS) {
            const formIds = (character.forms ?? []).map((form) => form.id);

            assert.equal(new Set(formIds).size, formIds.length, character.id);

            const kits = [character, ...(character.forms ?? [])];

            for (const skill of kits.flatMap((kit) => kit.skills)) {
                for (const effect of skill.effects) {
                    if (effect.type !== 'transform') continue;

                    assert.ok(formIds.includes(effect.form), `${skill.id}: forma ${effect.form}`);
                    assert.ok(skill.energyCost > 0, `${skill.id}: transformação sem custo daria ações extras sem fim`);
                    assert.ok(skill.description.includes(`${effect.turns} turno`), `${skill.id}: a descrição deveria dizer a duração`);
                }
            }
        }
    });

    it('a descrição de um golpe de execução diz quanto ele cresce com a vida que o alvo perdeu', () => {
        const executes = KITS.flatMap((kit) => kit.skills).filter((skill) => skill.effects.some((effect) => effect.type === 'damage' && effect.perTargetMissingHp));

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
        const entries = KITS.flatMap((kit) => kit.passives).flatMap((passive) =>
            [passive.effect, ...(passive.also ?? [])].map((effect) => ({ id: passive.id, description: passive.description, effect })),
        );

        for (const { id, description, effect } of entries) {
            // Os números que precisam aparecer no texto, conforme o tipo do efeito.
            const numbers: string[] = [];

            if (effect.type === 'extra_action_on_transform' || effect.type === 'count_corpses' || effect.type === 'stealth_each_turn') {
                // Sem número: a passiva só diz o que acontece (age de novo, conta os cadáveres, se esconde).
            } else if (effect.type === 'energy_on_crit') {
                numbers.push(`${effect.amount} de energia`);
            } else if (effect.type === 'damage_per_enemy_status') {
                // "N% a mais de dano para cada inimigo com o status."
                numbers.push(`${percent(effect.amount)} a mais`, 'para cada inimigo');
            } else if (effect.type === 'damage_per_missing_hp') {
                // "Para cada 1% de vida perdida, N% a mais."
                numbers.push(`${effect.amount}% a mais`);
            } else if (effect.type === 'status_on_hit') {
                numbers.push(percent(effect.power), `${effect.turns} turno`);
            } else if (effect.type === 'turn_start' || effect.type === 'battle_start') {
                for (const item of effect.effects) {
                    if (item.type === 'cleanse' || item.type === 'transform' || item.type === 'summon') continue;

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

    it('as invocações têm id que não é de personagem, e só cadáver é alvo de invocação', () => {
        const characterIds = CHARACTERS.map((c) => c.id);

        for (const character of CHARACTERS) {
            const summonIds = (character.summons ?? []).map((summon) => summon.id);

            for (const id of summonIds) {
                assert.ok(!characterIds.includes(id), `${id}: uma invocação não pode ser escolhida para o time`);
            }

            for (const skill of character.skills) {
                const summon = skill.effects.find((effect) => effect.type === 'summon');

                assert.equal(skill.target === 'corpse', summon !== undefined, skill.id);

                if (summon?.type === 'summon') {
                    assert.ok(summonIds.includes(summon.summon), `${skill.id}: invocação ${summon.summon}`);
                }
            }
        }
    });

    it('a descrição de quem reduz a cura diz quanto e por quanto tempo', () => {
        for (const skill of KITS.flatMap((kit) => kit.skills)) {
            for (const effect of skill.effects) {
                if (effect.type !== 'status' || effect.status !== 'heal_down') continue;

                assert.ok(skill.description.includes(`${Math.round(effect.power * 100)}%`), skill.id);
                assert.ok(skill.description.includes(`${effect.turns} turno`), skill.id);
            }
        }
    });

    it('os ajustes de custo: o Golpe Trovejante e o Brado de Guerra custam 1, e o atordoamento do Bárbaro tem 40% de chance', () => {
        const thunder = getCharacter('barbaro').skills.find((skill) => skill.id === 'barbaro.golpe-trovejante');
        const stun = thunder?.effects.find((effect) => effect.type === 'status' && effect.status === 'stun');

        assert.equal(thunder?.energyCost, 1);
        assert.equal(stun?.type === 'status' ? stun.chance : undefined, 0.4);
        assert.match(thunder?.description ?? '', /40%/);
        assert.equal(getCharacter('cavaleiro').skills.find((skill) => skill.id === 'cavaleiro.brado-de-guerra')?.energyCost, 1);
    });

    it('os ajustes de custo: as habilidades da Criomante e as das formas do Druida custam 1 a menos', () => {
        const costs = (skills: { id: string; energyCost: number }[]) => skills.map((skill) => [skill.id, skill.energyCost]);
        const forms = getCharacter('druida').forms ?? [];

        assert.deepEqual(costs(getCharacter('criomante').skills), [['criomante.estilhaco', 0], ['criomante.nevasca', 1], ['criomante.prisao-de-gelo', 1]]);
        assert.deepEqual(costs(forms.find((form) => form.id === 'urso')?.skills ?? []), [['druida.patada', 0], ['druida.rugido', 0], ['druida.esmagar', 1]]);
        assert.deepEqual(costs(forms.find((form) => form.id === 'lobo')?.skills ?? []), [['druida.mordida', 0], ['druida.dilacerar', 0], ['druida.frenesi', 1]]);
        // Virar urso ou lobo continua custando 1.
        assert.deepEqual(getCharacter('druida').skills.map((skill) => skill.energyCost), [0, 1, 1]);
    });

    it('Vampiro: o Banquete de Sangue bate com 85% do ataque e as Garras roubam 30% do dano', () => {
        const [claws, , feast] = getCharacter('vampiro').skills;

        assert.deepEqual(claws?.effects, [{ type: 'damage', power: 1.0, drain: 0.3 }]);
        assert.deepEqual(feast?.effects, [{ type: 'damage', power: 0.85, drain: 0.5 }]);
        assert.match(claws?.description ?? '', /30%/);
    });

    it('ninguém tem mais de três habilidades ativas: a quarta virou passiva', () => {
        for (const kit of KITS) {
            assert.ok(kit.skills.length <= 3, kit.label);
        }
    });

    it('toda habilidade tem elemento, e só golpe em inimigos é à distância', () => {
        for (const skill of KITS.flatMap((kit) => kit.skills)) {
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
            teamA: [getCharacter('sacerdote'), getCharacter('cavaleiro')],
            teamB: [getCharacter('cavaleiro')],
            seed: 1,
        });

        assert.equal(state.activeUnitId, 'A1');
        getUnit(state, 'A2').hp = 100;

        assert.deepEqual(chooseAction(state), { unitId: 'A1', skillId: 'sacerdote.toque-curativo', targetId: 'A2' });
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
            teamA: [getCharacter('sacerdote'), getCharacter('cavaleiro')],
            teamB: [getCharacter('cavaleiro')],
            seed: 1,
        });

        assert.equal(state.activeUnitId, 'A1');
        assert.deepEqual(chooseAction(state), { unitId: 'A1', skillId: 'sacerdote.bencao' });

        // O time como fica depois da Bênção: todos com os bônus, e o Sacerdote com a passiva fortalecida.
        for (const unit of state.units.filter((u) => u.team === 'A')) {
            unit.statuses = [
                { kind: 'speed_up', turns: 2, value: 0.3, sourceId: 'A1', appliedOnStep: 0 },
                { kind: 'atk_up', turns: 2, value: 0.2, sourceId: 'A1', appliedOnStep: 0 },
            ];
        }

        getUnit(state, 'A1').statuses.push({ kind: 'passive_up', turns: 2, value: 0.8, sourceId: 'A1', appliedOnStep: 0 });

        assert.deepEqual(chooseAction(state), { unitId: 'A1', skillId: 'sacerdote.raio-de-luz', targetId: 'B1' });
    });

    it('purifica o aliado atordoado ou com dano pesado por turno, e não gasta com efeito fraco', () => {
        const { state } = createBattle({
            teamA: [getCharacter('sacerdote'), getCharacter('cavaleiro'), getCharacter('barbaro')],
            teamB: [getCharacter('cavaleiro')],
            seed: 1,
        });

        state.activeUnitId = 'A1';

        // Queimadura de 62 no Cavaleiro (1300 de vida): menos de 10% por turno, não compensa.
        getUnit(state, 'A2').statuses = [{ kind: 'burn', turns: 2, value: 62, sourceId: 'B1', appliedOnStep: 0 }];
        assert.deepEqual(chooseAction(state), { unitId: 'A1', skillId: 'sacerdote.bencao' });

        // Veneno de 105 no Bárbaro (650 de vida): compensa.
        getUnit(state, 'A3').statuses = [{ kind: 'poison', turns: 3, value: 105, sourceId: 'B1', appliedOnStep: 0 }];
        assert.deepEqual(chooseAction(state), { unitId: 'A1', skillId: 'sacerdote.toque-curativo', targetId: 'A3' });

        // Atordoamento vale mais que tudo: devolve a vez do aliado.
        getUnit(state, 'A2').statuses = [{ kind: 'stun', turns: 1, value: 0, sourceId: 'B1', appliedOnStep: 0 }];
        assert.deepEqual(chooseAction(state), { unitId: 'A1', skillId: 'sacerdote.toque-curativo', targetId: 'A2' });

        // Aliado com menos da metade da vida vem antes: a cura vai para ele.
        getUnit(state, 'A3').hp = 100;
        assert.deepEqual(chooseAction(state), { unitId: 'A1', skillId: 'sacerdote.toque-curativo', targetId: 'A3' });
    });

    it('com um inimigo provocando, os golpes de alvo único vão nele, mesmo havendo outro com menos vida', () => {
        const { state } = createBattle({
            teamA: [getCharacter('barbaro')],
            teamB: [getCharacter('cavaleiro'), getCharacter('sacerdote')],
            seed: 1,
        });

        assert.equal(state.activeUnitId, 'A1');
        getUnit(state, 'B1').statuses = [{ kind: 'taunt', turns: 2, value: 0, sourceId: 'B1', appliedOnStep: 0 }];

        assert.deepEqual(chooseAction(state), { unitId: 'A1', skillId: 'barbaro.golpe-trovejante', targetId: 'B1' });
    });

    it('com duas habilidades de mesmo custo, o tanque provoca primeiro; já provocando, dá o escudo ao aliado mais ferido que ainda não tem um', () => {
        const { state } = createBattle({
            teamA: [getCharacter('cavaleiro'), getCharacter('guardiao'), getCharacter('criomante')],
            teamB: [getCharacter('cavaleiro')],
            seed: 1,
        });

        state.activeUnitId = 'A1';
        getUnit(state, 'A2').hp = 600;
        getUnit(state, 'A3').hp = 600;
        getUnit(state, 'A3').statuses = [{ kind: 'shield', turns: 2, value: 100, sourceId: 'A1', appliedOnStep: 0 }];

        // O Juramento de Guarda e o Brado de Guerra custam 1: o Brado (provocação) ganha o empate.
        assert.deepEqual(chooseAction(state), { unitId: 'A1', skillId: 'cavaleiro.brado-de-guerra' });

        // Com a provocação de pé e o inimigo já enfraquecido, o Brado não acrescenta nada.
        const taunting = applyAction(state, { unitId: 'A1', skillId: 'cavaleiro.brado-de-guerra' }).state;

        taunting.activeUnitId = 'A1';
        taunting.energy.A = 1;

        assert.deepEqual(chooseAction(taunting), { unitId: 'A1', skillId: 'cavaleiro.juramento-de-guarda', targetId: 'A2' });
    });

    it('entre duas habilidades de mesmo custo, usa a que causa mais dano (o lobo sem energia dilacera em vez de morder)', () => {
        const opening = createBattle({ teamA: [getCharacter('druida')], teamB: [getCharacter('cavaleiro')], seed: 1 }).state;

        opening.activeUnitId = 'A1';

        const wolf = applyAction(opening, { unitId: 'A1', skillId: 'druida.forma-de-lobo' }).state;

        wolf.energy.A = 0;

        assert.deepEqual(chooseAction(wolf), { unitId: 'A1', skillId: 'druida.dilacerar', targetId: 'B1' });

        // Com energia, o golpe em área (que custa 1) continua vindo primeiro.
        wolf.energy.A = 1;

        assert.equal(chooseAction(wolf).skillId, 'druida.frenesi');
    });

    it('sem ninguém ferido, ataca o inimigo com menos vida', () => {
        const { state } = createBattle({
            teamA: [getCharacter('barbaro')],
            teamB: [getCharacter('cavaleiro'), getCharacter('sacerdote')],
            seed: 1,
        });

        assert.equal(state.activeUnitId, 'A1');

        assert.deepEqual(chooseAction(state), { unitId: 'A1', skillId: 'barbaro.golpe-trovejante', targetId: 'B2' });
    });

    it('de treino: mira em quem tem mais vida e só usa uma habilidade com custo por turno', () => {
        let { state } = createBattle({
            teamA: [getCharacter('cavaleiro'), getCharacter('sacerdote')],
            teamB: [getCharacter('barbaro'), getCharacter('piromante')],
            seed: 1,
        });

        // O Bárbaro (B1) é o mais rápido e abre o turno com a energia intacta.
        assert.equal(state.activeUnitId, 'B1');
        getUnit(state, 'A1').hp = 300;

        const first = chooseTrainingAction(state);

        // A IA normal bateria no Cavaleiro ferido; a de treino vai no Sacerdote, que está inteiro.
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
        const player = ['cavaleiro', 'barbaro', 'piromante', 'arqueiro', 'sacerdote'].map(getCharacter);
        const enemy = ['banshee', 'vampiro', 'espadachim', 'criomante', 'driade'].map(getCharacter);

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
