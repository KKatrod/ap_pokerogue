/**
 * Blitz option of the Archipelago mode: a 100-floor run (spec: `archipelago/BLITZ.md`).
 * Dependency-free (constants only), so core modules such as `game-mode.ts` can use it.
 */

import { ClassicFixedBossWaves } from "#enums/fixed-boss-waves";
import apData from "./ap-data.json";

/** Last floor of a Blitz run (the End biome takes the 10 floors before it) */
export const BLITZ_FINAL_WAVE: number = apData.blitz_final_wave;

/** Factor between the virtual floor (difficulty, shop tiers, Gym Leaders) and the real floor */
export const BLITZ_VIRTUAL_WAVE_FACTOR = 2;

/** Factor applied to the money won in battles */
export const BLITZ_MONEY_MULTIPLIER = 2;

/** Offset of the reward seed of the second reward phase of a floor, so it offers other rewards */
export const BLITZ_BONUS_REWARD_SEED_OFFSET = 1000;

/** Floors of the Gym Leaders: every 30 virtual floors, the last one moved before the Elite Four */
export const BLITZ_GYM_WAVES: readonly number[] = [10, 25, 40, 55, 70, 80];

/** Floors where Mystery Encounters may spawn (half of the Classic range) */
export const BLITZ_MYSTERY_ENCOUNTER_WAVES: [number, number] = [5, 90];

/** Floor of each Classic story battle in a Blitz run */
export const BLITZ_FIXED_BOSS_WAVES: Readonly<Record<ClassicFixedBossWaves, number>> = {
  [ClassicFixedBossWaves.TOWN_YOUNGSTER]: 3,
  [ClassicFixedBossWaves.RIVAL_1]: 4,
  [ClassicFixedBossWaves.RIVAL_2]: 13,
  [ClassicFixedBossWaves.EVIL_GRUNT_1]: 18,
  [ClassicFixedBossWaves.RIVAL_3]: 28,
  [ClassicFixedBossWaves.EVIL_GRUNT_2]: 31,
  [ClassicFixedBossWaves.EVIL_GRUNT_3]: 32,
  [ClassicFixedBossWaves.EVIL_ADMIN_1]: 33,
  [ClassicFixedBossWaves.RIVAL_4]: 48,
  [ClassicFixedBossWaves.EVIL_GRUNT_4]: 56,
  [ClassicFixedBossWaves.EVIL_ADMIN_2]: 57,
  [ClassicFixedBossWaves.EVIL_BOSS_1]: 58,
  [ClassicFixedBossWaves.RIVAL_5]: 68,
  [ClassicFixedBossWaves.EVIL_ADMIN_3]: 74,
  [ClassicFixedBossWaves.EVIL_BOSS_2]: 75,
  [ClassicFixedBossWaves.ELITE_FOUR_1]: 82,
  [ClassicFixedBossWaves.ELITE_FOUR_2]: 84,
  [ClassicFixedBossWaves.ELITE_FOUR_3]: 86,
  [ClassicFixedBossWaves.ELITE_FOUR_4]: 88,
  [ClassicFixedBossWaves.CHAMPION]: 90,
  [ClassicFixedBossWaves.RIVAL_6]: 95,
};

const classicWaveByBlitzWave = new Map<number, ClassicFixedBossWaves>(
  Object.entries(BLITZ_FIXED_BOSS_WAVES).map(([classicWave, blitzWave]) => [
    blitzWave,
    Number(classicWave) as ClassicFixedBossWaves,
  ]),
);

/**
 * @returns the Classic floor of the story battle held on this Blitz floor, or `undefined` if there is none
 */
export function getClassicWaveOfBlitzWave(blitzWave: number): ClassicFixedBossWaves | undefined {
  return classicWaveByBlitzWave.get(blitzWave);
}
