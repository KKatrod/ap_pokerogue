# PokeRogue × Archipelago

Mode de jeu **Archipelago** (multiworld randomizer) pour PokeRogue. Il apparaît dans *Nouvelle partie → Archipelago*, à côté de Classique / Défi / Infini.

## Fonctionnement

| Élément | Règle |
|---|---|
| **Déblocages séparés** | En mode Archipelago, le Pokédex et les données de starters sont ceux d'un **profil AP** (un par seed + slot), stocké dans `localStorage` (`ap_profile_<seed>_<slot>`). Le Pokédex Classique n'est ni lu ni modifié. Les captures en run ne débloquent pas de starter : seuls les objets AP le font. |
| **Locations envoyées** | Chaque étage terminé (1 à 199) → `Floor N Cleared`. Chaque objet AP acheté en boutique → `Shop Item N`. Battre l'étage 200 → objectif (`CLIENT_GOAL`). |
| **Passe d'étage** | `Progressive Floor Pass` (×19). Pour dépasser l'étage 10·k il faut k passes. Sans passe, le jeu attend sur un écran « Étage verrouillé » jusqu'à réception. |
| **Pokémon** | `Pokemon - <Nom>` débloque ce starter dans le profil AP. N starters de départ sont donnés en inventaire initial. |
| **Consommables** (potions, rappels, éthers, Super Bonbons, Poké Balls, Parfums, pépites…) | Donnés **une seule fois**, entre deux étages. Si l'objet cible un Pokémon, l'écran d'équipe s'ouvre ; annuler le reporte à l'étage suivant. |
| **Objets tenus** (Restes, Œuf Chance, Vive Griffe…) | Une seule fois, sur le Pokémon choisi. |
| **Objets bonus** (Multi Exp, Charmes, Pièce Rune, Bracelet Méga…) | **Permanents** : redonnés au début de chaque nouvelle run AP. |
| **Boutique** | `shop_item_count` objets AP au total, `shop_items_per_visit` maximum par boutique, prix = `shop_cost_percent` % de l'argent d'une vague. L'objet affiche le nom et le destinataire (scout). |

Les œufs du profil Classique ne progressent pas pendant une run Archipelago.

## Côté joueur

1. *Nouvelle partie → Archipelago*, saisir `serveur:port` (ex. `archipelago.gg:38281`), le nom du slot et le mot de passe éventuel.
2. Choisir ses starters parmi ceux reçus, puis jouer normalement.
3. Pour reprendre une partie AP sauvegardée, le jeu redemande la connexion et vérifie que la seed correspond.

La connexion se reconnecte automatiquement ; les locations faites hors-ligne sont renvoyées à la reconnexion.

## Côté serveur : l'apworld

`archipelago/apworld/pokerogue/` est le monde Archipelago (Python). Pour l'utiliser : zipper le dossier `pokerogue` en `pokerogue.apworld` et le placer dans `custom_worlds/` (ou `lib/worlds/`) d'Archipelago.

Options YAML : `shop_item_count` (0–150, 30), `shop_items_per_visit` (1–3, 1), `shop_cost_percent` (10–500, 100), `starting_pokemon` (1–10, 3), `pokemon_in_pool` (0–300, 40).

```yaml
game: PokeRogue
name: Joueur
PokeRogue:
  shop_item_count: 30
  shop_items_per_visit: 1
  starting_pokemon: 3
  pokemon_in_pool: 40
```

## Données partagées

`src/archipelago/ap-data.json` est la source unique des objets/IDs. Après modification, régénérer la table Python :

```bash
node archipelago/generate-apworld-data.mjs
```

## Test local sans multiworld

```bash
node archipelago/mock-server.mjs
```

puis se connecter à `localhost:38281` (n'importe quel nom de slot). Le faux serveur donne Bulbizarre, Salamèche, Carapuce, un Charme Exp. et une Potion, et envoie un Passe d'étage à chaque étage multiple de 5 terminé.

## Fichiers

- `src/archipelago/ap-client.ts` – client du protocole réseau Archipelago (WebSocket).
- `src/archipelago/archipelago.ts` – gestionnaire : profil, objets reçus, locations, boutique.
- `src/archipelago/ap-phases.ts` – phases « attente de passe » et « réception d'objets ».
- `src/archipelago/ap-hooks.ts` – points d'accroche sans dépendance (évite les imports circulaires).
- `src/ui/archipelago-connect-ui-handler.ts` – formulaire de connexion.
- Modifiés : `game-mode.ts`, `phases.ts`, `system/game-data.ts`, `modifier/modifier-type.ts`, `ui/ui.ts`, `ui/form-modal-ui-handler.ts`, `ui/starter-select-ui-handler.ts`.
