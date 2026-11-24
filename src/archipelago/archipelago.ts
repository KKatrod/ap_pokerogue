import { globalScene } from "#app/global-scene";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { allBiomes } from "#data/data-lists";
import { Egg } from "#data/egg";
import { AbilityAttr } from "#enums/ability-attr";
import { BiomeId } from "#enums/biome-id";
import { DexAttr } from "#enums/dex-attr";
import { EggSourceType } from "#enums/egg-source-types";
import { EggTier } from "#enums/egg-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { Nature } from "#enums/nature";
import { Passive } from "#enums/passive";
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
import { getBiomeName, randSeedInt, randSeedItem } from "#utils/common";
import { type ApSentEntry, getArchipelagoCheckBar } from "./ap-check-bar";
import { ArchipelagoClient, ClientStatus, type ConnectedPacket, ItemFlags, type NetworkItem } from "./ap-client";
import apData from "./ap-data.json";
import { AP_FATE_SPRITE_DATA_URI, AP_FATE_SPRITE_FRAME, AP_FATE_SPRITE_KEY } from "./ap-fate-sprite";
import { type ApSessionState, apHooks } from "./ap-hooks";
import { AP_ITEM_ICON_DATA_URI, AP_ITEM_ICON_TEXTURE } from "./ap-icon";
import {
  AP_KATROD_SPRITE_DATA_URI,
  AP_KATROD_SPRITE_FRAME,
  AP_KATROD_SPRITE_KEY,
  AP_KATROD_SPRITE_SOURCE,
} from "./ap-katrod-sprite";
import { apText } from "./ap-messages";
import { BLITZ_GYM_WAVES } from "./blitz";

export type { ApSessionState };

/* ======================================================================= Data */

export const AP_GAME: string = apData.game;
export const AP_BASE_ID: number = apData.base_id;
/** Last floor of a Classic run (`final_wave` in the slot data gives the one of the seed) */
export const AP_FINAL_WAVE: number = apData.final_wave;
export const AP_GATE_INTERVAL: number = apData.gate_interval;
/**
 * Waves at which the regular shop gets new items: each one unlocks a batch of Archipelago shop items
 * (`shop_tier_waves` in the slot data gives the ones of the seed)
 */
const SHOP_TIER_WAVES: number[] = apData.shop_tier_waves;
const BLITZ_SHOP_TIER_WAVES: number[] = apData.blitz_shop_tier_waves;

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
  /** With the Map, the biomes already visited are also offered when the biome changes */
  FLY_TICKET = "fly_ticket",
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

/** `starter_bonus_unlock: egg_moves`: the 4 egg moves of a starter (one bit each) */
const ALL_EGG_MOVES = 0b1111;
/** `starter_bonus_unlock: natures`: every nature (bit `nature + 1`, like the game) */
const ALL_NATURES_ATTR = Object.values(Nature)
  .filter((n): n is Nature => typeof n === "number")
  .reduce((attr, nature) => attr | (1 << (nature + 1)), 0);
/** `starter_bonus_unlock: fast_egg`: the eggs need this many times fewer floors to hatch */
const FAST_EGG_DIVISOR = 10;

/** "See the Fate" encounter: range of floors (Classic, Blitz) and seed offset of the floor draw */
const FATE_WAVES_CLASSIC: [number, number] = [41, 99];
const FATE_WAVES_BLITZ: [number, number] = [21, 49];
const FATE_SEED_OFFSET = 777_777;

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
const WAVE_BONUS_LOCATION_BASE = AP_BASE_ID + apData.wave_bonus_location_offset;
const SHOP_LOCATION_BASE = AP_BASE_ID + apData.shop_location_offset;
const BIOME_LOCATION_BASE = AP_BASE_ID + apData.biome_location_offset;
const BIOME_PASS_BASE = AP_BASE_ID + apData.biome_pass_offset;
const DEX_LOCATION_BASE = AP_BASE_ID + apData.dex_location_offset;

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

/** Location id of the second check of a cleared floor ("Floor N Bonus", `floor_checks: 2`) */
export function getWaveBonusLocationId(wave: number): number {
  return WAVE_BONUS_LOCATION_BASE + wave;
}

/** Location id sent when the given floor (1-10) of a biome is cleared */
export function getBiomeLocationId(biomeId: number, floor: number): number {
  return BIOME_LOCATION_BASE + biomeId * 10 + floor - 1;
}

/** Every biome id of the game (biome floor locations of unknown biomes are ignored) */
const BIOME_IDS = new Set<number>(Object.values(BiomeId));

/** Location id of the Dexsanity check of a species (a starter species with `dexsanity: starters`) */
export function getDexLocationId(speciesId: SpeciesId): number {
  return DEX_LOCATION_BASE + speciesId;
}

