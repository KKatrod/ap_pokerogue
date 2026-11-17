import { apText } from "#app/archipelago/ap-messages";
import { archipelago } from "#app/archipelago/archipelago";
import { globalScene } from "#app/global-scene";
import { Button } from "#enums/buttons";
import { UiMode } from "#enums/ui-mode";
import type { FormModalConfig, ModalConfig } from "#types/ui-types";
import type { InputFieldConfig } from "#ui/form-modal-ui-handler";
import { FormModalUiHandler } from "#ui/form-modal-ui-handler";

/**
 * Connection form for the Archipelago mode.
 * `buttonActions[0]` is called once connected, `buttonActions[1]` when cancelled.
 */
export class ArchipelagoConnectUiHandler extends FormModalUiHandler {
  private config: FormModalConfig | null = null;

  override getModalTitle(_config?: ModalConfig): string {
    return apText("connectTitle");
  }

  override getInputFieldConfigs(): InputFieldConfig[] {
    return [
      { label: apText("server"), maxLength: 128 },
      { label: apText("slot"), maxLength: 64 },
      { label: apText("password"), isPassword: true },
    ];
  }

  override getWidth(_config?: ModalConfig): number {
    return 160;
  }

  override getMargin(_config?: ModalConfig): [number, number, number, number] {
    return [0, 0, 48, 0];
  }

  override getButtonLabels(_config?: ModalConfig): string[] {
    return [apText("connect"), apText("cancel")];
  }

  override getReadableErrorMessage(error: string): string {
    return error ?? "";
  }

  override show(args: any[]): boolean {
    if (!super.show(args)) {
      return false;
    }
    const config = args[0] as FormModalConfig;
    this.config = config;

    // Keep what the player typed when the form is shown again after an error
    const previous = Array.isArray(args[1]) ? (args[1] as string[]) : null;
    const last = archipelago.getLastConnection();
    this.inputs[0].text = previous?.[0] ?? last?.server ?? "";
    this.inputs[1].text = previous?.[1] ?? last?.slot ?? "";
    this.inputs[2].text = "";

    this.submitAction = () => {
      this.sanitizeInputs();
      const [server, slot, password] = this.inputs.map(i => i.text);
      const onFail = (error: string) => {
        globalScene.ui.setMode(UiMode.ARCHIPELAGO_CONNECT, { ...config, errorMessage: error }, [server, slot]);
        globalScene.ui.playError();
      };
      if (!server) {
        onFail(apText("emptyServer"));
        return;
      }
      if (!slot) {
        onFail(apText("emptySlot"));
        return;
      }
      globalScene.ui.setMode(UiMode.LOADING, { buttonActions: [] });
      archipelago
        .connect(server, slot, password)
        .then(() => config.buttonActions[0]())
        .catch((err: Error) => onFail(err?.message ?? String(err)));
    };

    return true;
  }

  override processInput(button: Button): boolean {
    if (button === Button.CANCEL && this.config) {
      this.config.buttonActions[1]?.();
      return true;
    }
    return super.processInput(button);
  }

  override clear(): void {
    super.clear();
    this.config = null;
  }
}
