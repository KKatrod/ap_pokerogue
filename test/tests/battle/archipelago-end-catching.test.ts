import { archipelago } from "#app/archipelago/archipelago";
import { BiomeId } from "#enums/biome-id";
import { MoveId } from "#enums/move-id";
import { PokeballType } from "#enums/pokeball";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { mockI18next } from "#test/utils/test-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/** Starts an Archipelago-like run in the End, throws a Master Ball and checks the result */
async function throwInEnd(
  game: GameManager,
  dexsanity: boolean,
): Promise<{ caught: boolean; tSpy: ReturnType<typeof mockI18next> }> {
  await game.classicMode.startBattle(SpeciesId.MAGIKARP);
  game.scene.gameMode.isArchipelago = true;
  vi.spyOn(archipelago, "allowsEndCatch").mockReturnValue(dexsanity);

  const partyLength = game.scene.getPlayerParty().length;
  game.scene.pokeballCounts[PokeballType.MASTER_BALL] = 1;
  const tSpy = mockI18next();

  game.doThrowPokeball(PokeballType.MASTER_BALL);
  if (game.isCurrentPhase("CommandPhase")) {
    game.move.select(MoveId.SPLASH);
  }
  await game.toEndOfTurn();
  return { caught: game.scene.getPlayerParty().length === partyLength + 1, tSpy };
}

describe("Archipelago - catching in the End", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .startingWave(199)
      .startingBiome(BiomeId.END)
      .battleStyle("single")
      .moveset([MoveId.SPLASH])
      .enemyMoveset([MoveId.SPLASH])
      .startingLevel(9999);
  });

  it("allows catching a never caught wild Pokémon with Dexsanity", async () => {
    const { caught } = await throwInEnd(game, true);
    expect(caught).toBe(true);
  });

  it("allows catching the final boss with Dexsanity", async () => {
    game.override.startingWave(200);
    const { caught, tSpy } = await throwInEnd(game, true);
    expect(tSpy).not.toHaveBeenCalledWith("battle:noPokeballForceFinalBoss");
    expect(caught).toBe(true);
  });

  it("keeps the rule of the original game without Dexsanity", async () => {
    const { caught, tSpy } = await throwInEnd(game, false);
    expect(tSpy).toHaveBeenCalledWith("battle:noPokeballForce");
    expect(caught).toBe(false);
  });
});