/** Dexsanity option: no Pokédex checks, one check per starter (any Pokémon of its line), or one per species */
export enum ApDexsanityMode {
  OFF = 0,
  STARTERS = 1,
  ALL = 2,
}

/** Goal of the seed (`goal` option) */
export enum ApGoal {
  ETERNATUS = 0,
  POKEDEX = 1,
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
  /** Locations already revealed by a trainer hint */
  hintedLocations?: number[];
  /** Eggs of the Archipelago profile: they hatch during Archipelago runs */
  eggs?: Egg[];
  /** "See the Fate" encounter: indices (in the slot data lists) of the pass and key item hints already given */
  fateShownPasses?: number[];
  fateShownSpheres?: number[];
  fateShownRegions?: number[];
  /** Biomes whose 10 floors were cleared at least once (in any run): the destinations of the Fly Ticket */
  visitedBiomes?: number[];
}

/** Hint of the "See the Fate" encounter about a pass of this player (`fate_pass_hints` slot data) */
interface ApFatePassHint {
  item: string;
  item_id: number;
  location: string;
  location_id: number;
  finder: number;
  game: string;
}

/** Hint of the "See the Fate" encounter about a rare progression item of another player (`fate_sphere_hints`) */
/** "Find the way": a region holding a rare progression item, from the slot data */
interface ApFateRegionHint {
  region: string;
  /** Player whose world holds the region */
  world: number;
  game: string;
  /** Progression items in the region */
  count: number;
  /** One of the rare progression items of the region, and its owner */
  item: string;
  owner: number;
}

interface ApFateSphereHint {
  item: string;
  owner: number;
  /** Part of the adventure of its first copy: 1 first third of the spheres, 2 second, 3 last */
  part?: number;
  /** Seeds of apworld 0.14: the sphere (and the number of spheres) instead of the part */
  sphere?: number;
  total?: number;
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

/** Registers a sprite of one frame as an atlas, like the sprites of the game (once the textures are available) */
function ensureSingleFrameAtlas(
  key: string,
  dataUri: string,
  frame: { w: number; h: number },
  source?: { x: number; y: number; w: number; h: number },
): void {
  const textures = globalScene?.textures;
  if (!textures || textures.exists(key)) {
    return;
  }
  const image = new Image();
  image.onload = () => {
    if (textures.exists(key)) {
      return;
    }
    textures.addAtlasJSONHash(key, image, {
      frames: {
        "0001.png": {
          frame: { x: 0, y: 0, w: frame.w, h: frame.h },
          rotated: false,
          // A trimmed frame (like the trainer atlases) keeps the shadow under the sprite as wide as the sprite
          trimmed: !!source,
          spriteSourceSize: { x: source?.x ?? 0, y: source?.y ?? 0, w: frame.w, h: frame.h },
          sourceSize: { w: source?.w ?? frame.w, h: source?.h ?? frame.h },
        },
      },
    });
  };
  image.src = dataUri;
}

/** Registers the Mega Alakazam of the "See the Fate" encounter */
export function ensureFateSpriteTexture(): void {
  ensureSingleFrameAtlas(AP_FATE_SPRITE_KEY, AP_FATE_SPRITE_DATA_URI, AP_FATE_SPRITE_FRAME);
}

/** Registers Katrod, the trainer of the Katrod encounter */
export function ensureKatrodSpriteTexture(): void {
  ensureSingleFrameAtlas(
    AP_KATROD_SPRITE_KEY,
    AP_KATROD_SPRITE_DATA_URI,
    AP_KATROD_SPRITE_FRAME,
    AP_KATROD_SPRITE_SOURCE,
  );
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
  /** Floor of the "See the Fate" encounter, cached for the run seed */
  private fateWave: { seed: string; wave: number | null } | null = null;
  /** Species with a Dexsanity check, cached for the slot data they come from */
  private dexsanitySpecies: { source: Record<string, any>; ids: Set<number> } | null = null;
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
    apHooks.isBlitz = () => this.active && this.isBlitz();
    apHooks.onPokemonObtained = (speciesId, newCatch) => this.onPokemonObtained(speciesId, newCatch);
    apHooks.getForcedMysteryEncounter = wave =>
      this.active && wave === this.getFateWave() ? MysteryEncounterType.ARCHIPELAGO_FATE : null;
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
    // Pokédex goal: all the Dexsanity checks were made (e.g. while offline)
    if (this.getGoal() === ApGoal.POKEDEX && this.isDexsanityComplete()) {
      this.profile.goalReached = true;
    }
    this.client.setStatus(this.profile.goalReached ? ClientStatus.CLIENT_GOAL : ClientStatus.CLIENT_PLAYING);

    // Scout every shop location (so the shop can display what it sells) and every other missing location
    // (so key trainers can hint at the progression items they hold)
    const missingOrChecked = new Set([...connected.missing_locations, ...connected.checked_locations]);
    const shopLocations = this.getAllShopLocationIds().filter(l => missingOrChecked.has(l));
    // The trainer hints chosen at generation are shown again even once their location is checked
    const hintLocations = Object.values(this.getTrainerHintLocations() ?? {}).filter(l => missingOrChecked.has(l));
    this.client.scoutLocations([...new Set([...shopLocations, ...hintLocations, ...connected.missing_locations])]);
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
    ensureFateSpriteTexture();
    ensureKatrodSpriteTexture();
    this.active = true;
    // Starters hatched from the Archipelago eggs since the last time get the bonuses too
    this.applyStarterBonuses();
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
    this.applyStarterBonuses();
    this.saveProfile();
  }

