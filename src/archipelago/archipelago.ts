import { globalScene } from "#app/global-scene";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { Egg } from "#data/egg";
import { AbilityAttr } from "#enums/ability-attr";
import { BiomeId } from "#enums/biome-id";
import { DexAttr } from "#enums/dex-attr";
import { EggSourceType } from "#enums/egg-source-types";
import { EggTier } from "#enums/egg-type";
import { ModifierTier } from "#enums/modifier-tier";
import { Nature } from "#enums/nature";
import { SpeciesId } from "#enums/species-id";
import { TrainerType } from "#enums/trainer-type";
import { ConsumableModifier, type Modifier, PersistentModifier } from "#modifiers/modifier";
import {
  getModifierTypeFuncById,
  ModifierType,
  ModifierTypeGenerator,
  ModifierTypeOption,
  PokemonModifierType,
} from "#modifiers/modifier-type";
import { EggData } from "#system/egg-data";
import type { DexData } from "#types/dex-data";
import type { StarterData } from "#types/save-data";
import { getBiomeName } from "#utils/common";
import { ArchipelagoClient, ClientStatus, type ConnectedPacket, ItemFlags, type NetworkItem } from "./ap-client";
import apData from "./ap-data.json";
import { type ApSessionState, apHooks } from "./ap-hooks";
import { AP_ITEM_ICON_DATA_URI, AP_ITEM_ICON_TEXTURE } from "./ap-icon";
import { apText } from "./ap-messages";

export type { ApSessionState };

/* ======================================================================= Data */

export const AP_GAME: string = apData.game;
export const AP_BASE_ID: number = apData.base_id;
export const AP_FINAL_WAVE: number = apData.final_wave;
export const AP_GATE_INTERVAL: number = apData.gate_interval;
/** Waves at which the regular shop gets new items: each one unlocks a batch of Archipelago shop items */
const SHOP_TIER_WAVES: number[] = apData.shop_tier_waves;

export enum ApItemCategory {
  GATE = "gate",
  CONSUMABLE = "consumable",
  HELD = "held",
  BONUS = "bonus",
  POKEMON = "pokemon",
  EGG = "egg",
  /** Negative effect applied at the next battle turn (or right away for money) */
  TRAP = "trap",
  /** Positive battle effect applied at the next battle turn */
  EFFECT = "effect",
  /** Unlocks a biome as a destination (`biome_passes` option) */
  BIOME_PASS = "biome_pass",
  /** Raises the starter points of the team by 1 */
  STARTER_LIMIT = "starter_limit",
}

/** Starter points of the team without any Starter Limit +1 (same as Classic) */
const BASE_STARTER_POINTS = 10;
/** Most starter points reachable with the Starter Limit +1 items */
const MAX_STARTER_POINTS = 30;

/** Which floor checks exist (`location_mode` option) */
export enum ApLocationMode {
  FLOORS = 0,
  BIOME_FLOORS = 1,
  BOTH = 2,
}

/** One-shot item categories: handed out once, whatever happens to them */
const ONE_SHOT_CATEGORIES = new Set([
  ApItemCategory.CONSUMABLE,
  ApItemCategory.HELD,
  ApItemCategory.EGG,
  ApItemCategory.TRAP,
  ApItemCategory.EFFECT,
]);

/** Item categories applied during a battle (by `ArchipelagoBattleEventPhase`) instead of between floors */
const BATTLE_EVENT_CATEGORIES = new Set([ApItemCategory.TRAP, ApItemCategory.EFFECT]);

/** Egg tier given by each Archipelago egg item (`undefined`: rolled like a gacha pull) */
const EGG_ITEM_TIERS: Record<string, EggTier | undefined> = {
  EGG_COMMON: EggTier.COMMON,
  EGG_RARE: EggTier.RARE,
  EGG_EPIC: EggTier.EPIC,
  EGG_LEGENDARY: EggTier.LEGENDARY,
  EGG_MYSTERY: undefined,
};

/** Whether an item has to be given to a Pokémon chosen in the party screen */
function isTargetedModifierType(type: ModifierType): boolean {
  return type instanceof PokemonModifierType;
}

/** Maximum number of eggs a profile can hold (same limit as the game) */
const MAX_EGGS = 99;

export interface ApItemDef {
  id: number;
  key: string;
  name: string;
  category: ApItemCategory;
  speciesId?: SpeciesId;
  /** Biome unlocked by a Biome Pass */
  biomeId?: BiomeId;
  /**
   * Given again in every run of the Archipelago session (at floor 1) instead of only once:
   * the permanent bonus items and the items marked `persistent` in `ap-data.json`
   */
  persistent?: boolean;
  /** Most copies of a kept item given in one run (e.g. 1 DNA Splicers, however many were received) */
  runMax?: number | undefined;
}

