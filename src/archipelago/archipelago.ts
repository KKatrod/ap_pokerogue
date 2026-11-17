import BattleScene from "#app/battle-scene";
import { getPokemonSpecies, speciesStarters } from "#app/data/pokemon-species";
import { Nature } from "#app/data/nature";
import { AbilityAttr, DexAttr, DexData, GameData, StarterData } from "#app/system/game-data";
import {
  getModifierType, ModifierType, ModifierTypeGenerator, ModifierTypeOption, modifierTypes
} from "#app/modifier/modifier-type";
import { ConsumableModifier } from "#app/modifier/modifier";
import { ModifierTier } from "#app/modifier/modifier-tier";
import { Species } from "#enums/species";
import apData from "./ap-data.json";
import { ArchipelagoClient, ClientStatus, ConnectedPacket, ItemFlags, NetworkItem } from "./ap-client";
import { apText } from "./ap-messages";
import { apHooks, ApSessionState } from "./ap-hooks";

export type { ApSessionState };

/* ======================================================================= Data */

export const AP_GAME: string = apData.game;
export const AP_BASE_ID: number = apData.base_id;
export const AP_FINAL_WAVE: number = apData.final_wave;
export const AP_GATE_INTERVAL: number = apData.gate_interval;

export enum ApItemCategory {
  GATE = "gate",
  CONSUMABLE = "consumable",
  HELD = "held",
  BONUS = "bonus",
  POKEMON = "pokemon"
}

export interface ApItemDef {
  id: number;
  key: string;
  name: string;
  category: ApItemCategory;
  speciesId?: Species;
}

const itemDefsById = new Map<number, ApItemDef>(
  apData.items.map(i => [ AP_BASE_ID + i.offset, { id: AP_BASE_ID + i.offset, key: i.key, name: i.name, category: i.category as ApItemCategory } ])
);

const POKEMON_ITEM_BASE = AP_BASE_ID + apData.pokemon_item_offset;
const WAVE_LOCATION_BASE = AP_BASE_ID + apData.wave_location_offset;
const SHOP_LOCATION_BASE = AP_BASE_ID + apData.shop_location_offset;

export function getPokemonItemId(speciesId: Species): number {
  return POKEMON_ITEM_BASE + speciesId;
}

export function getApItemDef(itemId: number): ApItemDef | undefined {
  const def = itemDefsById.get(itemId);
  if (def) {
    return def;
  }
  const speciesId = itemId - POKEMON_ITEM_BASE;
  if (speciesId > 0 && speciesStarters.hasOwnProperty(speciesId)) {
    return { id: itemId, key: `POKEMON_${Species[speciesId]}`, name: getPokemonSpecies(speciesId).name, category: ApItemCategory.POKEMON, speciesId };
  }
  return undefined;
}

/** Location id sent when the given wave (floor) is cleared */
export function getWaveLocationId(wave: number): number {
  return WAVE_LOCATION_BASE + wave;
}

/** Location id of the n-th (1-based) Archipelago shop item */
export function getShopLocationId(index: number): number {
  return SHOP_LOCATION_BASE + index;
}

/* ================================================================== Profile */

/**
 * Archipelago progression persisted per seed/slot.
 * The Pokédex and starter data are kept here so that unlocks are fully separated from Classic.
 */
interface ApProfile {
  version: number;
  seedName: string;
  slotName: string;
  dexData: DexData;
  starterData: StarterData;
  /** Indices (in the received item list) of one-shot items already given to the player */
  oneShotDelivered: number[];
  /** Number of received items already announced in-game (Pokémon unlocks) */
  announced: number;
  /** Number of Floor Passes already announced (by the receive phase or the gate screen) */
  announcedPasses?: number;
  /** Locations checked locally, re-sent on every (re)connection */
  checkedLocations: number[];
  goalReached: boolean;
}

interface ApLastConnection {
  server: string;
  slot: string;
}

const MAX_INT_ATTR_VALUE = 0x80000000;
const bigintReplacer = (_k: string, v: any) => typeof v === "bigint" ? (v <= MAX_INT_ATTR_VALUE ? Number(v) : v.toString()) : v;
const bigintReviver = (k: string, v: any) => k.endsWith("Attr") && ![ "natureAttr", "abilityAttr", "passiveAttr" ].includes(k) ? BigInt(v ?? 0) : v;

/* ============================================================ Shop modifiers */

/*
 * The shop classes extend core classes, which are not guaranteed to be initialised when this module is first
 * evaluated (the core modules form import cycles). They are therefore created on first use.
 */
let shopItemTypeClass: (new (locationId: number) => ModifierType) | null = null;

