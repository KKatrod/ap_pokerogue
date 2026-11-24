/**
 * Professor Oak mystery encounter of the Archipelago mode, with Dexsanity: like when he hands over the first Pokémon,
 * the Professor offers three Pokémon whose Dexsanity check is still missing (no type in common, all different costs).
 * Obtaining one counts as a catch (Dexsanity check, Pokédex goal). The fourth choice declines the offer for a set
 * of Poké Balls. Forced once per run (see `ArchipelagoManager.getOakWave`), and may come once more by chance.
 */
import { globalScene } from "#app/global-scene";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { getPokeballName } from "#data/pokeball";
import type { PokemonSpecies } from "#data/pokemon-species";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { PokeballType } from "#enums/pokeball";
import { PokemonType } from "#enums/pokemon-type";
import type { SpeciesId } from "#enums/species-id";
import type { EnemyPokemon } from "#field/pokemon";
import { PlayerPokemon } from "#field/pokemon";
import { showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import { leaveEncounterWithoutBattle } from "#mystery-encounters/encounter-phase-utils";
import { catchPokemon } from "#mystery-encounters/encounter-pokemon-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { EncounterSceneRequirement } from "#mystery-encounters/mystery-encounter-requirements";
import { PokemonData } from "#system/pokemon-data";
import { randSeedShuffle } from "#utils/common";
import { toCamelCase } from "#utils/strings";
import i18next from "i18next";
import { AP_OAK_SPRITE_KEY } from "./ap-oak-sprite";
import { archipelago, ensureOakSpriteTexture } from "./archipelago";

/** i18n namespace of the encounter (registered at runtime: the texts are not in the `locales` repository) */
const namespace = "mysteryEncounters/archipelagoOak";

/** Number of Pokémon offered */
const OFFER_COUNT = 3;

/** Poké Balls given when the offer is declined */
const DECLINE_BALLS: [PokeballType, number][] = [
  [PokeballType.POKEBALL, 10],
  [PokeballType.GREAT_BALL, 10],
  [PokeballType.ULTRA_BALL, 5],
  [PokeballType.ROGUE_BALL, 5],
  [PokeballType.MASTER_BALL, 1],
];

/** Texts of the three Pokémon choices, filled with the dialogue tokens of each choice (pokemon1, types1, cost1...) */
function offerTexts(tooltip: string, selected: string): Record<number, Record<string, string>> {
  const texts: Record<number, Record<string, string>> = {};
  for (let n = 1; n <= OFFER_COUNT; n++) {
    const fill = (value: string) => value.replace(/{{(pokemon|types|cost)}}/g, `{{$1${n}}}`);
    texts[n] = { label: `{{pokemon${n}}}`, tooltip: fill(tooltip), selected: fill(selected) };
  }
  return texts;
}

const OAK_TEXTS = {
  en: {
    intro: "An elderly man in a lab coat waits for you, three Poké Balls lined up on a small table.",
    speaker: "Professor Oak",
    introDialogue1: "Ah, there you are! This world is full of creatures we call Pokémon.",
    introDialogue2: "But your Pokédex still lacks so many of them... Let me help you!",
    introDialogue3: "Three Poké Balls, three Pokémon. Go on, pick the one you like!",
    title: "The Professor's Gift",
    description:
      "Professor Oak wants to help you with your Pokédex: he offers you one of the three Pokémon he brought. They are all missing from your Dexsanity list.",
    query: "Which Pokémon do you choose?",
    option: {
      ...offerTexts(
        "(+) Obtain {{pokemon}}\n({{types}}, cost {{cost}})",
        "So, you choose {{pokemon}}? A fine choice!\nTake good care of it, and may your Pokédex grow!",
      ),
      none: {
        label: "—",
        tooltip: "(-) No other Pokémon to offer",
      },
      decline: {
        label: "I'll manage",
        tooltip: "(+) Poké Balls to catch\nthem yourself",
        selected:
          "Ho ho! You would rather catch them yourself? That's the spirit of a true trainer!\nThen take these, they will come in handy.",
      },
    },
    balls: "You received {{balls}}!",
    ballsAnd: "and",
    outro: "Professor Oak goes back to his research.",
  },
  fr: {
    intro: "Un homme âgé en blouse blanche vous attend, trois Poké Balls alignées sur une petite table.",
    speaker: "Professeur Chen",
    introDialogue1: "Ah, te voilà ! Ce monde regorge de créatures que l'on appelle Pokémon.",
    introDialogue2: "Mais ton Pokédex en manque encore beaucoup... Laisse-moi t'aider !",
    introDialogue3: "Trois Poké Balls, trois Pokémon. Allez, choisis celui qui te plaît !",
    title: "Le cadeau du Professeur",
    description:
      "Le Professeur Chen veut t'aider à compléter ton Pokédex : il te propose l'un des trois Pokémon qu'il a apportés. Tous manquent à ta liste Dexsanity.",
    query: "Quel Pokémon choisis-tu ?",
    option: {
      ...offerTexts(
        "(+) Obtenir {{pokemon}}\n({{types}}, coût {{cost}})",
        "Alors, ce sera {{pokemon}} ? Excellent choix !\nPrends-en bien soin, et que ton Pokédex s'agrandisse !",
      ),
      none: {
        label: "—",
        tooltip: "(-) Plus d'autre Pokémon à proposer",
      },
      decline: {
        label: "Me débrouiller",
        tooltip: "(+) Des Poké Balls pour\nles capturer soi-même",
        selected:
          "Ho ho ! Tu préfères les attraper toi-même ? Voilà l'esprit d'un vrai dresseur !\nAlors prends ceci, ça te sera utile.",
      },
    },
    balls: "Vous recevez {{balls}} !",
    ballsAnd: "et",
    outro: "Le Professeur Chen retourne à ses recherches.",
  },
};

/** Registers the texts of the encounter (French for French, English for the other languages) */
function registerOakTexts(): void {
  i18next.addResourceBundle("en", namespace, OAK_TEXTS.en, true, true);
  i18next.addResourceBundle("fr", namespace, OAK_TEXTS.fr, true, true);
  const language = i18next.resolvedLanguage ?? i18next.language;
  if (language && !language.startsWith("en") && !language.startsWith("fr")) {
    i18next.addResourceBundle(language, namespace, OAK_TEXTS.en, true, true);
  }
}

const text = (key: string, params?: Record<string, string | number>) => i18next.t(`${namespace}:${key}`, params);

/** Types of a species (its base form) */
function getSpeciesTypes(species: PokemonSpecies): PokemonType[] {
  return species.type2 == null ? [species.type1] : [species.type1, species.type2];
}

/** Starter cost of a species (the one of its line) */
function getSpeciesCost(species: PokemonSpecies): number {
  return speciesDataRegistry.getStarterCost(species.getRootSpeciesId());
}

/**
 * Up to three Pokémon of the missing Dexsanity list without any type in common and with different costs: the first
 * compatible trio in a seeded shuffle of the list, else the first compatible pair, else a single Pokémon
 */
export function pickOakOffers(missing: SpeciesId[]): PokemonSpecies[] {
  const list = randSeedShuffle(missing.map(id => speciesDataRegistry.getSpecies(id)));
  const info = list.map(species => ({ species, types: getSpeciesTypes(species), cost: getSpeciesCost(species) }));
  const compatible = (a: (typeof info)[number], b: (typeof info)[number]) =>
    a.cost !== b.cost && !a.types.some(t => b.types.includes(t));
  let pair: PokemonSpecies[] | null = null;
  for (let i = 0; i < info.length; i++) {
    for (let j = i + 1; j < info.length; j++) {
      if (!compatible(info[i], info[j])) {
        continue;
      }
      pair ??= [info[i].species, info[j].species];
      for (let k = j + 1; k < info.length; k++) {
        if (compatible(info[i], info[k]) && compatible(info[j], info[k])) {
          return [info[i].species, info[j].species, info[k].species];
        }
      }
    }
  }
  return pair ?? list.slice(0, 1);
}

const typeName = (type: PokemonType) => i18next.t(`pokemonInfo:type.${toCamelCase(PokemonType[type])}`);

/** The encounter only happens in the Archipelago mode, with Dexsanity and Pokémon still missing */
class OakRequirement extends EncounterSceneRequirement {
  override meetsRequirement(): boolean {
    return globalScene.gameMode.isArchipelago && archipelago.isOakEncounterEnabled();
  }

  override getDialogueToken(): [string, string] {
    return ["oak", ""];
  }
}

/** A choice is only available when a Pokémon could be offered for it */
class OfferRequirement extends EncounterSceneRequirement {
  private readonly index: number;

  constructor(index: number) {
    super();
    this.index = index;
  }

  override meetsRequirement(): boolean {
    const offers: PlayerPokemon[] | undefined = globalScene.currentBattle?.mysteryEncounter?.misc?.offers;
    return !!offers?.[this.index];
  }

  override getDialogueToken(): [string, string] {
    return [`pokemon${this.index + 1}`, ""];
  }
}

/** The chosen Pokémon joins the player as if it had been caught (Dexsanity check, Pokédex goal) */
async function giveOffer(index: number): Promise<void> {
  const pokemon = globalScene.currentBattle.mysteryEncounter!.misc.offers[index] as PlayerPokemon;
  const data = new PokemonData(pokemon);
  data.player = false;
  await catchPokemon(data.toPokemon() as EnemyPokemon, null, PokeballType.POKEBALL, true, true);
  leaveEncounterWithoutBattle();
}

/** The offer is declined: a set of Poké Balls */
async function giveBalls(): Promise<void> {
  const names = DECLINE_BALLS.map(([type, count]) => {
    globalScene.pokeballCounts[type] += count;
    return `${count} ${getPokeballName(type)}`;
  });
  const balls = `${names.slice(0, -1).join(", ")} ${text("ballsAnd")} ${names.at(-1)}`;
  await showEncounterText(text("balls", { balls }));
  leaveEncounterWithoutBattle();
}

/** One of the three Pokémon choices */
function offerOption(index: number) {
  const n = index + 1;
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DISABLED_OR_DEFAULT)
    .withSceneRequirement(new OfferRequirement(index))
    .withHasDexProgress(true)
    .withDialogue({
      buttonLabel: `${namespace}:option.${n}.label`,
      buttonTooltip: `${namespace}:option.${n}.tooltip`,
      disabledButtonLabel: `${namespace}:option.none.label`,
      disabledButtonTooltip: `${namespace}:option.none.tooltip`,
      selected: [{ speaker: `${namespace}:speaker`, text: `${namespace}:option.${n}.selected` }],
    })
    .withOptionPhase(() => giveOffer(index))
    .build();
}

