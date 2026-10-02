/** Números que definem o ritmo do jogo. Mexer aqui é balancear. */

/**
 * Energia. No começo de cada turno a energia de cada time é reabastecida: o
 * que sobrou do turno anterior não acumula. O turno 1 dá INITIAL_ENERGY, e
 * cada turno seguinte dá ENERGY_GROWTH_PER_TURN a mais, até MAX_ENERGY.
 */
export const INITIAL_ENERGY = 3;

/** Quanto a energia do turno cresce de um turno para o outro. */
export const ENERGY_GROWTH_PER_TURN = 1;

/** O máximo de energia que um turno pode dar. */
export const MAX_ENERGY = 10;

export const MAX_TEAM_SIZE = 6;

/**
 * Fúria: depois deste turno, todo dano cresce a cada turno que passa.
 * Sem isso, dois times com cura poderiam lutar para sempre.
 * (Um turno é uma rodada inteira: todas as unidades vivas agem uma vez.)
 */
export const FURY_START_TURN = 8;

/** Quanto o dano cresce por turno durante a fúria (0.5 = +50% por turno). */
export const FURY_DAMAGE_PER_TURN = 0.5;

/**
 * Piso dos debuffs: por mais penalidades que acumule, um atributo nunca cai
 * abaixo desta fração do valor original.
 */
export const MIN_STAT_FACTOR = 0.2;