const itemDefsById = new Map<number, ApItemDef>(
  apData.items.map(i => [
    AP_BASE_ID + i.offset,
    {
      id: AP_BASE_ID + i.offset,
      key: i.key,
      name: i.name,
      category: i.category as ApItemCategory,
      persistent: i.category === ApItemCategory.BONUS || ("persistent" in i && i.persistent === true),
      // For bonus items, `max` is the stack limit of the game (see `isStackFull`), not a per-run limit
      runMax: i.category !== ApItemCategory.BONUS && "max" in i ? i.max : undefined,
    },
  ]),
);

const POKEMON_ITEM_BASE = AP_BASE_ID + apData.pokemon_item_offset;
const WAVE_LOCATION_BASE = AP_BASE_ID + apData.wave_location_offset;
const SHOP_LOCATION_BASE = AP_BASE_ID + apData.shop_location_offset;
const BIOME_LOCATION_BASE = AP_BASE_ID + apData.biome_location_offset;
const BIOME_PASS_BASE = AP_BASE_ID + apData.biome_pass_offset;

/** Biomes always open with the `biome_passes` option: the Town (start and fallback) and the End (last floors) */
const FREE_BIOMES = new Set<number>([BiomeId.TOWN, BiomeId.END]);

export function getBiomePassItemId(biomeId: BiomeId): number {
  return BIOME_PASS_BASE + biomeId;
}

export function getPokemonItemId(speciesId: SpeciesId): number {
  return POKEMON_ITEM_BASE + speciesId;
}

/** Whether the species can be an Archipelago "Pokemon" item (any PokeRogue starter) */
export function isApStarterSpecies(speciesId: number): boolean {
  return speciesId > 0 && speciesId in SpeciesId && speciesDataRegistry.isStarter(speciesId as SpeciesId);
}

export function getApItemDef(itemId: number): ApItemDef | undefined {
  const def = itemDefsById.get(itemId);
  if (def) {
    return def;
  }
  const biomeId = itemId - BIOME_PASS_BASE;
  if (biomeId >= 0 && biomeId < POKEMON_ITEM_BASE - BIOME_PASS_BASE && BIOME_IDS.has(biomeId)) {
    return {
      id: itemId,
      key: `BIOME_PASS_${biomeId}`,
      name: apText("biomePassName", { biome: getBiomeName(biomeId as BiomeId) }),
      category: ApItemCategory.BIOME_PASS,
      biomeId: biomeId as BiomeId,
    };
  }
  const speciesId = itemId - POKEMON_ITEM_BASE;
  if (isApStarterSpecies(speciesId)) {
    return {
      id: itemId,
      key: `POKEMON_${SpeciesId[speciesId]}`,
      name: speciesDataRegistry.getSpecies(speciesId as SpeciesId).name,
      category: ApItemCategory.POKEMON,
      speciesId: speciesId as SpeciesId,
    };
  }
  return undefined;
}

/** Location id sent when the given wave (floor) is cleared */
export function getWaveLocationId(wave: number): number {
  return WAVE_LOCATION_BASE + wave;
}

/** Location id sent when the given floor (1-10) of a biome is cleared */
export function getBiomeLocationId(biomeId: number, floor: number): number {
  return BIOME_LOCATION_BASE + biomeId * 10 + floor - 1;
}

/** Every biome id of the game (biome floor locations of unknown biomes are ignored) */
const BIOME_IDS = new Set<number>(Object.values(BiomeId));

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
  /** Locations already revealed by a trainer hint */
  hintedLocations?: number[];
  /** Eggs of the Archipelago profile: they hatch during Archipelago runs */
  eggs?: Egg[];
}

interface ApLastConnection {
  server: string;
  slot: string;
}

const MAX_INT_ATTR_VALUE = 0x80000000;
const BIGINT_ATTRS = new Set(["seenAttr", "caughtAttr"]);
const bigintReplacer = (_k: string, v: unknown) =>
  typeof v === "bigint" ? (v <= MAX_INT_ATTR_VALUE ? Number(v) : v.toString()) : v;
const bigintReviver = (k: string, v: unknown) => (BIGINT_ATTRS.has(k) ? BigInt((v as number | string) ?? 0) : v);

/* ============================================================ Shop modifiers */

