# Option Blitz – spécification

Statut : **implémentée** (apworld 0.9.0, jeu et tracker). Les écarts et précisions par rapport à la conception
sont listés en section 11.

Blitz est une option de l'apworld qui ramène une partie à **100 étages** au lieu de 200, pour des seeds plus
courtes. Elle garde la structure d'une partie Classic : biomes, combats de l'histoire, champions d'arène, tiers
de boutique et Eternatus en boss final. Tout est simplement compressé de moitié.

Une seconde option, indépendante de Blitz, permet d'avoir **1 ou 2 checks par étage**.

## 1. Options YAML

| Option | Valeurs | Défaut | Effet |
|---|---|---|---|
| `blitz` | true / false | false | Partie de 100 étages (détails ci-dessous). |
| `floor_checks` | 1 / 2 | 1 | Nombre de checks de fin d'étage : `Floor N Cleared`, plus `Floor N Bonus` avec 2. Sans effet sur les checks de biome. |

Les deux options sont envoyées dans `slot_data`, avec les valeurs qui en découlent (section 6).

## 2. Étage virtuel

Blitz s'appuie sur un **étage virtuel**, égal au double de l'étage réel (étage réel 50 → étage virtuel 100). Le
jeu s'en sert partout où la difficulté et la progression dépendent de l'étage, sur le modèle du décalage du
Daily (`GameMode.getWaveForDifficulty`) :

