import { audioManager } from "#app/global-audio-manager";
import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import { Phase } from "#app/phase";
import { TerrainType } from "#data/terrain";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { HitResult } from "#enums/hit-result";
import { MoveId } from "#enums/move-id";
import { PartyUiMode } from "#enums/party-ui-mode";
import { BATTLE_STATS, EFFECTIVE_STATS, Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import {
  FusePokemonModifierType,
  type ModifierType,
  PokemonAllMovePpRestoreModifierType,
  PokemonHeldItemModifierType,
  PokemonHpRestoreModifierType,
  PokemonModifierType,
  PokemonMoveModifierType,
  PokemonPpRestoreModifierType,
  PokemonPpUpModifierType,
  PokemonStatusHealModifierType,
  RememberMoveModifierType,
  TmModifierType,
} from "#modifiers/modifier-type";
import { PartyOption } from "#ui/party-ui-handler";
import { addTextObject } from "#ui/text";
import { addWindow } from "#ui/ui-theme";
import i18next from "i18next";
import { apText } from "./ap-messages";
import { ApItemCategory, type ApPendingDelivery, archipelago } from "./archipelago";

/**
 * Blocks the progression past a floor multiple of 10 until enough "Progressive Floor Pass" items were received.
 * The phase waits (polling) for the item to arrive from the multiworld.
 */
export class ArchipelagoGatePhase extends Phase {
  public readonly phaseName = "ArchipelagoGatePhase";
  private pollTimer: Phaser.Time.TimerEvent | null = null;

  start(): void {
    super.start();

    const wave = globalScene.currentBattle.waveIndex;
    if (archipelago.canAdvanceFrom(wave)) {
      this.end();
      return;
    }

    // Floor Passes first, then the End Pass (`biome_passes: end_only`) for the last block of floors
    const waitingForEndPass = () => wave + 1 <= archipelago.getMaxWave() && archipelago.isEndPassMissingFor(wave + 1);
    const showWaiting = () =>
      globalScene.ui.showText(
        waitingForEndPass()
          ? apText("gateEndLocked", { wave })
          : apText("gateLocked", {
              wave,
              have: archipelago.getFloorPassCount(),
              need: archipelago.getPassesNeededFor(wave),
            }),
      );

    // The menu stays available while waiting (see `UiInputs.buttonMenu`), to save and quit for instance
    globalScene.disableMenu = false;
    globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
      showWaiting();
      let lastCount = archipelago.getFloorPassCount();
      const endPassNeeded = archipelago.isEndPassMissingFor(wave + 1);
      this.pollTimer = globalScene.time.addEvent({
        delay: 1000,
        loop: true,
        callback: () => {
          // Left through the menu (back to the title screen): stop waiting
          if (globalScene.phaseManager.getCurrentPhase() !== this) {
            this.pollTimer?.remove();
            this.pollTimer = null;
            return;
          }
          // The menu is open: wait until it is closed
          if (globalScene.ui.mode !== UiMode.MESSAGE) {
            return;
          }
          if (archipelago.canAdvanceFrom(wave)) {
            this.pollTimer?.remove();
            this.pollTimer = null;
            audioManager.playSound("se/level_up_fanfare");
            archipelago.acknowledgeFloorPasses();
            globalScene.ui.showText(
              apText(endPassNeeded ? "gateEndUnlocked" : "gateUnlocked", { wave }),
              null,
              () => this.end(),
              null,
              true,
            );
          } else if (archipelago.getFloorPassCount() !== lastCount) {
            lastCount = archipelago.getFloorPassCount();
            showWaiting();
          }
        },
      });
    });
  }

  end(): void {
    this.pollTimer?.remove();
    this.pollTimer = null;
    super.end();
  }
}

/**
 * Hands out the items received from the multiworld: consumables and held items once,
 * permanent bonus items once per run. Targeted items open the party screen.
 */