function createShopItemType(locationId: number): ModifierType {
  if (!shopItemTypeClass) {
    class ArchipelagoLocationModifier extends ConsumableModifier {
      public readonly locationId: number;

      constructor(type: ModifierType, locationId: number) {
        super(type);
        this.locationId = locationId;
      }

      shouldApply(args: any[]): boolean {
        return super.shouldApply(args) && !archipelago.isLocationChecked(this.locationId);
      }

      apply(args: any[]): boolean {
        const scene = args[0] as BattleScene;
        archipelago.checkLocation(this.locationId);
        const scouted = archipelago.getScoutedItem(this.locationId);
        if (scouted) {
          // Shown right away in the shop's text box
          scene.ui.showText(apText("shopItemBought", {
            item: archipelago.client.getItemName(scouted.item, scouted.player),
            player: archipelago.client.getPlayerName(scouted.player)
          }));
        }
        return true;
      }
    }

    class ArchipelagoShopItemModifierType extends ModifierType {
      public readonly locationId: number;
      public readonly isArchipelagoShopItem = true;

      constructor(locationId: number) {
        super(null, "apitem", (type, _args) => new ArchipelagoLocationModifier(type, locationId), "archipelago", "item_fanfare");
        this.locationId = locationId;
        const flags = archipelago.getScoutedItem(locationId)?.flags ?? 0;
        this.setTier(flags & ItemFlags.PROGRESSION ? ModifierTier.ROGUE : flags & ItemFlags.USEFUL ? ModifierTier.ULTRA : ModifierTier.GREAT);
      }

      get name(): string {
        const scouted = archipelago.getScoutedItem(this.locationId);
        if (!scouted) {
          return apText("shopItemUnknown");
        }
        return apText("shopItemName", {
          item: archipelago.client.getItemName(scouted.item, scouted.player),
          player: archipelago.client.getPlayerName(scouted.player)
        });
      }

      getDescription(_scene: BattleScene): string {
        const scouted = archipelago.getScoutedItem(this.locationId);
        if (!scouted) {
          return apText("shopItemDescUnknown");
        }
        return apText("shopItemDesc", {
          item: archipelago.client.getItemName(scouted.item, scouted.player),
          player: archipelago.client.getPlayerName(scouted.player)
        });
      }
    }

    shopItemTypeClass = ArchipelagoShopItemModifierType;
  }
  return new shopItemTypeClass(locationId);
}

/* ==================================================================== Manager */

export interface ApPendingDelivery {
  index: number;
  item: NetworkItem;
  def: ApItemDef;
}

export class ArchipelagoManager {
  public readonly client = new ArchipelagoClient();

  private profile: ApProfile | null = null;
  private receivedItems: NetworkItem[] = [];
  private slotData: Record<string, any> = {};
  private scoutedLocations = new Map<number, NetworkItem>();
  private runBonusDelivered = new Set<number>();
  private shopCache: { wave: number, options: ModifierTypeOption[] } | null = null;
  private gameData: GameData | null = null;
  /** True while the Archipelago profile is swapped into the game data (Archipelago mode) */
  private active = false;
  /** Messages received from the server (item sends, chat...) kept for display */
  public readonly log: string[] = [];

  constructor() {
    this.client.addListener({
      onReceivedItems: (index, items) => this.onReceivedItems(index, items),
      onLocationInfo: items => items.forEach(i => this.scoutedLocations.set(i.location, i)),
      onPrint: text => {
        this.log.push(text);
        if (this.log.length > 100) {
          this.log.shift();
        }
        console.log(`[AP] ${text}`);
      },
      onDisconnected: () => console.warn(`[AP] ${apText("disconnected")}`),
      onReconnected: connected => this.onConnected(connected)
    });
    apHooks.getSessionState = () => this.getSessionState();
    apHooks.restoreSessionState = state => this.restoreSessionState(state);
    apHooks.getShopOptions = (wave, baseCost) => this.getShopOptions(wave, baseCost);
    apHooks.getSoldLabel = type => typeof type?.locationId === "number" && type.isArchipelagoShopItem && this.isLocationChecked(type.locationId)
      ? apText("shopItemSold")
      : null;
  }

  /* --------------------------------------------------------------- Connection */

  get isConnected(): boolean {
    return this.client.isConnected;
  }

  get hasProfile(): boolean {
    return !!this.profile;
  }

  get isActive(): boolean {
    return this.active;
  }

  get seedName(): string | undefined {
    return this.profile?.seedName;
  }

  get slotName(): string | undefined {
    return this.profile?.slotName;
  }

