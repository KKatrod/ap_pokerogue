import i18next from "i18next";

/**
 * Small local string table for the Archipelago mode (French / English).
 * Kept outside the i18next namespaces to avoid touching every locale folder.
 */
const messages = {
  en: {
    modeName: "Archipelago",
    connectTitle: "Archipelago",
    server: "Server",
    slot: "Slot",
    password: "Password",
    connect: "Connect",
    cancel: "Cancel",
    connecting: "Connecting to Archipelago...",
    connected: "Connected to Archipelago as {{slot}}!",
    disconnected: "Archipelago connection lost. Reconnecting...",
    emptyServer: "Please enter the server address",
    emptySlot: "Please enter your slot name",
    wrongSeed: "This save belongs to another Archipelago seed ({{seed}}).",
    needConnection: "This run is an Archipelago run. Connect to its server to continue.",
    noStarters: "You have not received any Pokemon yet! Wait for the multiworld to send you one.",
    gateLocked:
      "The path beyond floor {{wave}} is sealed.\nWaiting for a Progressive Floor Pass ({{have}}/{{need}})...",
    gateUnlocked: "A Floor Pass was received! The path beyond floor {{wave}} is open.",
    received: "Received {{item}} from {{player}}!",
    receivedOwn: "Found your own {{item}}!",
    chooseTarget: "Choose a Pokemon to receive {{item}}.",
    pokemonUnlocked: "{{pokemon}} can now be used as a starter!",
    floorPassReceived: "Floor Pass received! You may now go up to floor {{wave}}.",
    shopItemName: "{{item}} ({{player}})",
    shopItemUnknown: "Archipelago Item",
    shopItemDesc: "An Archipelago item for {{player}}: {{item}}.",
    shopItemDescUnknown: "An item from the Archipelago multiworld.",
    shopItemBought: "Sent {{item}} to {{player}}!",
    shopItemSold: "SOLD",
    eggReceived: "The egg was added to your Archipelago egg list. It hatches during Archipelago runs.",
    eggListFull: "Your Archipelago egg list is full: the egg was lost.",
    goalComplete: "Archipelago goal complete!",
    itemConvertedToMoney: "You cannot hold more {{item}}: it was converted into money.",
    eventNoEffect: "But nothing happened!",
    trapMoney: "You lost ₽{{money}}!",
    trapItemDrop: "{{pokemon}} dropped its {{item}}!",
    deathLinkReceived: "DeathLink from {{player}}!",
    deathLinkReceivedCause: "DeathLink from {{player}}: {{cause}}",
  },
  fr: {
    modeName: "Archipelago",
    connectTitle: "Archipelago",
    server: "Serveur",
    slot: "Slot",
    password: "Mot de passe",
    connect: "Connexion",
    cancel: "Annuler",
    connecting: "Connexion à Archipelago...",
    connected: "Connecté à Archipelago en tant que {{slot}} !",
    disconnected: "Connexion à Archipelago perdue. Reconnexion...",
    emptyServer: "Veuillez saisir l'adresse du serveur",
    emptySlot: "Veuillez saisir le nom du slot",
    wrongSeed: "Cette sauvegarde appartient à une autre seed Archipelago ({{seed}}).",
    needConnection: "Cette partie est une partie Archipelago. Connectez-vous à son serveur pour continuer.",
    noStarters: "Vous n'avez encore reçu aucun Pokémon ! Attendez que le multiworld vous en envoie un.",
    gateLocked:
      "Le passage au-delà de l'étage {{wave}} est scellé.\nEn attente d'un Passe d'étage ({{have}}/{{need}})...",
    gateUnlocked: "Passe d'étage reçu ! Le passage au-delà de l'étage {{wave}} est ouvert.",
    received: "{{player}} vous envoie : {{item}} !",
    receivedOwn: "Vous trouvez votre propre objet : {{item}} !",
    chooseTarget: "Choisissez le Pokémon qui recevra : {{item}}.",
    pokemonUnlocked: "{{pokemon}} peut maintenant être choisi comme starter !",
    floorPassReceived: "Passe d'étage reçu ! Vous pouvez monter jusqu'à l'étage {{wave}}.",
    shopItemName: "{{item}} ({{player}})",
    shopItemUnknown: "Objet Archipelago",
    shopItemDesc: "Un objet Archipelago pour {{player}} : {{item}}.",
    shopItemDescUnknown: "Un objet du multiworld Archipelago.",
    shopItemBought: "{{item}} envoyé à {{player}} !",
    shopItemSold: "VENDU",
    eggReceived: "L'œuf a été ajouté à vos œufs Archipelago. Il éclora pendant les parties Archipelago.",
    eggListFull: "Votre liste d'œufs Archipelago est pleine : l'œuf est perdu.",
    goalComplete: "Objectif Archipelago accompli !",
    itemConvertedToMoney: "Vous ne pouvez pas avoir plus de {{item}} : l'objet est converti en argent.",
    eventNoEffect: "Mais rien ne se passe !",
    trapMoney: "Vous perdez {{money}} ₽ !",
    trapItemDrop: "{{pokemon}} lâche son objet : {{item}} !",
    deathLinkReceived: "DeathLink de {{player}} !",
    deathLinkReceivedCause: "DeathLink de {{player}} : {{cause}}",
  },
};

export type ApMessageKey = keyof typeof messages.en;

export function apText(key: ApMessageKey, params: Record<string, string | number> = {}): string {
  const lang = (i18next.resolvedLanguage || i18next.language || "en").toLowerCase().startsWith("fr") ? "fr" : "en";
  let text: string = messages[lang][key] ?? messages.en[key];
  for (const [name, value] of Object.entries(params)) {
    text = text.split(`{{${name}}}`).join(String(value));
  }
  return text;
}
