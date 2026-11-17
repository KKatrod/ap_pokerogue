import BattleScene from "#app/battle-scene";
import { Phase } from "#app/phase";
import { Mode } from "#app/ui/ui";
import { PartyOption, PartyUiMode } from "#app/ui/party-ui-handler";
import {
  ModifierType, PokemonModifierType, PokemonMoveModifierType, PokemonPpRestoreModifierType, PokemonPpUpModifierType,
  RememberMoveModifierType, TmModifierType, FusePokemonModifierType
} from "#app/modifier/modifier-type";
import { archipelago, ApPendingDelivery } from "./archipelago";
import { apText } from "./ap-messages";

/**
 * Blocks the progression past a floor multiple of 10 until enough "Progressive Floor Pass" items were received.
 * The phase waits (polling) for the item to arrive from the multiworld.
 */
export class ArchipelagoGatePhase extends Phase {
  private pollTimer: Phaser.Time.TimerEvent | null = null;

  constructor(scene: BattleScene) {
    super(scene);
  }

  start(): void {
    super.start();

    const wave = this.scene.currentBattle.waveIndex;
    if (archipelago.canAdvanceFrom(wave)) {
      return this.end();
    }

    const showWaiting = () => this.scene.ui.showText(apText("gateLocked", {
      wave,
      have: archipelago.getFloorPassCount(),
      need: archipelago.getPassesNeededFor(wave)
    }));

    this.scene.ui.setMode(Mode.MESSAGE).then(() => {
      showWaiting();
      let lastCount = archipelago.getFloorPassCount();
      this.pollTimer = this.scene.time.addEvent({
        delay: 1000,
        loop: true,
        callback: () => {
          if (archipelago.canAdvanceFrom(wave)) {
            this.pollTimer?.remove();
            this.pollTimer = null;
            this.scene.playSound("level_up_fanfare");
            archipelago.acknowledgeFloorPasses();
            this.scene.ui.showText(apText("gateUnlocked", { wave }), null, () => this.end(), null, true);
          } else if (archipelago.getFloorPassCount() !== lastCount) {
            lastCount = archipelago.getFloorPassCount();
            showWaiting();
          }
        }
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
  private queue: ApPendingDelivery[] = [];
  private messages: string[] = [];

  constructor(scene: BattleScene) {
    super(scene);
  }

  start(): void {
    super.start();

    this.messages = archipelago.consumeAnnouncements();
    this.queue = archipelago.getPendingDeliveries();

    if (!this.messages.length && !this.queue.length) {
      return this.end();
    }

    this.scene.ui.setMode(Mode.MESSAGE).then(() => this.showNextMessage());
  }

  private showNextMessage(): void {
    const message = this.messages.shift();
    if (!message) {
      return this.deliverNext();
    }
    this.scene.ui.showText(message, null, () => this.showNextMessage(), null, true);
  }

  private deliverNext(): void {
    const delivery = this.queue.shift();
    if (!delivery) {
      return this.end();
    }

    const party = this.scene.getParty();
    const type = archipelago.resolveModifierType(delivery.def, party);
    if (!type || type instanceof FusePokemonModifierType) {
      // Unknown or unsupported item for this game version: drop it instead of blocking the queue
      archipelago.markDelivered(delivery);
      return this.deliverNext();
    }

    const message = archipelago.getReceivedMessage(delivery.item, delivery.def);

    if (type instanceof PokemonModifierType) {
      this.scene.ui.showText(`${message}\n${apText("chooseTarget", { item: type.name })}`, null, () => this.selectTarget(delivery, type), null, true);
      return;
    }

    const modifier = type.newModifier();
    this.scene.addModifier(modifier, false, true).then(() => {
      archipelago.markDelivered(delivery);
      this.scene.playSound("item_fanfare");
      this.scene.ui.showText(message, null, () => this.deliverNext(), null, true);
    });
  }

  /** Same party selection flow as buying a targeted item in the shop */
  private selectTarget(delivery: ApPendingDelivery, modifierType: ModifierType): void {
    const party = this.scene.getParty();
    const pokemonModifierType = modifierType as PokemonModifierType;
    const isMoveModifier = modifierType instanceof PokemonMoveModifierType;
    const isTmModifier = modifierType instanceof TmModifierType;
    const isRememberMoveModifier = modifierType instanceof RememberMoveModifierType;
    const isPpRestoreModifier = modifierType instanceof PokemonPpRestoreModifierType || modifierType instanceof PokemonPpUpModifierType;
    const partyUiMode = isMoveModifier ? PartyUiMode.MOVE_MODIFIER
      : isTmModifier ? PartyUiMode.TM_MODIFIER
        : isRememberMoveModifier ? PartyUiMode.REMEMBER_MOVE_MODIFIER
          : PartyUiMode.MODIFIER;
    const tmMoveId = isTmModifier ? (modifierType as TmModifierType).moveId : undefined;

    this.scene.ui.setMode(Mode.PARTY, partyUiMode, -1, (slotIndex: integer, option: PartyOption) => {
      if (slotIndex < 6) {
        this.scene.ui.setMode(Mode.MESSAGE).then(() => {
          const modifier = !isMoveModifier
            ? !isRememberMoveModifier
              ? modifierType.newModifier(party[slotIndex])
              : modifierType.newModifier(party[slotIndex], option as integer)
            : modifierType.newModifier(party[slotIndex], option - PartyOption.MOVE_1);
          this.scene.addModifier(modifier, false, true).then(success => {
            if (success) {
              archipelago.markDelivered(delivery);
            }
            this.deliverNext();
          });
        });
      } else {
        // Cancelled: the item stays pending and will be offered again after the next floor
        this.scene.ui.setMode(Mode.MESSAGE).then(() => this.deliverNext());
      }
    }, pokemonModifierType.selectFilter, isMoveModifier ? (modifierType as PokemonMoveModifierType).moveSelectFilter : undefined, tmMoveId, isPpRestoreModifier);
  }
}