- le niveau des ennemis (`Battle.getLevelForWave`), donc l'expérience gagnée ;
- le plafond de niveau (`BattleScene.getMaxExpLevel`) ;
- la force des dresseurs (`trainer-party-template.ts`, `trainer.ts`) ;
- les objets tenus par les ennemis (`BattleScene`, chances d'objets ennemis) ;
- les poids d'objets qui dépendent de l'étage (par exemple le Champi Mémoire dans `init-modifier-pools.ts`) ;
- les tiers de la boutique (section 5) et les champions d'arène (section 4).

Avec cette règle, les ennemis de l'étage 100 ont le niveau d'un étage 200 en Classic (environ 165).

Restent sur l'**étage réel** : les changements de biome (tous les 10 étages), les boss (étages multiples de 10),
les Floor Passes, les checks, l'argent et les prix (section 5).

À vérifier pendant l'implémentation : les plages d'étages des rencontres mystères, à passer sur l'étage virtuel
si elles reposent sur l'étage.

## 3. Fin de partie

- Étage final : **100**. `GameMode.isWaveFinal` doit utiliser l'étage final de la seed (lu dans `slot_data`) en
  mode Archipelago, au lieu de 200 en dur.
- **Biome End aux étages 91 à 100** : `SelectBiomePhase` force déjà End quand `isWaveFinal(étage suivant + 9)` est
  vrai, donc ce point suit automatiquement.
- **Eternatus à l'étage 100, au niveau 200.** La formule de niveau du boss final, appliquée à l'étage virtuel 200,
  donne 200 comme en Classic. Les deux phases du combat (dont Eternamax) sont conservées.

## 4. Combats de l'histoire et champions d'arène

`ClassicFixedBossWaves` (`enums/fixed-boss-waves.ts`) est remplacé par une fonction qui renvoie l'étage de chaque
combat selon le mode. Elle sert aussi à `fixed-battle-configs.ts`, `trainer-party-template.ts`,
`trainer-config.ts` (tests `waveIndex === EVIL_ADMIN_1`) et `challenge.ts`. Table Blitz :

| Combat | Classic | Blitz |
|---|---|---|
| Gamin de Town | 5 | 3 |
| Rival 1 | 8 | 4 |
| Rival 2 | 25 | 13 |
| Sbire 1 | 35 | 18 |
| Rival 3 | 55 | 28 |
| Sbires 2 et 3, Admin 1 | 62, 64, 66 | 31, 32, 33 |
| Rival 4 | 95 | 48 |
| Sbire 4, Admin 2, Chef 1 | 112, 114, 115 | 56, 57, 58 |
| Rival 5 | 145 | 68 |
| Admin 3, Chef 2 | 164, 165 | 74, 75 |
| Conseil 4 | 182, 184, 186, 188 | 82, 84, 86, 88 |
| Maître | 190 | 90 |
| Rival 6 (dans End) | 195 | 95 |

**Champions d'arène : 6, comme en Classic**, aux étages réels **10, 25, 40, 55, 70 et 80**. Les cinq premiers
suivent la règle Classic (tous les 30 étages) appliquée à l'étage virtuel. Le dernier est avancé de 85 à 80 pour
passer avant le Conseil 4, et non au milieu. Ces étages ne croisent aucun combat de la table ci-dessus. Garder les
6 champions conserve aussi la quantité de Hints (`trainer_hints`).

## 5. Récompenses, boutique et argent

- **Deux phases de récompense après chaque combat gagné.** Le joueur choisit donc deux récompenses par étage, et la
  boutique s'ouvre deux fois. La seconde phase s'enchaîne après la première (`SelectModifierPhase`).
- **Les items AP de la boutique se renouvellent entre les deux phases.** Le cache `ArchipelagoManager.shopCache`,
  aujourd'hui indexé par étage, doit l'être par étage et par phase. La seconde phase propose ainsi les items
  suivants pas encore achetés.
- **Argent ×2** : en Blitz, les gains d'argent des combats sont doublés. L'argent et les prix
  (`BattleScene.getWaveMoneyAmount`) restent calculés sur l'étage réel, donc le pouvoir d'achat double. C'est
  voulu : il faut payer deux boutiques par étage, et le multiworld peut proposer beaucoup d'items AP.
- **Expérience** : pas de multiplicateur. L'étage virtuel donne des ennemis de plus haut niveau, et les Charme
  Exp. reçus du multiworld sont conservés d'une run à l'autre. Si la progression manque d'expérience en pratique,
  un bonus pourra être ajouté.
- **Tiers de boutique : 7, comme en Classic.** La boutique normale (`getPlayerShopModifierTypeOptionsForWave`)
  utilise l'étage virtuel. Ses tiers commencent alors aux étages réels **1, 11, 26, 41, 56, 71 et 86**, au lieu de
  1, 21, 51, 81, 111, 141 et 171. Les tiers AP (`SHOP_TIER_WAVES`) suivent les mêmes étages. Les options
  `shop_item_count`, `shop_items_per_tier` et `shop_items_per_visit` gardent leur sens. Les items de fin de
  partie (Total Soin, Cendre Sacrée) restent en vente.

## 6. Checks et ids

| | Classic, 1 check | Classic, 2 checks | Blitz, 1 check | Blitz, 2 checks |
|---|---|---|---|---|
| Checks de fin d'étage | 199 | 398 | 99 | 198 |
| Progressive Floor Pass | 19 | 19 | 9 | 9 |
| Bloc du biome End | 19 | 19 | 9 | 9 |
| Checks de biome | 349 | 349 | 349 | 349 |

- **`Floor N Cleared`** : id inchangé (base + N).
- **`Floor N Bonus`** : nouvelle plage d'ids, **base + 3000 + N** (N = 1 à 199). Les plages existantes sont
  base + 1 à 199 (étages), base + 1000 (shop) et base + 2000 (biomes).
- **Quand les checks partent** :
  - en Blitz, `Cleared` part à la première phase de récompense, `Bonus` à la seconde ;
  - en Classic avec `floor_checks: 2`, les deux partent ensemble à la fin de l'étage
    (`ArchipelagoManager.onWaveCleared`).
- Les étages 100 à 199 n'ont pas de location en Blitz.
- Tous les biomes restent atteignables en Blitz : leur profondeur maximale est 6, et les 10 blocs en permettent 8.

## 7. Apworld

- Les constantes `FINAL_WAVE`, `BLOCK_COUNT`, `SHOP_TIER_WAVES` et `BIOME_DEPTHS` (End au dernier bloc) dépendent
  de `blitz`. Les tables d'ids globales (`LOCATION_TABLE`) restent complètes ; seules les locations de la seed
  changent.
- **Floor Passes** : `BLOCK_COUNT - 1`, soit 19 en Classic et 9 en Blitz.
- **Shop items** : même règle qu'aujourd'hui (premier étage du tier, sur plusieurs runs), avec les tiers Blitz.
  `get_shop_item_count` reste plafonné à 7 × `shop_items_per_tier`.
- **Biome Passes** : `can_reach_biome` limité à `BLOCK_COUNT - 2` changements de biome.
- **Pool d'objets** : il se règle déjà sur le nombre de locations. Les Pokémon, Starter Limit et objets bonus ne
  sont ajoutés que s'il reste de la place. La progression (au plus 9 Floor Passes et 33 Biome Passes en Blitz)
  tient toujours, car il y a au moins 99 locations.
- **`slot_data`** : en plus des clés existantes, `blitz`, `floor_checks`, `final_wave` et `shop_tier_waves`.
- Les anciennes seeds, sans ces clés, se jouent comme aujourd'hui : 200 étages et 1 check par étage.

## 8. Jeu (client)

- **Lire dans `slot_data`** l'étage final, le mode Blitz, `floor_checks` et les tiers de boutique, au lieu des
  constantes de `ap-data.json` (`AP_FINAL_WAVE`, `shop_tier_waves`).
- **Étage virtuel** : `getWaveForDifficulty` et les fonctions de la section 2.
- **Combats et champions** : table Blitz et règle des champions (section 4).
- **Récompenses** : seconde phase de récompense, renouvellement des items AP, argent ×2 (section 5).
- **Checks** : `Floor N Bonus` (section 6).

## 9. Tracker PopTracker

- Lire `blitz`, `floor_checks`, `final_wave` et `shop_tier_waves` dans `slot_data`.
- **Onglet Floors** :
  - une section `Floor N Bonus` dans chaque bloc, visible seulement avec `floor_checks: 2` ;
  - les blocs au-delà de l'étage 99 masqués en Blitz.
- **Biomes** : la règle de End devient dynamique (bloc 9 ou 19).
- **Shop** : les étages des tiers viennent de `slot_data`. Les libellés de la carte (« floors 1-20 »…) doivent
  aussi s'adapter, ou être remplacés par le numéro du tier seul.
- **Floor Passes** : compteur limité à 9 en Blitz.

## 10. Points à régler en jeu

- La force réelle de la progression : expérience, objets, et argent ×2.
- La durée d'une run Blitz par rapport à une run Classic.
- Les rencontres mystères (section 2).

## 11. Implémentation : précisions

- **Code du jeu.** Les constantes Blitz (étage final, table des combats, champions, plage des rencontres
  mystères, multiplicateur d'argent) sont dans `src/archipelago/blitz.ts`. `GameMode.isBlitz` vaut vrai pour une
  partie Archipelago dont la seed a l'option ; `GameMode.getVirtualWave`, `getFixedBossWave`,
  `getClassicFixedWave` et `isGymWave` appliquent les règles des sections 2 et 4.
- **Seconde phase de récompense.** Elle est précédée d'`ArchipelagoBonusRewardPhase`, qui envoie
  `Floor N Bonus` et renouvelle les items AP de la boutique. Elle tire ses récompenses avec une autre graine
  (étage + 1000), sinon elle proposerait les mêmes objets que la première.
- **Étages multiples de 10.** Ils n'ont pas de boutique : leurs récompenses fixes (Charme Exp., Golden Poké Ball…)
  sont données deux fois.
- **`Floor N Bonus` sans seconde phase** (rencontre mystère, fuite) : le check part quand le joueur quitte l'étage,
  comme `Floor N Cleared`.
- **Rencontres mystères.** Elles apparaissent entre les étages 5 et 90, et leurs conditions d'étage sont vérifiées
  sur l'étage virtuel. Leur nombre total par run reste celui du Classic, donc elles sont deux fois plus fréquentes.
- **Tracker.** La carte de l'onglet Floors garde ses 20 cases : en Blitz, les cases au-delà de l'étage 100 sont
  vides (leurs checks sont masqués).