export const ArchipelagoOakEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ARCHIPELAGO_OAK,
)
  .withEncounterTier(MysteryEncounterTier.ROGUE)
  .withSceneRequirement(new OakRequirement())
  .withMaxAllowedEncounters(2)
  .withIntroSpriteConfigs([
    {
      spriteKey: AP_OAK_SPRITE_KEY,
      fileRoot: "",
      hasShadow: true,
    },
  ])
  .withIntroDialogue([
    {
      text: `${namespace}:intro`,
    },
    { text: `${namespace}:introDialogue1`, speaker: `${namespace}:speaker` },
    { text: `${namespace}:introDialogue2`, speaker: `${namespace}:speaker` },
    { text: `${namespace}:introDialogue3`, speaker: `${namespace}:speaker` },
  ])
  .withOnInit(() => {
    registerOakTexts();
    ensureOakSpriteTexture();
    const encounter = globalScene.currentBattle.mysteryEncounter!;
    const level = Math.max(5, globalScene.currentBattle.getLevelForWave());
    const offers = pickOakOffers(archipelago.getMissingDexsanitySpecies()).map(species => {
      const pokemon = new PlayerPokemon(species, level);
      pokemon.generateAndPopulateMoveset();
      pokemon.calculateStats();
      return pokemon;
    });
    encounter.misc = { offers };
    offers.forEach((pokemon, index) => {
      const n = index + 1;
      encounter.setDialogueToken(`pokemon${n}`, pokemon.getNameToRender());
      encounter.setDialogueToken(`types${n}`, getSpeciesTypes(pokemon.species).map(typeName).join(" / "));
      encounter.setDialogueToken(`cost${n}`, getSpeciesCost(pokemon.species).toString());
    });
    return true;
  })
  .withAutoHideIntroVisuals(false)
  .setLocalizationKey(namespace)
  .withTitle(`${namespace}:title`)
  .withDescription(`${namespace}:description`)
  .withQuery(`${namespace}:query`)
  .withOption(offerOption(0))
  .withOption(offerOption(1))
  .withOption(offerOption(2))
  .withSimpleOption(
    {
      buttonLabel: `${namespace}:option.decline.label`,
      buttonTooltip: `${namespace}:option.decline.tooltip`,
      selected: [{ speaker: `${namespace}:speaker`, text: `${namespace}:option.decline.selected` }],
    },
    giveBalls,
  )
  .withOutroDialogue([
    {
      text: `${namespace}:outro`,
    },
  ])
  .build();
