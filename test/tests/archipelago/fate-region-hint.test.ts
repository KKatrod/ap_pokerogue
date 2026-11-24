import { archipelago } from "#app/archipelago/archipelago";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/** "See the Fate" - "Find the way": a region holding a rare progression item */
describe("Archipelago - Fate region hint", () => {
  let phaserGame: Phaser.Game;
  // biome-ignore lint/suspicious/noExplicitAny: private fields of the manager, set for the test
  const manager = archipelago as any;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    new GameManager(phaserGame);
    manager.profile = {};
    vi.spyOn(archipelago, "saveProfile").mockImplementation(() => {});
    vi.spyOn(archipelago.client, "getPlayerName").mockImplementation((player: number) => `P${player}`);
  });

  afterEach(() => {
    manager.profile = null;
    manager.slotData = {};
    vi.restoreAllMocks();
  });

  it("tells the region, its world, its progression items and one of them, a different region each time", () => {
    manager.slotData = {
      fate_region_hints: [
        { region: "Hotland", world: 2, game: "Undertale", count: 4, item: "Timespinner Wheel", owner: 3 },
        { region: "Castle Keep", world: 3, game: "Timespinner", count: 1, item: "Lightwall", owner: 3 },
      ],
    };

    const first = archipelago.takeFateRegionHint();
    expect(first).toContain("Hotland");
    expect(first).toContain("P2");
    expect(first).toContain("Undertale");
    expect(first).toContain("4");
    expect(first).toContain("Timespinner Wheel");
    expect(first).toContain("P3");

    // The second one is another region, with a single progression item
    const second = archipelago.takeFateRegionHint();
    expect(second).toContain("Castle Keep");
    expect(second).toContain("Lightwall");
    expect(manager.profile.fateShownRegions).toEqual([0, 1]);
  });

  it("has nothing to tell without region hints (older seeds)", () => {
    manager.slotData = {};
    expect(archipelago.takeFateRegionHint()).not.toContain("undefined");
  });
});
