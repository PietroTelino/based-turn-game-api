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
 *   visual e qual som usar (`ranged: true` = projétil em alvo único, chuva de
 *   projéteis em área);
 * - `drain` num efeito de dano é roubo de vida: quem usa recupera essa fração
 *   do dano que o alvo perdeu;
 * - nos efeitos de status, `power` é o valor do status: ATK x power para
 *   queimadura, veneno e escudo; a fração do atributo para bônus e
 *   penalidades (0.3 = 30%); 0 para atordoamento;
 * - todo personagem tem pelo menos uma passiva (`passives`), que ninguém usa:
 *   vale sozinha. A maioria deixa as habilidades do próprio personagem mais
 *   fortes; as de começo de vez (`turn_start`) agem por conta própria. Os
 *   tipos estão em PassiveEffect (types.ts), e a descrição precisa dizer os
 *   mesmos números que estão em `effect`.
 */
export const CHARACTERS: CharacterDefinition[] = [
    {
        id: 'piromante',
        name: 'Piromante',
        role: 'mage',
        stats: { maxHp: 760, atk: 205, def: 35, speed: 105, critChance: 0.15, critDamage: 1.5 },
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
                energyCost: 3,
                target: 'all-enemies',
                element: 'fire',
                effects: [
                    { type: 'damage', power: 1.0 },
                    { type: 'status', status: 'def_down', turns: 2, power: 0.25 },
                ],
            },
        ],
        passives: [
            {
                id: 'piromante.combustao',
                name: 'Combustão',
                description: 'Os golpes do Piromante causam 40% a mais de dano em inimigos que estão queimando ou com a defesa reduzida.',
                element: 'fire',
                effect: { type: 'damage_bonus', amount: 0.4, when: { type: 'target_has_status', statuses: ['burn', 'def_down'] } },
            },
        ],
    },
    {
        id: 'cavaleiro',
        name: 'Cavaleiro',
        role: 'tank',
        stats: { maxHp: 1300, atk: 155, def: 90, speed: 88, critChance: 0.05, critDamage: 1.5 },
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
        passives: [
            {
                id: 'cavaleiro.peso-da-armadura',
                name: 'Peso da Armadura',
                description: 'Os golpes do Cavaleiro somam ao ataque 30% da defesa dele.',
                element: 'physical',
                effect: { type: 'atk_from_def', amount: 0.3 },
            },
        ],
    },
    {
        id: 'clerigo',
        name: 'Clérigo',
        role: 'support',
        stats: { maxHp: 740, atk: 160, def: 40, speed: 120, critChance: 0.05, critDamage: 1.5 },
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
        ],
        passives: [
            // Era a habilidade Luz Restauradora (cura em área, 3 de energia): virou
            // uma cura menor que acontece sozinha a cada vez do Clérigo.
            {
                id: 'clerigo.aura-restauradora',
                name: 'Aura Restauradora',
                description: 'No começo da vez do Clérigo, todos os aliados feridos recuperam vida igual a 20% do ataque dele.',
                element: 'light',
                effect: { type: 'turn_start', target: 'all-allies', effects: [{ type: 'heal', power: 0.2 }] },
            },
        ],
    },
    {
        id: 'barbaro',
        name: 'Bárbaro',
        role: 'attacker',
        stats: { maxHp: 650, atk: 185, def: 30, speed: 135, critChance: 0.3, critDamage: 1.6 },
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
        passives: [
            {
                id: 'barbaro.sede-de-batalha',
                name: 'Sede de Batalha',
                description: 'Quando o Bárbaro acerta um golpe crítico, o time recupera 2 de energia.',
                element: 'lightning',
                effect: { type: 'energy_on_crit', amount: 2 },
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
                energyCost: 3,
                target: 'single-enemy',
                element: 'ice',
                ranged: true,
                effects: [
                    { type: 'damage', power: 0.8 },
                    { type: 'status', status: 'stun', turns: 1, power: 0 },
                ],
            },
        ],
        passives: [
            {
                id: 'criomante.frio-cortante',
                name: 'Frio Cortante',
                description: 'Os golpes da Criomante causam 40% a mais de dano em inimigos lentos ou atordoados.',
                element: 'ice',
                effect: { type: 'damage_bonus', amount: 0.4, when: { type: 'target_has_status', statuses: ['speed_down', 'stun'] } },
            },
        ],
    },
    {
        id: 'guardiao',
        name: 'Guardião',
        role: 'fighter',
        stats: { maxHp: 950, atk: 190, def: 65, speed: 95, critChance: 0.1, critDamage: 1.5 },
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
        passives: [
            {
                id: 'guardiao.toxina-potente',
                name: 'Toxina Potente',
                description: 'O veneno que o Guardião aplica causa 60% a mais de dano por turno.',
                element: 'nature',
                effect: { type: 'status_power', statuses: ['poison'], amount: 0.6 },
            },
        ],
    },
    {
        id: 'banshee',
        name: 'Banshee',
        role: 'mage',
        stats: { maxHp: 720, atk: 210, def: 30, speed: 112, critChance: 0.1, critDamage: 1.5 },
        skills: [
            {
                id: 'banshee.lamento',
                name: 'Lamento',
                description: 'Atinge um inimigo com um lamento espectral.',
                energyCost: 0,
                target: 'single-enemy',
                element: 'shadow',
                ranged: true,
                effects: [
                    { type: 'damage', power: 0.9 },
                ],
            },
            {
                id: 'banshee.maldicao',
                name: 'Maldição',
                description: 'Causa dano a um inimigo e reduz a defesa dele por 2 turnos.',
                energyCost: 2,
                target: 'single-enemy',
                element: 'shadow',
                ranged: true,
                effects: [
                    { type: 'damage', power: 1.1 },
                    { type: 'status', status: 'def_down', turns: 2, power: 0.3 },
                ],
            },
            {
                id: 'banshee.grito-aterrador',
                name: 'Grito Aterrador',
                description: 'Atinge todos os inimigos, com 35% de chance de atordoar cada um.',
                energyCost: 3,
                target: 'all-enemies',
                element: 'shadow',
                effects: [
                    { type: 'damage', power: 0.9 },
                    { type: 'status', status: 'stun', turns: 1, power: 0, chance: 0.35 },
                ],
            },
        ],
        passives: [
            {
                id: 'banshee.pressagio',
                name: 'Presságio',
                description: 'Os golpes da Banshee causam 35% a mais de dano em inimigos com menos de 40% da vida.',
                element: 'shadow',
                effect: { type: 'damage_bonus', amount: 0.35, when: { type: 'target_hp_below', ratio: 0.4 } },
            },
        ],
    },
    {
        id: 'vampiro',
        name: 'Vampiro',
        role: 'fighter',
        stats: { maxHp: 980, atk: 190, def: 55, speed: 102, critChance: 0.15, critDamage: 1.5 },
        skills: [
            {
                id: 'vampiro.garras',
                name: 'Garras',
                description: 'Rasga um inimigo com as garras.',
                energyCost: 0,
                target: 'single-enemy',
                element: 'shadow',
                effects: [
                    { type: 'damage', power: 1.0 },
                ],
            },
            {
                id: 'vampiro.mordida',
                name: 'Mordida',
                description: 'Morde um inimigo e recupera vida igual à metade do dano causado.',
                energyCost: 2,
                target: 'single-enemy',
                element: 'shadow',
                effects: [
                    { type: 'damage', power: 1.5, drain: 0.5 },
                ],
            },
            {
                id: 'vampiro.banquete-de-sangue',
                name: 'Banquete de Sangue',
                description: 'Atinge todos os inimigos e recupera vida igual a 30% do dano causado.',
                energyCost: 3,
                target: 'all-enemies',
                element: 'shadow',
                effects: [
                    { type: 'damage', power: 0.75, drain: 0.3 },
                ],
            },
        ],
        passives: [
            {
                id: 'vampiro.sede-de-sangue',
                name: 'Sede de Sangue',
                description: 'Todo golpe do Vampiro devolve a ele 30% do dano causado como vida, somando com o roubo de vida das habilidades.',
                element: 'shadow',
                effect: { type: 'lifesteal', amount: 0.3 },
            },
        ],
    },
    {
        id: 'driade',
        name: 'Dríade',
        role: 'support',
        stats: { maxHp: 860, atk: 170, def: 45, speed: 110, critChance: 0.05, critDamage: 1.5 },
        skills: [
            {
                id: 'driade.espinhos',
                name: 'Espinhos',
                description: 'Lança espinhos em um inimigo.',
                energyCost: 0,
                target: 'single-enemy',
                element: 'nature',
                ranged: true,
                effects: [
                    { type: 'damage', power: 0.9 },
                ],
            },
            {
                id: 'driade.abraco-da-floresta',
                name: 'Abraço da Floresta',
                description: 'Recupera a vida de um aliado e aumenta a defesa dele por 2 turnos.',
                energyCost: 2,
                target: 'single-ally',
                element: 'nature',
                effects: [
                    { type: 'heal', power: 1.7 },
                    { type: 'status', status: 'def_up', turns: 2, power: 0.25 },
                ],
            },
            {
                id: 'driade.florescer',
                name: 'Florescer',
                description: 'Recupera a vida de todos os aliados e aumenta a defesa deles por 2 turnos.',
                energyCost: 3,
                target: 'all-allies',
                element: 'nature',
                effects: [
                    { type: 'heal', power: 0.8 },
                    { type: 'status', status: 'def_up', turns: 2, power: 0.2 },
                ],
            },
        ],
        passives: [
            // Era uma habilidade de 3 de energia (dano, lentidão e ataque menor num
            // alvo escolhido): virou um golpe mais fraco que acontece sozinho a
            // cada vez da Dríade, sempre no inimigo mais veloz.
            {
                id: 'driade.raizes-enredantes',
                name: 'Raízes Enredantes',
                description: 'No começo da vez da Dríade, raízes prendem o inimigo mais veloz: causam dano (30% do ataque dela) e reduzem a velocidade dele em 20% por 1 turno.',
                element: 'nature',
                ranged: true,
                effect: {
                    type: 'turn_start',
                    target: 'fastest-enemy',
                    effects: [
                        { type: 'damage', power: 0.3 },
                        { type: 'status', status: 'speed_down', turns: 1, power: 0.2 },
                    ],
                },
            },
        ],
    },
    {
        id: 'ladino',
        name: 'Ladino',
        role: 'assassin',
        stats: { maxHp: 680, atk: 200, def: 30, speed: 140, critChance: 0.35, critDamage: 1.8 },
        skills: [
            {
                id: 'ladino.punhalada',
                name: 'Punhalada',
                description: 'Golpeia um inimigo com a adaga.',
                energyCost: 0,
                target: 'single-enemy',
                element: 'physical',
                effects: [
                    { type: 'damage', power: 1.0 },
                ],
            },
            {
                id: 'ladino.lamina-envenenada',
                name: 'Lâmina Envenenada',
                description: 'Causa dano e envenena o alvo por 3 turnos.',
                energyCost: 2,
                target: 'single-enemy',
                element: 'nature',
                effects: [
                    { type: 'damage', power: 1.0 },
                    { type: 'status', status: 'poison', turns: 3, power: 0.45 },
                ],
            },
            {
                id: 'ladino.golpe-fatal',
                name: 'Golpe Fatal',
                description: 'Um golpe certeiro que causa dano muito alto a um inimigo.',
                energyCost: 3,
                target: 'single-enemy',
                element: 'physical',
                effects: [
                    { type: 'damage', power: 2.3 },
                ],
            },
        ],
        passives: [
            {
                id: 'ladino.ponto-fraco',
                name: 'Ponto Fraco',
                description: 'O Ladino tem 25% a mais de chance de crítico contra inimigos com algum efeito negativo.',
                element: 'physical',
                effect: { type: 'crit_chance_bonus', amount: 0.25, when: { type: 'target_has_status', statuses: ['burn', 'poison', 'stun', 'atk_down', 'def_down', 'speed_down'] } },
            },
        ],
    },
    {
        id: 'espadachim',
        name: 'Espadachim',
        role: 'fighter',
        stats: { maxHp: 850, atk: 188, def: 50, speed: 125, critChance: 0.2, critDamage: 1.5 },
        skills: [
            {
                id: 'espadachim.estocada',
                name: 'Estocada',
                description: 'Golpeia um inimigo com a espada.',
                energyCost: 0,
                target: 'single-enemy',
                element: 'physical',
                effects: [
                    { type: 'damage', power: 1.0 },
                ],
            },
            {
                id: 'espadachim.postura-de-duelo',
                name: 'Postura de Duelo',
                description: 'Aumenta o próprio ataque e a própria defesa por 2 turnos.',
                energyCost: 2,
                target: 'self',
                element: 'physical',
                effects: [
                    { type: 'status', status: 'atk_up', turns: 2, power: 0.3 },
                    { type: 'status', status: 'def_up', turns: 2, power: 0.3 },
                ],
            },
            {
                id: 'espadachim.danca-das-laminas',
                name: 'Dança das Lâminas',
                description: 'Três golpes rápidos no mesmo inimigo. Cada um pode ser crítico.',
                energyCost: 3,
                target: 'single-enemy',
                element: 'physical',
                effects: [
                    { type: 'damage', power: 0.58 },
                    { type: 'damage', power: 0.58 },
                    { type: 'damage', power: 0.58 },
                ],
            },
        ],
        passives: [
            {
                id: 'espadachim.fio-da-lamina',
                name: 'Fio da Lâmina',
                description: 'Os golpes do Espadachim ignoram 60% da defesa do alvo.',
                element: 'physical',
                effect: { type: 'ignore_defense', amount: 0.6 },
            },
        ],
    },
    {
        id: 'arqueiro',
        name: 'Arqueiro',
        role: 'attacker',
        stats: { maxHp: 720, atk: 220, def: 35, speed: 118, critChance: 0.25, critDamage: 1.6 },
        skills: [
            {
                id: 'arqueiro.flecha',
                name: 'Flecha',
                description: 'Dispara uma flecha em um inimigo.',
                energyCost: 0,
                target: 'single-enemy',
                element: 'physical',
                ranged: true,
                effects: [
                    { type: 'damage', power: 1.0 },
                ],
            },
            {
                id: 'arqueiro.flecha-incapacitante',
                name: 'Flecha Incapacitante',
                description: 'Causa dano a um inimigo e reduz a velocidade dele por 2 turnos.',
                energyCost: 2,
                target: 'single-enemy',
                element: 'physical',
                ranged: true,
                effects: [
                    { type: 'damage', power: 1.1 },
                    { type: 'status', status: 'speed_down', turns: 2, power: 0.4 },
                ],
            },
            {
                id: 'arqueiro.chuva-de-flechas',
                name: 'Chuva de Flechas',
                description: 'Dispara uma saraivada que atinge todos os inimigos.',
                energyCost: 3,
                target: 'all-enemies',
                element: 'physical',
                ranged: true,
                effects: [
                    { type: 'damage', power: 0.9 },
                ],
            },
        ],
        passives: [
            {
                id: 'arqueiro.olho-de-aguia',
                name: 'Olho de Águia',
                description: 'Os golpes do Arqueiro causam 25% a mais de dano em inimigos com mais de 70% da vida.',
                element: 'physical',
                effect: { type: 'damage_bonus', amount: 0.25, when: { type: 'target_hp_above', ratio: 0.7 } },
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
