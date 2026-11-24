/**
 * "Katrod" mystery encounter of the Archipelago mode (option `katrod_encounter`): an easter egg where Katrod shares
 * his favourite topics. Rare, in any biome, at most once per run.
 * The trainer sprite is a placeholder (Scientist) until Katrod's own sprite is made.
 */
import { globalScene } from "#app/global-scene";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { allAbilities, allMoves, modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { Nature } from "#enums/nature";
import { PartyMemberStrength } from "#enums/party-member-strength";
import { PokemonType, type RegularPokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { PERMANENT_STATS, Stat } from "#enums/stat";
import { TrainerType } from "#enums/trainer-type";
import type { PlayerPokemon } from "#field/pokemon";
import { ExpBalanceModifier, ExtraModifierModifier, TempExtraModifierModifier } from "#modifiers/modifier";
import type { PokemonHeldItemModifierType } from "#modifiers/modifier-type";
import { showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import {
  type EnemyPartyConfig,
  type EnemyPokemonConfig,
  generateModifierType,
  initBattleWithEnemyConfig,
  leaveEncounterWithoutBattle,
  setEncounterRewards,
  transitionMysteryEncounterIntroVisuals,
} from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { EncounterSceneRequirement } from "#mystery-encounters/mystery-encounter-requirements";
import { trainerConfigs } from "#trainers/trainer-config";
import { TrainerPartyCompoundTemplate, TrainerPartyTemplate } from "#trainers/trainer-party-template";
import { NumberHolder, randSeedItem } from "#utils/common";
import { getEnumValues } from "#utils/enums";
import { toCamelCase } from "#utils/strings";
import i18next from "i18next";
import { AP_KATROD_SPRITE_KEY } from "./ap-katrod-sprite";
import { archipelago, ensureKatrodSpriteTexture } from "./archipelago";

/** i18n namespace of the encounter (registered at runtime: the texts are not in the `locales` repository) */
const namespace = "mysteryEncounters/archipelagoKatrod";

/** Placeholder sprite until Katrod's own sprite: the male Scientist */
const KATROD_TRAINER_TYPE = TrainerType.SCIENTIST;

/** Option 1: Exp. Balance stacks the player ends up with, and share of the money given to the community */
const EXP_BALANCE_TARGET = 4;
const COMMUNITY_MONEY_SHARE = 0.2;
/** Option 2: power of the offensive moves offered, at least */
const RANDOM_ATTACK_MIN_POWER = 40;

const KATROD_TEXTS = {
  en: {
    intro:
      "A trainer with sparkling eyes blocks your way, a Gramsci book in one hand and a guide to randomizers in the other.",
    speaker: "Katrod",
    introDialogue: "Hi! Got five minutes? I absolutely have to tell you about something!",
    title: "Katrod's Passions",
    description:
      "Katrod, passionate about political theory, randomizers and endless debates, won't let you pass without talking about his favourite topics.",
    query: "How do you react?",
    option: {
      1: {
        label: "A Marx rant",
        tooltip: "(+) Exp. Balance, vitamins\n(-) 20% of your money",
        selected:
          "Katrod talks for hours about class struggle, cultural hegemony and surplus value...\nConclusion: resources must be shared!",
      },
      2: {
        label: "Randomizers",
        tooltip: "(?) Random abilities,\npassives and types\n(+) 4 moves per Pokémon",
        selected:
          '"Randomness is life! Every run is unique!"\nKatrod waves his arms... and your team is not quite the same.',
      },
      3: {
        label: "Argue details",
        tooltip: "(-) Battle Katrod\n(+) Master and Rogue items",
        selected: '"Wait, wait, wait... That\'s not quite it."\nThe debate turns into a battle!',
      },
      4: {
        label: "Offer a coffee",
        tooltip: "(+) A regular shop",
        selected: 'Katrod never turns down a coffee!\n"Thanks, that\'s nice of you. Have a good trip!"',
      },
    },
    shared: "Katrod gives you {{item}} until you have {{count}}, and a vitamin to each Pokémon for its lowest stat.",
    community: "You give ₽{{money}} to the community.",
    abilityChanged: "{{pokemon}}'s ability became {{ability}}!",
    passiveChanged: "{{pokemon}}'s passive became {{ability}}!",
    typesChanged: "{{pokemon}}'s types became {{type1}} and {{type2}}!",
    battleIntro: "I'll prove I'm right with a demonstration!",
    victory: "...Wait. Actually, we agreed from the start, didn't we?",
    nickname: {
      toxicroak: "Coatrod",
      toxtricity: "Re-volt",
      xatu: "Franc-Xatu",
      excadrill: "Marxotaupe",
      rotom: "Practical Work",
    },
  },
  fr: {
    intro:
      "Un dresseur aux yeux pétillants vous barre la route, un livre de Gramsci dans une main et un guide sur les randomizers dans l'autre.",
    speaker: "Katrod",
    introDialogue: "Salut ! Tu as cinq minutes ? Il faut absolument que je te parle de quelque chose !",
    title: "Les passions de Katrod",
    description:
      "Katrod, passionné de théorie politique, de randomizers et de débats sans fin, ne vous laissera pas passer sans vous parler de ses sujets favoris.",
    query: "Comment réagissez-vous ?",
    option: {
      1: {
        label: "Tunnel sur Marx",
        tooltip: "(+) EXP. Balance, vitamines\n(-) 20 % de votre argent",
        selected:
          "Katrod parle pendant des heures de lutte des classes, d'hégémonie culturelle et de plus-value...\nConclusion : il faut partager les ressources !",
      },
      2: {
        label: "Les randomizers",
        tooltip: "(?) Talents, passifs et\ntypes aléatoires\n(+) 4 capacités par Pokémon",
        selected:
          "« L'aléatoire, c'est la vie ! Chaque partie est unique ! »\nKatrod agite les bras... et votre équipe n'est plus tout à fait la même.",
      },
      3: {
        label: "Pinailler",
        tooltip: "(-) Affronter Katrod\n(+) Objets Master et Rogue",
        selected: "« Attends, attends, attends... Ce n'est pas tout à fait ça. »\nLe débat tourne au combat !",
      },
      4: {
        label: "Offrir un café",
        tooltip: "(+) Boutique classique",
        selected: "Katrod ne refuse jamais un petit café !\n« Merci, c'est sympa. Allez, bonne route ! »",
      },
    },
    shared:
      "Katrod vous donne des {{item}} jusqu'à en avoir {{count}}, et une vitamine à chaque Pokémon pour sa statistique la plus basse.",
    community: "Vous versez {{money}} ₽ à la communauté.",
    abilityChanged: "Le talent de {{pokemon}} est devenu {{ability}} !",
    passiveChanged: "Le passif de {{pokemon}} est devenu {{ability}} !",
    typesChanged: "Les types de {{pokemon}} sont devenus {{type1}} et {{type2}} !",
    battleIntro: "Je vais te prouver par l'exemple que j'ai raison !",
    victory: "... Attends. En fait, on était d'accord depuis le début, non ?",
    nickname: {
      toxicroak: "Coatrod",
      toxtricity: "Ré-volt",
      xatu: "Franc-Xatu",
      excadrill: "Marxotaupe",
      rotom: "TP de Techno",
    },
  },
};

/** Registers the texts of the encounter (French for French, English for the other languages) */
function registerKatrodTexts(): void {
  i18next.addResourceBundle("en", namespace, KATROD_TEXTS.en, true, true);
  i18next.addResourceBundle("fr", namespace, KATROD_TEXTS.fr, true, true);
  const language = i18next.resolvedLanguage ?? i18next.language;
  if (language && !language.startsWith("en") && !language.startsWith("fr")) {
    i18next.addResourceBundle(language, namespace, KATROD_TEXTS.en, true, true);
  }
}

const text = (key: string, params?: Record<string, string | number>) => i18next.t(`${namespace}:${key}`, params);

/** The encounter only happens in the Archipelago mode, when the seed has the option */
class KatrodRequirement extends EncounterSceneRequirement {
  override meetsRequirement(): boolean {
    return globalScene.gameMode.isArchipelago && archipelago.isKatrodEncounterEnabled();
  }

  override getDialogueToken(): [string, string] {
    return ["katrod", ""];
  }
}

/* ---------------------------------------------------------------- Option 1: Marx and Gramsci */

/** Exp. Balance up to 4, a vitamin for the lowest stat of each Pokémon, then 20% of the money for the community */
async function shareResources(): Promise<void> {
  const expBalance = globalScene.findModifier(m => m instanceof ExpBalanceModifier);
  const missing = Math.max(0, EXP_BALANCE_TARGET - (expBalance?.getStackCount() ?? 0));
  const expBalanceType = modifierTypes.EXP_BALANCE();
  for (let i = 0; i < missing; i++) {
    globalScene.addModifier(expBalanceType.newModifier(), true, false, false, true);
  }

  for (const pokemon of globalScene.getPlayerParty()) {
    const lowest = PERMANENT_STATS.reduce((low, stat) => (pokemon.getStat(stat) < pokemon.getStat(low) ? stat : low));
    const vitamin = generateModifierType(modifierTypes.BASE_STAT_BOOSTER, [lowest]) as PokemonHeldItemModifierType;
    globalScene.addModifier(vitamin.newModifier(pokemon), true, false, false, true);
  }
  globalScene.updateModifiers(true, true);
  await showEncounterText(text("shared", { item: expBalanceType.name, count: EXP_BALANCE_TARGET }));

  const given = Math.floor(globalScene.money * COMMUNITY_MONEY_SHARE);
  if (given > 0) {
    globalScene.money -= given;
    globalScene.updateMoneyText();
    globalScene.animateMoneyChanged(false);
    await showEncounterText(text("community", { money: given.toLocaleString() }));
  }
  leaveEncounterWithoutBattle();
}

/* ---------------------------------------------------------------- Option 2: randomizers */

const REGULAR_TYPES = getEnumValues(PokemonType).filter(
  (t): t is RegularPokemonType => t >= PokemonType.NORMAL && t <= PokemonType.FAIRY,
);

let validAbilities: AbilityId[] | null = null;
let validMoves: MoveId[] | null = null;

/** Abilities a Pokémon may get: implemented, and not tied to a form or plainly harmful (like the Ability Randomizer) */
function getValidAbilities(): AbilityId[] {
  validAbilities ??= getEnumValues(AbilityId).filter(
    a =>
      ![
        AbilityId.NONE,
        AbilityId.COMMANDER,
        AbilityId.DISGUISE,
        AbilityId.FORECAST,
        AbilityId.GULP_MISSILE,
        AbilityId.HUNGER_SWITCH,
        AbilityId.ICE_FACE,
        AbilityId.MULTITYPE,
        AbilityId.POWER_CONSTRUCT,
        AbilityId.RKS_SYSTEM,
        AbilityId.SCHOOLING,
        AbilityId.SHIELDS_DOWN,
        AbilityId.STANCE_CHANGE,
        AbilityId.TERA_SHIFT,
        AbilityId.ZEN_MODE,
        AbilityId.ZERO_TO_HERO,
        AbilityId.DEFEATIST,
        AbilityId.KLUTZ,
        AbilityId.NORMALIZE,
        AbilityId.SLOW_START,
        AbilityId.STALL,
        AbilityId.TRUANT,
        AbilityId.WIMP_OUT,
      ].includes(a) && !allAbilities[a].unimplemented,
  );
  return validAbilities;
}

/** Moves a Pokémon may learn: implemented, no Z-Move or Struggle */
function getValidMoves(): MoveId[] {
  validMoves ??= getEnumValues(MoveId).filter(
    m =>
      ![MoveId.NONE, MoveId.STRUGGLE, MoveId.SPLASH, MoveId.HOLD_HANDS].includes(m)
      && !allMoves[m].isUnimplemented
      && !MoveId[m].includes("__"),
  );
  return validMoves;
}

const typeName = (type: PokemonType) => i18next.t(`pokemonInfo:type.${toCamelCase(PokemonType[type])}`);

/** The 4 moves offered: an offensive one of each new type (category of the best attack stat), and 2 others */
function pickRandomMoves(pokemon: PlayerPokemon, types: PokemonType[]): MoveId[] {
  const category =
    pokemon.getStat(Stat.ATK) >= pokemon.getStat(Stat.SPATK) ? MoveCategory.PHYSICAL : MoveCategory.SPECIAL;
  const known = new Set(pokemon.getMoveset().map(m => m.moveId));
  const chosen: MoveId[] = [];
  const pick = (pool: MoveId[]) => {
    const candidates = pool.filter(m => !known.has(m) && !chosen.includes(m));
    if (candidates.length > 0) {
      chosen.push(randSeedItem(candidates));
    }
  };
  for (const type of types) {
    pick(
      getValidMoves().filter(
        m =>
          allMoves[m].type === type
          && allMoves[m].category === category
          && allMoves[m].power >= RANDOM_ATTACK_MIN_POWER,
      ),
    );
  }
  while (chosen.length < 4) {
    const before = chosen.length;
    pick(getValidMoves());
    if (chosen.length === before) {
      break;
    }
  }
  return chosen;
}

/**
 * New ability, passive and two types for each Pokémon, told one Pokémon at a time, then the moves it may learn
 * (each one asks before replacing a move)
 */
function randomizeTeam(): void {
  globalScene.getPlayerParty().forEach((pokemon, index) => {
    const name = pokemon.getNameToRender();
    const ability = randSeedItem(getValidAbilities());
    const passive = randSeedItem(getValidAbilities().filter(a => a !== ability));
    const firstType = randSeedItem(REGULAR_TYPES);
    const secondType = randSeedItem(REGULAR_TYPES.filter(t => t !== firstType));
    pokemon.customPokemonData.ability = ability;
    pokemon.customPokemonData.passive = passive;
    pokemon.customPokemonData.types = [firstType, secondType];
    pokemon.updateInfo();

    const messages = [
      text("abilityChanged", { pokemon: name, ability: allAbilities[ability].name }),
      text("passiveChanged", { pokemon: name, ability: allAbilities[passive].name }),
      text("typesChanged", { pokemon: name, type1: typeName(firstType), type2: typeName(secondType) }),
    ];
    for (const message of messages) {
      globalScene.phaseManager.unshiftNew("MessagePhase", message, null, true);
    }
    for (const move of pickRandomMoves(pokemon, [firstType, secondType])) {
      globalScene.phaseManager.unshiftNew("LearnMovePhase", index, move);
    }
  });
  leaveEncounterWithoutBattle();
}

/* ---------------------------------------------------------------- Option 3: the debate */

const heldItem = (func: keyof typeof modifierTypes, args?: unknown[]) => ({
  modifier: generateModifierType(modifierTypes[func], args) as PokemonHeldItemModifierType,
});
const typeBooster = (type: PokemonType) => heldItem("ATTACK_TYPE_BOOSTER", [type]);

/** Katrod's team, at the level of the floor (Galarian Moltres stronger, as a 2-bar boss) */
function getKatrodPartyConfig(): EnemyPartyConfig {
  const trainerConfig = trainerConfigs[KATROD_TRAINER_TYPE]
    .clone()
    .setPartyTemplates(
      new TrainerPartyCompoundTemplate(
        new TrainerPartyTemplate(5, PartyMemberStrength.AVERAGE),
        new TrainerPartyTemplate(1, PartyMemberStrength.STRONG),
      ),
    );
  // Katrod's own sprite (registered when entering the Archipelago mode), instead of the Scientist one
  trainerConfig.getSpriteKey = () => AP_KATROD_SPRITE_KEY;
  trainerConfig.loadAssets = () => Promise.resolve();
  trainerConfig.encounterMessages = [text("battleIntro")];
  trainerConfig.victoryMessages = [text("victory")];
  const species = (id: SpeciesId) => speciesDataRegistry.getSpecies(id);
  const pokemonConfigs: EnemyPokemonConfig[] = [
    {
      species: species(SpeciesId.TOXICROAK),
      isBoss: false,
      nickname: text("nickname.toxicroak"),
      abilityIndex: 1, // Dry Skin
      nature: Nature.ADAMANT,
      moveSet: [MoveId.SWORDS_DANCE, MoveId.DRAIN_PUNCH, MoveId.POISON_JAB, MoveId.SUCKER_PUNCH],
      modifierConfigs: [
        heldItem("LEFTOVERS"),
        heldItem("SHELL_BELL"),
        typeBooster(PokemonType.FIGHTING),
        typeBooster(PokemonType.POISON),
      ],
    },
    {
      species: species(SpeciesId.TOXTRICITY),
      isBoss: false,
      nickname: text("nickname.toxtricity"),
      formIndex: 1, // Low Key
      abilityIndex: 0, // Punk Rock
      nature: Nature.MODEST,
      tera: PokemonType.NORMAL, // Boomburst
      moveSet: [MoveId.OVERDRIVE, MoveId.BOOMBURST, MoveId.SLUDGE_BOMB, MoveId.VOLT_SWITCH],
      modifierConfigs: [typeBooster(PokemonType.ELECTRIC), typeBooster(PokemonType.POISON), heldItem("LEFTOVERS")],
    },
    {
      species: species(SpeciesId.XATU),
      isBoss: false,
      nickname: text("nickname.xatu"),
      abilityIndex: 2, // Magic Bounce
      nature: Nature.TIMID,
      moveSet: [MoveId.CALM_MIND, MoveId.PSYCHIC, MoveId.AIR_SLASH, MoveId.ROOST],
      modifierConfigs: [heldItem("LEFTOVERS"), typeBooster(PokemonType.PSYCHIC), typeBooster(PokemonType.FLYING)],
    },
    {
      species: species(SpeciesId.EXCADRILL),
      isBoss: false,
      nickname: text("nickname.excadrill"),
      abilityIndex: 2, // Mold Breaker
      nature: Nature.ADAMANT,
      moveSet: [MoveId.SWORDS_DANCE, MoveId.EARTHQUAKE, MoveId.IRON_HEAD, MoveId.ROCK_SLIDE],
      modifierConfigs: [typeBooster(PokemonType.GROUND), heldItem("QUICK_CLAW"), heldItem("FOCUS_BAND")],
    },
    {
      species: species(SpeciesId.ROTOM),
      isBoss: false,
      nickname: text("nickname.rotom"),
      formIndex: 2, // Wash
      abilityIndex: 0, // Levitate
      nature: Nature.MODEST,
      moveSet: [MoveId.NASTY_PLOT, MoveId.HYDRO_PUMP, MoveId.THUNDERBOLT, MoveId.SHADOW_BALL],
      modifierConfigs: [typeBooster(PokemonType.WATER), typeBooster(PokemonType.ELECTRIC), heldItem("LEFTOVERS")],
    },
    {
      species: species(SpeciesId.GALAR_MOLTRES),
      isBoss: true,
      bossSegments: 2,
      // "de la Commune" stays in French in every language, after the local name of Moltres
      nickname: `${species(SpeciesId.MOLTRES).name} de la Commune`,
      abilityIndex: 0, // Berserk
      nature: Nature.MODEST,
      moveSet: [MoveId.NASTY_PLOT, MoveId.FIERY_WRATH, MoveId.HURRICANE, MoveId.ROOST],
      modifierConfigs: [typeBooster(PokemonType.DARK), typeBooster(PokemonType.FLYING), heldItem("LEFTOVERS")],
    },
  ];
  return { trainerConfig, pokemonConfigs, female: false, doubleBattle: false };
}

/** Number of rewards the shop offers (3, more with the items that add some), like `SelectModifierPhase` */
function getRewardCount(): number {
  const count = new NumberHolder(3);
  globalScene.applyModifiers(ExtraModifierModifier, true, count);
  globalScene.applyModifiers(TempExtraModifierModifier, true, count);
  return count.value;
}

async function debateKatrod(): Promise<void> {
  // After the victory: two Master tier rewards, all the others of the Rogue tier
  const others = Math.max(0, getRewardCount() - 2);
  setEncounterRewards({
    guaranteedModifierTiers: [ModifierTier.MASTER, ModifierTier.MASTER, ...new Array(others).fill(ModifierTier.ROGUE)],
    fillRemaining: false,
  });
  // The intro sprite leaves the field, the trainer sprite of the battle takes its place
  await transitionMysteryEncounterIntroVisuals();
  await initBattleWithEnemyConfig(getKatrodPartyConfig());
  const trainer = globalScene.currentBattle.trainer;
  if (trainer) {
    // Just "Katrod", without the class title of the Scientist
    trainer.name = text("speaker");
    trainer.getName = () => text("speaker");
  }
}

/* ---------------------------------------------------------------- The encounter */

export const ArchipelagoKatrodEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ARCHIPELAGO_KATROD,
)
  .withEncounterTier(MysteryEncounterTier.ROGUE)
  .withSceneRequirement(new KatrodRequirement())
  .withMaxAllowedEncounters(1)
  .withIntroSpriteConfigs([
    {
      spriteKey: AP_KATROD_SPRITE_KEY,
      fileRoot: "",
      hasShadow: true,
    },
  ])
  .withIntroDialogue([
    {
      text: `${namespace}:intro`,
    },
    {
      text: `${namespace}:introDialogue`,
      speaker: `${namespace}:speaker`,
    },
  ])
  .withOnInit(() => {
    registerKatrodTexts();
    ensureKatrodSpriteTexture();
    return true;
  })
  .withAutoHideIntroVisuals(false)
  .setLocalizationKey(namespace)
  .withTitle(`${namespace}:title`)
  .withDescription(`${namespace}:description`)
  .withQuery(`${namespace}:query`)
  .withSimpleOption(
    {
      buttonLabel: `${namespace}:option.1.label`,
      buttonTooltip: `${namespace}:option.1.tooltip`,
      selected: [{ speaker: `${namespace}:speaker`, text: `${namespace}:option.1.selected` }],
    },
    shareResources,
  )
  .withSimpleOption(
    {
      buttonLabel: `${namespace}:option.2.label`,
      buttonTooltip: `${namespace}:option.2.tooltip`,
      selected: [{ speaker: `${namespace}:speaker`, text: `${namespace}:option.2.selected` }],
    },
    async () => randomizeTeam(),
  )
  .withSimpleOption(
    {
      buttonLabel: `${namespace}:option.3.label`,
      buttonTooltip: `${namespace}:option.3.tooltip`,
      selected: [{ speaker: `${namespace}:speaker`, text: `${namespace}:option.3.selected` }],
    },
    debateKatrod,
  )
  .withSimpleOption(
    {
      buttonLabel: `${namespace}:option.4.label`,
      buttonTooltip: `${namespace}:option.4.tooltip`,
      selected: [{ speaker: `${namespace}:speaker`, text: `${namespace}:option.4.selected` }],
    },
    async () => {
      // A regular shop
      setEncounterRewards({ fillRemaining: true });
      leaveEncounterWithoutBattle();
    },
  )
  .build();
