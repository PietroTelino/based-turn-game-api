/** Porta de entrada do motor. O resto da API importa daqui: import { ... } from '../game'. */
export * from './types';
export * from './constants';
export * from './errors';
export * from './engine';
export { chooseAction, chooseActionFor, chooseAiAction, chooseEasyAction, chooseHardAction, chooseTrainingAction } from './ai';
export { CHARACTERS, getCharacter } from './data/characters';
export { CAMPAIGN, getCampaignStage } from './data/campaign';
export { BOSSES, getBoss } from './data/bosses';
export { TOWER_MODIFIERS, towerFloor, applyTowerModifiers } from './data/tower';
export type { TowerFloor, TowerModifier } from './data/tower';
export { dailyChallenge } from './data/challenge';
export { WEEKLY_EVENTS, eventOf, weekKey, weekStart } from './data/events';
export type { EventMode, WeeklyEvent } from './data/events';
export { raidOf, raidBossDefinition } from './data/raid';
export type { RaidBoss } from './data/raid';
export type { DailyChallenge } from './data/challenge';
export type { CampaignStage } from './data/campaign';
