import { ArchipelagoOakEncounter, pickOakOffers } from "#app/archipelago/ap-oak-encounter";
import { archipelago } from "#app/archipelago/archipelago";
import type { BattleScene } from "#app/battle-scene";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { BiomeId } from "#enums/biome-id";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { PokeballType } from "#enums/pokeball";
import { SpeciesId } from "#enums/species-id";
import * as MysteryEncounters from "#mystery-encounters/mystery-encounter-biomes";
import { GameManager } from "#test/framework/game-manager";
import { runMysteryEncounterToEnd } from "#test/utils/encounter-test-utils";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const defaultParty = [SpeciesId.LAPRAS, SpeciesId.GENGAR, SpeciesId.ABRA];
const defaultBiome = BiomeId.CAVE;
const defaultWave = 45;

/** Missing Dexsanity Pokémon of the tests: many types and costs */
const MISSING = [
  SpeciesId.BULBASAUR,
  SpeciesId.CHARMANDER,
  SpeciesId.SQUIRTLE,
  SpeciesId.PIKACHU,
  SpeciesId.MACHOP,
  SpeciesId.GASTLY,
  SpeciesId.DRATINI,
  SpeciesId.EEVEE,
  SpeciesId.LARVITAR,
  SpeciesId.BELDUM,
  SpeciesId.MAGIKARP,
  SpeciesId.SNORLAX,
  SpeciesId.CATERPIE,
  SpeciesId.ZUBAT,
  SpeciesId.SCYTHER,
  SpeciesId.SNEASEL,
  SpeciesId.ABSOL,
  SpeciesId.MEWTWO,
];

const typesOf = (id: SpeciesId) => {
  const species = speciesDataRegistry.getSpecies(id);
  return species.type2 == null ? [species.type1] : [species.type1, species.type2];
};
const costOf = (id: SpeciesId) =>
  speciesDataRegistry.getStarterCost(speciesDataRegistry.getSpecies(id).getRootSpeciesId());

describe("Archipelago Professor Oak - Mystery Encounter", () => {
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
      new Map<BiomeId, MysteryEncounterType[]>([[BiomeId.CAVE, [MysteryEncounterType.ARCHIPELAGO_OAK]]]),
    );
    vi.spyOn(archipelago, "getMissingDexsanitySpecies").mockReturnValue(MISSING);
  });

  it("should have the correct properties", async () => {
    await game.runToMysteryEncounter(MysteryEncounterType.ARCHIPELAGO_OAK, defaultParty);

    expect(ArchipelagoOakEncounter.encounterType).toBe(MysteryEncounterType.ARCHIPELAGO_OAK);
    expect(ArchipelagoOakEncounter.encounterTier).toBe(MysteryEncounterTier.ROGUE);
    expect(ArchipelagoOakEncounter.options.length).toBe(4);
  });

  it("offers three missing Pokémon without a common type and with different costs", async () => {
    await game.runToMysteryEncounter(MysteryEncounterType.ARCHIPELAGO_OAK, defaultParty);
    const offers = scene.currentBattle.mysteryEncounter!.misc.offers;
    const ids: SpeciesId[] = offers.map(p => p.species.speciesId);

    expect(ids).toHaveLength(3);
    expect(ids.every(id => MISSING.includes(id))).toBe(true);
    const types = ids.flatMap(typesOf);
    expect(new Set(types).size).toBe(types.length);
    expect(new Set(ids.map(costOf)).size).toBe(3);
  });

  it("keeps fewer Pokémon when the missing ones share types or costs", () => {
    // Bulbasaur and Oddish are both Grass/Poison
    const offers = pickOakOffers([SpeciesId.BULBASAUR, SpeciesId.ODDISH]);
    expect(offers).toHaveLength(1);
  });

  it("option 1 gives the Pokémon as a catch (Dexsanity check)", async () => {
    await game.runToMysteryEncounter(MysteryEncounterType.ARCHIPELAGO_OAK, defaultParty);
    const offered = scene.currentBattle.mysteryEncounter!.misc.offers[0].species.speciesId;
    const caughtSpy = vi.spyOn(scene.gameData, "setPokemonCaught");
    const partyLength = scene.getPlayerParty().length;

    await runMysteryEncounterToEnd(game, 1);

    expect(scene.getPlayerParty()).toHaveLength(partyLength + 1);
    expect(scene.getPlayerParty().at(-1)?.species.speciesId).toBe(offered);
    expect(caughtSpy).toHaveBeenCalled();
    expect(caughtSpy.mock.calls[0][0].species.speciesId).toBe(offered);
  });

  it("option 4 gives Poké Balls", async () => {
    await game.runToMysteryEncounter(MysteryEncounterType.ARCHIPELAGO_OAK, defaultParty);
    const before = { ...scene.pokeballCounts };

    await runMysteryEncounterToEnd(game, 4);

    expect(scene.pokeballCounts[PokeballType.POKEBALL]).toBe(before[PokeballType.POKEBALL] + 10);
    expect(scene.pokeballCounts[PokeballType.GREAT_BALL]).toBe(before[PokeballType.GREAT_BALL] + 10);
    expect(scene.pokeballCounts[PokeballType.ULTRA_BALL]).toBe(before[PokeballType.ULTRA_BALL] + 5);
    expect(scene.pokeballCounts[PokeballType.ROGUE_BALL]).toBe(before[PokeballType.ROGUE_BALL] + 5);
    expect(scene.pokeballCounts[PokeballType.MASTER_BALL]).toBe(before[PokeballType.MASTER_BALL] + 1);
  });

  it("disables the choices without a Pokémon", async () => {
    vi.spyOn(archipelago, "getMissingDexsanitySpecies").mockReturnValue([SpeciesId.BULBASAUR]);
    await game.runToMysteryEncounter(MysteryEncounterType.ARCHIPELAGO_OAK, defaultParty);
    const options = scene.currentBattle.mysteryEncounter!.options;

    expect(options[0].meetsRequirements()).toBe(true);
    expect(options[1].meetsRequirements()).toBe(false);
    expect(options[2].meetsRequirements()).toBe(false);
    expect(options[3].meetsRequirements()).toBe(true);
  });

  it("should not spawn outside of the Archipelago mode", async () => {
    await game.runToMysteryEncounter();
    expect(scene.currentBattle?.mysteryEncounter?.encounterType).not.toBe(MysteryEncounterType.ARCHIPELAGO_OAK);
  });
});
