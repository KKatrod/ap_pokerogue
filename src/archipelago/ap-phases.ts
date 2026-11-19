import { audioManager } from "#app/global-audio-manager";
import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import { Phase } from "#app/phase";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { HitResult } from "#enums/hit-result";
import { PartyUiMode } from "#enums/party-ui-mode";
import { EFFECTIVE_STATS } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { UiMode } from "#enums/ui-mode";
import type { Pokemon } from "#field/pokemon";
import {
  FusePokemonModifierType,
  type ModifierType,
  PokemonHeldItemModifierType,
  PokemonModifierType,
  PokemonMoveModifierType,
  PokemonPpRestoreModifierType,
  PokemonPpUpModifierType,
  RememberMoveModifierType,
  TmModifierType,
} from "#modifiers/modifier-type";
import { PartyOption } from "#ui/party-ui-handler";
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

    const showWaiting = () =>
      globalScene.ui.showText(
        apText("gateLocked", {
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
            globalScene.ui.showText(apText("gateUnlocked", { wave }), null, () => this.end(), null, true);
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
  private queue: ApPendingDelivery[] = [];
  private messages: string[] = [];

  constructor(runStart = false) {
    super();
    this.runStart = runStart;
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
    if (this.runStart) {
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

  private giveMoneyInstead(message: string, itemName: string): void {
    archipelago.grantMoneyInstead();
    audioManager.playSound("se/buy");
    globalScene.ui.showText(
      `${message}\n${apText("itemConvertedToMoney", { item: itemName })}`,
      null,
      () => this.deliverNext(),
      null,
      true,
    );
  }

  /** Same party selection flow as buying DNA Splicers in the shop: the first Pokémon chosen absorbs the second */
  private selectFusion(modifierType: FusePokemonModifierType): void {
    const party = globalScene.getPlayerParty();
    globalScene.ui.setMode(
      UiMode.PARTY,
      PartyUiMode.SPLICE,
      -1,
      (fromSlotIndex: number, spliceSlotIndex: number) => {
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

    globalScene.ui.setMode(
      UiMode.PARTY,
      partyUiMode,
      -1,
      (slotIndex: number, option: PartyOption) => {
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

/** Arena tag (on the player's side, 5 turns) given by each screen effect */
const SCREEN_EFFECTS: Record<string, ArenaTagType> = {
  EFFECT_REFLECT: ArenaTagType.REFLECT,
  EFFECT_LIGHT_SCREEN: ArenaTagType.LIGHT_SCREEN,
  EFFECT_SAFEGUARD: ArenaTagType.SAFEGUARD,
  EFFECT_MIST: ArenaTagType.MIST,
};

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
    if (key in SCREEN_EFFECTS) {
      if (!globalScene.arena.addTag(SCREEN_EFFECTS[key], 5, undefined, pokemon.id, ArenaTagSide.PLAYER)) {
        nothing();
      }
      return;
    }

    switch (key) {
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
