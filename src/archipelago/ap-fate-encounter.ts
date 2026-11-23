/**
 * "See the Fate" mystery encounter of the Archipelago mode: once per run, a Mega Alakazam whose spoons have the
 * colours of the Archipelago logo offers a hint about the multiworld (option `fate_encounter`, data prepared at
 * generation in the slot data). The floor is chosen by `ArchipelagoManager.getFateWave`.
 */
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import { leaveEncounterWithoutBattle } from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import i18next from "i18next";
import { AP_FATE_SPRITE_KEY } from "./ap-fate-sprite";
import { archipelago } from "./archipelago";

/** i18n namespace of the encounter (registered at runtime: the texts are not in the `locales` repository) */
const namespace = "mysteryEncounters/archipelagoFate";

const FATE_TEXTS = {
  en: {
    intro: "A Mega Alakazam floats above the ground, surrounded by spoons in the colours of the Archipelago.",
    speaker: "Mega Alakazam",
    introDialogue: "I can see the threads of fate that bind every world together...\nDo you wish to see them?",
    title: "See the Fate",
    description:
      "A Mega Alakazam with multicoloured spoons offers to lift the veil on the fate of the multiworld. It will only answer one question.",
    query: "What do you want to see?",
    option: {
      1: {
        label: "A pass",
        tooltip: "(+) Where one of your Floor or Biome Passes lies",
      },
      2: {
        label: "A key item",
        tooltip: "(+) Where a rare key item of another player lies, and its sphere",
      },
      3: {
        label: "The winners",
        tooltip: "(+) Who should reach their goal first, and who last",
      },
    },
    outro: "Mega Alakazam vanishes in a multicoloured flash.",
  },
  fr: {
    intro: "Un Méga-Alakazam flotte au-dessus du sol, entouré de cuillères aux couleurs de l'Archipel.",
    speaker: "Méga-Alakazam",
    introDialogue: "Je perçois les fils du destin qui relient tous les mondes...\nVeux-tu les voir ?",
    title: "Voir le destin",
    description:
      "Un Méga-Alakazam aux cuillères multicolores propose de lever le voile sur le destin du multiworld. Il ne répondra qu'à une seule question.",
    query: "Que veux-tu voir ?",
    option: {
      1: {
        label: "Un passe",
        tooltip: "(+) Où se trouve l'un de vos passes d'étage ou de biome",
      },
      2: {
        label: "Un objet clé",
        tooltip: "(+) Où se trouve un objet clé rare d'un autre joueur, et sa sphère",
      },
      3: {
        label: "Les vainqueurs",
        tooltip: "(+) Qui devrait atteindre son objectif en premier, et en dernier",
      },
    },
    outro: "Méga-Alakazam disparaît dans un éclair multicolore.",
  },
};

/** Registers the texts of the encounter (French for French, English for the other languages) */
export function registerFateTexts(): void {
  i18next.addResourceBundle("en", namespace, FATE_TEXTS.en, true, true);
  i18next.addResourceBundle("fr", namespace, FATE_TEXTS.fr, true, true);
  const language = i18next.resolvedLanguage ?? i18next.language;
  if (language && !language.startsWith("en") && !language.startsWith("fr")) {
    i18next.addResourceBundle(language, namespace, FATE_TEXTS.en, true, true);
  }
}

/** Shows the hint of the chosen option, then the encounter ends without a battle */
async function showFate(text: string): Promise<void> {
  await showEncounterText(text);
  leaveEncounterWithoutBattle();
}

export const ArchipelagoFateEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ARCHIPELAGO_FATE,
)
  .withEncounterTier(MysteryEncounterTier.ROGUE)
  .withIntroSpriteConfigs([
    {
      spriteKey: AP_FATE_SPRITE_KEY,
      fileRoot: "",
      hasShadow: true,
      x: 4,
      y: 4,
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
    registerFateTexts();
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
    },
    () => showFate(archipelago.takeFatePassHint()),
  )
  .withSimpleOption(
    {
      buttonLabel: `${namespace}:option.2.label`,
      buttonTooltip: `${namespace}:option.2.tooltip`,
    },
    () => showFate(archipelago.takeFateSphereHint()),
  )
  .withSimpleOption(
    {
      buttonLabel: `${namespace}:option.3.label`,
      buttonTooltip: `${namespace}:option.3.tooltip`,
    },
    () => showFate(archipelago.getFateGoalText()),
  )
  .withOutroDialogue([
    {
      text: `${namespace}:outro`,
    },
  ])
  .build();
