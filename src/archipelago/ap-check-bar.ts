import { globalScene } from "#app/global-scene";
import { TextStyle } from "#enums/text-style";
import { addTextObject } from "#ui/text";
import { addWindow } from "#ui/ui-theme";
import { AP_ITEM_ICON_TEXTURE } from "./ap-icon";

/** One item sent to the multiworld by a check */
export interface ApSentEntry {
  item: string;
  /** Player who gets the item ("for you" for this player) */
  player: string;
  /** Colour of the item name (classification of the item) */
  tint: number;
}

const WIDTH = 132;
const PADDING = 5;
const TITLE_HEIGHT = 11;
const LINE_HEIGHT = 10;
const ICON_SIZE = 8;
/** Lines shown at most in one panel (the others follow in the next one) */
const MAX_LINES = 5;
/** Display time of a panel: a base time plus a little per line */
const BASE_DURATION_MS = 3500;
const LINE_DURATION_MS = 700;

interface ApSentPanel {
  title: string;
  entries: ApSentEntry[];
}

/**
 * Side panel listing the items sent to the multiworld by the floor checks (like the achievement bar): it slides in
 * from the right under the floor / money display, then slides out. It never waits for an input.
 */
export class ArchipelagoCheckBar extends Phaser.GameObjects.Container {
  private readonly queue: ApSentPanel[] = [];
  private readonly parts: Phaser.GameObjects.GameObject[] = [];
  private shown = false;

  constructor() {
    super(globalScene, globalScene.scaledCanvas.width, 0);
    this.setName("ap-check-bar").setVisible(false);
  }

  /** Shows the items sent by checks made at the same time (several panels if there are many) */
  showEntries(title: string, entries: ApSentEntry[]): void {
    for (let i = 0; i < entries.length; i += MAX_LINES) {
      this.queue.push({ title, entries: entries.slice(i, i + MAX_LINES) });
    }
    if (!this.shown) {
      this.showNext();
    }
  }

  private showNext(): void {
    const panel = this.queue.shift();
    if (!panel) {
      return;
    }
    for (const part of this.parts.splice(0)) {
      part.destroy();
    }

    const height = TITLE_HEIGHT + LINE_HEIGHT * panel.entries.length + PADDING;
    const parts: Phaser.GameObjects.GameObject[] = [addWindow(0, 0, WIDTH, height)];
    parts.push(addTextObject(PADDING, 3, panel.title, TextStyle.WINDOW_ALT, { fontSize: "54px" }).setOrigin(0));

    let y = TITLE_HEIGHT;
    for (const entry of panel.entries) {
      const icon = globalScene.add.image(PADDING, y + 1, AP_ITEM_ICON_TEXTURE).setOrigin(0);
      icon.setDisplaySize(ICON_SIZE, ICON_SIZE);
      const playerText = addTextObject(WIDTH - PADDING, y + 1, entry.player, TextStyle.WINDOW_ALT, {
        fontSize: "45px",
      }).setOrigin(1, 0);
      const itemText = addTextObject(PADDING + ICON_SIZE + 3, y, entry.item, TextStyle.WINDOW, { fontSize: "54px" })
        .setOrigin(0)
        .setColor(`#${entry.tint.toString(16).padStart(6, "0")}`);
      // The item name never runs over the player name
      const maxItemWidth = WIDTH - PADDING * 2 - ICON_SIZE - 6 - playerText.displayWidth;
      while (itemText.displayWidth > maxItemWidth && itemText.text.length > 4) {
        itemText.setText(`${itemText.text.slice(0, -2)}…`);
      }
      parts.push(icon, itemText, playerText);
      y += LINE_HEIGHT;
    }
    this.add(parts);
    this.parts.push(...parts);

    // Under the floor / money display, and under the achievement bar if it is shown
    const achvBar = globalScene.ui.achvBar;
    this.y = achvBar.y + (achvBar.shown ? achvBar.displayHeight + 2 : 0);
    this.x = globalScene.scaledCanvas.width;
    this.setVisible(true);
    this.shown = true;
    globalScene.tweens.add({
      targets: this,
      x: globalScene.scaledCanvas.width - WIDTH,
      duration: 400,
      ease: "Sine.easeOut",
    });
    globalScene.time.delayedCall(BASE_DURATION_MS + LINE_DURATION_MS * panel.entries.length, () => this.hide());
  }

  private hide(): void {
    globalScene.tweens.add({
      targets: this,
      x: globalScene.scaledCanvas.width,
      duration: 400,
      ease: "Sine.easeIn",
      onComplete: () => {
        this.shown = false;
        this.setVisible(false);
        this.showNext();
      },
    });
  }
}

let checkBar: ArchipelagoCheckBar | null = null;

/** The side panel of the sent items, created on first use (once the game UI exists) */
export function getArchipelagoCheckBar(): ArchipelagoCheckBar | null {
  if (!(globalScene?.uiContainer && globalScene.ui?.achvBar)) {
    return null;
  }
  if (!checkBar || checkBar.scene !== globalScene) {
    checkBar = new ArchipelagoCheckBar();
    globalScene.uiContainer.add(checkBar);
  }
  return checkBar;
}
