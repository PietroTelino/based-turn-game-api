import type { CharacterDefinition, SkillDefinition } from '../types';
import { CHARACTERS } from './characters';

/**
 * Os chefes da campanha. Cada um é um personagem do jogo reforçado: bem mais
 * vida, um pouco mais de ataque e defesa, e uma habilidade só dele. O id da
 * unidade continua o do personagem de base (é por ele que a tela acha o
 * modelo e a ilustração); a marca `boss` faz a tela mostrá-lo maior.
 *
 * Chefe não entra em seleção, loja nem time de jogador: só a fase o coloca.
 */
interface BossSpec {
    id: string;
    base: string;
    name: string;
    skill: SkillDefinition;
}

const SPECS: BossSpec[] = [
    {
        id: 'rei-lich',
        base: 'necromante',
        name: 'Rei Lich',
        skill: {
            id: 'rei-lich.inverno-da-morte',
            name: 'Inverno da Morte',
            description: 'Fere todos os inimigos, que ficam mais lentos por 2 turnos e recebem 60% a menos de cura por 3. Só duas vezes por batalha.',
            energyCost: 2,
            uses: 2,
            target: 'all-enemies',
            element: 'shadow',
            effects: [
                { type: 'damage', power: 1.1 },
                { type: 'status', status: 'heal_down', turns: 3, power: 0.6 },
                { type: 'status', status: 'speed_down', turns: 2, power: 0.25 },
            ],
        },
    },
    {
        id: 'rainha-do-gelo',
        base: 'criomante',
        name: 'Rainha do Gelo',
        skill: {
            id: 'rainha-do-gelo.inverno-eterno',
            name: 'Inverno Eterno',
            description: 'Uma tempestade de gelo em todos os inimigos: dano, 40% menos velocidade e 25% menos defesa por 2 turnos. Só duas vezes por batalha.',
            energyCost: 2,
            uses: 2,
            target: 'all-enemies',
            element: 'ice',
            effects: [
                { type: 'damage', power: 1.2 },
                { type: 'status', status: 'speed_down', turns: 2, power: 0.4 },
                { type: 'status', status: 'def_down', turns: 2, power: 0.25 },
            ],
        },
    },
];

/** O personagem `base` como chefe: vida x2,6, ataque x1,15, +30 de defesa e a habilidade extra. */
function build(spec: BossSpec): CharacterDefinition {
    const base = CHARACTERS.find((character) => character.id === spec.base);

    if (!base) throw new Error(`Chefe sem personagem de base: ${spec.base}`);

    const copy = structuredClone(base);

    return {
        ...copy,
        name: spec.name,
        boss: true,
        stats: {
            ...copy.stats,
            maxHp: Math.round(copy.stats.maxHp * 2.6),
            atk: Math.round(copy.stats.atk * 1.15),
            def: copy.stats.def + 30,
        },
        skills: [...copy.skills, structuredClone(spec.skill)],
    };
}

export const BOSSES: Readonly<Record<string, CharacterDefinition>> = Object.fromEntries(SPECS.map((spec) => [spec.id, build(spec)]));

export function getBoss(id: string): CharacterDefinition | undefined {
    const boss = BOSSES[id];

    return boss ? structuredClone(boss) : undefined;
}