  getLastConnection(): ApLastConnection {
    try {
      return JSON.parse(localStorage.getItem("ap_last_connection") ?? "") as ApLastConnection;
    } catch {
      return { server: "archipelago.gg:38281", slot: "" };
    }
  }

  async connect(server: string, slot: string, password: string): Promise<void> {
    const connected = await this.client.connect({ server, slot, password, game: AP_GAME });
    try {
      localStorage.setItem("ap_last_connection", JSON.stringify({ server, slot } as ApLastConnection));
    } catch {
      // ignore
    }
    this.onConnected(connected, slot);
  }

  disconnect(): void {
    this.client.disconnect();
  }

  private onConnected(connected: ConnectedPacket, slotName?: string): void {
    const seedName = this.client.roomInfo?.seed_name ?? "unknown";
    const slot = slotName ?? this.profile?.slotName ?? this.client.getPlayerName(connected.slot);
    if (!this.profile || this.profile.seedName !== seedName || this.profile.slotName !== slot) {
      if (this.profile && this.gameData) {
        this.deactivate(this.gameData);
      }
      this.profile = this.loadProfile(seedName, slot);
      this.runBonusDelivered.clear();
    }
    this.slotData = connected.slot_data ?? {};
    // The full item list (ReceivedItems, index 0) arrives together with Connected, before the profile is loaded
    this.applyReceivedUnlocks();

    // Re-send locations checked while offline, and merge the server's view
    const serverChecked = new Set(connected.checked_locations);
    const unsent = this.profile.checkedLocations.filter(l => !serverChecked.has(l));
    this.client.checkLocations(unsent);
    this.profile.checkedLocations = [ ...new Set([ ...this.profile.checkedLocations, ...connected.checked_locations ]) ];
    if (this.profile.goalReached) {
      this.client.setStatus(ClientStatus.CLIENT_GOAL);
    } else {
      this.client.setStatus(ClientStatus.CLIENT_PLAYING);
    }

    // Scout every shop location so the shop can display what it sells
    const shopLocations = this.getAllShopLocationIds();
    this.client.scoutLocations(shopLocations.filter(l => connected.missing_locations.includes(l) || connected.checked_locations.includes(l)));
    this.saveProfile();
  }

  /* ------------------------------------------------------------------ Profile */

  private getProfileKey(seedName: string, slotName: string): string {
    return `ap_profile_${seedName}_${slotName}`;
  }

  private loadProfile(seedName: string, slotName: string): ApProfile {
    try {
      const raw = localStorage.getItem(this.getProfileKey(seedName, slotName));
      if (raw) {
        return JSON.parse(raw, bigintReviver) as ApProfile;
      }
    } catch (err) {
      console.error("[AP] Failed to load profile, starting a new one", err);
    }
    const blank = GameData.createBlankDexAndStarterData();
    return {
      version: 1,
      seedName,
      slotName,
      dexData: blank.dexData,
      starterData: blank.starterData,
      oneShotDelivered: [],
      announced: 0,
      checkedLocations: [],
      goalReached: false
    };
  }

  saveProfile(): void {
    if (!this.profile) {
      return;
    }
    try {
      localStorage.setItem(this.getProfileKey(this.profile.seedName, this.profile.slotName), JSON.stringify(this.profile, bigintReplacer));
    } catch (err) {
      console.error("[AP] Failed to save profile", err);
    }
  }

  /** Swaps the Archipelago Pokédex/starters into the game data (entering the Archipelago mode) */
  activate(gameData: GameData): void {
    if (!this.profile) {
      return;
    }
    this.gameData = gameData;
    this.active = true;
    gameData.swapInArchipelagoProfile(this.profile.dexData, this.profile.starterData, () => this.saveProfile());
  }

  /** Restores the Classic Pokédex/starters (leaving the Archipelago mode) */
  deactivate(gameData: GameData): void {
    this.active = false;
    gameData.swapOutArchipelagoProfile();
    this.saveProfile();
  }

  /* ---------------------------------------------------------------- Run state */

  startNewRun(): void {
    this.runBonusDelivered.clear();
    this.shopCache = null;
  }

  getSessionState(): ApSessionState | undefined {
    if (!this.profile) {
      return undefined;
    }
    return { seedName: this.profile.seedName, slotName: this.profile.slotName, runBonusDelivered: [ ...this.runBonusDelivered ] };
  }

  restoreSessionState(state: ApSessionState | undefined): void {
    this.runBonusDelivered = new Set(state?.runBonusDelivered ?? []);
    this.shopCache = null;
  }

