"""
PokeRogue for Archipelago.

Locations: clearing each floor (1-199) and/or each floor of each biome, and buying the Archipelago items
offered in the shops.
Items: Progressive Floor Passes (needed to go past each floor multiple of 10), starter Pokemon unlocks,
consumables, held items, permanent bonus items, eggs, battle effects and traps. Goal: clear floor 200.

Item / location ids come from data.py, generated from the game sources
(node archipelago/generate-apworld-data.mjs).
"""
import math
from collections import deque
from typing import Dict, List, Optional

from BaseClasses import Item, ItemClassification, Location, Region
from worlds.AutoWorld import WebWorld, World

from .data import (BASE_ID, BIOME_LOCATION_OFFSET, BIOMES, FINAL_WAVE, GAME_NAME, GATE_INTERVAL, ITEM_MAX, ITEMS,
                   POKEMON, SHOP_LOCATION_OFFSET, SHOP_TIER_WAVES, WAVE_LOCATION_OFFSET)
from .options import LocationMode, PokeRogueOptions

FLOOR_PASS = "Progressive Floor Pass"
VICTORY = "Victory"
MAP = "Map"

TOWN_BIOME = 0
END_BIOME = 50

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
    "trap": ItemClassification.trap,
}

ITEM_TABLE: Dict[str, int] = {name: item_id for name, item_id, _category, _cls in ITEMS}
ITEM_TABLE.update({name: item_id for name, item_id, _cost in POKEMON})
ITEM_CATEGORY: Dict[str, str] = {name: category for name, _id, category, _cls in ITEMS}
ITEM_CLASSIFICATION: Dict[str, str] = {name: cls for name, _id, _category, cls in ITEMS}

CONSUMABLE_FILLERS = [name for name, _id, cat, cls in ITEMS if cat == "consumable" and cls == "filler"]
EFFECT_FILLERS = [name for name, _id, cat, _cls in ITEMS if cat == "effect"]
TRAPS = [name for name, _id, cat, _cls in ITEMS if cat == "trap"]

MAX_SHOP_ITEMS = 150 * 3
BLOCK_COUNT = FINAL_WAVE // GATE_INTERVAL


def wave_location_name(wave: int) -> str:
    return f"Floor {wave} Cleared"


def shop_location_name(index: int) -> str:
    return f"Shop Item {index}"


def biome_location_name(biome_name: str, floor: int) -> str:
    return f"{biome_name} - Floor {floor}"


def compute_biome_depths() -> Dict[int, int]:
    """
    Earliest floor block (0 = floors 1-10) where each biome can be visited in a Classic run.
    The run starts in the Town, the biome changes after each floor multiple of 10 following the biome links
    (weighted links are only offered sometimes, but are offered eventually), and the End is forced for the last
    block.
    """
    links = {biome_id: biome_links for biome_id, _name, biome_links in BIOMES}
    depths = {TOWN_BIOME: 0}
    queue = deque([TOWN_BIOME])
    while queue:
        biome = queue.popleft()
        for target in links.get(biome, []):
            if target != END_BIOME and target not in depths and depths[biome] + 1 < BLOCK_COUNT - 1:
                depths[target] = depths[biome] + 1
                queue.append(target)
    depths[END_BIOME] = BLOCK_COUNT - 1
    return depths


BIOME_DEPTHS = compute_biome_depths()
BIOME_NAMES = {biome_id: name for biome_id, name, _links in BIOMES}


def biome_floors(biome_id: int) -> range:
    """Floors (1-10) of a biome that hold a check (the last floor of the End is the final boss: the goal)."""
    return range(1, GATE_INTERVAL) if biome_id == END_BIOME else range(1, GATE_INTERVAL + 1)


def biome_location_id(biome_id: int, floor: int) -> int:
    return BASE_ID + BIOME_LOCATION_OFFSET + biome_id * 10 + floor - 1


LOCATION_TABLE: Dict[str, int] = {wave_location_name(w): BASE_ID + WAVE_LOCATION_OFFSET + w for w in range(1, FINAL_WAVE)}
LOCATION_TABLE.update({shop_location_name(i): BASE_ID + SHOP_LOCATION_OFFSET + i for i in range(1, MAX_SHOP_ITEMS + 1)})
for _biome_id in sorted(BIOME_DEPTHS):
    for _floor in biome_floors(_biome_id):
        LOCATION_TABLE[biome_location_name(BIOME_NAMES[_biome_id], _floor)] = biome_location_id(_biome_id, _floor)