export class ArchipelagoReceivePhase extends Phase {
  public readonly phaseName = "ArchipelagoReceivePhase";
  /** Floor 1 of a run: the kept items are handed out first, with a single message for those that need no target */
  private readonly runStart: boolean;
  /** Run start handled before the team is sent out: the DNA Splicers can be used right away */
  private readonly beforeSummon: boolean;
  private queue: ApPendingDelivery[] = [];
  private messages: string[] = [];

  constructor(runStart = false, beforeSummon = false) {
    super();
    this.runStart = runStart;
    this.beforeSummon = beforeSummon;
  }

  start(): void {
    super.start();
    this.waitForCheckReplies(Date.now());
  }

  /**
   * The location of the floor just cleared may hold an item for this player: wait a little for the server's reply
   * so the item is handed out now and not after the next floor
   */
  private waitForCheckReplies(since: number): void {
    if (archipelago.hasUnconfirmedChecks() && Date.now() - since < CHECK_REPLY_TIMEOUT_MS) {
      globalScene.time.delayedCall(100, () => this.waitForCheckReplies(since));
      return;
    }
    this.prepare();
  }

  private prepare(): void {
    this.messages = archipelago.consumeAnnouncements();
    if (this.runStart) {
      const kept = archipelago.grantKeptItems();
      if (kept.length > 0) {
        this.messages.push(apText("keptItems", { items: kept.join(", ") }));
      }
    }
    this.queue = archipelago.getPendingDeliveries();
    if (this.runStart && !this.beforeSummon) {
      // Fusing Pokémon in the middle of a battle is not supported: DNA Splicers wait for the end of the floor
      this.queue = this.queue.filter(delivery => !BETWEEN_FLOORS_ITEMS.has(delivery.def.key));
    }

    if (this.messages.length === 0 && this.queue.length === 0) {
      this.end();
      return;
    }

    globalScene.ui.setMode(UiMode.MESSAGE).then(() => this.showNextMessage());
  }

  private showNextMessage(): void {
    const message = this.messages.shift();
    if (!message) {
      this.deliverNext();
      return;
    }
    globalScene.ui.showText(message, null, () => this.showNextMessage(), null, true);
  }

  private deliverNext(): void {
    const delivery = this.queue.shift();
    if (!delivery) {
      this.end();
      return;
    }

    if (delivery.def.category === ApItemCategory.EGG) {
      archipelago.markDelivered(delivery);
      const added = archipelago.addEgg(delivery.def);
      const message = archipelago.getReceivedMessage(delivery.item, delivery.def);
      audioManager.playSound(added ? "se/item_fanfare" : "se/error");
      globalScene.ui.showText(
        `${message}\n${apText(added ? "eggReceived" : "eggListFull")}`,
        null,
        () => this.deliverNext(),
        null,
        true,
      );
      return;
    }

    const type = archipelago.resolveModifierType(delivery.def);
    if (!type) {
      // Unknown item for this game version: drop it instead of blocking the queue
      archipelago.markDelivered(delivery);
      this.deliverNext();
      return;
    }
    const message = archipelago.getReceivedMessage(delivery.item, delivery.def);
    if (type instanceof FusePokemonModifierType) {
      archipelago.markDelivered(delivery);
      if (globalScene.getPlayerParty().length < 2) {
        // Nothing to fuse: the item is lost for this run
        audioManager.playSound("se/error");
        globalScene.ui.showText(`${message}\n${apText("noFusionTarget")}`, null, () => this.deliverNext(), null, true);
        return;
      }
      globalScene.ui.showText(`${message}\n${apText("chooseFusion")}`, null, () => this.selectFusion(type), null, true);
      return;
    }

    if (
      type instanceof PokemonHeldItemModifierType
      && !globalScene.getPlayerParty().some(p => !type.selectFilter?.(p))
    ) {
      // No Pokémon can hold one more of this item: it is converted into money
      archipelago.markDelivered(delivery);
      this.giveMoneyInstead(message, type.name);
      return;
    }

    if (delivery.def.category === ApItemCategory.CONSUMABLE && isUselessConsumable(type, delivery.def.key)) {
      // A healing item none of the Pokémon needs (full HP / PP, no status...): converted into money
      archipelago.markDelivered(delivery);
      this.giveMoneyInstead(message, type.name, "itemUselessToMoney");
      return;
    }

    if (type instanceof PokemonModifierType) {
      // An item is offered only once: it is consumed even if the player declines it or no Pokémon can use it
      archipelago.markDelivered(delivery);
      globalScene.ui.showText(
        `${message}\n${apText("chooseTarget", { item: type.name })}`,
        null,
        () => this.selectTarget(type),
        null,
        true,
      );
      return;
    }

    const modifier = type.newModifier();
    archipelago.markDelivered(delivery);
    if (modifier && archipelago.isStackFull(modifier)) {
      // Already held as many times as possible: converted into money
      this.giveMoneyInstead(message, type.name);
      return;
    }
    globalScene.addModifier(modifier, false, true);
    audioManager.playSound("se/item_fanfare");
    globalScene.ui.showText(message, null, () => this.deliverNext(), null, true);
  }

