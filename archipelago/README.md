# PokeRogue × Archipelago

Mode de jeu **Archipelago** (multiworld randomizer) pour PokeRogue **1.12** (version publique `main`). Il apparaît dans *Nouvelle partie → Archipelago*.

Techniquement, une partie Archipelago est une partie **Classique** (mêmes 200 étages, Mystery Encounters, dresseurs…) portant le drapeau `gameMode.isArchipelago` : elle hérite automatiquement de tout le comportement Classique et des futures mises à jour.

## Lancer le jeu (développement)

PokeRogue 1.12 demande Node.js ≥ 24.9 et pnpm 10 :

```bash
git submodule update --init --depth 1
```

```bash
pnpm install
```

```bash
pnpm start:dev
```

## Fonctionnement

| Élément | Règle |
|---|---|
| **Déblocages séparés** | En mode Archipelago, le Pokédex et les données de starters sont ceux d'un **profil AP** (un par seed + slot), stocké dans `localStorage` (`ap_profile_<seed>_<slot>`). Le Pokédex Classique n'est ni lu ni modifié. Les captures en run ne débloquent pas de starter : seuls les objets AP le font. |
| **Locations envoyées** | Selon `location_mode` : chaque étage terminé (1 à 199) → `Floor N Cleared` (`floors`), et/ou chaque étage de chaque biome → `<Biome> - Floor 1` à `<Biome> - Floor 10` (`biome_floors`, ou `both` pour les deux). Chaque objet AP acheté en boutique → `Shop Item N`. Battre l'étage 200 → objectif (`CLIENT_GOAL`). |
| **Logique des biomes** | Un biome compte à partir du premier bloc de 10 étages où il est atteignable depuis la Ville en suivant les liens du jeu (liens pondérés inclus) : Ville = étages 1-10 (0 passe), Plaine = 11-20 (1 passe), Métropole/Lac/Prairie = 21-30 (2 passes)… La Fin n'est atteinte qu'aux étages 191-199 (19 passes) ; son 10e étage est le boss final (objectif). 34 biomes atteignables × 10 + 9 = 349 locations. |
| **Passe d'étage** | `Progressive Floor Pass` (×19). Pour dépasser l'étage 10·k il faut k passes. Sans passe, le jeu attend sur un écran « Étage verrouillé » jusqu'à réception. |
| **Pokémon** | `Pokemon - <Nom>` débloque ce starter dans le profil AP (tous les starters de PokeRogue, dont Pikachu). N starters de départ sont donnés en inventaire initial : aucun au-dessus de `starting_pokemon_max_cost`, et au moins un de coût ≥ 5. |
| **Consommables** (potions, rappels, éthers, Super Bonbons, Poké Balls, Parfums, pépites…) | Proposés **une seule fois**, entre deux étages. Si l'objet cible un Pokémon, l'écran d'équipe s'ouvre ; refuser ou ne pas pouvoir l'utiliser le fait perdre. |
| **Objets tenus** (Restes, Œuf Chance, Vive Griffe…) | Proposés une seule fois, sur le Pokémon choisi. |
| **Œufs** (fillers : Common/Rare/Epic/Legendary Egg, Mystery Egg = palier tiré comme au gacha) | Ajoutés aux **œufs du profil Archipelago** (max. 99) ; ils éclosent pendant les parties AP et débloquent le Pokémon dans le profil AP. Les œufs Classiques ne sont pas touchés. |
| **Carte** | Donnée au début de chaque partie AP (option `start_with_map`, activée par défaut). |
| **Objets bonus** (Multi Exp, Charmes, Pièce Rune, Bracelet Méga…) | **Permanents** : redonnés au début de chaque nouvelle run AP. `bonus_item_copies` copies de chacun dans le pool, jamais plus que le maximum du jeu (5 Multi Exp, 4 Charmes Chroma, 1 Bracelet Méga…). |
| **Objet au maximum** | Un objet bonus déjà au maximum, ou un objet tenu qu'aucun Pokémon de l'équipe ne peut porter en plus, est **converti en argent** (comme une Pépite). En début de run, l'excédent est simplement ignoré. |
| **Effets de combat** (fillers : `Stat Boost`, `Reflect`, `Light Screen`, `Safeguard`, `Mist`) | Appliqués au Pokémon actif (ou à son côté du terrain, 5 tours) au **début du tour de combat suivant**. Proportion : `effect_filler_percent`. |
| **Pièges** (`trap_percent`) | `Money Loss Trap` (−25 % de l'argent), `Item Drop Trap` (le Pokémon actif lâche un objet tenu), `Poison/Paralysis/Burn/Sleep Trap`, `Confusion Trap`, `Stat Down Trap` (−1 dans une stat au hasard). Appliqués au début du tour suivant ; un effet impossible (type immunisé, déjà empoisonné…) ne fait rien. |
| **DeathLink** (`death_link`) | Recevoir un DeathLink met K.O. le Pokémon actif au début du tour suivant (ignore Fermeté, Bandeau, Graine Miracle). Perdre la run (dernier Pokémon K.O.) envoie un DeathLink, sauf si c'est un DeathLink reçu qui a mis K.O. le dernier Pokémon. |
| **Boutique** | `shop_item_count` objets AP au total, débloqués par lots de `shop_items_per_tier` chaque fois que la boutique de base s'enrichit (étages 1, 21, 51, 81, 111, 141, 171 ; 0 = tous dès l'étage 1), `shop_items_per_visit` maximum par boutique, prix = `shop_cost_percent` % de l'argent d'une vague. L'objet affiche le nom et le destinataire (scout). |