/** Marker interface for the shop entries that sell an Archipelago location */
export interface ArchipelagoShopItem {
  readonly isArchipelagoShopItem: true;
  readonly locationId: number;
}

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

      override shouldApply(): boolean {
        return !archipelago.isLocationChecked(this.locationId);
      }

      override apply(): boolean {
        archipelago.checkLocation(this.locationId);
        const scouted = archipelago.getScoutedItem(this.locationId);
        if (scouted) {
          // Shown right away in the shop's text box
          globalScene.ui.showText(
            apText("shopItemBought", {
              item: archipelago.client.getItemName(scouted.item, scouted.player),
              player: archipelago.client.getPlayerName(scouted.player),
            }),
          );
        }
        return true;
      }
    }

    class ArchipelagoShopItemModifierType extends ModifierType implements ArchipelagoShopItem {
      public readonly locationId: number;
      public readonly isArchipelagoShopItem = true;
      /** Texture used instead of the "items" atlas (see ModifierOption) */
      public readonly iconTexture = AP_ITEM_ICON_TEXTURE;
      /** Colour of the item name in the shop, after the multiworld classification (see ModifierOption) */
      public textTint: number;

      constructor(locationId: number) {
        super(
          null,
          AP_ITEM_ICON_TEXTURE,
          type => new ArchipelagoLocationModifier(type, locationId),
          "archipelago",
          "se/item_fanfare",
        );
        this.locationId = locationId;
        const flags = archipelago.getScoutedItem(locationId)?.flags ?? 0;
        this.textTint = getClassificationTint(flags);
        this.setTier(
          flags & ItemFlags.PROGRESSION
            ? ModifierTier.ROGUE
            : flags & ItemFlags.USEFUL
              ? ModifierTier.ULTRA
              : ModifierTier.GREAT,
        );
      }

      override get name(): string {
        const scouted = archipelago.getScoutedItem(this.locationId);
        if (!scouted) {
          return apText("shopItemUnknown");
        }
        return apText("shopItemName", {
          item: archipelago.client.getItemName(scouted.item, scouted.player),
          player: archipelago.client.getPlayerName(scouted.player),
        });
      }

      override getDescription(): string {
        const scouted = archipelago.getScoutedItem(this.locationId);
        if (!scouted) {
          return apText("shopItemDescUnknown");
        }
        return apText("shopItemDesc", {
          item: archipelago.client.getItemName(scouted.item, scouted.player),
          player: archipelago.client.getPlayerName(scouted.player),
        });
      }
    }

    shopItemTypeClass = ArchipelagoShopItemModifierType;
  }
  return new shopItemTypeClass(locationId);
}

/** Item name colours used by the multiworld clients: progression, useful, trap, filler */
const CLASSIFICATION_TINTS = {
  progression: 0xf8d038,
  useful: 0x4998f8,
  trap: 0xdb4343,
  filler: 0xa8a8a8,
};

/** Colour of an item name after its classification flags (progression wins over the others) */
export function getClassificationTint(flags: number): number {
  if (flags & ItemFlags.PROGRESSION) {
    return CLASSIFICATION_TINTS.progression;
  }
  if (flags & ItemFlags.USEFUL) {
    return CLASSIFICATION_TINTS.useful;
  }
  if (flags & ItemFlags.TRAP) {
    return CLASSIFICATION_TINTS.trap;
  }
  return CLASSIFICATION_TINTS.filler;
}