  private giveMoneyInstead(
    message: string,
    itemName: string,
    reason: "itemConvertedToMoney" | "itemUselessToMoney" = "itemConvertedToMoney",
  ): void {
    archipelago.grantMoneyInstead();
    audioManager.playSound("se/buy");
    globalScene.ui.showText(
      `${message}\n${apText(reason, { item: itemName })}`,
      null,
      () => this.deliverNext(),
      null,
      true,
    );
  }

  /** Same party selection flow as buying DNA Splicers in the shop: the first Pokémon chosen absorbs the second */
  private selectFusion(modifierType: FusePokemonModifierType): void {
    const party = globalScene.getPlayerParty();
    const hideItemInUse = showItemInUse(modifierType);
    globalScene.ui.setMode(
      UiMode.PARTY,
      PartyUiMode.SPLICE,
      -1,
      (fromSlotIndex: number, spliceSlotIndex: number) => {
        hideItemInUse();
        globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
          if (
            spliceSlotIndex !== undefined
            && fromSlotIndex < 6
            && spliceSlotIndex < 6
            && fromSlotIndex !== spliceSlotIndex
          ) {
            const modifier = modifierType.newModifier(party[fromSlotIndex], party[spliceSlotIndex]);
            if (modifier) {
              globalScene.addModifier(modifier, false, true);
            }
          }
          // Declined: the item was offered once and is not offered again in this run
          this.deliverNext();
        });
      },
      modifierType.selectFilter,
    );
  }

  /** Same party selection flow as buying a targeted item in the shop */
  private selectTarget(modifierType: ModifierType): void {
    const party = globalScene.getPlayerParty();
    const pokemonModifierType = modifierType as PokemonModifierType;
    const isMoveModifier = modifierType instanceof PokemonMoveModifierType;
    const isTmModifier = modifierType instanceof TmModifierType;
    const isRememberMoveModifier = modifierType instanceof RememberMoveModifierType;
    const isPpRestoreModifier =
      modifierType instanceof PokemonPpRestoreModifierType || modifierType instanceof PokemonPpUpModifierType;
    const partyUiMode = isMoveModifier
      ? PartyUiMode.MOVE_MODIFIER
      : isTmModifier
        ? PartyUiMode.TM_MODIFIER
        : isRememberMoveModifier
          ? PartyUiMode.REMEMBER_MOVE_MODIFIER
          : PartyUiMode.MODIFIER;
    const tmMoveId = isTmModifier ? (modifierType as TmModifierType).moveId : undefined;
    const hideItemInUse = showItemInUse(modifierType);

    globalScene.ui.setMode(
      UiMode.PARTY,
      partyUiMode,
      -1,
      (slotIndex: number, option: PartyOption) => {
        hideItemInUse();
        if (slotIndex < 6) {
          globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
            const modifier = isMoveModifier
              ? modifierType.newModifier(party[slotIndex], option - PartyOption.MOVE_1)
              : isRememberMoveModifier
                ? modifierType.newModifier(party[slotIndex], option as number)
                : modifierType.newModifier(party[slotIndex]);
            // NB: addModifier() returns false for held items even when they are added, so its result is not used
            globalScene.addModifier(modifier, false, true);
            this.deliverNext();
          });
        } else {
          // Declined: the item was offered once and is not offered again
          globalScene.ui.setMode(UiMode.MESSAGE).then(() => this.deliverNext());
        }
      },
      pokemonModifierType.selectFilter,
      isMoveModifier ? (modifierType as PokemonMoveModifierType).moveSelectFilter : undefined,
      tmMoveId,
      isPpRestoreModifier,
    );
  }
}

