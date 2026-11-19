import { archipelago } from "#app/archipelago/archipelago";
import { globalScene } from "#app/global-scene";
import { BattlePhase } from "#phases/battle-phase";

export class NewBattlePhase extends BattlePhase {
  public readonly phaseName = "NewBattlePhase";
  /** Whether the Archipelago floor check, item delivery and floor gate were already handled */
  private readonly archipelagoChecked: boolean;

  constructor(archipelagoChecked = false) {
    super();
    this.archipelagoChecked = archipelagoChecked;
  }

  start() {
    super.start();

    if (globalScene.gameMode.isArchipelago && !this.archipelagoChecked) {
      // Leaving a floor (by any means) is an Archipelago location
      archipelago.onWaveCleared(globalScene.currentBattle.waveIndex, true);
      // Hand out received items, then wait for a Floor Pass if the next floor is locked
      globalScene.phaseManager.removeAllPhasesOfType("NewBattlePhase");
      globalScene.phaseManager.unshiftNew("ArchipelagoReceivePhase");
      globalScene.phaseManager.unshiftNew("ArchipelagoGatePhase");
      globalScene.phaseManager.unshiftNew("NewBattlePhase", true);
      this.end();
      return;
    }

    globalScene.phaseManager.removeAllPhasesOfType("NewBattlePhase");

    globalScene.newBattle();

    this.end();
  }
}
