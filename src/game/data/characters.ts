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
 * - nos efeitos de status, `power` é o valor do status: ATK x power para
 *   queimadura, veneno e escudo; a fração do atributo para bônus e
 *   penalidades (0.3 = 30%); 0 para atordoamento.
 */
export const CHARACTERS: CharacterDefinition[] = [
    {
        id: 'brasa',
        name: 'Brasa',
        role: 'attacker',
        stats: { maxHp: 720, atk: 185, def: 35, speed: 105, critChance: 0.15, critDamage: 1.5 },
        skills: [
            {
                id: 'brasa.soco-flamejante',
                name: 'Soco Flamejante',
                description: 'Golpeia um inimigo.',
                energyCost: 0,
                target: 'single-enemy',
                effects: [
                    { type: 'damage', power: 1.0 },
                ],
            },
            {
                id: 'brasa.bola-de-fogo',
                name: 'Bola de Fogo',
                description: 'Causa dano alto a um inimigo e o deixa queimando por 2 turnos.',
                energyCost: 2,
                target: 'single-enemy',
                effects: [
                    { type: 'damage', power: 1.5 },
                    { type: 'status', status: 'burn', turns: 2, power: 0.3 },
                ],
            },
            {
                id: 'brasa.chuva-de-meteoros',
                name: 'Chuva de Meteoros',
                description: 'Atinge todos os inimigos e reduz a defesa deles por 2 turnos.',
                energyCost: 4,
                target: 'all-enemies',
                effects: [
                    { type: 'damage', power: 1.0 },
                    { type: 'status', status: 'def_down', turns: 2, power: 0.25 },
                ],
            },
        ],
    },
    {
        id: 'muralha',
        name: 'Muralha',
        role: 'tank',
        stats: { maxHp: 1350, atk: 195, def: 90, speed: 88, critChance: 0.05, critDamage: 1.5 },
        skills: [
            {
                id: 'muralha.pancada',
                name: 'Pancada',
                description: 'Golpeia um inimigo.',
                energyCost: 0,
                target: 'single-enemy',
                effects: [
                    { type: 'damage', power: 1.0 },
                ],
            },
            {
                id: 'muralha.escudo-de-pedra',
                name: 'Escudo de Pedra',
                description: 'Dá a um aliado um escudo que absorve dano por 2 turnos.',
                energyCost: 2,
                target: 'single-ally',
                effects: [
                    { type: 'status', status: 'shield', turns: 2, power: 2.0 },
                ],
            },
            {
                id: 'muralha.terremoto',
                name: 'Terremoto',
                description: 'Atinge todos os inimigos e reduz o ataque deles por 2 turnos.',
                energyCost: 3,
                target: 'all-enemies',
                effects: [
                    { type: 'damage', power: 1.1 },
                    { type: 'status', status: 'atk_down', turns: 2, power: 0.3 },
                ],
            },
        ],
    },
    {
        id: 'brisa',
        name: 'Brisa',
        role: 'support',
        stats: { maxHp: 700, atk: 130, def: 40, speed: 120, critChance: 0.05, critDamage: 1.5 },
        skills: [
            {
                id: 'brisa.rajada',
                name: 'Rajada',
                description: 'Golpeia um inimigo com vento.',
                energyCost: 0,
                target: 'single-enemy',
                effects: [
                    { type: 'damage', power: 0.9 },
                ],
            },
            {
                id: 'brisa.sopro-curativo',
                name: 'Sopro Curativo',
                description: 'Recupera a vida de um aliado.',
                energyCost: 2,
                target: 'single-ally',
                effects: [
                    { type: 'heal', power: 1.8 },
                ],
            },
            {
                id: 'brisa.vento-a-favor',
                name: 'Vento a Favor',
                description: 'Aumenta a velocidade e o ataque de todos os aliados por 2 turnos.',
                energyCost: 3,
                target: 'all-allies',
                effects: [
                    { type: 'status', status: 'speed_up', turns: 2, power: 0.3 },
                    { type: 'status', status: 'atk_up', turns: 2, power: 0.2 },
                ],
            },
            {
                id: 'brisa.chuva-restauradora',
                name: 'Chuva Restauradora',
                description: 'Recupera a vida de todos os aliados.',
                energyCost: 4,
                target: 'all-allies',
                effects: [
                    { type: 'heal', power: 1.1 },
                ],
            },
        ],
    },
    {
        id: 'faisca',
        name: 'Faísca',
        role: 'assassin',
        stats: { maxHp: 620, atk: 180, def: 30, speed: 135, critChance: 0.3, critDamage: 1.6 },
        skills: [
            {
                id: 'faisca.choque',
                name: 'Choque',
                description: 'Golpeia um inimigo.',
                energyCost: 0,
                target: 'single-enemy',
                effects: [
                    { type: 'damage', power: 0.9 },
                ],
            },
            {
                id: 'faisca.relampago',
                name: 'Relâmpago',
                description: 'Um golpe devastador com 30% de chance de atordoar o alvo.',
                energyCost: 3,
                target: 'single-enemy',
                effects: [
                    { type: 'damage', power: 1.9 },
                    { type: 'status', status: 'stun', turns: 1, power: 0, chance: 0.3 },
                ],
            },
        ],
    },
    {
        id: 'geada',
        name: 'Geada',
        role: 'mage',
        stats: { maxHp: 680, atk: 200, def: 35, speed: 108, critChance: 0.1, critDamage: 1.5 },
        skills: [
            {
                id: 'geada.estilhaco',
                name: 'Estilhaço',
                description: 'Golpeia um inimigo com gelo.',
                energyCost: 0,
                target: 'single-enemy',
                effects: [
                    { type: 'damage', power: 1.0 },
                ],
            },
            {
                id: 'geada.nevasca',
                name: 'Nevasca',
                description: 'Atinge todos os inimigos e os deixa mais lentos por 2 turnos.',
                energyCost: 3,
                target: 'all-enemies',
                effects: [
                    { type: 'damage', power: 0.9 },
                    { type: 'status', status: 'speed_down', turns: 2, power: 0.3 },
                ],
            },
            {
                id: 'geada.prisao-de-gelo',
                name: 'Prisão de Gelo',
                description: 'Congela um inimigo: causa dano e o faz perder a próxima vez.',
                energyCost: 4,
                target: 'single-enemy',
                effects: [
                    { type: 'damage', power: 0.8 },
                    { type: 'status', status: 'stun', turns: 1, power: 0 },
                ],
            },
        ],
    },
    {
        id: 'espinho',
        name: 'Espinho',
        role: 'fighter',
        stats: { maxHp: 920, atk: 170, def: 65, speed: 95, critChance: 0.1, critDamage: 1.5 },
        skills: [
            {
                id: 'espinho.chicote',
                name: 'Chicote',
                description: 'Golpeia um inimigo.',
                energyCost: 0,
                target: 'single-enemy',
                effects: [
                    { type: 'damage', power: 1.0 },
                ],
            },
            {
                id: 'espinho.espinho-venenoso',
                name: 'Espinho Venenoso',
                description: 'Causa dano e envenena o alvo por 3 turnos.',
                energyCost: 2,
                target: 'single-enemy',
                effects: [
                    { type: 'damage', power: 0.8 },
                    { type: 'status', status: 'poison', turns: 3, power: 0.55 },
                ],
            },
            {
                id: 'espinho.seiva',
                name: 'Seiva',
                description: 'Recupera a própria vida e aumenta a própria defesa por 2 turnos.',
                energyCost: 2,
                target: 'self',
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
