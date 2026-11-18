import { audioManager } from "#app/global-audio-manager";
import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import { PartyUiMode } from "#enums/party-ui-mode";
import { UiMode } from "#enums/ui-mode";
import {
  FusePokemonModifierType,
  type ModifierType,
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

    globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
      showWaiting();
      let lastCount = archipelago.getFloorPassCount();
      this.pollTimer = globalScene.time.addEvent({
        delay: 1000,
        loop: true,
        callback: () => {
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
  private queue: ApPendingDelivery[] = [];
  private messages: string[] = [];

  start(): void {
    super.start();

    this.messages = archipelago.consumeAnnouncements();
    this.queue = archipelago.getPendingDeliveries();

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
    if (!type || type instanceof FusePokemonModifierType) {
      // Unknown or unsupported item for this game version: drop it instead of blocking the queue
      archipelago.markDelivered(delivery);
      this.deliverNext();
      return;
    }

    const message = archipelago.getReceivedMessage(delivery.item, delivery.def);

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

    globalScene.addModifier(type.newModifier(), false, true);
    archipelago.markDelivered(delivery);
    audioManager.playSound("se/item_fanfare");
    globalScene.ui.showText(message, null, () => this.deliverNext(), null, true);
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