  /** @returns an error message if the given session cannot be played with the current connection */
  validateSession(state: ApSessionState | undefined): string | null {
    if (!this.isConnected || !this.profile) {
      return apText("needConnection");
    }
    if (state && (state.seedName !== this.profile.seedName || state.slotName !== this.profile.slotName)) {
      return apText("wrongSeed", { seed: state.seedName });
    }
    return null;
  }

  /* -------------------------------------------------------------------- Items */

  private onReceivedItems(index: number, items: NetworkItem[]): void {
    if (index === 0) {
      this.receivedItems = [ ...items ];
    } else if (index === this.receivedItems.length) {
      this.receivedItems.push(...items);
    } else if (index < this.receivedItems.length) {
      // Duplicate packet, keep the existing list but make sure everything is present
      items.forEach((item, i) => this.receivedItems[index + i] = item);
    } else {
      this.client.requestSync();
      return;
    }

    this.applyReceivedUnlocks();
  }

  /** Unlocks in the profile every starter received so far */
  private applyReceivedUnlocks(): void {
    if (!this.profile) {
      return;
    }
    for (const item of this.receivedItems) {
      const def = getApItemDef(item.item);
      if (def?.category === ApItemCategory.POKEMON && def.speciesId) {
        this.unlockSpecies(def.speciesId);
      }
    }
    this.saveProfile();
  }

  private unlockSpecies(speciesId: Species): void {
    if (!this.profile) {
      return;
    }
    const entry = this.profile.dexData[speciesId];
    if (!entry || entry.caughtAttr) {
      return;
    }
    const species = getPokemonSpecies(speciesId);
    const attr = DexAttr.NON_SHINY | DexAttr.DEFAULT_VARIANT | DexAttr.DEFAULT_FORM | (species.malePercent === 0 ? DexAttr.FEMALE : DexAttr.MALE);
    const neutralNatures = [ Nature.HARDY, Nature.DOCILE, Nature.SERIOUS, Nature.BASHFUL, Nature.QUIRKY ];
    entry.seenAttr |= attr;
    entry.caughtAttr |= attr;
    entry.natureAttr |= 1 << (neutralNatures[speciesId % neutralNatures.length] + 1);
    entry.ivs = entry.ivs.map(iv => Math.max(iv, 10));
    const starterEntry = this.profile.starterData[speciesId];
    if (starterEntry) {
      starterEntry.abilityAttr |= AbilityAttr.ABILITY_1;
    }
  }

  getFloorPassCount(): number {
    return this.receivedItems.filter(i => getApItemDef(i.item)?.category === ApItemCategory.GATE).length;
  }

  /** Highest floor the player may currently reach */
  getMaxWave(): number {
    return Math.min((this.getFloorPassCount() + 1) * AP_GATE_INTERVAL, AP_FINAL_WAVE);
  }

  /** Whether the player may go from the given (just cleared) wave to the next one */
  canAdvanceFrom(wave: number): boolean {
    return wave + 1 <= this.getMaxWave();
  }

  getPassesNeededFor(wave: number): number {
    return Math.floor(wave / AP_GATE_INTERVAL);
  }

  /** Marks the Floor Passes received so far as announced (the gate screen already told the player) */
  acknowledgeFloorPasses(): void {
    if (this.profile) {
      this.profile.announcedPasses = this.getFloorPassCount();
      this.saveProfile();
    }
  }

  hasUnlockedStarters(): boolean {
    return this.receivedItems.some(i => getApItemDef(i.item)?.category === ApItemCategory.POKEMON);
  }

  /** Items that still have to be handed out in the current run, in reception order */
  getPendingDeliveries(): ApPendingDelivery[] {
    if (!this.profile) {
      return [];
    }
    const oneShot = new Set(this.profile.oneShotDelivered);
    const pending: ApPendingDelivery[] = [];
    this.receivedItems.forEach((item, index) => {
      const def = getApItemDef(item.item);
      if (!def) {
        return;
      }
      const isOneShot = def.category === ApItemCategory.CONSUMABLE || def.category === ApItemCategory.HELD;
      if ((isOneShot && !oneShot.has(index)) || (def.category === ApItemCategory.BONUS && !this.runBonusDelivered.has(index))) {
        pending.push({ index, item, def });
      }
    });
    return pending;
  }

  markDelivered(delivery: ApPendingDelivery): void {
    if (!this.profile) {
      return;
    }
    if (delivery.def.category === ApItemCategory.BONUS) {
      this.runBonusDelivered.add(delivery.index);
    } else if (!this.profile.oneShotDelivered.includes(delivery.index)) {
      this.profile.oneShotDelivered.push(delivery.index);
    }
    this.saveProfile();
  }

