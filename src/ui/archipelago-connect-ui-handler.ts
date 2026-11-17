import i18next from "i18next";
import BattleScene from "#app/battle-scene";
import { Button } from "#enums/buttons";
import { FormModalConfig, FormModalUiHandler } from "./form-modal-ui-handler";
import { ModalConfig } from "./modal-ui-handler";
import { Mode } from "./ui";
import { archipelago } from "#app/archipelago/archipelago";
import { apText } from "#app/archipelago/ap-messages";

/**
 * Connection form for the Archipelago mode.
 * `buttonActions[0]` is called once connected, `buttonActions[1]` when cancelled.
 */
export default class ArchipelagoConnectUiHandler extends FormModalUiHandler {
  private config: FormModalConfig | null = null;

  constructor(scene: BattleScene, mode: Mode | null = null) {
    super(scene, mode);
  }

  getModalTitle(_config?: ModalConfig): string {
    return apText("connectTitle");
  }

  getFields(_config?: ModalConfig): string[] {
    // The password label reuses the game's translation so the base class masks the field
    return [ apText("server"), apText("slot"), i18next.t("menu:password") ];
  }

  getFieldMaxLength(_fieldIndex: number, isPassword: boolean): number {
    return isPassword ? 64 : 128;
  }

  getWidth(_config?: ModalConfig): number {
    return 160;
  }

  getMargin(_config?: ModalConfig): [number, number, number, number] {
    return [ 0, 0, 48, 0 ];
  }

  getButtonLabels(_config?: ModalConfig): string[] {
    return [ apText("connect"), apText("cancel") ];
  }

  getReadableErrorMessage(error: string): string {
    return error ?? "";
  }

  show(args: any[]): boolean {
    if (!super.show(args)) {
      return false;
    }
    this.config = args[0] as FormModalConfig;
    const config = this.config;

    // Keep what the player typed when the form is shown again after an error
    if (!config.errorMessage) {
      const last = archipelago.getLastConnection();
      this.inputs[0].text = last?.server ?? "";
      this.inputs[1].text = last?.slot ?? "";
      this.inputs[2].text = "";
    }

    this.submitAction = () => {
      this.sanitizeInputs();
      const [ server, slot, password ] = this.inputs.map(i => i.text);
      const onFail = (error: string) => {
        this.scene.ui.setMode(Mode.ARCHIPELAGO_CONNECT, Object.assign({}, config, { errorMessage: error }), [ server, slot ]);
        this.scene.ui.playError();
      };
      if (!server) {
        return onFail(apText("emptyServer"));
      }
      if (!slot) {
        return onFail(apText("emptySlot"));
      }
      this.scene.ui.setMode(Mode.LOADING, { buttonActions: [] });
      archipelago.connect(server, slot, password)
        .then(() => config.buttonActions[0]())
        .catch((err: Error) => onFail(err?.message ?? String(err)));
    };

    // Restore the fields after an error
    if (config.errorMessage && Array.isArray(args[1])) {
      this.inputs[0].text = args[1][0] ?? "";
      this.inputs[1].text = args[1][1] ?? "";
    }

    return true;
  }

  processInput(button: Button): boolean {
    if (button === Button.CANCEL && this.config) {
      this.config.buttonActions[1]?.();
      return true;
    }
    return super.processInput(button);
  }

  clear(): void {
    super.clear();
    this.config = null;
  }
}
