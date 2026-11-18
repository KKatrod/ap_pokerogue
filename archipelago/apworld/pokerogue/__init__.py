"""
PokeRogue for Archipelago.

Locations: clearing each floor (1-199) and buying the Archipelago items offered in the shops.
Items: Progressive Floor Passes (needed to go past each floor multiple of 10), starter Pokemon unlocks,
consumables, held items and permanent bonus items. Goal: clear floor 200.

Item / location ids come from data.py, generated from the game sources
(node archipelago/generate-apworld-data.mjs).
"""
import math
from typing import Dict, List

from BaseClasses import Item, ItemClassification, Location, Region
from worlds.AutoWorld import WebWorld, World

from .data import (BASE_ID, FINAL_WAVE, GAME_NAME, GATE_INTERVAL, ITEMS, POKEMON, SHOP_LOCATION_OFFSET,
                   WAVE_LOCATION_OFFSET)
from .options import PokeRogueOptions

FLOOR_PASS = "Progressive Floor Pass"
VICTORY = "Victory"
MAP = "Map"

# Starting Pokemon: at least one costs this much (to avoid a too weak starting team)
STRONG_STARTER_MIN_COST = 5

# Relative weights of the egg fillers
EGG_WEIGHTS = {
    "Common Egg": 40,
    "Rare Egg": 30,
    "Epic Egg": 15,
    "Legendary Egg": 5,
    "Mystery Egg": 10,
}

CLASSIFICATIONS = {
    "progression": ItemClassification.progression,
    "useful": ItemClassification.useful,
    "filler": ItemClassification.filler,
}

ITEM_TABLE: Dict[str, int] = {name: item_id for name, item_id, _category, _cls in ITEMS}
ITEM_TABLE.update({name: item_id for name, item_id, _cost in POKEMON})
ITEM_CATEGORY: Dict[str, str] = {name: category for name, _id, category, _cls in ITEMS}
ITEM_CLASSIFICATION: Dict[str, str] = {name: cls for name, _id, _category, cls in ITEMS}

MAX_SHOP_VISITS = (FINAL_WAVE - 1) - (FINAL_WAVE - 1) // GATE_INTERVAL  # shops are not available on floors multiple of 10
MAX_SHOP_ITEMS = 150 * 3


def wave_location_name(wave: int) -> str:
    return f"Floor {wave} Cleared"


def shop_location_name(index: int) -> str:
    return f"Shop Item {index}"


LOCATION_TABLE: Dict[str, int] = {wave_location_name(w): BASE_ID + WAVE_LOCATION_OFFSET + w for w in range(1, FINAL_WAVE)}
LOCATION_TABLE.update({shop_location_name(i): BASE_ID + SHOP_LOCATION_OFFSET + i for i in range(1, MAX_SHOP_ITEMS + 1)})


def shop_item_wave(index: int, per_visit: int) -> int:
    """Earliest floor whose shop offers the given (1-based) shop item, mirroring the game client."""
    visit = math.ceil(index / per_visit)
    return visit + (visit - 1) // (GATE_INTERVAL - 1)


class PokeRogueItem(Item):
    game = GAME_NAME


class PokeRogueLocation(Location):
    game = GAME_NAME


class PokeRogueWeb(WebWorld):
    theme = "grass"