/** Registers the Archipelago item icon texture (once the game textures are available) */
export function ensureArchipelagoIconTexture(): void {
  const textures = globalScene?.textures;
  if (textures && !textures.exists(AP_ITEM_ICON_TEXTURE)) {
    textures.addBase64(AP_ITEM_ICON_TEXTURE, AP_ITEM_ICON_DATA_URI);
  }
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
  private readonly scoutedLocations = new Map<number, NetworkItem>();
  private runBonusDelivered = new Set<number>();
  private shopCache: { wave: number; options: ModifierTypeOption[] } | null = null;
  /** True while the Archipelago profile is swapped into the game data (Archipelago mode) */
  private active = false;
  /** Biome where the current wave is played (the arena already shows the next biome when the wave is left) */
  private waveBiome: { wave: number; biomeId: number } | null = null;
  /** DeathLinks received from the multiworld, applied at the next battle turn */
  private pendingDeathLinks: { source: string; cause?: string }[] = [];
  /** Wave where a received DeathLink knocked out the last Pokémon (the resulting game over is not sent back) */
  private deathLinkWave = -1;
  /** Whether the items kept for every run were already handed out at floor 1 of this run */
  private runStartHandled = false;
  /** Time (seconds) of the last DeathLink sent, to ignore its echo */
  private lastDeathLinkSent = 0;
  /** Messages received from the server (item sends, chat...) kept for display */
  public readonly log: string[] = [];

  constructor() {
    this.client.addListener({
      onReceivedItems: (index, items) => this.onReceivedItems(index, items),
      onLocationInfo: items => {
        for (const i of items) {
          this.scoutedLocations.set(i.location, i);
        }
      },
      onPrint: text => {
        this.log.push(text);
        if (this.log.length > 100) {
          this.log.shift();
        }
        console.log(`[AP] ${text}`);
      },
      onBounced: packet => this.onBounced(packet),
      onDisconnected: () => console.warn(`[AP] ${apText("disconnected")}`),
      onReconnected: connected => this.onConnected(connected),
    });
    apHooks.getSessionState = () => this.getSessionState();
    apHooks.restoreSessionState = state => this.restoreSessionState(state);
    apHooks.getShopOptions = (wave, baseCost) => this.getShopOptions(wave, baseCost);
    apHooks.getStarterValueLimit = () => (this.active ? this.getStarterValueLimit() : null);
    apHooks.getSoldLabel = type =>
      type?.isArchipelagoShopItem && this.isLocationChecked(type.locationId) ? apText("shopItemSold") : null;
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
      if (this.profile && this.active) {
        this.deactivate();
      }
      this.profile = this.loadProfile(seedName, slot);
      this.runBonusDelivered.clear();
    }
    this.slotData = connected.slot_data ?? {};
    this.client.setTags(this.isDeathLinkEnabled() ? ["DeathLink"] : []);
    // The full item list (ReceivedItems, index 0) arrives together with Connected, before the profile is loaded
    this.applyReceivedUnlocks();

    // Re-send locations checked while offline, and merge the server's view
    const serverChecked = new Set(connected.checked_locations);
    const unsent = this.profile.checkedLocations.filter(l => !serverChecked.has(l));
    this.client.checkLocations(unsent);
    this.profile.checkedLocations = [...new Set([...this.profile.checkedLocations, ...connected.checked_locations])];
    this.client.setStatus(this.profile.goalReached ? ClientStatus.CLIENT_GOAL : ClientStatus.CLIENT_PLAYING);

    // Scout every shop location (so the shop can display what it sells) and every other missing location
    // (so key trainers can hint at the progression items they hold)
    const missingOrChecked = new Set([...connected.missing_locations, ...connected.checked_locations]);
    const shopLocations = this.getAllShopLocationIds().filter(l => missingOrChecked.has(l));
    this.client.scoutLocations([...new Set([...shopLocations, ...connected.missing_locations])]);
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
        const profile = JSON.parse(raw, bigintReviver) as ApProfile;
        globalScene.gameData.completeArchipelagoProfileData(profile.dexData, profile.starterData);
        profile.eggs = (profile.eggs ?? []).map(e => new EggData(e).toEgg());
        return profile;
      }
    } catch (err) {
      console.error("[AP] Failed to load profile, starting a new one", err);
    }
    const blank = globalScene.gameData.createArchipelagoProfileData();
    return {
      version: 2,
      seedName,
      slotName,
      dexData: blank.dexData,
      starterData: blank.starterData,
      oneShotDelivered: [],
      announced: 0,
      checkedLocations: [],
      goalReached: false,
      eggs: [],
    };
  }

  saveProfile(): void {
    if (!this.profile) {
      return;
    }
    try {
      const serialized = { ...this.profile, eggs: (this.profile.eggs ?? []).map(e => new EggData(e)) };
      localStorage.setItem(
        this.getProfileKey(this.profile.seedName, this.profile.slotName),
        JSON.stringify(serialized, bigintReplacer),
      );
    } catch (err) {
      console.error("[AP] Failed to save profile", err);
    }
  }

  /** Swaps the Archipelago Pokédex/starters into the game data (entering the Archipelago mode) */
  activate(): void {
    if (!this.profile) {
      return;
    }
    ensureArchipelagoIconTexture();
    this.active = true;
    this.profile.eggs ??= [];
    globalScene.gameData.swapInArchipelagoProfile(
      this.profile.dexData,
      this.profile.starterData,
      this.profile.eggs,
      () => this.saveProfile(),
    );
  }

  /** Restores the Classic Pokédex/starters (leaving the Archipelago mode) */
  deactivate(): void {
    this.active = false;
    globalScene.gameData.swapOutArchipelagoProfile();
    this.saveProfile();
  }

  /* ---------------------------------------------------------------- Run state */

  startNewRun(): void {
    this.runBonusDelivered.clear();
    this.shopCache = null;
    this.waveBiome = null;
    this.pendingDeathLinks = [];
    this.deathLinkWave = -1;
    this.runStartHandled = false;
  }

  getSessionState(): ApSessionState | undefined {
    if (!this.profile) {
      return undefined;
    }
    return {
      seedName: this.profile.seedName,
      slotName: this.profile.slotName,
      runBonusDelivered: [...this.runBonusDelivered],
    };
  }

  restoreSessionState(state: ApSessionState | undefined): void {
    this.runBonusDelivered = new Set(state?.runBonusDelivered ?? []);
    this.shopCache = null;
  }

  /** @returns an error message if the given session cannot be played with the current connection */
  validateSession(state: ApSessionState | undefined): string | null {
    if (!(this.isConnected && this.profile)) {
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
      this.receivedItems = [...items];
    } else if (index === this.receivedItems.length) {
      this.receivedItems.push(...items);
    } else if (index < this.receivedItems.length) {
      // Duplicate packet: make sure everything is present
      items.forEach((item, i) => {
        this.receivedItems[index + i] = item;
      });
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

  private unlockSpecies(speciesId: SpeciesId): void {
    if (!this.profile) {
      return;
    }
    const entry = this.profile.dexData[speciesId];
    if (!entry || entry.caughtAttr) {
      return;
    }
    const species = speciesDataRegistry.getSpecies(speciesId);
    // Same attributes as the default Classic starters, restricted to what the species can have
    const attr =
      (DexAttr.NON_SHINY | DexAttr.MALE | DexAttr.FEMALE | DexAttr.DEFAULT_VARIANT | DexAttr.DEFAULT_FORM)
      & species.getFullUnlocksData();
    const neutralNatures = [Nature.HARDY, Nature.DOCILE, Nature.SERIOUS, Nature.BASHFUL, Nature.QUIRKY];
    entry.seenAttr |= attr;
    entry.caughtAttr |= attr;
    entry.natureAttr |= 1 << (neutralNatures[speciesId % neutralNatures.length] + 1);
    entry.ivs = entry.ivs.map(iv => Math.max(iv, 15));
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

  /* -------------------------------------------------------------- Biome passes */

  /** Whether biomes need a Biome Pass to be visited (`biome_passes` option) */
  isBiomePassesEnabled(): boolean {
    return !!this.slotData.biome_passes;
  }

  /** Whether the biome may be chosen as the next destination */
  hasBiomePass(biomeId: BiomeId): boolean {
    if (!this.isBiomePassesEnabled() || FREE_BIOMES.has(biomeId)) {
      return true;
    }
    const itemId = getBiomePassItemId(biomeId);
    return this.receivedItems.some(i => i.item === itemId);
  }

  /* ------------------------------------------------------------ Starter points */

  /** Starter points of the team: 10, plus 1 per Starter Limit +1 received (30 at most) */
  getStarterValueLimit(): number {
    const bonus = this.receivedItems.filter(i => getApItemDef(i.item)?.category === ApItemCategory.STARTER_LIMIT);
    return Math.min(BASE_STARTER_POINTS + bonus.length, MAX_STARTER_POINTS);
  }

  /* --------------------------------------------------------------- Challenges */

  /**
   * Challenge values set in the player's options (`challenges` slot data: challenge name → value).
   * Unknown challenges and values out of range are ignored by the caller.
   */
  getChallengeValues(): { name: string; value: number }[] {
    const challenges: Record<string, unknown> = this.slotData.challenges ?? {};
    return Object.entries(challenges)
      .map(([name, value]) => ({ name, value: Number(value) }))
      .filter(c => Number.isInteger(c.value) && c.value > 0);
  }

  /** Marks the Floor Passes received so far as announced (the gate screen already told the player) */
  acknowledgeFloorPasses(): void {
    if (this.profile) {
      this.profile.announcedPasses = this.getFloorPassCount();
      this.saveProfile();
    }
  }

  /** Marks the Pokémon received so far as announced (the player sees them in the starter selection) */
  acknowledgePokemonUnlocks(): void {
    if (this.profile) {
      this.profile.announced = this.receivedItems.length;
      this.saveProfile();
    }
  }

  hasUnlockedStarters(): boolean {
    return this.receivedItems.some(i => getApItemDef(i.item)?.category === ApItemCategory.POKEMON);
  }

  /**
   * Items that still have to be handed out in the current run, in reception order
   * @param battleEvents - `true` for the traps / battle effects (applied during a battle), `false` for the others
   */
  getPendingDeliveries(battleEvents = false): ApPendingDelivery[] {
    if (!this.profile) {
      return [];
    }
    const oneShot = new Set(this.profile.oneShotDelivered);
    const pending: ApPendingDelivery[] = [];
    /** Copies of each kept item with a per-run limit, given or to give in this run */
    const runCounts = new Map<string, number>();
    this.receivedItems.forEach((item, index) => {
      const def = getApItemDef(item.item);
      if (!def || BATTLE_EVENT_CATEGORIES.has(def.category) !== battleEvents) {
        return;
      }
      if (def.persistent && def.runMax !== undefined) {
        const count = runCounts.get(def.key) ?? 0;
        if (count >= def.runMax) {
          return;
        }
        runCounts.set(def.key, count + 1);
      }
      const pendingNow = def.persistent
        ? !this.runBonusDelivered.has(index)
        : ONE_SHOT_CATEGORIES.has(def.category) && !oneShot.has(index);
      if (pendingNow) {
        pending.push({ index, item, def });
      }
    });
    return pending;
  }

  /** Whether traps, battle effects or DeathLinks are waiting for the next battle turn */
  hasPendingBattleEvents(): boolean {
    return this.pendingDeathLinks.length > 0 || this.getPendingDeliveries(true).length > 0;
  }

  /** Takes the DeathLinks received since the last call */
  takeDeathLinks(): { source: string; cause?: string }[] {
    const deathLinks = this.pendingDeathLinks;
    this.pendingDeathLinks = [];
    return deathLinks;
  }

  markDelivered(delivery: ApPendingDelivery): void {
    if (!this.profile) {
      return;
    }
    if (delivery.def.persistent) {
      this.runBonusDelivered.add(delivery.index);
    } else if (!this.profile.oneShotDelivered.includes(delivery.index)) {
      this.profile.oneShotDelivered.push(delivery.index);
    }
    this.saveProfile();
  }

  /** Messages for Floor Passes and Pokémon received since the last call */
  consumeAnnouncements(): string[] {
    if (!this.profile) {
      return [];
    }
    const messages: string[] = [];
    let starterLimitReceived = false;
    for (let i = this.profile.announced; i < this.receivedItems.length; i++) {
      const def = getApItemDef(this.receivedItems[i].item);
      if (def?.category === ApItemCategory.POKEMON) {
        messages.push(apText("pokemonUnlocked", { pokemon: def.name }));
      } else if (def?.category === ApItemCategory.BIOME_PASS && def.biomeId !== undefined) {
        messages.push(apText("biomePassReceived", { biome: getBiomeName(def.biomeId) }));
      } else if (def?.category === ApItemCategory.STARTER_LIMIT) {
        starterLimitReceived = true;
      }
    }
    // A single message for all the Starter Limit +1 received since the last announcement
    if (starterLimitReceived) {
      messages.push(apText("starterLimitReceived", { points: this.getStarterValueLimit() }));
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
    const itemName = this.resolveModifierType(def)?.name ?? def.name;
    if (item.player === this.client.connected?.slot) {
      return apText("receivedOwn", { item: itemName });
    }
    return apText("received", { item: itemName, player: this.client.getPlayerName(item.player) });
  }

  /**
   * Adds the egg matching an Archipelago egg item to the Archipelago profile.
   * @returns `false` if the profile already holds the maximum number of eggs
   */
  addEgg(def: ApItemDef): boolean {
    const eggs = globalScene.gameData.eggs;
    if (eggs.length >= MAX_EGGS) {
      return false;
    }
    const tier = EGG_ITEM_TIERS[def.key];
    // Without a tier (Mystery Egg), the tier is rolled like a gacha pull
    eggs.push(
      new Egg({
        ...(tier === undefined ? {} : { tier }),
        sourceType: EggSourceType.EVENT,
        eggDescriptor: "Archipelago",
      }),
    );
    this.saveProfile();
    return true;
  }

  /** Builds the PokeRogue modifier type matching an Archipelago item */
  resolveModifierType(def: ApItemDef): ModifierType | null {
    const func = getModifierTypeFuncById(def.key);
    if (!func) {
      return null;
    }
    let type: ModifierType | null = func().withIdFromFunc(func);
    if (type instanceof ModifierTypeGenerator) {
      type = type.generateType(globalScene.getPlayerParty()) ?? null;
      if (type && !type.id) {
        type.id = def.key;
      }
    }
    return type;
  }

  /**
   * Whether the items received before this run (kept items and the others) still have to be handed out:
   * this is done once, at the first battle turn of floor 1.
   */
  shouldHandleRunStart(): boolean {
    return (
      !this.runStartHandled && globalScene.currentBattle?.waveIndex === 1 && this.getPendingDeliveries().length > 0
    );
  }

  markRunStartHandled(): void {
    this.runStartHandled = true;
  }

  /**
   * Silently grants the kept items that need no target (bonus items, Poké Balls, nuggets...).
   * Items already held as many times as possible are converted into money.
   * @returns the names of the items given, for a single summary message
   */
  grantKeptItems(): string[] {
    const names: string[] = [];
    for (const delivery of this.getPendingDeliveries()) {
      if (!delivery.def.persistent) {
        continue;
      }
      const type = this.resolveModifierType(delivery.def);
      if (!type || isTargetedModifierType(type)) {
        continue;
      }
      const modifier = type.newModifier();
      if (modifier) {
        if (this.isStackFull(modifier)) {
          this.grantMoneyInstead(true);
        } else {
          globalScene.addModifier(modifier, true, false, false, true);
        }
        names.push(type.name);
      }
      this.markDelivered(delivery);
    }
    globalScene.updateModifiers(true, true);
    return names;
  }

  /** Whether the player already holds the maximum number of stacks of a (non held) persistent item */
  isStackFull(modifier: Modifier): boolean {
    if (!(modifier instanceof PersistentModifier)) {
      return false;
    }
    const existing = globalScene.findModifier(m => m.match(modifier)) as PersistentModifier | undefined;
    return !!existing && existing.getStackCount() >= existing.getMaxStackCount();
  }

  /**
   * Gives money instead of an item the player cannot hold anymore (same amount as a Nugget).
   * @param silent - `true` to skip the money animation (start of a run)
   */
  grantMoneyInstead(silent = false): void {
    if (!globalScene.currentBattle) {
      // The amount depends on the wave: nothing to give before the first battle
      return;
    }
    const nugget = getModifierTypeFuncById("NUGGET");
    const modifier = nugget?.().withIdFromFunc(nugget).newModifier();
    if (modifier) {
      globalScene.addModifier(modifier, true, !silent);
    }
  }

  /* ---------------------------------------------------------------- Locations */

  isLocationChecked(locationId: number): boolean {
    return (
      !!this.profile?.checkedLocations.includes(locationId)
      || !!this.client.connected?.checked_locations.includes(locationId)
    );
  }

  checkLocation(locationId: number): void {
    if (!this.profile || this.isLocationChecked(locationId)) {
      return;
    }
    this.profile.checkedLocations.push(locationId);
    this.client.checkLocations([locationId]);
    this.saveProfile();
  }

  /** Whether locations were checked while connected but the server has not confirmed them yet */
  hasUnconfirmedChecks(): boolean {
    const confirmed = this.client.connected?.checked_locations;
    if (!(this.isConnected && confirmed && this.profile)) {
      return false;
    }
    const confirmedSet = new Set(confirmed);
    return this.profile.checkedLocations.some(l => !confirmedSet.has(l));
  }

  getLocationMode(): ApLocationMode {
    return Number(this.slotData.location_mode ?? ApLocationMode.FLOORS) as ApLocationMode;
  }

  /** Remembers the biome of the wave being played (called when each battle starts, including loaded ones) */
  onWaveStarted(wave: number, biomeId: number): void {
    this.waveBiome = { wave, biomeId };
  }

  onWaveCleared(wave: number): void {
    if (wave >= 1 && wave < AP_FINAL_WAVE) {
      const mode = this.getLocationMode();
      if (mode !== ApLocationMode.BIOME_FLOORS) {
        this.checkLocation(getWaveLocationId(wave));
      }
      if (mode !== ApLocationMode.FLOORS) {
        // When a floor multiple of 10 is left, the arena already shows the next biome
        const biomeId = this.waveBiome?.wave === wave ? this.waveBiome.biomeId : globalScene.arena.biomeId;
        this.checkLocation(getBiomeLocationId(biomeId, ((wave - 1) % AP_GATE_INTERVAL) + 1));
      }
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

  /* ---------------------------------------------------------------- DeathLink */

  isDeathLinkEnabled(): boolean {
    return !!this.slotData.death_link;
  }

  private onBounced(packet: any): void {
    const tags: string[] = packet?.tags ?? [];
    const data = packet?.data ?? {};
    if (!(tags.includes("DeathLink") && this.isDeathLinkEnabled())) {
      return;
    }
    // Our own DeathLink comes back to us
    if (data.source === this.profile?.slotName && Number(data.time) === this.lastDeathLinkSent) {
      return;
    }
    const source = String(data.source ?? "?");
    console.log(`[AP] DeathLink from ${source}${data.cause ? `: ${data.cause}` : ""}`);
    // Only applied during an Archipelago run
    if (this.active && globalScene.gameMode?.isArchipelago && globalScene.currentBattle) {
      this.pendingDeathLinks.push({ source, cause: data.cause });
    }
  }

  /** A received DeathLink knocked out the last Pokémon of the team: the resulting game over is not sent back */
  markDeathLinkKnockOut(): void {
    this.deathLinkWave = globalScene.currentBattle?.waveIndex ?? -1;
  }

  /** The run was lost: send a DeathLink to the multiworld (unless the loss was caused by one) */
  onRunLost(): void {
    if (!this.isDeathLinkEnabled() || !this.profile) {
      return;
    }
    if (this.deathLinkWave === globalScene.currentBattle?.waveIndex) {
      this.deathLinkWave = -1;
      return;
    }
    this.lastDeathLinkSent = Date.now() / 1000;
    const wave = globalScene.currentBattle?.waveIndex ?? 0;
    this.client.bounce(
      {
        time: this.lastDeathLinkSent,
        source: this.profile.slotName,
        cause: `${this.profile.slotName}'s team was wiped out on floor ${wave} of PokeRogue.`,
      },
      ["DeathLink"],
    );
  }

  getScoutedItem(locationId: number): NetworkItem | undefined {
    return this.scoutedLocations.get(locationId);
  }

  /* -------------------------------------------------------------------- Hints */

  isTrainerHintsEnabled(): boolean {
    return this.slotData.trainer_hints ?? true;
  }

  /** Whether beating this trainer gives a hint: rival, Gym Leaders, Elite Four, Champion, evil team bosses/admins */
  isHintTrainer(trainerType: TrainerType | undefined, isBoss: boolean | undefined): boolean {
    return (
      !!isBoss || (trainerType !== undefined && trainerType >= TrainerType.RIVAL && trainerType <= TrainerType.RIVAL_6)
    );
  }

  /**
   * Picks a progression item hidden at a location of this world not checked or hinted yet (preferably for another
   * player), registers the hint on the server and returns its text.
   * @returns `null` when hints are disabled or there is nothing left to hint at
   */
  takeTrainerHint(): string | null {
    try {
      return this.pickTrainerHint();
    } catch (err) {
      // A hint must never block the end of the battle
      console.error("[AP] Failed to build a trainer hint", err);
      return null;
    }
  }

  private pickTrainerHint(): string | null {
    if (!(this.profile && this.isConnected && this.isTrainerHintsEnabled())) {
      return null;
    }
    const hinted = new Set(this.profile.hintedLocations ?? []);
    const candidates = [...this.scoutedLocations.values()].filter(
      i =>
        i.flags & ItemFlags.PROGRESSION
        && !hinted.has(i.location)
        && !this.isLocationChecked(i.location)
        && this.describeLocation(i.location) !== null,
    );
    const others = candidates.filter(i => i.player !== this.client.connected?.slot);
    const pool = others.length > 0 ? others : candidates;
    if (pool.length === 0) {
      return null;
    }
    const target = pool[Math.floor(Math.random() * pool.length)];
    this.profile.hintedLocations = [...hinted, target.location];
    this.saveProfile();
    // Also listed in the multiworld hints (create_as_hint 2: only new hints are announced)
    this.client.scoutLocations([target.location], 2);
    const location = this.describeLocation(target.location)!;
    return apText(location.key, {
      item: this.client.getItemName(target.item, target.player),
      player: this.client.getPlayerName(target.player),
      floor: location.floor,
      zone: location.biomeId === undefined ? "" : getBiomeName(location.biomeId),
    });
  }

  /** Where a location of this world is, for hints (`null`: not a location the game knows) */
  private describeLocation(
    locationId: number,
  ): { key: "hintFloor" | "hintBiomeFloor" | "hintShop"; floor: number; biomeId?: BiomeId } | null {
    const wave = locationId - WAVE_LOCATION_BASE;
    if (wave >= 1 && wave < AP_FINAL_WAVE) {
      return { key: "hintFloor", floor: wave };
    }
    const shopIndex = locationId - SHOP_LOCATION_BASE;
    if (shopIndex >= 1 && shopIndex <= this.getShopItemCount()) {
      return { key: "hintShop", floor: this.getShopItemFirstWave(shopIndex) };
    }
    const biomeOffset = locationId - BIOME_LOCATION_BASE;
    const biomeId = Math.floor(biomeOffset / 10);
    if (biomeOffset >= 0 && BIOME_IDS.has(biomeId)) {
      return { key: "hintBiomeFloor", floor: (biomeOffset % 10) + 1, biomeId: biomeId as BiomeId };
    }
    return null;
  }

  /* --------------------------------------------------------------------- Shop */

  getShopItemCount(): number {
    return Math.max(0, Number(this.slotData.shop_item_count ?? 0));
  }

  getShopItemsPerVisit(): number {
    return Math.max(1, Number(this.slotData.shop_items_per_visit ?? 1));
  }

  /** Number of Archipelago shop items unlocked at each new shop tier (0: all of them from the start) */
  getShopItemsPerTier(): number {
    return Math.max(0, Number(this.slotData.shop_items_per_tier ?? 0));
  }

  /** Number of Archipelago shop items (bought or not) the shop of the given wave may offer */
  getAvailableShopItemCount(wave: number): number {
    const perTier = this.getShopItemsPerTier();
    if (perTier <= 0) {
      return this.getShopItemCount();
    }
    const tiers = SHOP_TIER_WAVES.filter(tierWave => tierWave <= wave).length;
    return Math.min(this.getShopItemCount(), tiers * perTier);
  }

  /** First floor of the shop tier that unlocks the n-th (1-based) Archipelago shop item */
  getShopItemFirstWave(index: number): number {
    const perTier = this.getShopItemsPerTier();
    if (perTier <= 0) {
      return SHOP_TIER_WAVES[0];
    }
    return SHOP_TIER_WAVES[Math.min(Math.ceil(index / perTier), SHOP_TIER_WAVES.length) - 1];
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
    if (!(this.profile && this.active)) {
      return [];
    }
    if (this.shopCache?.wave === wave) {
      return this.shopCache.options;
    }
    const cost = Math.max(1, (baseCost * this.getShopCostPercent()) / 100);
    const options = this.getAllShopLocationIds()
      .slice(0, this.getAvailableShopItemCount(wave))
      .filter(id => !this.isLocationChecked(id))
      .slice(0, this.getShopItemsPerVisit())
      .map(id => new ModifierTypeOption(createShopItemType(id), 0, cost));
    this.shopCache = { wave, options };
    return options;
  }
}

export const archipelago = new ArchipelagoManager();
