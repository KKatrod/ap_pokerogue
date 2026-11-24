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
| **Locations envoyées** | Dès la victoire (avant l'écran de récompenses), pour qu'un objet trouvé à cet étage soit remis à la fin de cet étage. Selon `location_mode` : chaque étage terminé (1 à 199) → `Floor N Cleared` (`floors`), et/ou chaque étage de chaque biome → `<Biome> - Floor 1` à `<Biome> - Floor 10` (`biome_floors`, ou `both` pour les deux). Chaque objet AP acheté en boutique → `Shop Item N`. Battre l'étage 200 → objectif (`CLIENT_GOAL`), ou tous les Pokémon de la Dexsanity avec `goal: pokedex`. Chaque check d'étage, de biome ou de Dexsanity affiche un **panneau latéral** (sous l'argent, à droite) avec les objets envoyés et leurs destinataires ; il disparaît seul, sans boîte de dialogue. |
| **Logique des biomes** | Un biome compte à partir du premier bloc de 10 étages où il est atteignable depuis la Ville en suivant les liens du jeu (liens pondérés inclus) : Ville = étages 1-10 (0 passe), Plaine = 11-20 (1 passe), Métropole/Lac/Prairie = 21-30 (2 passes)… La Fin n'est atteinte qu'aux étages 191-199 (19 passes) ; son 10e étage est le boss final (objectif). 34 biomes atteignables × 10 + 9 = 349 locations. |
| **Passe d'étage** | `Progressive Floor Pass` (×19). Pour dépasser l'étage 10·k il faut k passes. Sans passe, le jeu attend sur un écran « Étage verrouillé » jusqu'à réception ; le menu (Échap) reste accessible, par exemple pour *Sauver & quitter* et relancer une partie. |
| **Pass de biome** (`biome_passes`) | `Biome Pass - <Biome>` (×33 : tous les biomes sauf la Ville et la Fin). Un biome ne peut être choisi comme destination qu'avec son pass, en plus des passes d'étage. Si aucun des biomes suivants n'est débloqué, le joueur retourne à la **Ville** (message « Aucun des biomes suivants n'est débloqué : retour à la Ville. »). Avec la **Carte**, la Ville est toujours proposée en plus des biomes débloqués ; sans Carte, le biome est tiré parmi les biomes débloqués. Logique : un étage de biome est en logique s'il existe un chemin Ville → … → biome de longueur ≤ nombre de passes d'étage dont chaque biome est débloqué. Les pass sont `progression` en mode `biome_floors`/`both` ou avec la Dexsanity, `useful` sinon (aucune location n'en dépend). Avec `biome_passes: end_only`, un seul pass, `Biome Pass - End` (`progression`), est nécessaire pour entrer dans la Fin (les 10 derniers étages), en plus de tous les passes d'étage : sans lui, le jeu attend à l'étage 190 (90 en Blitz) ; les autres biomes sont libres. |
| **Dexsanity** (`dexsanity`, `dexsanity_exclude`) | `starters` : un check `Dex - <Pokémon>` par starter (sauf les starters de départ), envoyé en obtenant n'importe quel Pokémon de sa lignée (capture, éclosion, don d'un événement). `all` : un check par espèce (évolutions et formes régionales comprises), envoyé aussi en faisant évoluer un Pokémon. La liste respecte Monogénération / Monotype ; `dexsanity_exclude` retire des Pokémon par nom, et `Legendaries` retire tous les légendaires, fabuleux et sous-légendaires. Le **premier étage de chaque bloc de 10** (11, 21…) propose toujours un Pokémon sauvage du biome pas encore obtenu (s'il en reste), et le premier étage de la Fin n'importe quel Pokémon de la liste pas encore obtenu. Logique : un Pokémon est en logique dès qu'un biome où lui (ou sa lignée, ou une pré-évolution avec `all`) apparaît est atteignable, ou que la Fin l'est. `goal: pokedex` (qui demande la Dexsanity) fait de l'obtention de tous ces Pokémon l'objectif. |
| **Pokémon** | `Pokemon - <Nom>` débloque ce starter dans le profil AP (tous les starters de PokeRogue, dont Pikachu). `starting_pokemon` starters de départ (5 par défaut, `random` accepté) sont donnés en inventaire initial : aucun au-dessus de `starting_pokemon_max_cost`, au moins un de coût ≥ 5, un **coût moyen entre 3 et 3,5** dès 2 starters, et **aucun type n'apparaît deux fois** parmi eux (avec Monotype, seul l'autre type compte ; si les challenges laissent trop peu de Pokémon, les derniers peuvent partager un type). Avec Monogénération / Monotype, starters de départ et Pokémon du pool sont pris parmi les Pokémon autorisés. |
| **Limite d'équipe** | `Starter Limit +1` (`useful`, `starter_limit_items` exemplaires, 20 par défaut) : chaque exemplaire reçu augmente de 1 les points de starters de l'équipe (10 au départ, 30 au maximum). Visible dans l'écran de sélection (« 0/13 »). |
| **Challenges** | Les options du mode Challenge de PokeRogue s'appliquent à toutes les parties AP (sans passer en mode Challenge) : Monogénération, Monotype, Désert Médical, Capture Limitée, Zéro Résurrection, Capacités/Talents randomisés, Combat Inversé, Stats Inversées, Passifs Actifs. Valeurs par défaut = partie normale. « Nouveau Départ » n'est pas proposé (le profil AP part déjà de zéro) et est ignoré s'il est envoyé. Avec Désert Médical `no_shop` ou `both`, il n'y a plus de boutique : `shop_item_count` est ramené à 0. |
| **Consommables** (potions, rappels, éthers, Parfums…) | Proposés **une seule fois**, entre deux étages. Si l'objet cible un Pokémon, l'écran d'équipe s'ouvre ; refuser ou ne pas pouvoir l'utiliser le fait perdre. |
| **Objets tenus** (Restes, Œuf Chance…) | Proposés une seule fois, sur le Pokémon choisi. |
| **Œufs** (fillers : Common/Rare/Epic/Legendary Egg, Mystery Egg = palier tiré comme au gacha) | Ajoutés aux **œufs du profil Archipelago** (max. 99) ; ils éclosent pendant les parties AP et débloquent le Pokémon dans le profil AP. Les œufs Classiques ne sont pas touchés. |
| **Carte** | Donnée au début de chaque partie AP (option `start_with_map`, activée par défaut). |
| **Ticket Vol** (`Fly Ticket`, `useful`, 1 exemplaire) | Avec la Carte, au changement de biome (après un étage multiple de 10), les biomes déjà visités s'ajoutent aux destinations proposées. Un biome est visité dès que son 10ᵉ étage a été franchi au moins une fois, dans n'importe quelle run (mémorisé dans le profil AP). Ni le biome actuel ni la Fin ne sont proposés ; avec `biome_passes: true`, seulement les biomes débloqués. Il ne change pas la logique : un biome visité était déjà atteignable. |
| **Objets conservés** | Redonnés à **chaque nouvelle partie** de la session, au 1er tour de l'étage 1 : tous les objets bonus (Multi Exp, Charmes, Bonbonnière, Bracelet Méga, Poignet Dynamax, Capsule Scellée, Pièce Rune…) et les objets marqués `persistent` dans `ap-data.json` : Poké/Super/Hyper/Rogue/Master Ball, Pépite, Maxi Pépite, Vieux Ducat, Super Bonbon, les objets tenus de rang Ultra, Rogue et Master (Vive Griffe, Résugraine, Loupe, Restes, Grelot Coque, Lentilscope, Roche Royale, Bandeau, Accro Griffe, Témoin, Rosée Âme, Œuf Chance, Lentille Multi, Œuf d’Or) et le Pointeau ADN. Ceux qui ne ciblent pas de Pokémon sont donnés d'un coup avec un seul message ; les autres ouvrent l'écran d'équipe. Le **Pointeau ADN** est placé une seule fois dans le pool ; s'il a été reçu (une ou plusieurs fois), un seul est proposé par partie, à l'étage 1, avant l'envoi du premier Pokémon (et avant la question « Changer de Pokémon ? » en mode Choix ; pour une partie reprise à l'étage 1, à la fin de l'étage). Il faut au moins deux Pokémon dans l'équipe. `bonus_item_copies` copies de chaque objet bonus dans le pool, jamais plus que le maximum du jeu. |
| **Objet au maximum** | Un objet bonus déjà au maximum, ou un objet tenu qu'aucun Pokémon de l'équipe ne peut porter en plus, est **converti en argent** (comme une Pépite). En début de run, l'excédent est simplement ignoré. |
| **Soin inutile** | Un objet de soin dont aucun Pokémon n'a besoin est **converti en argent** (comme une Pépite) sans ouvrir l'écran d'équipe : potions et Guérison si tous les PV sont au maximum (et sans altération pour la Guérison), Rappels et Cendre Sacrée sans Pokémon K.O., Huiles et Élixirs si tous les PP sont pleins, Total Soin sans altération d'état ni confusion. |
| **Objet en cours d'utilisation** | Quand un objet AP ouvre l'écran d'équipe, une petite fenêtre en bas à gauche (sous le premier Pokémon) rappelle son nom et son icône. |
| **Effets de combat** (fillers, `effect_filler_percent`) | Appliqués au **début du tour de combat suivant**. Pokémon actif : `Stat Boost`, `Howl` (+1 Attaque), `Dragon Cheer` (taux de critique). Équipe : `Heal Bell` (soigne les altérations de toute l'équipe), `Life Dew` (25 % des PV), `Jungle Healing` (25 % des PV et altérations). Côté du joueur : `Reflect`, `Light Screen`, `Safeguard`, `Mist`, `Aurora Veil` (sans grêle), `Lucky Chant` (5 tours), `Tailwind` (4 tours), `Happy Hour` (argent doublé). Tout le terrain : `Haze`, `Rain Dance`, `Sunny Day`, `Sandstorm`, `Snowscape`, les 4 Champs (`Electric/Grassy/Misty/Psychic Terrain`), `Gravity`, `Trick Room`, `Mud Sport`, `Water Sport`. Ce sont les capacités de statut « tout le terrain » et « votre équipe/côté » de Bulbapedia, sauf celles qui n'ont pas de sens ici : protections d'un tour (Garde Large, Prévention, Tatamigaeshi, Vigilance), Plus/Minus seulement (Engrenage, Magné-Contrôle), Requiem (met K.O. son propre Pokémon), Thé Party, Floral Défense, Fertilisation, Change Côté, Électro-Lame, Verrou Enchanté, Abri Sombre/Contre Froid, Zone Magique et Zone Étrange (non implémentées dans le jeu) ; Aromathérapie et Lumi-Bénédiction ont le même effet que Glas de Soin et Soin Floral. |
| **Pièges** (`trap_percent`) | `Money Loss Trap` (−25 % de l'argent), `Item Drop Trap` (le Pokémon actif lâche un objet tenu), `Poison/Paralysis/Burn/Sleep Trap`, `Confusion Trap`, `Stat Down Trap` (−1 dans une stat au hasard), et les altérations volatiles : `Infatuation Trap`, `Encore Trap`, `Taunt Trap`, `Torment Trap`, `Disable Trap`, `Heal Block Trap`, `Yawn Trap`, `Leech Seed Trap`, `Curse Trap`, `Salt Cure Trap`, `Tar Shot Trap`, `Throat Chop Trap` (le Pokémon adverse en est la source). Appliqués au début du tour suivant ; un effet impossible (type immunisé, même genre pour l'Attraction, aucune capacité utilisée pour Encore / Entrave…) ne fait rien. |
| **DeathLink** (`death_link`) | Recevoir un DeathLink met K.O. le Pokémon actif au début du tour suivant (ignore Fermeté, Bandeau, Graine Miracle). Perdre la run (dernier Pokémon K.O.) envoie un DeathLink, sauf si c'est un DeathLink reçu qui a mis K.O. le dernier Pokémon. |
| **Indices** (`trainer_hints`) | Les dresseurs clés donnent, une fois battus, un indice sur un objet caché dans PokeRogue : « On raconte que [objet] ([joueur]) se trouve à l'étage X de la zone [biome] » (étage seul en mode `floors`), « … serait vendu au-delà de l'étage N » pour la boutique, ou « … est offert à qui obtiendra [Pokémon] » pour la Dexsanity. Les indices sont **fixés à la génération** (`trainer_hint_locations` dans le slot data) : 22 dresseurs (rivale ×6, admins ×3, boss ×2, Conseil 4, Maître, et les 6 Champions d'Arène dans leur ordre de passage), chacun avec un indice différent, toujours le même pour un même combat, y compris dans une run suivante et en Blitz. Ordre de choix : objets de progression des autres joueurs, puis ses propres objets de progression, puis objets utiles, puis le reste. L'indice apparaît aussi dans la liste des hints du multiworld. |
| **Boutique** | `shop_item_count` objets AP au total, débloqués par lots de `shop_items_per_tier` chaque fois que la boutique de base s'enrichit (étages 1, 21, 51, 81, 111, 141, 171 ; 0 = tous dès l'étage 1), `shop_items_per_visit` maximum par boutique (les objets achetés le restent d'une run à l'autre : en logique, tous les objets d'un lot sont achetables dès le premier étage de leur palier, quitte à faire plusieurs runs), prix = `shop_cost_percent` % de l'argent d'une vague. L'objet affiche le nom et le destinataire (scout). Le nom est coloré comme dans les clients multiworld : doré = progression, bleu = utile, rouge = piège, gris = filler. |

Pendant une partie Archipelago, ce sont les œufs du profil AP qui progressent ; les œufs Classiques restent en pause.

## Côté joueur

1. *Nouvelle partie → Archipelago*, saisir `serveur:port` (ex. `archipelago.gg:38281`), le nom du slot et le mot de passe éventuel.
2. Choisir ses starters parmi ceux reçus, puis jouer normalement.
3. Pour reprendre une partie AP sauvegardée, le jeu redemande la connexion et vérifie que la seed correspond.

La connexion se reconnecte automatiquement ; les locations faites hors-ligne sont renvoyées à la reconnexion.

## Client sans installation

`archipelago/client/` permet de distribuer le jeu dans un dossier que le joueur lance sans rien installer (ni Node, ni dépendances) :

```bash
node archipelago/client/build-client.mjs <dossier de sortie> --node <dossier contenant node.exe>
```

Le script compile le jeu (`vite build --mode app` : pas de compte, sauvegardes dans le navigateur) et assemble :

- `game/` : le jeu compilé, images, sons et textes compris (environ 720 Mo) ;
- `serve.mjs` : un petit serveur web sans dépendance, qui sert `game/` sur `http://localhost:8000` et ouvre le navigateur par défaut ;
- `pokerogue.bat` : lance `node
ode.exe serve.mjs` ;
- `node/` : `node.exe` (copié avec `--node`, ou ajouté à la main).

Le joueur double-clique sur `pokerogue.bat` et garde la fenêtre ouverte pendant la partie. Le port reste 8000 : le navigateur garde les sauvegardes par adresse, un autre port afficherait une sauvegarde vide. Si PokeRogue est déjà lancé, le script ouvre simplement le navigateur. `--no-build` réutilise le dernier build (`dist/`).

## Côté serveur : l'apworld

`archipelago/apworld/pokerogue/` est le monde Archipelago (Python). Pour l'utiliser : zipper le dossier `pokerogue` en `pokerogue.apworld` et le placer dans `custom_worlds/` (ou `lib/worlds/`) d'Archipelago. Après chaque nouvelle version, **fermer puis relancer le Launcher** avant de régénérer le template YAML (*Generate Template Options*) : un Launcher déjà ouvert garde l'ancienne version en mémoire et produit un template sans les nouvelles options.

Options YAML : `goal` (eternatus / pokedex, eternatus), `location_mode` (floors / biome_floors / both, floors), `dexsanity` (false / starters / all, false), `dexsanity_exclude` (liste de noms et/ou `Legendaries`, vide), `shop_item_count` (0–350, 70), `shop_items_per_tier` (0–50, 10), `shop_items_per_visit` (1–3, 1), `shop_cost_percent` (10–500, 100), `starting_pokemon` (1–10 ou `random`, 5), `starting_pokemon_max_cost` (1–10, 6), `start_with_map` (true/false, true), `pokemon_in_pool` (0 à 572 = tous les starters de PokeRogue, 40), `pokemon_pool_costs` (unbiased / varied / low_cost / high_cost, unbiased : coûts des Pokémon du pool, voir ci-dessous), `bonus_item_copies` (1–5, 1), `egg_filler_percent` (0–100, 25), `effect_filler_percent` (0–100, 10), `trap_percent` (0–100, 0), `death_link` (true/false, false), `trainer_hints` (true/false, true), `fate_encounter` (true/false, true : rencontre « Voir le destin », voir ci-dessous), `katrod_encounter` (true/false, true : rencontre « Katrod », voir ci-dessous), `biome_passes` (false / true / end_only, false), `biome_pass_priority` (true/false, true : voir ci-dessous), `starter_limit_items` (0–20, 20), `starter_bonus_unlock` (liste parmi `passives`, `abilities`, `egg_moves`, `shinies`, `natures`, `fast_egg`, vide : voir ci-dessous), `blitz` (true/false, false : partie de 100 étages, voir [BLITZ.md](BLITZ.md)), `floor_checks` (1–2, 1 : avec 2, un check `Floor N Bonus` en plus de `Floor N Cleared`).

**Rencontre « Voir le destin »** (`fate_encounter`) : une fois par run, un Méga-Alakazam aux cuillères aux couleurs d'Archipelago apparaît en rencontre mystère, sur un étage tiré au hasard entre 41 et 99 (21 et 49 en Blitz), jamais sur un étage multiple de 10, un premier étage de bloc, un combat de l'histoire ou un Champion d'Arène. Il répond à une seule question :

- **Un passe** : où se trouve l'un des passes d'étage ou de biome du joueur (lieu, monde et jeu), de préférence un passe pas encore reçu. L'indice est aussi ajouté à la liste des hints du multiworld (paquet `CreateHints`, gratuit).
- **Un objet clé** : à quel moment de l'aventure se trouve un objet de progression rare d'un autre joueur (au plus 3 exemplaires, pour écarter les Triforce Pieces ou les pièces de puzzle) : « relativement tôt » (1ᵉʳ tiers des sphères du spoiler), « vers le milieu de l'aventure » (2ᵉ tiers) ou « plutôt tard » (dernier tiers). Pour un objet en plusieurs exemplaires (Progressive Sword…), c'est son premier exemplaire qui compte, et l'objet n'est indiqué qu'une fois. Ni son emplacement ni sa sphère ne sont donnés. Les objets des autres jeux passent en premier.
- **Les vainqueurs** : le ou les joueurs qui atteignent leur objectif en premier, et le ou les joueurs qui l'atteignent en dernier, selon l'ordre des sphères de la génération (comme le spoiler, pas la partie réelle). Seuls les noms sont donnés, sans les sphères.

Ces indices sont préparés à la génération (`fate_pass_hints`, `fate_sphere_hints`, `fate_goal_order` dans le slot data) ; chaque run donne un indice de passe et un indice d'objet différents (le profil retient ceux déjà donnés). Le sprite recoloré est généré par `python archipelago/tools/make_fate_sprite.py`.

**Rencontre « Katrod »** (`katrod_encounter`) : rencontre mystère rare (tier Rogue, tous les biomes, au plus une fois par run), en mode Archipelago seulement. Katrod, militant et joueur de randomizers, propose quatre choix :

- **Tunnel sur Marx** : des EXP. Balance jusqu'à en avoir 4, une vitamine à chaque Pokémon pour sa statistique la plus basse, puis 20 % de l'argent en moins.
- **Les randomizers** : chaque Pokémon reçoit un talent, un passif et deux types aléatoires, puis 4 capacités aléatoires lui sont proposées (une offensive de puissance ≥ 40 de chacun de ses nouveaux types, physique ou spéciale selon sa meilleure statistique d'attaque, et deux autres) ; le joueur choisit lesquelles apprendre.
- **Pinailler** : combat contre Katrod (Coatox, Salarsen Forme Grave avec téracristal Normal, Xatu, Minotaupe, Motisma Lavage, et Sulfura de Galar en boss à 2 barres), puis une boutique de 2 objets Master, les autres Rogue.
- **Offrir un café** : boutique classique.

Les textes (français et anglais) sont dans `src/archipelago/ap-katrod-encounter.ts`. Le sprite de Katrod (tiré de son Mii) est `archipelago/tools/katrod_sprite.png`, converti en `src/archipelago/ap-katrod-sprite.ts` par `python archipelago/tools/make_katrod_sprite.py`.

**Bonus des starters** (`starter_bonus_unlock`) : appliqués à tous les starters débloqués dans le profil AP (reçus, de départ ou éclos), à la connexion, à chaque objet reçu et en entrant dans le mode Archipelago. `passives` : passif débloqué et activé ; `abilities` : tous les talents (second et caché compris) ; `egg_moves` : les 4 capacités œuf ; `shinies` : les formes chromatiques (toutes les variantes de l'espèce) ; `natures` : toutes les natures ; `fast_egg` : les œufs Archipelago éclosent 10 fois plus vite (un dixième des étages, au moins 1).

**Coûts des Pokémon du pool** (`pokemon_pool_costs`) : `unbiased` tire les Pokémon au hasard parmi les starters utilisables (la plupart coûtent 2 à 4) ; `varied` prend autant de Pokémon de chaque coût (1 à 10) que possible ; `low_cost` et `high_cost` tirent d'abord un coût, avec un poids multiplié par 1,5 à chaque point de coût en moins (ou en plus), puis un Pokémon de ce coût.

**Priorité des Biome Passes** (`biome_pass_priority`, avec `biome_passes: true` et des checks de biome) : le remplissage de la progression place les objets d'un joueur de la fin de la liste vers son début, et les derniers placés ne peuvent aller que là où mènent les objets déjà placés : ils arrivent donc plus tôt dans le multiworld. Les pass des biomes proches de la Ville sont mis en tête de liste (les plus proches en premier), ceux des biomes lointains en fin de liste. De plus, dans les locations PokeRogue, le pass d'un biome n'est jamais placé plus de 2 blocs de 10 étages après le premier bloc où le biome peut être visité (par exemple, le pass d'un biome des étages 11-20 se trouve au plus tard à l'étage 40). Les biomes entrent ainsi en logique à peu près dans l'ordre d'une run. Dans les autres jeux du multiworld, ce n'est qu'un biais.

Des modèles prêts à l'emploi sont dans [`yaml/`](yaml).

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
  pokemon_pool_costs: unbiased
  bonus_item_copies: 1
  egg_filler_percent: 25
  effect_filler_percent: 10
  trap_percent: 10
  death_link: false
  trainer_hints: true
  fate_encounter: true
  katrod_encounter: true
  biome_passes: false
  biome_pass_priority: true
  goal: eternatus
  dexsanity: false
  dexsanity_exclude: []
  blitz: false
  floor_checks: 1
  starter_limit_items: 20
  starter_bonus_unlock: []
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

Le générateur extrait aussi la génération et les types (forme de base) de chaque starter (`POKEMON_INFO`), utilisés pour les types distincts et les challenges Monogénération / Monotype. Les pass de biome ont l'ID `base_id + biome_pass_offset (700) + id du biome` (la Fin : 750). Les checks Dexsanity ont l'ID `base_id + dex_location_offset (10000) + id de l'espèce`.

Les données de la Dexsanity (espèces, starter, pré-évolution, biomes où chacune apparaît) viennent de `archipelago/dex-data.json`, exporté depuis le jeu ; après une mise à jour du jeu, le régénérer avant `generate-apworld-data.mjs` :

```bash
npx vitest run --config scripts/archipelago-dex-exporter/vitest.config.ts
```

## Fichiers

- `src/archipelago/ap-client.ts` – client du protocole réseau Archipelago (WebSocket).
- `src/archipelago/archipelago.ts` – gestionnaire : profil, objets reçus, locations, boutique.
- `src/archipelago/ap-phases.ts` – phases « attente de passe » et « réception d'objets ».
- `src/archipelago/ap-hooks.ts` – points d'accroche sans dépendance (évite les imports circulaires).
- `src/archipelago/ap-icon.ts` – icône des objets AP (embarquée, enregistrée comme texture `ap_item`).
- `src/ui/handlers/archipelago-connect-ui-handler.ts` – formulaire de connexion.
- Modifiés (points d'accroche) : `game-mode.ts`, `ui-inputs.ts`, `phases/battle-end-phase.ts`, `phases/turn-init-phase.ts`, `phase-manager.ts`, `phases/title-phase.ts`, `phases/select-starter-phase.ts`, `phases/new-battle-phase.ts`, `phases/game-over-phase.ts`, `phases/trainer-victory-phase.ts`, `phases/egg-lapse-phase.ts`, `phases/select-biome-phase.ts`, `phases/switch-biome-phase.ts`, `ui/utils/starter-select-ui-utils.ts`, `system/game-data.ts`, `@types/save-data.ts`, `modifier/modifier-type.ts`, `ui/ui.ts`, `enums/ui-mode.ts`, `ui/handlers/form-modal-ui-handler.ts`, `ui/handlers/modifier-select-ui-handler.ts`.