/**
 * Whether no Pokémon of the party would get anything from a consumable: HP healed or revived, PP restored, status
 * cured (the party screen would show "It won't have any effect" for every Pokémon). Other items are never useless.
 */
function isUselessConsumable(type: ModifierType, key: string): boolean {
  const party = globalScene.getPlayerParty();
  if (key === "SACRED_ASH") {
    return !party.some(p => p.isFainted());
  }
  if (
    !(
      type instanceof PokemonHpRestoreModifierType
      || type instanceof PokemonStatusHealModifierType
      || type instanceof PokemonPpRestoreModifierType
      || type instanceof PokemonAllMovePpRestoreModifierType
    )
  ) {
    return false;
  }
  return !party.some(p => {
    if (type.selectFilter?.(p)) {
      return false;
    }
    if (type instanceof PokemonMoveModifierType) {
      return p.getMoveset().some(move => !type.moveSelectFilter?.(move));
    }
    return true;
  });
}

/**
 * Shows the name and icon of the Archipelago item being used, in a small window of the party screen
 * (left side, in the empty space under the first Pokémon)
 * @returns a function removing the window
 */
function showItemInUse(type: ModifierType): () => void {
  const ui = globalScene.ui;
  const container = globalScene.add.container(ITEM_IN_USE_X, ITEM_IN_USE_Y);
  container.setName("ap-item-in-use");
  const label = addTextObject(0, 0, apText("usingItem"), TextStyle.WINDOW_ALT, { fontSize: "48px" }).setOrigin(0);
  const name = addTextObject(0, 0, type.name, TextStyle.WINDOW, { fontSize: "60px" }).setOrigin(0);
  const width = Math.min(ITEM_IN_USE_MAX_WIDTH, Math.max(label.displayWidth, name.displayWidth) + 30);
  const window = addWindow(0, 0, width, 22);
  const icon = globalScene.add.sprite(12, 11, "items", type.iconImage).setScale(0.5);
  label.setPosition(22, 3);
  name.setPosition(22, 9);
  while (name.displayWidth > width - 26 && name.text.length > 4) {
    name.setText(`${name.text.slice(0, -2)}…`);
  }
  container.add([window, icon, label, name]);
  ui.add(container);
  return () => container.destroy();
}

/** Position (UI coordinates, origin at the bottom left) and largest width of the "item in use" window */
const ITEM_IN_USE_X = 8;
const ITEM_IN_USE_Y = -76;
const ITEM_IN_USE_MAX_WIDTH = 124;

/** Items handed out between two floors only, never at the first battle turn of a run */
const BETWEEN_FLOORS_ITEMS = new Set(["DNA_SPLICERS"]);

/** Longest wait (ms) for the server to confirm the locations just checked */
const CHECK_REPLY_TIMEOUT_MS = 2000;

/** Status inflicted by each status trap */
const STATUS_TRAPS: Record<string, StatusEffect> = {
  TRAP_POISON: StatusEffect.POISON,
  TRAP_PARALYSIS: StatusEffect.PARALYSIS,
  TRAP_BURN: StatusEffect.BURN,
  TRAP_SLEEP: StatusEffect.SLEEP,
};