def shop_item_wave(index: int, per_tier: int, per_visit: int) -> Optional[int]:
    """
    Earliest floor whose shop offers the given (1-based) shop item, mirroring the game client: the items are
    unlocked by batches of `per_tier` each time the regular shop gets new items (all at once if `per_tier` is 0),
    and each shop offers the first `per_visit` items not bought yet. Shops are closed on floors multiple of 10.
    @returns None if the item can never be offered
    """
    tier, position = ((index - 1) // per_tier, (index - 1) % per_tier + 1) if per_tier > 0 else (0, index)
    if tier >= len(SHOP_TIER_WAVES):
        return None
    visit = math.ceil(position / per_visit)
    wave = SHOP_TIER_WAVES[tier]
    while wave < FINAL_WAVE:
        if wave % GATE_INTERVAL:
            visit -= 1
            if visit == 0:
                return wave
        wave += 1
    return None


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
        "Battle Effects": set(EFFECT_FILLERS),
        "Traps": set(TRAPS),
    }

    def get_shop_item_count(self) -> int:
        per_tier = self.options.shop_items_per_tier.value
        per_visit = self.options.shop_items_per_visit.value
        count = 0
        while count < self.options.shop_item_count.value and shop_item_wave(count + 1, per_tier, per_visit):
            count += 1
        return count

    def create_item(self, name: str) -> Item:
        if name == VICTORY:
            return PokeRogueItem(name, ItemClassification.progression, None, self.player)
        if name in ITEM_CLASSIFICATION:
            classification = CLASSIFICATIONS[ITEM_CLASSIFICATION[name]]
        else:
            classification = ItemClassification.useful  # Pokemon unlocks
        return PokeRogueItem(name, classification, self.item_name_to_id[name], self.player)

    def get_filler_item_name(self) -> str:
        roll = self.random.randint(1, 100)
        trap = self.options.trap_percent.value
        effect = trap + self.options.effect_filler_percent.value
        egg = effect + self.options.egg_filler_percent.value
        if roll <= trap:
            return self.random.choice(TRAPS)
        if roll <= effect:
            return self.random.choice(EFFECT_FILLERS)
        if roll <= egg:
            return self.random.choices(list(EGG_WEIGHTS), weights=list(EGG_WEIGHTS.values()))[0]
        return self.random.choice(CONSUMABLE_FILLERS)

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

    def add_location(self, region: Region, name: str) -> None:
        region.locations.append(PokeRogueLocation(self.player, name, LOCATION_TABLE[name], region))

    def create_regions(self) -> None:
        menu = Region("Menu", self.player, self.multiworld)
        self.multiworld.regions.append(menu)

        mode = self.options.location_mode.value
        with_floors = mode in (LocationMode.option_floors, LocationMode.option_both)
        with_biomes = mode in (LocationMode.option_biome_floors, LocationMode.option_both)

        # One region per block of 10 floors: block k needs k Floor Passes
        blocks: List[Region] = []
        previous = menu
        for block in range(BLOCK_COUNT):
            first, last = block * GATE_INTERVAL + 1, (block + 1) * GATE_INTERVAL
            region = Region(f"Floors {first}-{last}", self.player, self.multiworld)
            if with_floors:
                for wave in range(first, min(last, FINAL_WAVE - 1) + 1):
                    self.add_location(region, wave_location_name(wave))
            self.multiworld.regions.append(region)
            previous.connect(region, f"Floor Pass {block}",
                             lambda state, p=block: state.has(FLOOR_PASS, self.player, p))
            blocks.append(region)
            previous = region

        # Biome floors: available from the first block where the biome can be reached
        if with_biomes:
            for biome_id, depth in sorted(BIOME_DEPTHS.items()):
                for floor in biome_floors(biome_id):
                    self.add_location(blocks[depth], biome_location_name(BIOME_NAMES[biome_id], floor))

        per_tier = self.options.shop_items_per_tier.value
        per_visit = self.options.shop_items_per_visit.value
        for index in range(1, self.get_shop_item_count() + 1):
            wave = shop_item_wave(index, per_tier, per_visit)
            self.add_location(blocks[(wave - 1) // GATE_INTERVAL], shop_location_name(index))

        goal_region = blocks[-1]
        victory = PokeRogueLocation(self.player, f"Floor {FINAL_WAVE} Cleared", None, goal_region)
        victory.place_locked_item(self.create_item(VICTORY))
        goal_region.locations.append(victory)

    def create_items(self) -> None:
        location_count = len(self.multiworld.get_unfilled_locations(self.player))
        pool: List[Item] = []

        # Floor passes: one per gate between the first floor block and the last one
        pool += [self.create_item(FLOOR_PASS) for _ in range(BLOCK_COUNT - 1)]

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

        # Bonus items (never more copies than the game lets the player hold) and held items once each,
        # while there is room
        copies = self.options.bonus_item_copies.value
        for copy in range(copies):
            for name, _id, category, _cls in ITEMS:
                if category != "bonus" or len(pool) >= location_count:
                    continue
                held_max = ITEM_MAX.get(name, 1) - (1 if name == MAP and start_with_map else 0)
                if copy < held_max:
                    pool.append(self.create_item(name))
            if copy == 0:
                for name, _id, category, _cls in ITEMS:
                    if category == "held" and len(pool) < location_count:
                        pool.append(self.create_item(name))

        # Fill the remaining locations with consumables, eggs, battle effects and traps
        while len(pool) < location_count:
            pool.append(self.create_item(self.get_filler_item_name()))

        self.multiworld.itempool += pool

    def set_rules(self) -> None:
        self.multiworld.completion_condition[self.player] = lambda state: state.has(VICTORY, self.player)

    def fill_slot_data(self) -> Dict[str, object]:
        return {
            "location_mode": self.options.location_mode.value,
            "shop_item_count": self.get_shop_item_count(),
            "shop_items_per_tier": self.options.shop_items_per_tier.value,
            "shop_items_per_visit": self.options.shop_items_per_visit.value,
            "shop_cost_percent": self.options.shop_cost_percent.value,
            "death_link": bool(self.options.death_link.value),
            "final_wave": FINAL_WAVE,
        }