  /** Bonuses of the `starter_bonus_unlock` option (passives, abilities, egg moves, shinies, natures, fast_egg) */
  private hasStarterBonus(bonus: string): boolean {
    const bonuses = this.slotData.starter_bonus_unlock;
    return Array.isArray(bonuses) && bonuses.includes(bonus);
  }

  /**
   * Gives the `starter_bonus_unlock` bonuses to every starter unlocked in the profile (received, starting or
   * hatched): called on connection, on each item received and when entering the Archipelago mode
   */
  private applyStarterBonuses(): void {
    if (!this.profile) {
      return;
    }
    const passives = this.hasStarterBonus("passives");
    const abilities = this.hasStarterBonus("abilities");
    const eggMoves = this.hasStarterBonus("egg_moves");
    const shinies = this.hasStarterBonus("shinies");
    const natures = this.hasStarterBonus("natures");
    if (!(passives || abilities || eggMoves || shinies || natures)) {
      return;
    }
    for (const [key, starterEntry] of Object.entries(this.profile.starterData)) {
      const speciesId = Number(key) as SpeciesId;
      const dexEntry = this.profile.dexData[speciesId];
      if (!(starterEntry && dexEntry?.caughtAttr)) {
        continue;
      }
      const species = speciesDataRegistry.getSpecies(speciesId);
      if (passives) {
        starterEntry.passiveAttr |= Passive.UNLOCKED | Passive.ENABLED;
      }
      if (abilities) {
        starterEntry.abilityAttr |=
          AbilityAttr.ABILITY_1
          | (species.ability2 ? AbilityAttr.ABILITY_2 : 0)
          | (species.abilityHidden ? AbilityAttr.ABILITY_HIDDEN : 0);
      }
      if (eggMoves) {
        starterEntry.eggMoves = ALL_EGG_MOVES;
      }
      if (shinies) {
        const shinyAttr =
          (DexAttr.SHINY | DexAttr.DEFAULT_VARIANT | DexAttr.VARIANT_2 | DexAttr.VARIANT_3)
          & species.getFullUnlocksData();
        dexEntry.caughtAttr |= shinyAttr;
        dexEntry.seenAttr |= shinyAttr;
      }
      if (natures) {
        dexEntry.natureAttr |= ALL_NATURES_ATTR;
      }
    }
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
    return Math.min((this.getFloorPassCount() + 1) * AP_GATE_INTERVAL, this.getFinalWave());
  }

  /* -------------------------------------------------------------------- Blitz */

  /** Whether the seed uses the Blitz option: a 100-floor run (see `blitz.ts`) */
  isBlitz(): boolean {
    return !!this.slotData.blitz;
  }

  /** Last floor of the run: 200, or 100 with the Blitz option */
  getFinalWave(): number {
    return Number(this.slotData.final_wave ?? AP_FINAL_WAVE);
  }

  /** Checks per cleared floor (`floor_checks`): 1 = "Floor N Cleared", 2 = also "Floor N Bonus" */
  getFloorChecks(): number {
    return Number(this.slotData.floor_checks ?? 1);
  }

  /** Whether the player may go from the given (just cleared) wave to the next one */
  canAdvanceFrom(wave: number): boolean {
    return wave + 1 <= this.getMaxWave() && !this.isEndPassMissingFor(wave + 1);
  }

  /**
   * Whether the End Pass (`biome_passes: end_only`) is still needed to play this wave: the End takes the last block
   * of 10 floors
   */
  isEndPassMissingFor(wave: number): boolean {
    return this.isEndPassRequired() && wave > this.getFinalWave() - AP_GATE_INTERVAL && !this.hasEndPass();
  }

  getPassesNeededFor(wave: number): number {
    return Math.floor(wave / AP_GATE_INTERVAL);
  }

  /* -------------------------------------------------------------- Biome passes */

