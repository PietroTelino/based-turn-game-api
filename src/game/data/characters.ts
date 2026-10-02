import type { CharacterDefinition } from '../types';

/**
 * Catálogo de personagens. São só dados: para criar um personagem novo basta
 * acrescentar um objeto aqui. Nenhuma regra do motor precisa mudar.
 *
 * Convenções:
 * - a primeira habilidade é o ataque básico (custo 0, alvo inimigo);
 * - o id da habilidade é "<personagem>.<habilidade>";
 * - `power` multiplica o ATK de quem usa (1.0 = 100% do ATK);
 * - os efeitos acontecem na ordem em que estão escritos;
 * - `element` e `ranged` não mudam nenhuma conta: dizem à tela qual efeito
 *   visual e qual som usar (`ranged: true` = projétil, só faz diferença em
 *   habilidades de alvo único inimigo);
 * - nos efeitos de status, `power` é o valor do status: ATK x power para
 *   queimadura, veneno e escudo; a fração do atributo para bônus e
 *   penalidades (0.3 = 30%); 0 para atordoamento.
 */
export const CHARACTERS: CharacterDefinition[] = [
    {
        id: 'piromante',
        name: 'Piromante',
        role: 'mage',
        stats: { maxHp: 720, atk: 195, def: 35, speed: 105, critChance: 0.15, critDamage: 1.5 },
        skills: [
            {
                id: 'piromante.labareda',
                name: 'Labareda',
                description: 'Lança uma chama em um inimigo.',
                energyCost: 0,
                target: 'single-enemy',
                element: 'fire',
                ranged: true,
                effects: [
                    { type: 'damage', power: 1.0 },
                ],
            },
            {
                id: 'piromante.bola-de-fogo',
                name: 'Bola de Fogo',
                description: 'Causa dano alto a um inimigo e o deixa queimando por 2 turnos.',
                energyCost: 2,
                target: 'single-enemy',
                element: 'fire',
                ranged: true,
                effects: [
                    { type: 'damage', power: 1.5 },
                    { type: 'status', status: 'burn', turns: 2, power: 0.3 },
                ],
            },
            {
                id: 'piromante.chuva-de-meteoros',
                name: 'Chuva de Meteoros',
                description: 'Atinge todos os inimigos e reduz a defesa deles por 2 turnos.',
                energyCost: 4,
                target: 'all-enemies',
                element: 'fire',
                effects: [
                    { type: 'damage', power: 1.0 },
                    { type: 'status', status: 'def_down', turns: 2, power: 0.25 },
                ],
            },
        ],
    },
    {
        id: 'cavaleiro',
        name: 'Cavaleiro',
        role: 'tank',
        stats: { maxHp: 1350, atk: 155, def: 90, speed: 88, critChance: 0.05, critDamage: 1.5 },
        skills: [
            {
                id: 'cavaleiro.corte',
                name: 'Corte',
                description: 'Golpeia um inimigo com a espada.',
                energyCost: 0,
                target: 'single-enemy',
                element: 'physical',
                effects: [
                    { type: 'damage', power: 1.0 },
                ],
            },
            {
                id: 'cavaleiro.juramento-de-guarda',
                name: 'Juramento de Guarda',
                description: 'Protege um aliado com um escudo que absorve dano por 2 turnos.',
                energyCost: 2,
                target: 'single-ally',
                element: 'light',
                effects: [
                    { type: 'status', status: 'shield', turns: 2, power: 2.0 },
                ],
            },
            {
                id: 'cavaleiro.brado-de-guerra',
                name: 'Brado de Guerra',
                description: 'Atinge todos os inimigos e reduz o ataque deles por 2 turnos.',
                energyCost: 3,
                target: 'all-enemies',
                element: 'physical',
                effects: [
                    { type: 'damage', power: 0.9 },
                    { type: 'status', status: 'atk_down', turns: 2, power: 0.2 },
                ],
            },
        ],
    },
    {
        id: 'clerigo',
        name: 'Clérigo',
        role: 'support',
        stats: { maxHp: 700, atk: 155, def: 40, speed: 120, critChance: 0.05, critDamage: 1.5 },
        skills: [
            {
                id: 'clerigo.raio-de-luz',
                name: 'Raio de Luz',
                description: 'Atinge um inimigo com um raio de luz.',
                energyCost: 0,
                target: 'single-enemy',
                element: 'light',
                ranged: true,
                effects: [
                    { type: 'damage', power: 0.9 },
                ],
            },
            {
                id: 'clerigo.toque-curativo',
                name: 'Toque Curativo',
                description: 'Recupera a vida de um aliado.',
                energyCost: 2,
                target: 'single-ally',
                element: 'light',
                effects: [
                    { type: 'heal', power: 1.8 },
                ],
            },
            {
                id: 'clerigo.bencao',
                name: 'Bênção',
                description: 'Aumenta a velocidade e o ataque de todos os aliados por 2 turnos.',
                energyCost: 3,
                target: 'all-allies',
                element: 'light',
                effects: [
                    { type: 'status', status: 'speed_up', turns: 2, power: 0.3 },
                    { type: 'status', status: 'atk_up', turns: 2, power: 0.2 },
                ],
            },
            {
                id: 'clerigo.luz-restauradora',
                name: 'Luz Restauradora',
                description: 'Recupera a vida de todos os aliados.',
                energyCost: 4,
                target: 'all-allies',
                element: 'light',
                effects: [
                    { type: 'heal', power: 1.1 },
                ],
            },
        ],
    },
    {
        id: 'barbaro',
        name: 'Bárbaro',
        role: 'attacker',
        stats: { maxHp: 650, atk: 200, def: 30, speed: 135, critChance: 0.3, critDamage: 1.6 },
        skills: [
            {
                id: 'barbaro.machadada',
                name: 'Machadada',
                description: 'Golpeia um inimigo com o machado.',
                energyCost: 0,
                target: 'single-enemy',
                element: 'lightning',
                effects: [
                    { type: 'damage', power: 0.9 },
                ],
            },
            {
                id: 'barbaro.golpe-trovejante',
                name: 'Golpe Trovejante',
                description: 'Um golpe devastador, carregado de raios, com 30% de chance de atordoar o alvo.',
                energyCost: 3,
                target: 'single-enemy',
                element: 'lightning',
                effects: [
                    { type: 'damage', power: 1.9 },
                    { type: 'status', status: 'stun', turns: 1, power: 0, chance: 0.3 },
                ],
            },
        ],
    },
    {
        id: 'criomante',
        name: 'Criomante',
        role: 'mage',
        stats: { maxHp: 680, atk: 210, def: 35, speed: 108, critChance: 0.1, critDamage: 1.5 },
        skills: [
            {
                id: 'criomante.estilhaco',
                name: 'Estilhaço',
                description: 'Golpeia um inimigo com gelo.',
                energyCost: 0,
                target: 'single-enemy',
                element: 'ice',
                ranged: true,
                effects: [
                    { type: 'damage', power: 1.0 },
                ],
            },
            {
                id: 'criomante.nevasca',
                name: 'Nevasca',
                description: 'Atinge todos os inimigos e os deixa mais lentos por 2 turnos.',
                energyCost: 3,
                target: 'all-enemies',
                element: 'ice',
                effects: [
                    { type: 'damage', power: 0.9 },
                    { type: 'status', status: 'speed_down', turns: 2, power: 0.3 },
                ],
            },
            {
                id: 'criomante.prisao-de-gelo',
                name: 'Prisão de Gelo',
                description: 'Congela um inimigo: causa dano e o faz perder a próxima vez.',
                energyCost: 4,
                target: 'single-enemy',
                element: 'ice',
                ranged: true,
                effects: [
                    { type: 'damage', power: 0.8 },
                    { type: 'status', status: 'stun', turns: 1, power: 0 },
                ],
            },
        ],
    },
    {
        id: 'guardiao',
        name: 'Guardião',
        role: 'fighter',
        stats: { maxHp: 920, atk: 180, def: 65, speed: 95, critChance: 0.1, critDamage: 1.5 },
        skills: [
            {
                id: 'guardiao.raizes',
                name: 'Raízes',
                description: 'Golpeia um inimigo com as raízes.',
                energyCost: 0,
                target: 'single-enemy',
                element: 'nature',
                effects: [
                    { type: 'damage', power: 1.0 },
                ],
            },
            {
                id: 'guardiao.esporos-venenosos',
                name: 'Esporos Venenosos',
                description: 'Causa dano e envenena o alvo por 3 turnos.',
                energyCost: 2,
                target: 'single-enemy',
                element: 'nature',
                ranged: true,
                effects: [
                    { type: 'damage', power: 0.8 },
                    { type: 'status', status: 'poison', turns: 3, power: 0.55 },
                ],
            },
            {
                id: 'guardiao.seiva',
                name: 'Seiva',
                description: 'Recupera a própria vida e aumenta a própria defesa por 2 turnos.',
                energyCost: 2,
                target: 'self',
                element: 'nature',
                effects: [
                    { type: 'heal', power: 1.4 },
                    { type: 'status', status: 'def_up', turns: 2, power: 0.3 },
                ],
            },
        ],
    },
];

export function getCharacter(id: string): CharacterDefinition {
    const character = CHARACTERS.find((c) => c.id === id);

    if (!character) {
        throw new Error(`Personagem desconhecido: ${id}`);
    }

    return character;
}
