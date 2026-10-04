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
 * - `perTargetMissingHp` num efeito de dano é o golpe de execução: essa
 *   porcentagem a mais de dano para cada 1% de vida que o alvo já perdeu;
 * - nos efeitos de status, `power` é o valor do status: ATK x power para
 *   queimadura, veneno e escudo; a fração do atributo para bônus e
 *   penalidades (0.3 = 30%) e para `passive_up`, que fortalece a passiva de
 *   começo de vez de quem o carrega (0.8 = 80% a mais de cura ou dano); 0
 *   para atordoamento e provocação;
 * - `bleed` (sangramento) é dano por turno como queimadura e veneno, mas é um
 *   status à parte: os três podem estar no mesmo alvo;
 * - o efeito `cleanse` é a purificação: tira do alvo os efeitos negativos
 *   (atordoamento, queimadura, veneno e as penalidades de atributo);
 * - todo personagem tem pelo menos uma passiva (`passives`), que ninguém usa:
 *   vale sozinha. A maioria deixa as habilidades do próprio personagem mais
 *   fortes; as de começo de vez (`turn_start`) agem por conta própria. Os
 *   tipos estão em PassiveEffect (types.ts), e a descrição precisa dizer os
 *   mesmos números que estão em `effect`;
 * - um personagem pode ter `forms`: outras formas em que ele se transforma
 *   com o efeito `transform` (o urso e o lobo do Druida). Cada forma tem os
 *   próprios atributos, habilidades e passivas, e segue as mesmas regras de
 *   um personagem: a primeira habilidade é o ataque básico, no máximo três
 *   ativas. Os ids continuam "<personagem>.<habilidade>". A tela procura a
 *   ilustração da forma em "<personagem>-<forma>";
 * - `heal_down` reduz a cura que o alvo recebe (`power` 0.6 = 60% a menos), de
 *   qualquer origem: habilidade, passiva ou roubo de vida;
 * - um personagem pode ter `summons`: unidades que ele invoca com o efeito
 *   `summon` numa habilidade de alvo `corpse` (o Guerreiro Esqueleto do
 *   Necromante). A invocação tem o mesmo formato de uma forma, mas o id dela
 *   é o de uma unidade própria: as habilidades são "<invocação>.<habilidade>"
 *   e a ilustração é "<invocação>.webp". Ela não aparece na escolha de time.
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
                energyCost: 1,
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
                description: 'Atinge todos os inimigos, reduz a defesa deles e os deixa queimando por 2 turnos.',
                energyCost: 2,
                target: 'all-enemies',
                element: 'fire',
                effects: [
                    { type: 'damage', power: 1.0 },
                    { type: 'status', status: 'def_down', turns: 2, power: 0.25 },
                    { type: 'status', status: 'burn', turns: 2, power: 0.3 },
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
                energyCost: 1,
                target: 'single-ally',
                element: 'light',
                effects: [
                    { type: 'status', status: 'shield', turns: 2, power: 2.0 },
                ],
            },
            {
                id: 'cavaleiro.brado-de-guerra',
                name: 'Brado de Guerra',
                description: 'Provoca os inimigos por 2 turnos: os golpes de alvo único deles só podem mirar no Cavaleiro. Também reduz o ataque deles.',
                energyCost: 2,
                target: 'all-enemies',
                element: 'physical',
                effects: [
                    // Provocação: fica no próprio Cavaleiro, e quem escolhe alvo é obrigado a mirar nele.
                    { type: 'status', status: 'taunt', turns: 2, power: 0, to: 'self' },
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
        id: 'sacerdote',
        name: 'Sacerdote',
        role: 'support',
        stats: { maxHp: 740, atk: 160, def: 40, speed: 120, critChance: 0.05, critDamage: 1.5 },
        skills: [
            {
                id: 'sacerdote.raio-de-luz',
                name: 'Raio de Luz',
                description: 'Lança um raio de luz em um inimigo.',
                energyCost: 0,
                target: 'single-enemy',
                element: 'light',
                ranged: true,
                effects: [
                    { type: 'damage', power: 0.9 },
                ],
            },
            {
                id: 'sacerdote.toque-curativo',
                name: 'Toque Curativo',
                description: 'Cura um aliado e remove os efeitos negativos dele.',
                energyCost: 1,
                target: 'single-ally',
                element: 'light',
                effects: [
                    { type: 'cleanse' },
                    { type: 'heal', power: 1.8 },
                ],
            },
            {
                id: 'sacerdote.bencao',
                name: 'Bênção',
                description: 'Aumenta a velocidade e o ataque dos aliados por 2 turnos. Nesse tempo, a Aura Restauradora cura 80% a mais.',
                energyCost: 2,
                target: 'all-allies',
                element: 'light',
                effects: [
                    { type: 'status', status: 'speed_up', turns: 2, power: 0.3 },
                    { type: 'status', status: 'atk_up', turns: 2, power: 0.2 },
                    // Fortalece a passiva do próprio Sacerdote: as duas próximas curas da Aura Restauradora.
                    { type: 'status', status: 'passive_up', turns: 2, power: 0.8, to: 'self' },
                ],
            },
        ],
        passives: [
            // Era a habilidade Luz Restauradora (cura em área, 3 de energia): virou
            // uma cura menor que acontece sozinha a cada vez do Sacerdote.
            {
                id: 'sacerdote.aura-restauradora',
                name: 'Aura Restauradora',
                description: 'No começo da vez do Sacerdote, os aliados feridos recuperam vida igual a 40% do ataque dele.',
                element: 'light',
                effect: { type: 'turn_start', target: 'all-allies', effects: [{ type: 'heal', power: 0.4 }] },
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
                energyCost: 2,
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
            {
                id: 'barbaro.sangue-quente',
                name: 'Sangue Quente',
                description: 'Para cada 1% de vida que o Bárbaro perdeu, os golpes dele causam 1% a mais de dano.',
                element: 'lightning',
                effect: { type: 'damage_per_missing_hp', amount: 1 },
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
                energyCost: 2,
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
                energyCost: 2,
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
                energyCost: 1,
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
                energyCost: 1,
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
                description: 'O veneno do Guardião causa 60% a mais de dano a cada turno que o alvo segue envenenado. Se o veneno acabar, o próximo recomeça do normal.',
                element: 'nature',
                effect: { type: 'status_growth', statuses: ['poison'], amount: 0.6 },
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
                energyCost: 1,
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
                energyCost: 2,
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
                energyCost: 1,
                target: 'single-enemy',
                element: 'shadow',
                effects: [
                    { type: 'damage', power: 1.5, drain: 0.5 },
                ],
            },
            {
                id: 'vampiro.banquete-de-sangue',
                name: 'Banquete de Sangue',
                description: 'Atinge todos os inimigos e recupera vida igual à metade do dano causado.',
                energyCost: 2,
                target: 'all-enemies',
                element: 'shadow',
                effects: [
                    { type: 'damage', power: 0.75, drain: 0.5 },
                ],
            },
        ],
        passives: [
            {
                id: 'vampiro.sede-de-sangue',
                name: 'Sede de Sangue',
                description: 'Cada cura que o Vampiro recebe do roubo de vida das habilidades aumenta o dano dele em 10% até o fim da batalha.',
                element: 'shadow',
                effect: { type: 'damage_per_drain', amount: 0.1 },
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
                description: 'Cura um aliado, remove os efeitos negativos dele e aumenta a defesa por 2 turnos.',
                energyCost: 1,
                target: 'single-ally',
                element: 'nature',
                effects: [
                    { type: 'cleanse' },
                    { type: 'heal', power: 1.7 },
                    { type: 'status', status: 'def_up', turns: 2, power: 0.25 },
                ],
            },
            {
                id: 'driade.florescer',
                name: 'Florescer',
                description: 'Cura todos os aliados e aumenta a defesa deles por 2 turnos.',
                energyCost: 2,
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
            // alvo escolhido): virou um golpe que acontece sozinho a cada vez da
            // Dríade, sempre no inimigo mais veloz.
            {
                id: 'driade.raizes-enredantes',
                name: 'Raízes Enredantes',
                description: 'No começo da vez da Dríade, raízes golpeiam o inimigo mais veloz (100% do ataque dela) e tiram 20% da velocidade dele por 1 turno.',
                element: 'nature',
                ranged: true,
                effect: {
                    type: 'turn_start',
                    target: 'fastest-enemy',
                    effects: [
                        { type: 'damage', power: 1.0 },
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
                energyCost: 1,
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
                description: 'Dano muito alto em um inimigo. Para cada 1% de vida que o alvo já perdeu, causa 1% a mais.',
                energyCost: 2,
                target: 'single-enemy',
                element: 'physical',
                effects: [
                    { type: 'damage', power: 2.3, perTargetMissingHp: 1 },
                ],
            },
        ],
        passives: [
            {
                id: 'ladino.ponto-fraco',
                name: 'Ponto Fraco',
                description: 'O Ladino tem 25% a mais de chance de crítico contra inimigos com algum efeito negativo.',
                element: 'physical',
                effect: { type: 'crit_chance_bonus', amount: 0.25, when: { type: 'target_has_status', statuses: ['burn', 'poison', 'bleed', 'heal_down', 'stun', 'atk_down', 'def_down', 'speed_down'] } },
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
                energyCost: 0,
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
                energyCost: 1,
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
                energyCost: 1,
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
                energyCost: 2,
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
                description: 'Os golpes do Arqueiro causam 50% a mais em inimigos com mais de 70% da vida e tiram 20% da defesa do alvo por 2 turnos.',
                element: 'physical',
                effect: { type: 'damage_bonus', amount: 0.5, when: { type: 'target_hp_above', ratio: 0.7 } },
                also: [{ type: 'status_on_hit', status: 'def_down', turns: 2, power: 0.2 }],
            },
        ],
    },
    {
        // Começa humano, quase só com o ataque básico: o jogo dele é escolher a
        // forma. Transformar-se custa 1 de energia e não gasta a vez (passiva).
        id: 'druida',
        name: 'Druida',
        role: 'shapeshifter',
        stats: { maxHp: 820, atk: 175, def: 45, speed: 112, critChance: 0.1, critDamage: 1.5 },
        skills: [
            {
                id: 'druida.golpe-de-cajado',
                name: 'Golpe de Cajado',
                description: 'Golpeia um inimigo com o cajado.',
                energyCost: 0,
                target: 'single-enemy',
                element: 'nature',
                effects: [
                    { type: 'damage', power: 1.0 },
                ],
            },
            {
                id: 'druida.forma-de-urso',
                name: 'Forma de Urso',
                description: 'Vira urso por 3 turnos: mais vida e defesa, provoca e recupera vida ao bater.',
                energyCost: 1,
                target: 'self',
                element: 'nature',
                effects: [
                    { type: 'transform', form: 'urso', turns: 3 },
                ],
            },
            {
                id: 'druida.forma-de-lobo',
                name: 'Forma de Lobo',
                description: 'Vira lobo por 3 turnos: veloz, de ataque alto, e todo golpe faz o alvo sangrar.',
                energyCost: 1,
                target: 'self',
                element: 'nature',
                effects: [
                    { type: 'transform', form: 'lobo', turns: 3 },
                ],
            },
        ],
        passives: [
            {
                id: 'druida.chamado-selvagem',
                name: 'Chamado Selvagem',
                description: 'Ao se transformar, o Druida age de novo na mesma vez.',
                element: 'nature',
                effect: { type: 'extra_action_on_transform' },
            },
        ],
        forms: [
            {
                // Tanque: aguenta, provoca e se sustenta com roubo de vida.
                id: 'urso',
                name: 'Urso',
                stats: { maxHp: 1300, atk: 165, def: 95, speed: 92, critChance: 0.05, critDamage: 1.5 },
                skills: [
                    {
                        id: 'druida.patada',
                        name: 'Patada',
                        description: 'Golpeia um inimigo com a pata.',
                        energyCost: 0,
                        target: 'single-enemy',
                        element: 'nature',
                        effects: [
                            { type: 'damage', power: 1.0 },
                        ],
                    },
                    {
                        id: 'druida.rugido',
                        name: 'Rugido',
                        description: 'Provoca os inimigos e aumenta a própria defesa por 2 turnos: os golpes de alvo único deles só podem mirar no urso.',
                        energyCost: 1,
                        target: 'self',
                        element: 'nature',
                        effects: [
                            { type: 'status', status: 'taunt', turns: 2, power: 0 },
                            { type: 'status', status: 'def_up', turns: 2, power: 0.3 },
                        ],
                    },
                    {
                        id: 'druida.esmagar',
                        name: 'Esmagar',
                        description: 'Um golpe pesado que reduz o ataque do alvo por 2 turnos.',
                        energyCost: 2,
                        target: 'single-enemy',
                        element: 'nature',
                        effects: [
                            { type: 'damage', power: 1.4 },
                            { type: 'status', status: 'atk_down', turns: 2, power: 0.3 },
                        ],
                    },
                ],
                passives: [
                    {
                        id: 'druida.vigor-do-urso',
                        name: 'Vigor do Urso',
                        description: 'Os golpes do urso devolvem como vida 40% do dano causado.',
                        element: 'nature',
                        effect: { type: 'lifesteal', amount: 0.4 },
                    },
                ],
            },
            {
                // Dano: veloz, crítico alto e sangramento em todo golpe.
                id: 'lobo',
                name: 'Lobo',
                stats: { maxHp: 720, atk: 215, def: 32, speed: 138, critChance: 0.3, critDamage: 1.7 },
                skills: [
                    {
                        id: 'druida.mordida',
                        name: 'Mordida',
                        description: 'Morde um inimigo.',
                        energyCost: 0,
                        target: 'single-enemy',
                        element: 'physical',
                        effects: [
                            { type: 'damage', power: 1.0 },
                        ],
                    },
                    {
                        id: 'druida.dilacerar',
                        name: 'Dilacerar',
                        description: 'Dois golpes de garra no mesmo inimigo. Cada um pode ser crítico.',
                        energyCost: 1,
                        target: 'single-enemy',
                        element: 'physical',
                        effects: [
                            { type: 'damage', power: 0.85 },
                            { type: 'damage', power: 0.85 },
                        ],
                    },
                    {
                        id: 'druida.frenesi',
                        name: 'Frenesi',
                        description: 'Avança sobre todos os inimigos, que saem sangrando.',
                        energyCost: 2,
                        target: 'all-enemies',
                        element: 'physical',
                        effects: [
                            { type: 'damage', power: 0.9 },
                        ],
                    },
                ],
                passives: [
                    {
                        id: 'druida.presas-afiadas',
                        name: 'Presas Afiadas',
                        description: 'Todo golpe do lobo faz o alvo sangrar por 2 turnos: dano por turno igual a 30% do ataque dele.',
                        element: 'physical',
                        effect: { type: 'status_on_hit', status: 'bleed', turns: 2, power: 0.3 },
                    },
                ],
            },
        ],
    },
    {
        // Mago de maldição: corta a cura do outro time e, conforme os aliados
        // caem, ergue os cadáveres como Guerreiros Esqueletos.
        id: 'necromante',
        name: 'Necromante',
        role: 'mage',
        stats: { maxHp: 730, atk: 195, def: 35, speed: 106, critChance: 0.1, critDamage: 1.5 },
        skills: [
            {
                id: 'necromante.toque-da-morte',
                name: 'Toque da Morte',
                description: 'Fere um inimigo, que recebe 60% a menos de cura por 2 turnos.',
                energyCost: 0,
                target: 'single-enemy',
                element: 'shadow',
                ranged: true,
                effects: [
                    { type: 'damage', power: 0.9 },
                    { type: 'status', status: 'heal_down', turns: 2, power: 0.6 },
                ],
            },
            {
                id: 'necromante.erguer-esqueleto',
                name: 'Erguer Esqueleto',
                description: 'Ergue um aliado caído como Guerreiro Esqueleto, que já age neste turno.',
                energyCost: 1,
                target: 'corpse',
                element: 'shadow',
                effects: [
                    { type: 'summon', summon: 'esqueleto' },
                ],
            },
            {
                id: 'necromante.praga',
                name: 'Praga',
                description: 'Fere todos os inimigos, que recebem 60% a menos de cura por 2 turnos.',
                energyCost: 1,
                target: 'all-enemies',
                element: 'shadow',
                effects: [
                    { type: 'damage', power: 0.8 },
                    { type: 'status', status: 'heal_down', turns: 2, power: 0.6 },
                ],
            },
        ],
        passives: [
            {
                id: 'necromante.senhor-dos-mortos',
                name: 'Senhor dos Mortos',
                description: 'Conta os aliados caídos que ainda podem ser erguidos.',
                element: 'shadow',
                effect: { type: 'count_corpses' },
            },
        ],
        summons: [
            {
                id: 'esqueleto',
                name: 'Guerreiro Esqueleto',
                stats: { maxHp: 650, atk: 180, def: 45, speed: 104, critChance: 0.15, critDamage: 1.5 },
                skills: [
                    {
                        id: 'esqueleto.espada-enferrujada',
                        name: 'Espada Enferrujada',
                        description: 'Golpeia um inimigo com a espada.',
                        energyCost: 0,
                        target: 'single-enemy',
                        element: 'physical',
                        effects: [
                            { type: 'damage', power: 1.0 },
                        ],
                    },
                    {
                        id: 'esqueleto.golpe-profano',
                        name: 'Golpe Profano',
                        description: 'Um golpe forte que reduz a defesa do alvo por 2 turnos.',
                        energyCost: 1,
                        target: 'single-enemy',
                        element: 'shadow',
                        effects: [
                            { type: 'damage', power: 1.4 },
                            { type: 'status', status: 'def_down', turns: 2, power: 0.2 },
                        ],
                    },
                ],
                passives: [
                    {
                        id: 'esqueleto.servo-da-maldicao',
                        name: 'Servo da Maldição',
                        description: 'Os golpes do esqueleto causam 30% a mais de dano em inimigos com a cura reduzida.',
                        element: 'shadow',
                        effect: { type: 'damage_bonus', amount: 0.3, when: { type: 'target_has_status', statuses: ['heal_down'] } },
                    },
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