  /** Whether biomes need a Biome Pass to be visited (`biome_passes` option) */
  isBiomePassesEnabled(): boolean {
    return !!this.slotData.biome_passes;
  }

  /** Whether the End needs its own pass (`biome_passes: end_only`): the other biomes are open */
  isEndPassRequired(): boolean {
    return !!this.slotData.end_pass;
  }

  hasEndPass(): boolean {
    const itemId = getBiomePassItemId(BiomeId.END);
    return this.receivedItems.some(i => i.item === itemId);
  }

  /** Whether the biome may be chosen as the next destination */
  hasBiomePass(biomeId: BiomeId): boolean {
    if (!this.isBiomePassesEnabled() || FREE_BIOMES.has(biomeId)) {
      return true;
    }
    const itemId = getBiomePassItemId(biomeId);
    return this.receivedItems.some(i => i.item === itemId);
  }

  /* ---------------------------------------------------------------- Fly Ticket */

  hasFlyTicket(): boolean {
    return this.receivedItems.some(i => getApItemDef(i.item)?.category === ApItemCategory.FLY_TICKET);
  }

  private markBiomeVisited(biomeId: number): void {
    if (!this.profile || biomeId === BiomeId.END || this.profile.visitedBiomes?.includes(biomeId)) {
      return;
    }
    this.profile.visitedBiomes = [...(this.profile.visitedBiomes ?? []), biomeId];
    this.saveProfile();
  }