  /** Messages for floor passes and Pokémon received since the last call */
  consumeAnnouncements(): string[] {
    if (!this.profile) {
      return [];
    }
    const messages: string[] = [];
    for (let i = this.profile.announced; i < this.receivedItems.length; i++) {
      const def = getApItemDef(this.receivedItems[i].item);
      if (def?.category === ApItemCategory.POKEMON) {
        messages.push(apText("pokemonUnlocked", { pokemon: def.name }));
      }
    }
    this.profile.announced = this.receivedItems.length;
    // A single message for all the passes received since the last announcement
    if (this.getFloorPassCount() > (this.profile.announcedPasses ?? 0)) {
      messages.push(apText("floorPassReceived", { wave: this.getMaxWave() }));
    }
    this.profile.announcedPasses = this.getFloorPassCount();
    this.saveProfile();
    return messages;
  }

  getReceivedMessage(item: NetworkItem, def: ApItemDef): string {
    const itemName = this.resolveModifierType(def, [])?.name ?? def.name;
    if (item.player === this.client.connected?.slot) {
      return apText("receivedOwn", { item: itemName });
    }
    return apText("received", { item: itemName, player: this.client.getPlayerName(item.player) });
  }

  /** Builds the PokeRogue modifier type matching an Archipelago item */
  resolveModifierType(def: ApItemDef, party: any[]): ModifierType | null {
    const func = modifierTypes[def.key];
    if (!func) {
      return null;
    }
    let type: ModifierType | null = getModifierType(func);
    if (type instanceof ModifierTypeGenerator) {
      type = type.generateType(party) ?? null;
      if (type && !type.id) {
        type.id = def.key;
      }
    }
    return type;
  }

  /** Grants every permanent bonus item at the beginning of a run (non-targeted ones only) */
  grantRunStartBonuses(scene: BattleScene): void {
    for (const delivery of this.getPendingDeliveries()) {
      if (delivery.def.category !== ApItemCategory.BONUS) {
        continue;
      }
      const type = this.resolveModifierType(delivery.def, scene.getParty());
      const modifier = type?.newModifier();
      if (modifier) {
        scene.addModifier(modifier, true, false, false, true);
      }
      this.markDelivered(delivery);
    }
    scene.updateModifiers(true, true);
  }

  /* ---------------------------------------------------------------- Locations */

  isLocationChecked(locationId: number): boolean {
    return !!this.profile?.checkedLocations.includes(locationId) || !!this.client.connected?.checked_locations.includes(locationId);
  }

  checkLocation(locationId: number): void {
    if (!this.profile || this.isLocationChecked(locationId)) {
      return;
    }
    this.profile.checkedLocations.push(locationId);
    this.client.checkLocations([ locationId ]);
    this.saveProfile();
  }

  onWaveCleared(wave: number): void {
    if (wave >= 1 && wave < AP_FINAL_WAVE) {
      this.checkLocation(getWaveLocationId(wave));
    }
    this.shopCache = null;
  }

  sendGoal(): void {
    if (!this.profile) {
      return;
    }
    this.profile.goalReached = true;
    this.client.setStatus(ClientStatus.CLIENT_GOAL);
    this.saveProfile();
  }

  getScoutedItem(locationId: number): NetworkItem | undefined {
    return this.scoutedLocations.get(locationId);
  }

  /* --------------------------------------------------------------------- Shop */

  getShopItemCount(): number {
    return Math.max(0, Number(this.slotData.shop_item_count ?? 0));
  }

  getShopItemsPerVisit(): number {
    return Math.max(1, Number(this.slotData.shop_items_per_visit ?? 1));
  }

  getShopCostPercent(): number {
    return Math.max(0, Number(this.slotData.shop_cost_percent ?? 100));
  }

  private getAllShopLocationIds(): number[] {
    return Array.from({ length: this.getShopItemCount() }, (_, i) => getShopLocationId(i + 1));
  }

  /**
   * Archipelago items offered in the shop of the given wave.
   * The result is cached for the whole wave so the shop UI and the selection phase see the same list.
   */
  getShopOptions(wave: number, baseCost: number): ModifierTypeOption[] {
    if (!this.profile || !this.active) {
      return [];
    }
    if (this.shopCache?.wave === wave) {
      return this.shopCache.options;
    }
    const cost = Math.max(1, baseCost * this.getShopCostPercent() / 100);
    const options = this.getAllShopLocationIds()
      .filter(id => !this.isLocationChecked(id))
      .slice(0, this.getShopItemsPerVisit())
      .map(id => new ModifierTypeOption(createShopItemType(id), 0, cost));
    this.shopCache = { wave, options };
    return options;
  }
}

export const archipelago = new ArchipelagoManager();