/** Arena tag given by each side / field effect: on the player's side, or on both sides (whole field) */
const ARENA_EFFECTS: Record<string, { tag: ArenaTagType; turns: number; side: ArenaTagSide }> = {
  EFFECT_REFLECT: { tag: ArenaTagType.REFLECT, turns: 5, side: ArenaTagSide.PLAYER },
  EFFECT_LIGHT_SCREEN: { tag: ArenaTagType.LIGHT_SCREEN, turns: 5, side: ArenaTagSide.PLAYER },
  EFFECT_SAFEGUARD: { tag: ArenaTagType.SAFEGUARD, turns: 5, side: ArenaTagSide.PLAYER },
  EFFECT_MIST: { tag: ArenaTagType.MIST, turns: 5, side: ArenaTagSide.PLAYER },
  EFFECT_AURORA_VEIL: { tag: ArenaTagType.AURORA_VEIL, turns: 5, side: ArenaTagSide.PLAYER },
  EFFECT_LUCKY_CHANT: { tag: ArenaTagType.NO_CRIT, turns: 5, side: ArenaTagSide.PLAYER },
  EFFECT_TAILWIND: { tag: ArenaTagType.TAILWIND, turns: 4, side: ArenaTagSide.PLAYER },
  EFFECT_HAPPY_HOUR: { tag: ArenaTagType.HAPPY_HOUR, turns: 0, side: ArenaTagSide.PLAYER },
  EFFECT_GRAVITY: { tag: ArenaTagType.GRAVITY, turns: 5, side: ArenaTagSide.BOTH },
  EFFECT_TRICK_ROOM: { tag: ArenaTagType.TRICK_ROOM, turns: 5, side: ArenaTagSide.BOTH },
  EFFECT_MUD_SPORT: { tag: ArenaTagType.MUD_SPORT, turns: 5, side: ArenaTagSide.BOTH },
  EFFECT_WATER_SPORT: { tag: ArenaTagType.WATER_SPORT, turns: 5, side: ArenaTagSide.BOTH },
};

/** Weather set by each weather effect (whole field) */
const WEATHER_EFFECTS: Record<string, WeatherType> = {
  EFFECT_RAIN_DANCE: WeatherType.RAIN,
  EFFECT_SUNNY_DAY: WeatherType.SUNNY,
  EFFECT_SANDSTORM: WeatherType.SANDSTORM,
  EFFECT_SNOWSCAPE: WeatherType.SNOW,
};

/** Terrain set by each terrain effect (whole field) */
const TERRAIN_EFFECTS: Record<string, TerrainType> = {
  EFFECT_ELECTRIC_TERRAIN: TerrainType.ELECTRIC,
  EFFECT_GRASSY_TERRAIN: TerrainType.GRASSY,
  EFFECT_MISTY_TERRAIN: TerrainType.MISTY,
  EFFECT_PSYCHIC_TERRAIN: TerrainType.PSYCHIC,
};

/**
 * Volatile status given by each volatile status trap to the active Pokémon (the opposing Pokémon is its source).
 * Some of them need a condition, checked by the game (e.g. a Pokémon of the other gender, a move used before).
 */
const VOLATILE_TRAPS: Record<string, { tag: BattlerTagType; turns: number; move: MoveId }> = {
  TRAP_INFATUATION: { tag: BattlerTagType.INFATUATED, turns: 0, move: MoveId.ATTRACT },
  TRAP_ENCORE: { tag: BattlerTagType.ENCORE, turns: 3, move: MoveId.ENCORE },
  TRAP_TAUNT: { tag: BattlerTagType.TAUNT, turns: 4, move: MoveId.TAUNT },
  TRAP_TORMENT: { tag: BattlerTagType.TORMENT, turns: 0, move: MoveId.TORMENT },
  TRAP_DISABLE: { tag: BattlerTagType.DISABLED, turns: 4, move: MoveId.DISABLE },
  TRAP_HEAL_BLOCK: { tag: BattlerTagType.HEAL_BLOCK, turns: 5, move: MoveId.HEAL_BLOCK },
  TRAP_YAWN: { tag: BattlerTagType.DROWSY, turns: 2, move: MoveId.YAWN },
  TRAP_LEECH_SEED: { tag: BattlerTagType.SEEDED, turns: 0, move: MoveId.LEECH_SEED },
  TRAP_CURSE: { tag: BattlerTagType.CURSED, turns: 0, move: MoveId.CURSE },
  TRAP_SALT_CURE: { tag: BattlerTagType.SALT_CURED, turns: 0, move: MoveId.SALT_CURE },
  TRAP_TAR_SHOT: { tag: BattlerTagType.TAR_SHOT, turns: 0, move: MoveId.TAR_SHOT },
  TRAP_THROAT_CHOP: { tag: BattlerTagType.THROAT_CHOPPED, turns: 2, move: MoveId.THROAT_CHOP },
};