Pendant une partie Archipelago, ce sont les œufs du profil AP qui progressent ; les œufs Classiques restent en pause.

## Côté joueur

1. *Nouvelle partie → Archipelago*, saisir `serveur:port` (ex. `archipelago.gg:38281`), le nom du slot et le mot de passe éventuel.
2. Choisir ses starters parmi ceux reçus, puis jouer normalement.
3. Pour reprendre une partie AP sauvegardée, le jeu redemande la connexion et vérifie que la seed correspond.

La connexion se reconnecte automatiquement ; les locations faites hors-ligne sont renvoyées à la reconnexion.

## Côté serveur : l'apworld

`archipelago/apworld/pokerogue/` est le monde Archipelago (Python). Pour l'utiliser : zipper le dossier `pokerogue` en `pokerogue.apworld` et le placer dans `custom_worlds/` (ou `lib/worlds/`) d'Archipelago.

Options YAML : `location_mode` (floors / biome_floors / both, floors), `shop_item_count` (0–150, 30), `shop_items_per_tier` (0–150, 10), `shop_items_per_visit` (1–3, 1), `shop_cost_percent` (10–500, 100), `starting_pokemon` (1–10, 3), `starting_pokemon_max_cost` (1–10, 6), `start_with_map` (true/false, true), `pokemon_in_pool` (0–300, 40), `bonus_item_copies` (1–5, 1), `egg_filler_percent` (0–100, 25), `effect_filler_percent` (0–100, 10), `trap_percent` (0–100, 0), `death_link` (true/false, false).

Les fillers sont tirés dans cet ordre : piège (`trap_percent` %), puis effet de combat (`effect_filler_percent` %), puis œuf (`egg_filler_percent` %), sinon consommable.

```yaml
game: PokeRogue
name: Joueur
PokeRogue:
  location_mode: biome_floors
  shop_item_count: 30
  shop_items_per_tier: 10
  shop_items_per_visit: 1
  starting_pokemon: 3
  starting_pokemon_max_cost: 6
  start_with_map: true
  pokemon_in_pool: 40
  bonus_item_copies: 1
  egg_filler_percent: 25
  effect_filler_percent: 10
  trap_percent: 10
  death_link: false
```

Les anciennes seeds (sans `location_mode` ni `shop_items_per_tier` dans le slot data) restent jouables : étages seuls et tous les objets de boutique disponibles dès le départ.

## Données partagées

`src/archipelago/ap-data.json` est la source unique des objets/IDs ; la liste des Pokémon vient des données du jeu (`starterCost` dans `src/data/balance/species/`). Après une modification ou une mise à jour du jeu, régénérer la table Python puis re-zipper l'apworld :

```bash
node archipelago/generate-apworld-data.mjs
```

## Test local sans multiworld

```bash
node archipelago/mock-server.mjs
```

puis se connecter à `localhost:38281` (n'importe quel nom de slot). Le faux serveur donne Bulbizarre, Salamèche, Carapuce, un Charme Exp. et une Potion, et envoie un Passe d'étage à chaque étage multiple de 5 terminé.

Variables d'environnement : `PASS_EVERY` (passe tous les N étages, 0 = jamais), `LOCATION_MODE` (0/1/2, défaut 2), `SHOP_PER_TIER` (défaut 2), `DEATHLINK_AT` (étage après lequel un DeathLink est reçu, 0 = DeathLink désactivé), `ITEMS_AT` (objets envoyés après un étage, ex. `1:TRAP_POISON,EFFECT_STAT_UP;3:MAP,MAP`). En mode biome, seuls les étages de la Ville déclenchent ces envois.

## Fichiers

- `src/archipelago/ap-client.ts` – client du protocole réseau Archipelago (WebSocket).
- `src/archipelago/archipelago.ts` – gestionnaire : profil, objets reçus, locations, boutique.
- `src/archipelago/ap-phases.ts` – phases « attente de passe » et « réception d'objets ».
- `src/archipelago/ap-hooks.ts` – points d'accroche sans dépendance (évite les imports circulaires).
- `src/archipelago/ap-icon.ts` – icône des objets AP (embarquée, enregistrée comme texture `ap_item`).
- `src/ui/handlers/archipelago-connect-ui-handler.ts` – formulaire de connexion.
- Modifiés (points d'accroche) : `game-mode.ts`, `phase-manager.ts`, `phases/title-phase.ts`, `phases/select-starter-phase.ts`, `phases/new-battle-phase.ts`, `phases/game-over-phase.ts`, `phases/egg-lapse-phase.ts`, `system/game-data.ts`, `@types/save-data.ts`, `modifier/modifier-type.ts`, `ui/ui.ts`, `enums/ui-mode.ts`, `ui/handlers/form-modal-ui-handler.ts`, `ui/handlers/modifier-select-ui-handler.ts`.
