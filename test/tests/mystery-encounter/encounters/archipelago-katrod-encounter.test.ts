import { ArchipelagoKatrodEncounter } from "#app/archipelago/ap-katrod-encounter";
import type { BattleScene } from "#app/battle-scene";
import { BiomeId } from "#enums/biome-id";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { BaseStatModifier, ExpBalanceModifier } from "#modifiers/modifier";
import * as EncounterPhaseUtils from "#mystery-encounters/encounter-phase-utils";
import * as MysteryEncounters from "#mystery-encounters/mystery-encounter-biomes";
import { GameManager } from "#test/framework/game-manager";
import { runMysteryEncounterToEnd } from "#test/utils/encounter-test-utils";
import { ModifierSelectUiHandler } from "#ui/modifier-select-ui-handler";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const defaultParty = [SpeciesId.LAPRAS, SpeciesId.GENGAR, SpeciesId.ABRA];
const defaultBiome = BiomeId.CAVE;
const defaultWave = 45;

describe("Archipelago Katrod - Mystery Encounter", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let scene: BattleScene;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    scene = game.scene;
    game.override
      .mysteryEncounterChance(100)
      .startingWave(defaultWave)
      .startingBiome(defaultBiome)
      .disableTrainerWaves();

    vi.spyOn(MysteryEncounters, "mysteryEncountersByBiome", "get").mockReturnValue(
      new Map<BiomeId, MysteryEncounterType[]>([[BiomeId.CAVE, [MysteryEncounterType.ARCHIPELAGO_KATROD]]]),
    );
  });

  it("should have the correct properties", async () => {
    await game.runToMysteryEncounter(MysteryEncounterType.ARCHIPELAGO_KATROD, defaultParty);

    expect(ArchipelagoKatrodEncounter.encounterType).toBe(MysteryEncounterType.ARCHIPELAGO_KATROD);
    expect(ArchipelagoKatrodEncounter.encounterTier).toBe(MysteryEncounterTier.ROGUE);
    expect(ArchipelagoKatrodEncounter.options.length).toBe(4);
  });

  it("should not spawn outside of the Archipelago mode", async () => {
    await game.runToMysteryEncounter();

    expect(scene.currentBattle?.mysteryEncounter?.encounterType).not.toBe(MysteryEncounterType.ARCHIPELAGO_KATROD);
  });

  it("option 1 should give Exp. Balances, a vitamin to each Pokémon and take 20% of the money", async () => {
    scene.money = 10000;
    await game.runToMysteryEncounter(MysteryEncounterType.ARCHIPELAGO_KATROD, defaultParty);
    await runMysteryEncounterToEnd(game, 1);

    expect(scene.findModifier(m => m instanceof ExpBalanceModifier)?.getStackCount()).toBe(4);
    for (const pokemon of scene.getPlayerParty()) {
      expect(scene.findModifier(m => m instanceof BaseStatModifier && m.pokemonId === pokemon.id)).toBeDefined();
    }
    expect(scene.money).toBe(8000);
  });

  it("option 2 should randomize abilities, passives and types, and offer 4 moves", async () => {
    await game.runToMysteryEncounter(MysteryEncounterType.ARCHIPELAGO_KATROD, defaultParty);
    const unshiftNew = scene.phaseManager.unshiftNew.bind(scene.phaseManager);
    const learnedMoves: unknown[] = [];
    vi.spyOn(scene.phaseManager, "unshiftNew").mockImplementation(((name: string, ...args: unknown[]) => {
      if (name === "LearnMovePhase") {
        learnedMoves.push(args);
        return;
      }
      return (unshiftNew as (...a: unknown[]) => unknown)(name, ...args);
    }) as typeof scene.phaseManager.unshiftNew);

    await runMysteryEncounterToEnd(game, 2);

    for (const pokemon of scene.getPlayerParty()) {
      expect(pokemon.customPokemonData.ability).toBeGreaterThan(0);
      expect(pokemon.customPokemonData.passive).toBeGreaterThan(0);
      expect(pokemon.customPokemonData.types).toHaveLength(2);
      expect(pokemon.getTypes()).toEqual(pokemon.customPokemonData.types);
    }
    expect(learnedMoves).toHaveLength(4 * defaultParty.length);
  });

  it("option 3 should start a battle against the 6 Pokémon of Katrod", async () => {
    await game.runToMysteryEncounter(MysteryEncounterType.ARCHIPELAGO_KATROD, defaultParty);
    await runMysteryEncounterToEnd(game, 3, undefined, true);

    expect(scene.currentBattle.trainer).toBeDefined();
    expect(scene.getEnemyParty()).toHaveLength(6);
    expect(scene.getEnemyParty().map(p => p.species.speciesId)).toEqual([
      SpeciesId.TOXICROAK,
      SpeciesId.TOXTRICITY,
      SpeciesId.XATU,
      SpeciesId.EXCADRILL,
      SpeciesId.ROTOM,
      SpeciesId.GALAR_MOLTRES,
    ]);
    // "de la Commune" stays in French whatever the language
    expect(scene.getEnemyParty()[5].getNameToRender()).toMatch(/ de la Commune$/);
  });

  it("option 4 should open a regular shop", async () => {
    const leaveSpy = vi.spyOn(EncounterPhaseUtils, "leaveEncounterWithoutBattle");
    await game.runToMysteryEncounter(MysteryEncounterType.ARCHIPELAGO_KATROD, defaultParty);
    await runMysteryEncounterToEnd(game, 4);
    await game.phaseInterceptor.to("SelectModifierPhase", false);
    expect(game).toBeAtPhase("SelectModifierPhase");
    await game.phaseInterceptor.to("SelectModifierPhase");

    expect(leaveSpy).toHaveBeenCalled();
    expect(scene.ui.mode).toBe(UiMode.MODIFIER_SELECT);
    const handler = scene.ui.handlers.find(h => h instanceof ModifierSelectUiHandler) as ModifierSelectUiHandler;
    expect(handler.options.length).toBe(3);
  });
});