  /**
   * Fly Ticket: the biomes already visited the player may also fly to from the current one (not the current biome,
   * not the End, and with `biome_passes: true` only the unlocked ones). Empty without the Fly Ticket.
   */
  getFlyTicketBiomes(currentBiome: BiomeId): BiomeId[] {
    if (!(this.active && this.profile && this.hasFlyTicket())) {
      return [];
    }
    return (this.profile.visitedBiomes ?? [])
      .filter(b => b !== currentBiome && b !== BiomeId.END && BIOME_IDS.has(b) && this.hasBiomePass(b as BiomeId))
      .map(b => b as BiomeId);
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
      } else if (def?.category === ApItemCategory.FLY_TICKET) {
        messages.push(apText("flyTicketReceived"));
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
    const itemName =
      def.category === ApItemCategory.FLY_TICKET
        ? apText("flyTicketName")
        : (this.resolveModifierType(def)?.name ?? def.name);
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
    const egg = new Egg({
      ...(tier === undefined ? {} : { tier }),
      sourceType: EggSourceType.EVENT,
      eggDescriptor: "Archipelago",
    });
    if (this.hasStarterBonus("fast_egg")) {
      egg.hatchWaves = Math.max(1, Math.ceil(egg.hatchWaves / FAST_EGG_DIVISOR));
    }
    eggs.push(egg);
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

  /** @returns whether the location was checked now (`false` if it already was) */
  checkLocation(locationId: number): boolean {
    if (!this.profile || this.isLocationChecked(locationId)) {
      return false;
    }
    this.profile.checkedLocations.push(locationId);
    this.client.checkLocations([locationId]);
    this.saveProfile();
    return true;
  }

  /**
   * Checks locations and lists the items they sent in the side panel (floor, biome floor and Dexsanity checks)
   * @returns the locations checked now
   */
  checkLocationsWithNotice(locationIds: number[]): number[] {
    const checked = locationIds.filter(l => this.checkLocation(l));
    if (checked.length === 0) {
      return checked;
    }
    try {
      const ownSlot = this.client.connected?.slot;
      const entries: ApSentEntry[] = checked.map(l => {
        const scouted = this.scoutedLocations.get(l);
        if (!scouted) {
          return { item: apText("shopItemUnknown"), player: "", tint: getClassificationTint(0) };
        }
        return {
          item: this.client.getItemName(scouted.item, scouted.player),
          player: scouted.player === ownSlot ? apText("checkSentOwn") : this.client.getPlayerName(scouted.player),
          tint: getClassificationTint(scouted.flags),
        };
      });
      getArchipelagoCheckBar()?.showEntries(apText("checkSent"), entries);
    } catch (err) {
      // The panel is only a display: never block the game for it
      console.error("[AP] Failed to show the sent items", err);
    }
    return checked;
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

  /**
   * Sends the checks of a cleared floor: when the battle is won, and again when the floor is left (by any means)
   * @param leaving - The floor is left: in a Blitz run, also sends the "Floor N Bonus" check if no second reward
   *   phase sent it (e.g. after a Mystery Encounter)
   */
  onWaveCleared(wave: number, leaving = false): void {
    if (wave >= 1 && wave < this.getFinalWave()) {
      const mode = this.getLocationMode();
      const locations: number[] = [];
      if (mode !== ApLocationMode.BIOME_FLOORS) {
        locations.push(getWaveLocationId(wave));
        // "Floor N Bonus": with the first check, or at the second reward phase in a Blitz run
        if (this.getFloorChecks() >= 2 && (leaving || !this.isBlitz())) {
          locations.push(getWaveBonusLocationId(wave));
        }
      }
      // When a floor multiple of 10 is left, the arena already shows the next biome
      const biomeId = this.waveBiome?.wave === wave ? this.waveBiome.biomeId : globalScene.arena.biomeId;
      if (mode !== ApLocationMode.FLOORS) {
        locations.push(getBiomeLocationId(biomeId, ((wave - 1) % AP_GATE_INTERVAL) + 1));
      }
      // The last floor of a biome is cleared: the biome is visited (Fly Ticket)
      if (wave % AP_GATE_INTERVAL === 0) {
        this.markBiomeVisited(biomeId);
      }
      this.checkLocationsWithNotice(locations);
    }
    this.shopCache = null;
  }

  /**
   * Second reward phase of a floor in a Blitz run: sends the "Floor N Bonus" check and renews the Archipelago
   * shop items (the shop then offers the next items not bought yet)
   */
  onBonusRewardPhase(wave: number): void {
    if (
      wave >= 1
      && wave < this.getFinalWave()
      && this.getFloorChecks() >= 2
      && this.getLocationMode() !== ApLocationMode.BIOME_FLOORS
    ) {
      this.checkLocationsWithNotice([getWaveBonusLocationId(wave)]);
    }
    this.shopCache = null;
  }

  /** The final boss was beaten: the goal of the seed, unless it is the Pokédex goal */
  onFinalBossDefeated(): void {
    if (this.getGoal() === ApGoal.ETERNATUS) {
      this.sendGoal();
    }
  }

  getGoal(): ApGoal {
    return Number(this.slotData.goal ?? ApGoal.ETERNATUS) as ApGoal;
  }

  sendGoal(): void {
    if (!this.profile) {
      return;
    }
    this.profile.goalReached = true;
    this.client.setStatus(ClientStatus.CLIENT_GOAL);
    this.saveProfile();
  }

  /* ---------------------------------------------------------------- Dexsanity */

  getDexsanityMode(): ApDexsanityMode {
    return Number(this.slotData.dexsanity ?? ApDexsanityMode.OFF) as ApDexsanityMode;
  }

  /** Species with a Dexsanity check (starter species with `dexsanity: starters`), from the slot data */
  getDexsanitySpecies(): Set<number> {
    if (this.dexsanitySpecies?.source !== this.slotData) {
      const ids = Array.isArray(this.slotData.dexsanity_species) ? this.slotData.dexsanity_species.map(Number) : [];
      this.dexsanitySpecies = { source: this.slotData, ids: new Set(ids) };
    }
    return this.dexsanitySpecies.ids;
  }

  /** Species whose Dexsanity check is sent when the given species is obtained (`undefined`: none) */
  private getDexsanityTarget(speciesId: SpeciesId): SpeciesId | undefined {
    const mode = this.getDexsanityMode();
    if (mode === ApDexsanityMode.OFF) {
      return undefined;
    }
    const target =
      mode === ApDexsanityMode.STARTERS ? speciesDataRegistry.getSpecies(speciesId).getRootSpeciesId() : speciesId;
    return this.getDexsanitySpecies().has(target) ? target : undefined;
  }

  /**
   * Whether Poké Balls may be thrown in the End (forbidden in the original game, but the End may hold Pokémon of the
   * Dexsanity list: the Paradox Pokémon, Eternatus, and the catch-up encounters of the last block)
   */
  allowsEndCatch(): boolean {
    return this.active && this.getDexsanityMode() !== ApDexsanityMode.OFF;
  }

  /** Whether obtaining the species would still send a Dexsanity check */
  isDexsanityMissing(speciesId: SpeciesId): boolean {
    const target = this.getDexsanityTarget(speciesId);
    return target !== undefined && !this.isLocationChecked(getDexLocationId(target));
  }

  /**
   * A Pokémon was obtained (caught, hatched, given, or evolved with `dexsanity: all`) during an Archipelago run:
   * sends its Dexsanity check
   * @param newCatch - The Pokémon joins the team now (not an evolution or a form change)
   */
  onPokemonObtained(speciesId: SpeciesId, newCatch: boolean): void {
    if (!(this.active && this.profile) || (!newCatch && this.getDexsanityMode() !== ApDexsanityMode.ALL)) {
      return;
    }
    const target = this.getDexsanityTarget(speciesId);
    if (target === undefined || this.checkLocationsWithNotice([getDexLocationId(target)]).length === 0) {
      return;
    }
    if (this.getGoal() === ApGoal.POKEDEX && !this.profile.goalReached && this.isDexsanityComplete()) {
      this.sendGoal();
      globalScene.phaseManager.queueMessage(apText("dexComplete"));
      globalScene.phaseManager.queueMessage(apText("goalComplete"));
    }
  }

  isDexsanityComplete(): boolean {
    const species = this.getDexsanitySpecies();
    return species.size > 0 && [...species].every(id => this.isLocationChecked(getDexLocationId(id)));
  }

  /**
   * Dexsanity: the wild Pokémon met on the first floor of each block of 10 is one of the current biome not obtained
   * yet (on the first floor of the End, any Pokémon not obtained yet). `null`: a regular encounter.
   */
  getDexsanityEncounter(wave: number, biomeId: BiomeId): SpeciesId | null {
    if (!this.active || this.getDexsanityMode() === ApDexsanityMode.OFF || wave % AP_GATE_INTERVAL !== 1) {
      return null;
    }
    let candidates: SpeciesId[];
    if (biomeId === BiomeId.END && wave > this.getFinalWave() - AP_GATE_INTERVAL) {
      candidates = [...this.getDexsanitySpecies()].filter(id => !this.isLocationChecked(getDexLocationId(id)));
    } else {
      const pool = allBiomes.get(biomeId)?.pokemonPool ?? {};
      const species = new Set<SpeciesId>();
      for (const byTime of Object.values(pool)) {
        for (const ids of Object.values(byTime as Record<string, readonly SpeciesId[]>)) {
          for (const id of ids) {
            species.add(id);
          }
        }
      }
      candidates = [...species].filter(id => this.isDexsanityMissing(id));
    }
    return candidates.length > 0 ? randSeedItem(candidates) : null;
  }

  /* ------------------------------------------------------------- Fate encounter */

  /** Whether Katrod may be met (`katrod_encounter` option, rare mystery encounter) */
  isKatrodEncounterEnabled(): boolean {
    return !!this.slotData.katrod_encounter;
  }

  /** Whether the seed has the "See the Fate" encounter (`fate_encounter` option) */
  isFateEncounterEnabled(): boolean {
    return !!this.slotData.fate_encounter;
  }

  /**
   * Floor of the run where the "See the Fate" encounter is forced: drawn from the run seed between floors 41 and 99
   * (21 and 49 with Blitz), never on a floor multiple of 10, the first floor of a block, a story battle or a Gym Leader
   * @returns `null` without the encounter
   */
  getFateWave(): number | null {
    if (!(this.active && this.isFateEncounterEnabled() && globalScene.gameMode?.isArchipelago)) {
      return null;
    }
    const seed = globalScene.seed;
    if (this.fateWave?.seed === seed) {
      return this.fateWave.wave;
    }
    const [first, last] = this.isBlitz() ? FATE_WAVES_BLITZ : FATE_WAVES_CLASSIC;
    const gameMode = globalScene.gameMode;
    const candidates: number[] = [];
    for (let wave = first; wave <= last; wave++) {
      if (
        wave % 10 > 1
        && !gameMode.isFixedBattle(wave)
        && !gameMode.isGymWave(wave, globalScene.offsetGym)
        && !gameMode.isWaveFinal(wave)
      ) {
        candidates.push(wave);
      }
    }
    let wave: number | null = null;
    if (candidates.length > 0) {
      globalScene.executeWithSeedOffset(() => {
        wave = candidates[randSeedInt(candidates.length)];
      }, FATE_SEED_OFFSET);
    }
    this.fateWave = { seed, wave };
    return wave;
  }

  /** "A pass": where a pass of this player lies, a different one each run (preferably one not received yet) */
  takeFatePassHint(): string {
    const hints: ApFatePassHint[] = Array.isArray(this.slotData.fate_pass_hints) ? this.slotData.fate_pass_hints : [];
    if (!this.profile || hints.length === 0) {
      return apText("fateNothing");
    }
    const shown = new Set(this.profile.fateShownPasses ?? []);
    const floorPassId = AP_BASE_ID + (apData.items.find(i => i.category === ApItemCategory.GATE)?.offset ?? 0);
    const missing = (hint: ApFatePassHint) =>
      hint.item_id === floorPassId
        ? this.getFloorPassCount() < this.getFinalWave() / AP_GATE_INTERVAL - 1
        : !this.receivedItems.some(i => i.item === hint.item_id);
    const indices = hints.map((_, i) => i);
    const index =
      indices.find(i => !shown.has(i) && missing(hints[i]))
      ?? indices.find(i => !shown.has(i))
      ?? indices.find(i => missing(hints[i]))
      ?? 0;
    const hint = hints[index];
    this.profile.fateShownPasses = [...shown, index];
    this.saveProfile();
    // Also listed in the multiworld hints (the location holds an item of this slot)
    this.client.createHints([hint.location_id], hint.finder);
    return apText("fatePass", {
      item: hint.item,
      location: hint.location,
      player: this.client.getPlayerName(hint.finder),
      game: hint.game,
    });
  }

  /** "A key item": when a rare progression item of another player is found (third of the spheres), a different one each run */
  takeFateSphereHint(): string {
    const hints: ApFateSphereHint[] = Array.isArray(this.slotData.fate_sphere_hints)
      ? this.slotData.fate_sphere_hints
      : [];
    if (!this.profile || hints.length === 0) {
      return apText("fateNothing");
    }
    const shown = new Set(this.profile.fateShownSpheres ?? []);
    const index = hints.findIndex((_, i) => !shown.has(i));
    const chosen = index >= 0 ? index : Math.floor(Math.random() * hints.length);
    const hint = hints[chosen];
    this.profile.fateShownSpheres = [...shown, chosen];
    this.saveProfile();
    // Only the part of the adventure: neither the location nor the sphere
    const part =
      hint.part
      ?? (hint.sphere && hint.total ? Math.min(3, Math.max(1, Math.ceil((3 * hint.sphere) / hint.total))) : 2);
    const key = part <= 1 ? "fateSphere1" : part === 2 ? "fateSphere2" : "fateSphere3";
    return apText(key, { item: hint.item, owner: this.client.getPlayerName(hint.owner) });
  }

  /**
   * "Find the way": a region of a world holding a rare progression item, how many progression items it holds and
   * one of the rare ones (never its location), a different region each run
   */
  takeFateRegionHint(): string {
    const hints: ApFateRegionHint[] = Array.isArray(this.slotData.fate_region_hints)
      ? this.slotData.fate_region_hints
      : [];
    if (!this.profile || hints.length === 0) {
      return apText("fateNothing");
    }
    const shown = new Set(this.profile.fateShownRegions ?? []);
    const index = hints.findIndex((_, i) => !shown.has(i));
    const chosen = index >= 0 ? index : Math.floor(Math.random() * hints.length);
    const hint = hints[chosen];
    this.profile.fateShownRegions = [...shown, chosen];
    this.saveProfile();
    return apText(hint.count > 1 ? "fateRegion" : "fateRegionOne", {
      region: hint.region,
      player: this.client.getPlayerName(hint.world),
      game: hint.game,
      count: hint.count,
      item: hint.item,
      owner: this.client.getPlayerName(hint.owner),
    });
  }

  /** "The winners": the players reaching their goal first and last in the generation (spoiler) order */
  getFateGoalText(): string {
    const order = this.slotData.fate_goal_order;
    if (!(order && Array.isArray(order.first) && order.first.length > 0 && Array.isArray(order.last))) {
      return apText("fateNothing");
    }
    // Only the names: "A, B and C"
    const names = (players: number[]) => {
      const list = players.map(p => this.client.getPlayerName(p));
      return list.length > 1 ? `${list.slice(0, -1).join(", ")} ${apText("nameListAnd")} ${list.at(-1)}` : list[0];
    };
    const first: number[] = order.first;
    const last: number[] = order.last;
    if (first.length === last.length && first.every(p => last.includes(p))) {
      // Everyone reaches their goal at the same time
      return apText("fateGoalTie", { players: names(first) });
    }
    // The verb agrees with several first players (in French)
    return apText(first.length > 1 ? "fateGoalPlural" : "fateGoal", { first: names(first), last: names(last) });
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
   * Locations hinted by the key trainers, chosen at generation (`trainer_hint_locations` slot data): the same
   * trainer always gives the same hint. `null` for the seeds made before (a random hint is picked then).
   */
  private getTrainerHintLocations(): Record<string, number> | null {
    const hints = this.slotData.trainer_hint_locations;
    return hints && typeof hints === "object" ? (hints as Record<string, number>) : null;
  }

  /**
   * Key of the trainer fought on this floor in `trainer_hint_locations`: `fixed_<floor>` for a story battle (its
   * Classic floor, also in a Blitz run), `gym_<n>` for the n-th Gym Leader of the run
   */
  private getTrainerHintKey(wave: number): string | null {
    const gameMode = globalScene.gameMode;
    if (gameMode.isFixedBattle(wave)) {
      return `fixed_${gameMode.getClassicFixedWave(wave)}`;
    }
    if (gameMode.isGymWave(wave, globalScene.offsetGym)) {
      const index = this.isBlitz()
        ? BLITZ_GYM_WAVES.indexOf(wave)
        : Math.floor((wave - (globalScene.offsetGym ? 30 : 20)) / 30);
      return `gym_${index + 1}`;
    }
    return null;
  }

  /**
   * Hint given by the key trainer beaten on this floor: the location chosen at generation for it (or, for older
   * seeds, a progression item not checked or hinted yet, preferably for another player). The hint is also
   * registered on the server.
   * @returns `null` when hints are disabled or there is nothing to hint at
   */
  takeTrainerHint(wave: number): string | null {
    try {
      return this.pickTrainerHint(wave);
    } catch (err) {
      // A hint must never block the end of the battle
      console.error("[AP] Failed to build a trainer hint", err);
      return null;
    }
  }

  private pickTrainerHint(wave: number): string | null {
    if (!(this.profile && this.isConnected && this.isTrainerHintsEnabled())) {
      return null;
    }
    const fixedHints = this.getTrainerHintLocations();
    if (fixedHints) {
      const key = this.getTrainerHintKey(wave);
      const locationId = key === null ? undefined : fixedHints[key];
      const target = locationId === undefined ? undefined : this.scoutedLocations.get(locationId);
      const location = locationId === undefined ? null : this.describeLocation(locationId);
      if (!(target && location)) {
        return null;
      }
      if (!this.isLocationChecked(target.location)) {
        // Also listed in the multiworld hints (create_as_hint 2: only new hints are announced)
        this.client.scoutLocations([target.location], 2);
      }
      return this.formatHint(target, location);
    }
    return this.pickRandomTrainerHint();
  }

  private formatHint(target: NetworkItem, location: NonNullable<ReturnType<ArchipelagoManager["describeLocation"]>>) {
    return apText(location.key, {
      item: this.client.getItemName(target.item, target.player),
      player: this.client.getPlayerName(target.player),
      floor: location.floor,
      zone: location.biomeId === undefined ? "" : getBiomeName(location.biomeId),
      pokemon: location.speciesId === undefined ? "" : speciesDataRegistry.getSpecies(location.speciesId).name,
    });
  }

  private pickRandomTrainerHint(): string | null {
    if (!this.profile) {
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
    return this.formatHint(target, this.describeLocation(target.location)!);
  }

  /** Where a location of this world is, for hints (`null`: not a location the game knows) */
  private describeLocation(locationId: number): {
    key: "hintFloor" | "hintBiomeFloor" | "hintShop" | "hintDex";
    floor: number;
    biomeId?: BiomeId;
    speciesId?: SpeciesId;
  } | null {
    const dexSpecies = locationId - DEX_LOCATION_BASE;
    if (dexSpecies > 0 && dexSpecies in SpeciesId) {
      return { key: "hintDex", floor: 0, speciesId: dexSpecies as SpeciesId };
    }
    const wave = locationId - WAVE_LOCATION_BASE;
    if (wave >= 1 && wave < this.getFinalWave()) {
      return { key: "hintFloor", floor: wave };
    }
    const bonusWave = locationId - WAVE_BONUS_LOCATION_BASE;
    if (bonusWave >= 1 && bonusWave < this.getFinalWave()) {
      return { key: "hintFloor", floor: bonusWave };
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

  /** Floors where the regular shop gets new items, each one unlocking a batch of Archipelago shop items */
  getShopTierWaves(): number[] {
    const waves = this.slotData.shop_tier_waves;
    if (Array.isArray(waves) && waves.length > 0) {
      return waves.map(Number);
    }
    return this.isBlitz() ? BLITZ_SHOP_TIER_WAVES : SHOP_TIER_WAVES;
  }

  /** Number of Archipelago shop items (bought or not) the shop of the given wave may offer */
  getAvailableShopItemCount(wave: number): number {
    const perTier = this.getShopItemsPerTier();
    if (perTier <= 0) {
      return this.getShopItemCount();
    }
    const tiers = this.getShopTierWaves().filter(tierWave => tierWave <= wave).length;
    return Math.min(this.getShopItemCount(), tiers * perTier);
  }

  /** First floor of the shop tier that unlocks the n-th (1-based) Archipelago shop item */
  getShopItemFirstWave(index: number): number {
    const perTier = this.getShopItemsPerTier();
    const tierWaves = this.getShopTierWaves();
    if (perTier <= 0) {
      return tierWaves[0];
    }
    return tierWaves[Math.min(Math.ceil(index / perTier), tierWaves.length) - 1];
  }

  getShopCostPercent(): number {
    return Math.max(0, Number(this.slotData.shop_cost_percent ?? 100));
  }

  private getAllShopLocationIds(): number[] {
    return Array.from({ length: this.getShopItemCount() }, (_, i) => getShopLocationId(i + 1));
  }

  /**
   * Archipelago items offered in the shop of the given wave.
   * The result is cached for the whole wave so the shop UI and the selection phase see the same list
   * (a Blitz run renews it for the second reward phase: see `onBonusRewardPhase`).
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
