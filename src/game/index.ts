/** Porta de entrada do motor. O resto da API importa daqui: import { ... } from '../game'. */
export * from './types';
export * from './constants';
export * from './errors';
export * from './engine';
export { chooseAction, chooseTrainingAction } from './ai';
export { CHARACTERS, getCharacter } from './data/characters';
