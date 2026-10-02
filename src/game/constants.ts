/** Números que definem o ritmo do jogo. Mexer aqui é balancear. */

/** Tamanho da barra de ação. A unidade joga quando a barra dela chega aqui. */
export const GAUGE_MAX = 1000;

/** Energia com que cada time começa. */
export const INITIAL_ENERGY = 3;

/** Teto da energia de um time. */
export const MAX_ENERGY = 8;

/** Energia que o time ganha toda vez que uma unidade dele começa um turno. */
export const ENERGY_PER_TURN = 1;

export const MAX_TEAM_SIZE = 6;

/**
 * Fúria: a partir deste turno, todo dano cresce a cada turno que passa.
 * Sem isso, dois times com cura poderiam lutar para sempre.
 */
export const FURY_START_TURN = 50;

/** Quanto o dano cresce por turno durante a fúria (0.1 = +10% por turno). */
export const FURY_DAMAGE_PER_TURN = 0.1;

/**
 * Piso dos debuffs: por mais penalidades que acumule, um atributo nunca cai
 * abaixo desta fração do valor original.
 */
export const MIN_STAT_FACTOR = 0.2;
