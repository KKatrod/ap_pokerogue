# Pack PopTracker – PokeRogue Archipelago

Pack [PopTracker](https://github.com/black-sliver/PopTracker) pour le monde Archipelago de PokeRogue
(apworld `archipelago/apworld/pokerogue/`, version 0.5.0). Il affiche les checks faits et restants, avec
l'auto-tracking Archipelago : checks cochés, Floor Passes, Biome Passes et Map reçus, options lues dans
`slot_data`.

Version minimale de PopTracker : 0.26.0 (testé avec 0.36.0).

## Installation

1. Copier le dossier `pokerogue_ap/` dans le dossier `packs` de PopTracker :
   - soit `packs\` à côté de `poptracker.exe` (installation portable, par exemple
     `Documents\Downloads\poptracker_0-28-0_win64\poptracker\packs\`) ;
   - soit `Documents\PopTracker\packs\`.

   On peut aussi zipper le dossier (le zip doit contenir `pokerogue_ap/manifest.json`) et déposer le `.zip`
   au même endroit.
2. Lancer PopTracker, cliquer sur l'icône dossier (*Load Pack*) et choisir **PokeRogue Archipelago Tracker**.
3. Cliquer sur **AP** en haut à gauche, puis entrer l'adresse du serveur (par exemple `localhost:38281` ou
   `archipelago.gg:12345`), le nom du slot et le mot de passe éventuel.

Le pack se connecte en tant que *Tracker* : il n'envoie aucun check et ne prend la place d'aucun client.

## Ce qui est suivi

Onglets :

| Onglet | Contenu |
|---|---|
| **Floors** | Une case par bloc de 10 étages (`Floors 1-10` … `Floors 191-199`) avec les checks `Floor N Cleared` (N = 1 à 199), et `Floor N Bonus` avec `floor_checks: 2`. En Blitz, les blocs au-delà de l'étage 99 et la case de l'étage 100 (boss final, sans check) sont masqués. |
| **Biomes** | Un marqueur par biome avec ses checks `<Biome> - Floor 1` à `<Biome> - Floor 10` (`End` : étages 1 à 9 ; le 10ᵉ est le boss final, l'objectif). |
| **Pokedex** | Avec la Dexsanity : une case par biome, avec les Pokémon de la liste qu'on peut y rencontrer, et une case *Anywhere* pour ceux qui n'apparaissent dans aucun biome (seul le premier étage de la Fin les propose). En mode `starters`, un starter est rangé dans chaque biome où apparaît un Pokémon de sa lignée ; en mode `all`, une espèce est rangée là où elle apparaît, et là où apparaissent ses pré-évolutions. Seuls les Pokémon de `dexsanity_species` (slot data) sont affichés ; un check fait coche le Pokémon dans toutes ses cases. Une case est en logique dès que son biome est atteignable (passes d'étage, et Biome Passes avec `biome_passes: true`), ou que la Fin l'est. |
| **Shop** | Les checks `Shop Item N`, regroupés par tier de la boutique (Tier 1 : étages 1-20, Tier 2 : 21-50, 51-80, 81-110, 111-140, 141-170, Tier 7 : 171-199 ; en Blitz : 1, 11, 26, 41, 56, 71 et 86). |

Les variantes viennent de `slot_data.location_mode`, appliqué à la connexion :

| `location_mode` | Checks affichés |
|---|---|
| `0` (`floors`) | Floors + Shop |
| `1` (`biome_floors`) | Biomes + Shop |
| `2` (`both`) | Floors + Biomes + Shop |

Le panneau *Settings (from the server)* montre les valeurs lues dans `slot_data` : mode (FL, BI, F+B),
`biome_passes` (BP, allumé avec `biome_passes: true`), `end_pass` (EP, allumé avec `biome_passes: end_only`), `blitz` (BZ, allumé en Blitz), `floor_checks` (FC, 1 ou 2),
`shop_item_count` (SH), `shop_items_per_tier` (/T), `shop_items_per_visit` (/V) et `dexsanity` (DX, DX:S, DX:A). Une fois connecté, ces réglages
viennent du serveur et un clic dessus est annulé. Sans connexion, on peut les régler à la main (clic gauche /
clic droit). Les valeurs par défaut sont celles de l'apworld (floors, pas de Biome Passes, pas de Blitz, 1 check
par étage, 70, 10, 1).

Objets suivis :

- **Progressive Floor Pass** : compteur de 0 à 19 (9 suffisent en Blitz).
- **Map** : la Map de départ (`start_with_map`) arrive avec l'inventaire de départ, elle est donc aussi
  détectée.
- **Biome Pass - <Biome>** : un par biome sauf Town et End, soit 33. Ils sont dans le groupe *Biome Passes*,
  classés par bloc, avec une abréviation du biome (PLA = Plains, TG = Tall Grass, etc.). Le groupe reste
  affiché sans l'option, mais il ne sert alors à rien.
- **Biome Pass - End** (END, à côté de la Map) : le seul pass avec `biome_passes: end_only`.

## Logique

Elle suit l'apworld (`__init__.py`) :

- **Étages** : le bloc k (étages 10k+1 à 10k+10) demande k `Progressive Floor Pass`. `Floor N Bonus` suit la
  même règle que `Floor N Cleared`.
- **Blitz** (option `blitz`, voir `archipelago/BLITZ.md`) : la partie s'arrête à l'étage 100, End occupe le bloc 9
  (9 passes au lieu de 19) et les tiers de boutique commencent aux étages 1, 11, 26, 41, 56, 71 et 86.
- **Biomes** : les étages d'un biome sont disponibles dès le premier bloc où ce biome peut être atteint
  (`BIOME_DEPTHS` : parcours en largeur depuis Town sur les liens de biomes de `data.py` ; End est forcé au
  bloc 19). L'onglet affiche pour chaque biome ce bloc et le nombre de passes demandé.
- **Shop** : la boutique débloque `shop_items_per_tier` items à chaque tier de la boutique normale (étages 1,
  21, 51, 81, 111, 141 et 171 ; tous à l'étage 1 si la valeur est 0). L'onglet a une case par tier. Un item
  n'apparaît que dans son tier : chaque tier contient tous les items qu'il peut recevoir, mais le tracker masque
  ceux d'un autre tier avec les réglages de la seed. `Shop Item n` est en logique dès que le premier étage de son
  tier est accessible (`shop_item_wave` de l'apworld, réécrit en Lua dans `scripts/logic.lua`). Une boutique ne
  propose que `shop_items_per_visit` items, mais les achats restent acquis d'une run à l'autre : plusieurs runs
  permettent donc d'acheter tous les items du tier. Les items au-delà de `shop_item_count` sont masqués.

- **Biome Passes** (option `biome_passes`) : un biome n'est accessible que par un chemin depuis Town dont
  chaque biome a son Biome Pass. Il faut aussi un Floor Pass par changement de biome (`can_reach_biome` de
  l'apworld, réécrit en Lua dans `scripts/logic.lua`). Par exemple, Tall Grass demande les passes de Plains,
  Grass et Tall Grass, plus 3 Floor Passes. Town n'a pas de passe. End n'en a pas non plus : il reste au bloc 19.
  La Map ne change rien à cette logique.
- **Pass de la Fin** (`biome_passes: end_only`) : le dernier bloc d'étages (End) demande tous les Floor Passes et
  le `Biome Pass - End`.


Règle propre au tracker, **sans l'option `biome_passes`** (mode `biome_floors` / `both`) : sans la Map, le
biome suivant est tiré au hasard. Dès qu'on a assez de passes pour leur bloc, les étages des biomes autres que
Town, Plains et End sont donc affichés **en jaune** : accessibles mais hors logique (*sequence break*). Avec la
Map, ils passent en vert. Avec l'option, un biome sans chemin de Biome Passes est **rouge**, car le jeu ne peut
pas y mener.

Couleurs PopTracker habituelles : vert = dans la logique, jaune = hors logique, rouge = inaccessible,
gris = tout est fait.

## Fichiers

```
archipelago/poptracker/
├── README.md                 ce fichier
├── tools/
│   ├── generate_pack.py      génère le pack à partir de apworld/pokerogue/data.py
│   ├── biome_chart_source.png       carte des biomes du wiki (originale)
│   └── biome_chart_positions.json   position des biomes sur cette carte
└── pokerogue_ap/             le pack à copier dans PopTracker
    ├── manifest.json
    ├── items/  locations/  maps/  layouts/  images/
    └── scripts/
        ├── init.lua
        ├── logic.lua                     règles de la boutique, valeurs par défaut des options
        └── autotracking/
            ├── archipelago.lua           gestion de la connexion AP (clear, items, locations)
            └── mapping.lua               (généré) ids des locations et des objets
```

`items/`, `locations/`, `maps/`, `layouts/`, les images générées et `mapping.lua` sont produits par le
générateur : ne pas les modifier à la main. Après un changement de l'apworld (noms, ids, liens de biomes),
relancer depuis la racine du dépôt (Python 3 avec Pillow) :

```powershell
python archipelago/poptracker/tools/generate_pack.py
```

## Carte des biomes

L'onglet **Biomes** utilise la carte des biomes du wiki PokeRogue
(`tools/biome_chart_source.png`), avec un marqueur par biome qui montre les étages restants. Le générateur
pose l'image sur un fond blanc (l'original est transparent) et ajoute une case **End**, absente de la carte.
Il écrit le résultat dans `pokerogue_ap/images/maps/biome_chart.png`. La position des marqueurs est dans
`tools/biome_chart_positions.json` (centre de chaque case, en pixels de l'image 2000×1072). L'onglet
**Biomes (grid)** montre les mêmes checks sous forme de grille, avec le bloc et le nombre de passes de chaque
biome. Sans `biome_chart_source.png`, seule la grille est générée.

La source de l'image et ce que l'on sait de sa licence sont notés dans
`pokerogue_ap/images/maps/CREDITS.md`. Je n'ai pas pu vérifier la licence du wiki : vérifie-la avant de
diffuser le pack.
