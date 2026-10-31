/** Porta de entrada do motor. O resto da API importa daqui: import { ... } from '../game'. */
export * from './types';
export * from './constants';
export * from './errors';
export * from './engine';
export { chooseAction, chooseActionFor, chooseAiAction, chooseEasyAction, chooseHardAction, chooseTrainingAction } from './ai';
export { CHARACTERS, getCharacter } from './data/characters';
export { CAMPAIGN, getCampaignStage } from './data/campaign';
export type { CampaignStage } from './data/campaign';