/** Share of the max HP healed by Life Dew and Jungle Healing */
const PARTY_HEAL_RATIO = 0.25;

/** Share of the current money lost to a Money Loss Trap */
const MONEY_TRAP_RATIO = 0.25;

/** Not seeded on purpose: multiworld events must not change the run's random sequence */
const randomInt = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));
const randomItem = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)];

/**
 * Applies the traps, battle effects and DeathLinks received from the multiworld to the active Pokémon,
 * at the start of a battle turn (queued by `TurnInitPhase`).
 */
export class ArchipelagoBattleEventPhase extends Phase {
  public readonly phaseName = "ArchipelagoBattleEventPhase";

  start(): void {
    super.start();

    const pokemon = globalScene.getPlayerField().find(p => p?.isActive(true));
    if (!pokemon) {
      // Nothing to apply the events to: they stay pending until the next turn
      this.end();
      return;
    }

    for (const delivery of archipelago.getPendingDeliveries(true)) {
      archipelago.markDelivered(delivery);
      globalScene.phaseManager.queueMessage(archipelago.getReceivedMessage(delivery.item, delivery.def));
      this.applyEvent(delivery.def.key, pokemon);
    }

    for (const deathLink of archipelago.takeDeathLinks()) {
      globalScene.phaseManager.queueMessage(
        deathLink.cause
          ? apText("deathLinkReceivedCause", { player: deathLink.source, cause: deathLink.cause })
          : apText("deathLinkReceived", { player: deathLink.source }),
      );
      if (!pokemon.isFainted()) {
        if (globalScene.getPokemonAllowedInBattle().every(p => p === pokemon || p.isFainted())) {
          // This knock-out ends the run: the resulting game over must not send a DeathLink back
          archipelago.markDeathLinkKnockOut();
        }
        // Indirect KO: ignores Sturdy, Focus Band, boss segments and Reviver Seed
        pokemon.damageAndUpdate(pokemon.hp, { result: HitResult.INDIRECT_KO, ignoreSegments: true });
      }
    }

    this.end();
  }

