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
| **Locations envoyées** | Dès la victoire (avant l'écran de récompenses), pour qu'un objet trouvé à cet étage soit remis à la fin de cet étage. Selon `location_mode` : chaque étage terminé (1 à 199) → `Floor N Cleared` (`floors`), et/ou chaque étage de chaque biome → `<Biome> - Floor 1` à `<Biome> - Floor 10` (`biome_floors`, ou `both` pour les deux). Chaque objet AP acheté en boutique → `Shop Item N`. Battre l'étage 200 → objectif (`CLIENT_GOAL`). |
| **Logique des biomes** | Un biome compte à partir du premier bloc de 10 étages où il est atteignable depuis la Ville en suivant les liens du jeu (liens pondérés inclus) : Ville = étages 1-10 (0 passe), Plaine = 11-20 (1 passe), Métropole/Lac/Prairie = 21-30 (2 passes)… La Fin n'est atteinte qu'aux étages 191-199 (19 passes) ; son 10e étage est le boss final (objectif). 34 biomes atteignables × 10 + 9 = 349 locations. |
| **Passe d'étage** | `Progressive Floor Pass` (×19). Pour dépasser l'étage 10·k il faut k passes. Sans passe, le jeu attend sur un écran « Étage verrouillé » jusqu'à réception ; le menu (Échap) reste accessible, par exemple pour *Sauver & quitter* et relancer une partie. |
| **Pass de biome** (`biome_passes`) | `Biome Pass - <Biome>` (×33 : tous les biomes sauf la Ville et la Fin). Un biome ne peut être choisi comme destination qu'avec son pass, en plus des passes d'étage. Si aucun des biomes suivants n'est débloqué, le joueur retourne à la **Ville** (message « Aucun des biomes suivants n'est débloqué : retour à la Ville. »). Avec la **Carte**, la Ville est toujours proposée en plus des biomes débloqués ; sans Carte, le biome est tiré parmi les biomes débloqués. Logique : un étage de biome est en logique s'il existe un chemin Ville → … → biome de longueur ≤ nombre de passes d'étage dont chaque biome est débloqué. Les pass sont `progression` en mode `biome_floors`/`both`, `useful` en mode `floors` (aucune location n'en dépend). |
| **Pokémon** | `Pokemon - <Nom>` débloque ce starter dans le profil AP (tous les starters de PokeRogue, dont Pikachu). `starting_pokemon` starters de départ (5 par défaut, `random` accepté) sont donnés en inventaire initial : aucun au-dessus de `starting_pokemon_max_cost`, au moins un de coût ≥ 5, un **coût moyen entre 3 et 3,5** dès 2 starters, et **aucun type n'apparaît deux fois** parmi eux (avec Monotype, seul l'autre type compte ; si les challenges laissent trop peu de Pokémon, les derniers peuvent partager un type). Avec Monogénération / Monotype, starters de départ et Pokémon du pool sont pris parmi les Pokémon autorisés. |
| **Limite d'équipe** | `Starter Limit +1` (`useful`, `starter_limit_items` exemplaires, 20 par défaut) : chaque exemplaire reçu augmente de 1 les points de starters de l'équipe (10 au départ, 30 au maximum). Visible dans l'écran de sélection (« 0/13 »). |
| **Challenges** | Les options du mode Challenge de PokeRogue s'appliquent à toutes les parties AP (sans passer en mode Challenge) : Monogénération, Monotype, Désert Médical, Capture Limitée, Zéro Résurrection, Capacités/Talents randomisés, Combat Inversé, Stats Inversées, Passifs Actifs. Valeurs par défaut = partie normale. « Nouveau Départ » n'est pas proposé (le profil AP part déjà de zéro) et est ignoré s'il est envoyé. Avec Désert Médical `no_shop` ou `both`, il n'y a plus de boutique : `shop_item_count` est ramené à 0. |
| **Consommables** (potions, rappels, éthers, Parfums…) | Proposés **une seule fois**, entre deux étages. Si l'objet cible un Pokémon, l'écran d'équipe s'ouvre ; refuser ou ne pas pouvoir l'utiliser le fait perdre. |
| **Objets tenus** (Restes, Œuf Chance…) | Proposés une seule fois, sur le Pokémon choisi. |
| **Œufs** (fillers : Common/Rare/Epic/Legendary Egg, Mystery Egg = palier tiré comme au gacha) | Ajoutés aux **œufs du profil Archipelago** (max. 99) ; ils éclosent pendant les parties AP et débloquent le Pokémon dans le profil AP. Les œufs Classiques ne sont pas touchés. |
| **Carte** | Donnée au début de chaque partie AP (option `start_with_map`, activée par défaut). |
| **Objets conservés** | Redonnés à **chaque nouvelle partie** de la session, au 1er tour de l'étage 1 : tous les objets bonus (Multi Exp, Charmes, Bonbonnière, Bracelet Méga, Poignet Dynamax, Capsule Scellée, Pièce Rune…) et les objets marqués `persistent` dans `ap-data.json` : Poké/Super/Hyper/Rogue/Master Ball, Pépite, Maxi Pépite, Vieux Ducat, Super Bonbon, les objets tenus de rang Ultra, Rogue et Master (Vive Griffe, Résugraine, Loupe, Restes, Grelot Coque, Lentilscope, Roche Royale, Bandeau, Accro Griffe, Témoin, Rosée Âme, Œuf Chance, Lentille Multi, Œuf d’Or) et le Pointeau ADN. Ceux qui ne ciblent pas de Pokémon sont donnés d'un coup avec un seul message ; les autres ouvrent l'écran d'équipe. Le **Pointeau ADN** est placé une seule fois dans le pool ; s'il a été reçu (une ou plusieurs fois), un seul est proposé par partie, à la fin de l'étage 1 (pas de fusion en plein combat). Il faut au moins deux Pokémon dans l'équipe. `bonus_item_copies` copies de chaque objet bonus dans le pool, jamais plus que le maximum du jeu. |
| **Objet au maximum** | Un objet bonus déjà au maximum, ou un objet tenu qu'aucun Pokémon de l'équipe ne peut porter en plus, est **converti en argent** (comme une Pépite). En début de run, l'excédent est simplement ignoré. |
| **Effets de combat** (fillers : `Stat Boost`, `Reflect`, `Light Screen`, `Safeguard`, `Mist`) | Appliqués au Pokémon actif (ou à son côté du terrain, 5 tours) au **début du tour de combat suivant**. Proportion : `effect_filler_percent`. |
| **Pièges** (`trap_percent`) | `Money Loss Trap` (−25 % de l'argent), `Item Drop Trap` (le Pokémon actif lâche un objet tenu), `Poison/Paralysis/Burn/Sleep Trap`, `Confusion Trap`, `Stat Down Trap` (−1 dans une stat au hasard). Appliqués au début du tour suivant ; un effet impossible (type immunisé, déjà empoisonné…) ne fait rien. |
| **DeathLink** (`death_link`) | Recevoir un DeathLink met K.O. le Pokémon actif au début du tour suivant (ignore Fermeté, Bandeau, Graine Miracle). Perdre la run (dernier Pokémon K.O.) envoie un DeathLink, sauf si c'est un DeathLink reçu qui a mis K.O. le dernier Pokémon. |
| **Indices** (`trainer_hints`) | Les dresseurs clés (rival, Champions d'Arène, Conseil 4, Maître, boss et admins des teams) donnent, une fois battus, un indice sur un objet de progression d'un autre joueur caché dans PokeRogue : « On raconte que [objet] ([joueur]) se trouve à l'étage X de la zone [biome] » (étage seul en mode `floors`), ou « … serait vendu au-delà de l'étage N » pour la boutique (premier étage du palier qui débloque l'objet). L'indice apparaît aussi dans la liste des hints du multiworld. Chaque location n'est révélée qu'une fois ; s'il n'y a plus d'objet de progression d'autres joueurs, les propres objets de progression (passes) sont indiqués. |
| **Boutique** | `shop_item_count` objets AP au total, débloqués par lots de `shop_items_per_tier` chaque fois que la boutique de base s'enrichit (étages 1, 21, 51, 81, 111, 141, 171 ; 0 = tous dès l'étage 1), `shop_items_per_visit` maximum par boutique (les objets achetés le restent d'une run à l'autre : en logique, tous les objets d'un lot sont achetables dès le premier étage de leur palier, quitte à faire plusieurs runs), prix = `shop_cost_percent` % de l'argent d'une vague. L'objet affiche le nom et le destinataire (scout). Le nom est coloré comme dans les clients multiworld : doré = progression, bleu = utile, rouge = piège, gris = filler. |

Pendant une partie Archipelago, ce sont les œufs du profil AP qui progressent ; les œufs Classiques restent en pause.

## Côté joueur

1. *Nouvelle partie → Archipelago*, saisir `serveur:port` (ex. `archipelago.gg:38281`), le nom du slot et le mot de passe éventuel.
2. Choisir ses starters parmi ceux reçus, puis jouer normalement.
3. Pour reprendre une partie AP sauvegardée, le jeu redemande la connexion et vérifie que la seed correspond.

La connexion se reconnecte automatiquement ; les locations faites hors-ligne sont renvoyées à la reconnexion.

## Côté serveur : l'apworld

`archipelago/apworld/pokerogue/` est le monde Archipelago (Python). Pour l'utiliser : zipper le dossier `pokerogue` en `pokerogue.apworld` et le placer dans `custom_worlds/` (ou `lib/worlds/`) d'Archipelago. Après chaque nouvelle version, **fermer puis relancer le Launcher** avant de régénérer le template YAML (*Generate Template Options*) : un Launcher déjà ouvert garde l'ancienne version en mémoire et produit un template sans les nouvelles options.

Options YAML : `location_mode` (floors / biome_floors / both, floors), `shop_item_count` (0–350, 70), `shop_items_per_tier` (0–50, 10), `shop_items_per_visit` (1–3, 1), `shop_cost_percent` (10–500, 100), `starting_pokemon` (1–10 ou `random`, 5), `starting_pokemon_max_cost` (1–10, 6), `start_with_map` (true/false, true), `pokemon_in_pool` (0 à 572 = tous les starters de PokeRogue, 40), `bonus_item_copies` (1–5, 1), `egg_filler_percent` (0–100, 25), `effect_filler_percent` (0–100, 10), `trap_percent` (0–100, 0), `death_link` (true/false, false), `trainer_hints` (true/false, true), `biome_passes` (true/false, false), `starter_limit_items` (0–20, 20).

Challenges (défaut : désactivé) : `mono_generation` (off / gen_1 … gen_9), `mono_type` (off / normal, fighting, flying, poison, ground, rock, bug, ghost, steel, fire, water, grass, electric, psychic, ice, dragon, dark, fairy), `limited_support` (off / no_heal / no_shop / both), `limited_catch` (true/false), `hardcore` (true/false), `moveset_randomizer` (off / on / lite), `ability_randomizer` (off / abilities / all / lite), `inverse_battle` (true/false), `flip_stat` (true/false), `active_passives` (off / trainers / all). Ils sont envoyés dans le slot data (`challenges`, par nom de l'enum `Challenges` du jeu).

Classification des objets : `progression` = passes d'étage (et pass de biome si des locations de biome existent) ; `useful` = starters, `Starter Limit +1`, Pointeau ADN et objets bonus permanents à faible limite (5 ou moins : Multi Exp, Bracelet Méga, Poignet Dynamax, Orbe Téracristal, Charmes…) ; `trap` = pièges ; tout le reste (consommables, objets tenus, œufs, effets, Charmes Exp. à grande limite, Bonbonnière) = `filler`.

Les fillers sont tirés dans cet ordre : piège (`trap_percent` %), puis effet de combat (`effect_filler_percent` %), puis œuf (`egg_filler_percent` %), sinon consommable.

```yaml
game: PokeRogue
name: Joueur
PokeRogue:
  location_mode: biome_floors
  shop_item_count: 70
  shop_items_per_tier: 10
  shop_items_per_visit: 1
  starting_pokemon: 5
  starting_pokemon_max_cost: 6
  start_with_map: true
  pokemon_in_pool: 40
  bonus_item_copies: 1
  egg_filler_percent: 25
  effect_filler_percent: 10
  trap_percent: 10
  death_link: false
  trainer_hints: true
  biome_passes: false
  starter_limit_items: 20
  mono_generation: off
  mono_type: off
  limited_support: off
  limited_catch: false
  hardcore: false
  moveset_randomizer: off
  ability_randomizer: off
  inverse_battle: false
  flip_stat: false
  active_passives: off
```

Les anciennes seeds (sans `location_mode` ni `shop_items_per_tier` dans le slot data) restent jouables : étages seuls et tous les objets de boutique disponibles dès le départ.

## Données partagées

`src/archipelago/ap-data.json` est la source unique des objets/IDs ; la liste des Pokémon vient des données du jeu (`starterCost` dans `src/data/balance/species/`). Après une modification ou une mise à jour du jeu, régénérer la table Python puis re-zipper l'apworld :

```bash
node archipelago/generate-apworld-data.mjs
```

Le générateur extrait aussi la génération et les types (forme de base) de chaque starter (`POKEMON_INFO`), utilisés pour les types distincts et les challenges Monogénération / Monotype. Les pass de biome ont l'ID `base_id + biome_pass_offset (700) + id du biome`.

## Fichiers

- `src/archipelago/ap-client.ts` – client du protocole réseau Archipelago (WebSocket).
- `src/archipelago/archipelago.ts` – gestionnaire : profil, objets reçus, locations, boutique.
- `src/archipelago/ap-phases.ts` – phases « attente de passe » et « réception d'objets ».
- `src/archipelago/ap-hooks.ts` – points d'accroche sans dépendance (évite les imports circulaires).
- `src/archipelago/ap-icon.ts` – icône des objets AP (embarquée, enregistrée comme texture `ap_item`).
- `src/ui/handlers/archipelago-connect-ui-handler.ts` – formulaire de connexion.
- Modifiés (points d'accroche) : `game-mode.ts`, `ui-inputs.ts`, `phases/battle-end-phase.ts`, `phases/turn-init-phase.ts`, `phase-manager.ts`, `phases/title-phase.ts`, `phases/select-starter-phase.ts`, `phases/new-battle-phase.ts`, `phases/game-over-phase.ts`, `phases/trainer-victory-phase.ts`, `phases/egg-lapse-phase.ts`, `phases/select-biome-phase.ts`, `phases/switch-biome-phase.ts`, `ui/utils/starter-select-ui-utils.ts`, `system/game-data.ts`, `@types/save-data.ts`, `modifier/modifier-type.ts`, `ui/ui.ts`, `enums/ui-mode.ts`, `ui/handlers/form-modal-ui-handler.ts`, `ui/handlers/modifier-select-ui-handler.ts`.