class PokeRogueWorld(World):
    """
    PokeRogue is a Pokemon roguelite: climb 200 floors with a team of starters, picking items between battles.
    """
    game = GAME_NAME
    web = PokeRogueWeb()
    options_dataclass = PokeRogueOptions
    options: PokeRogueOptions
    topology_present = False

    item_name_to_id = ITEM_TABLE
    location_name_to_id = LOCATION_TABLE
    item_name_groups = {
        "Pokemon": {name for name, _id, _cost in POKEMON},
        "Consumables": {name for name, _id, cat, _cls in ITEMS if cat == "consumable"},
        "Held Items": {name for name, _id, cat, _cls in ITEMS if cat == "held"},
        "Bonus Items": {name for name, _id, cat, _cls in ITEMS if cat == "bonus"},
        "Eggs": {name for name, _id, cat, _cls in ITEMS if cat == "egg"},
    }

    def get_shop_item_count(self) -> int:
        return min(self.options.shop_item_count.value, MAX_SHOP_VISITS * self.options.shop_items_per_visit.value)

    def create_item(self, name: str) -> Item:
        if name == VICTORY:
            return PokeRogueItem(name, ItemClassification.progression, None, self.player)
        if name in ITEM_CLASSIFICATION:
            classification = CLASSIFICATIONS[ITEM_CLASSIFICATION[name]]
        else:
            classification = ItemClassification.useful  # Pokemon unlocks
        return PokeRogueItem(name, classification, self.item_name_to_id[name], self.player)

    def get_filler_item_name(self) -> str:
        if self.random.randint(1, 100) <= self.options.egg_filler_percent.value:
            return self.random.choices(list(EGG_WEIGHTS), weights=list(EGG_WEIGHTS.values()))[0]
        fillers = [name for name, _id, cat, cls in ITEMS if cat == "consumable" and cls == "filler"]
        return self.random.choice(fillers)

    def pick_starting_pokemon(self) -> List[str]:
        """Random starting Pokemon: none above the maximum cost, at least one strong one."""
        count = self.options.starting_pokemon.value
        max_cost = self.options.starting_pokemon_max_cost.value
        strong_cost = min(STRONG_STARTER_MIN_COST, max_cost)
        allowed = [(name, cost) for name, _id, cost in POKEMON if cost <= max_cost]
        strong = [name for name, cost in allowed if cost >= strong_cost]
        chosen = [self.random.choice(strong)]
        others = [name for name, _cost in allowed if name not in chosen]
        chosen += self.random.sample(others, min(count - 1, len(others)))
        self.random.shuffle(chosen)
        return chosen

    def create_regions(self) -> None:
        menu = Region("Menu", self.player, self.multiworld)
        self.multiworld.regions.append(menu)

        blocks: List[Region] = []
        previous = menu
        for block in range(FINAL_WAVE // GATE_INTERVAL):
            first, last = block * GATE_INTERVAL + 1, (block + 1) * GATE_INTERVAL
            region = Region(f"Floors {first}-{last}", self.player, self.multiworld)
            for wave in range(first, last + 1):
                if wave < FINAL_WAVE:
                    name = wave_location_name(wave)
                    region.locations.append(PokeRogueLocation(self.player, name, LOCATION_TABLE[name], region))
            self.multiworld.regions.append(region)
            passes = block
            previous.connect(region, f"Floor Pass {block}",
                             lambda state, p=passes: state.has(FLOOR_PASS, self.player, p))
            blocks.append(region)
            previous = region

        per_visit = self.options.shop_items_per_visit.value
        for index in range(1, self.get_shop_item_count() + 1):
            wave = shop_item_wave(index, per_visit)
            region = blocks[(wave - 1) // GATE_INTERVAL]
            name = shop_location_name(index)
            region.locations.append(PokeRogueLocation(self.player, name, LOCATION_TABLE[name], region))

        goal_region = blocks[-1]
        victory = PokeRogueLocation(self.player, f"Floor {FINAL_WAVE} Cleared", None, goal_region)
        victory.place_locked_item(self.create_item(VICTORY))
        goal_region.locations.append(victory)

    def create_items(self) -> None:
        location_count = len(self.multiworld.get_unfilled_locations(self.player))
        pool: List[Item] = []

        # Floor passes: one per gate between the first floor block and the last one
        pool += [self.create_item(FLOOR_PASS) for _ in range(FINAL_WAVE // GATE_INTERVAL - 1)]

        # Pokemon: a few to start with, some more shuffled in the multiworld
        starting = self.pick_starting_pokemon()
        for name in starting:
            self.multiworld.push_precollected(self.create_item(name))
        remaining = [name for name, _id, _cost in POKEMON if name not in starting]
        self.random.shuffle(remaining)
        pokemon_count = min(self.options.pokemon_in_pool.value, len(remaining), max(0, location_count - len(pool)))
        pool += [self.create_item(name) for name in remaining[:pokemon_count]]

        # Map given from the start (permanent bonus item: the game grants it at the start of every run)
        start_with_map = bool(self.options.start_with_map.value)
        if start_with_map:
            self.multiworld.push_precollected(self.create_item(MAP))

        # Bonus and held items once each, while there is room
        for name, _id, category, _cls in ITEMS:
            if name == MAP and start_with_map:
                continue
            if category in ("bonus", "held") and len(pool) < location_count:
                pool.append(self.create_item(name))

        # Fill the remaining locations with consumables and eggs
        while len(pool) < location_count:
            pool.append(self.create_item(self.get_filler_item_name()))

        self.multiworld.itempool += pool

    def set_rules(self) -> None:
        self.multiworld.completion_condition[self.player] = lambda state: state.has(VICTORY, self.player)

    def fill_slot_data(self) -> Dict[str, object]:
        return {
            "shop_item_count": self.get_shop_item_count(),
            "shop_items_per_visit": self.options.shop_items_per_visit.value,
            "shop_cost_percent": self.options.shop_cost_percent.value,
            "final_wave": FINAL_WAVE,
        }