  private applyEvent(key: string, pokemon: Pokemon): void {
    const pokemonName = getPokemonNameWithAffix(pokemon);
    const nothing = () => globalScene.phaseManager.queueMessage(apText("eventNoEffect"));

    if (key in STATUS_TRAPS) {
      const status = STATUS_TRAPS[key];
      // Not quiet: the game explains why the status could not be inflicted
      if (
        !pokemon.trySetStatus(
          status,
          undefined,
          status === StatusEffect.SLEEP ? randomInt(2, 4) : 0,
          null,
          false,
          false,
        )
      ) {
        nothing();
      }
      return;
    }
    if (key in ARENA_EFFECTS) {
      const { tag, turns, side } = ARENA_EFFECTS[key];
      if (!globalScene.arena.addTag(tag, turns, undefined, pokemon.id, side)) {
        nothing();
      }
      return;
    }
    if (key in WEATHER_EFFECTS) {
      if (!globalScene.arena.trySetWeather(WEATHER_EFFECTS[key], pokemon)) {
        nothing();
      }
      return;
    }
    if (key in TERRAIN_EFFECTS) {
      if (!globalScene.arena.trySetTerrain(TERRAIN_EFFECTS[key], false, pokemon)) {
        nothing();
      }
      return;
    }
    if (key in VOLATILE_TRAPS) {
      const { tag, turns, move } = VOLATILE_TRAPS[key];
      const source = globalScene.getEnemyField().find(p => p?.isActive(true));
      if (!pokemon.addTag(tag, turns, move, source?.id)) {
        nothing();
      }
      return;
    }

    const allies = globalScene.getPlayerField().filter(p => p?.isActive(true));
    switch (key) {
      case "EFFECT_HEAL_BELL": {
        const party = globalScene.getPlayerParty().filter(p => p.status && !p.isFainted());
        if (party.length === 0) {
          nothing();
          return;
        }
        for (const p of party) {
          p.resetStatus(false);
          p.updateInfo();
        }
        globalScene.phaseManager.queueMessage(i18next.t("moveTriggers:bellChimed"));
        return;
      }
      case "EFFECT_LIFE_DEW":
      case "EFFECT_JUNGLE_HEALING":
        for (const p of allies) {
          globalScene.phaseManager.unshiftNew(
            "PokemonHealPhase",
            p.getBattlerIndex(),
            Math.max(1, Math.floor(p.getMaxHp() * PARTY_HEAL_RATIO)),
            {
              message: i18next.t("moveTriggers:healHp", { pokemonName: getPokemonNameWithAffix(p) }),
              healStatus: key === "EFFECT_JUNGLE_HEALING",
            },
          );
        }
        return;
      case "EFFECT_HOWL":
        for (const p of allies) {
          globalScene.phaseManager.unshiftNew("StatStageChangePhase", {
            battlerIndex: p.getBattlerIndex(),
            changes: [{ stat: Stat.ATK, stages: 1 }],
            sourcePokemon: undefined,
          });
        }
        return;
      case "EFFECT_DRAGON_CHEER": {
        const cheered = allies.filter(
          p => !p.getTag(BattlerTagType.CRIT_BOOST) && p.addTag(BattlerTagType.DRAGON_CHEER, 0, MoveId.DRAGON_CHEER),
        );
        if (cheered.length === 0) {
          nothing();
        }
        return;
      }
      case "EFFECT_HAZE":
        for (const p of globalScene.getField(true)) {
          for (const s of BATTLE_STATS) {
            p.setStatStage(s, 0);
          }
          p.updateInfo();
        }
        globalScene.phaseManager.queueMessage(i18next.t("moveTriggers:statEliminated"));
        return;
      case "TRAP_MONEY": {
        const lost = Math.floor(globalScene.money * MONEY_TRAP_RATIO);
        if (lost <= 0) {
          nothing();
          return;
        }
        globalScene.money -= lost;
        globalScene.updateMoneyText();
        globalScene.animateMoneyChanged(false);
        globalScene.phaseManager.queueMessage(apText("trapMoney", { money: lost.toLocaleString() }));
        return;
      }
      case "TRAP_ITEM_DROP": {
        const heldItems = pokemon.getHeldItems().filter(item => item.isTransferable);
        if (heldItems.length === 0) {
          nothing();
          return;
        }
        const heldItem = randomItem(heldItems);
        const itemName = heldItem.type.name;
        pokemon.loseHeldItem(heldItem);
        globalScene.updateModifiers(true);
        globalScene.phaseManager.queueMessage(apText("trapItemDrop", { pokemon: pokemonName, item: itemName }));
        return;
      }
      case "TRAP_CONFUSION":
        if (!pokemon.addTag(BattlerTagType.CONFUSED, randomInt(2, 5))) {
          nothing();
        }
        return;
      case "TRAP_STAT_DOWN":
      case "EFFECT_STAT_UP":
        globalScene.phaseManager.unshiftNew("StatStageChangePhase", {
          battlerIndex: pokemon.getBattlerIndex(),
          changes: [{ stat: randomItem(EFFECTIVE_STATS), stages: key === "EFFECT_STAT_UP" ? 1 : -1 }],
          sourcePokemon: undefined,
        });
        return;
      default:
        console.warn(`[AP] Unknown battle event ${key}`);
    }
  }
}

/**
 * Archipelago Blitz: queued between the two reward phases of a floor. Sends the "Floor N Bonus" check and renews
 * the Archipelago shop items, so the second shop offers the next items not bought yet.
 */
export class ArchipelagoBonusRewardPhase extends Phase {
  public readonly phaseName = "ArchipelagoBonusRewardPhase";

  start(): void {
    super.start();
    archipelago.onBonusRewardPhase(globalScene.currentBattle.waveIndex);
    this.end();
  }
}
