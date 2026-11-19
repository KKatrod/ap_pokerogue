"""
PokeRogue for Archipelago.

Locations: clearing each floor (1-199) and/or each floor of each biome, and buying the Archipelago items
offered in the shops.
Items: Progressive Floor Passes (needed to go past each floor multiple of 10), Biome Passes (optional),
starter Pokemon unlocks, Starter Limit +1, consumables, held items, permanent bonus items, eggs, battle effects and
traps. Goal: clear floor 200.

Item / location ids come from data.py, generated from the game sources
(node archipelago/generate-apworld-data.mjs).
"""
import math
from collections import deque
import logging
from typing import Dict, List, Optional, Set

from BaseClasses import CollectionState, Item, ItemClassification, Location, Region
from Options import OptionError
from worlds.AutoWorld import WebWorld, World

from .data import (BASE_ID, BIOME_LOCATION_OFFSET, BIOME_PASS_OFFSET, BIOMES, FINAL_WAVE, GAME_NAME, GATE_INTERVAL,
                   ITEM_MAX, ITEMS, POKEMON, POKEMON_INFO, SHOP_LOCATION_OFFSET, SHOP_TIER_WAVES,
                   WAVE_LOCATION_OFFSET)
from .options import LimitedSupport, LocationMode, PokeRogueOptions

FLOOR_PASS = "Progressive Floor Pass"
VICTORY = "Victory"
MAP = "Map"
STARTER_LIMIT = "Starter Limit +1"

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

# PokemonType order of the game (the Mono Type challenge value is this index + 1)
POKEMON_TYPES = ["NORMAL", "FIGHTING", "FLYING", "POISON", "GROUND", "ROCK", "BUG", "GHOST", "STEEL", "FIRE", "WATER",
                 "GRASS", "ELECTRIC", "PSYCHIC", "ICE", "DRAGON", "DARK", "FAIRY"]

ITEM_TABLE: Dict[str, int] = {name: item_id for name, item_id, _category, _cls in ITEMS}
ITEM_TABLE.update({name: item_id for name, item_id, _cost in POKEMON})
ITEM_CATEGORY: Dict[str, str] = {name: category for name, _id, category, _cls in ITEMS}
ITEM_CLASSIFICATION: Dict[str, str] = {name: cls for name, _id, _category, cls in ITEMS}

# Strong consumables kept out of the random fillers
RARE_CONSUMABLES = {"Sacred Ash", "Rarer Candy", "Master Ball", "DNA Splicers"}
# Items placed once in the pool (the game keeps them for every run, at most once per run)
ONCE_PER_WORLD = ["DNA Splicers"]
CONSUMABLE_FILLERS = [name for name, _id, cat, _cls in ITEMS if cat == "consumable" and name not in RARE_CONSUMABLES]
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
BIOME_LINKS = {biome_id: links for biome_id, _name, links in BIOMES}


def biome_pass_name(biome_id: int) -> str:
    return f"Biome Pass - {BIOME_NAMES[biome_id]}"


# Every biome except the Town (start, and fallback when no next biome is unlocked) and the End (forced at the end)
BIOME_PASSES: Dict[int, str] = {biome_id: biome_pass_name(biome_id) for biome_id in sorted(BIOME_DEPTHS)
                                if biome_id not in (TOWN_BIOME, END_BIOME)}
ITEM_TABLE.update({name: BASE_ID + BIOME_PASS_OFFSET + biome_id for biome_id, name in BIOME_PASSES.items()})


def can_reach_biome(state: CollectionState, player: int, target: int) -> bool:
    """
    Whether a run can get to the biome with the Floor Passes and Biome Passes collected: the biome changes after each
    floor multiple of 10 (block k needs k Floor Passes), only towards unlocked biomes.
    Going back to the Town (no unlocked next biome) never reaches a biome sooner, so it is not followed.
    """
    max_depth = min(state.count(FLOOR_PASS, player), BLOCK_COUNT - 2)
    seen: Set[int] = {TOWN_BIOME}
    frontier: Set[int] = {TOWN_BIOME}
    for _depth in range(max_depth):
        if target in seen:
            return True
        frontier = {link for biome in frontier for link in BIOME_LINKS.get(biome, [])
                    if link != END_BIOME and link not in seen and state.has(BIOME_PASSES[link], player)}
        if not frontier:
            break
        seen |= frontier
    return target in seen


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
        "Biome Passes": set(BIOME_PASSES.values()),
        "Battle Effects": set(EFFECT_FILLERS),
        "Traps": set(TRAPS),
    }

    def get_shop_item_count(self) -> int:
        # The Limited Support challenge can remove the shop
        if self.options.limited_support.value in (LimitedSupport.option_no_shop, LimitedSupport.option_both):
            return 0
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
        elif name in BIOME_PASSES.values():
            # Only needed to reach the biome floor checks
            classification = (ItemClassification.progression if self.has_biome_locations()
                              else ItemClassification.useful)
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

    def has_biome_locations(self) -> bool:
        return self.options.location_mode.value in (LocationMode.option_biome_floors, LocationMode.option_both)

    def get_mono_type(self) -> Optional[str]:
        value = self.options.mono_type.value
        return POKEMON_TYPES[value - 1] if value else None

    def get_usable_pokemon(self) -> List[str]:
        """Starter Pokemon usable with the Mono Generation / Mono Type challenges."""
        generation = self.options.mono_generation.value
        mono_type = self.get_mono_type()
        return [name for name, _id, _cost in POKEMON
                if (not generation or POKEMON_INFO[name][0] == generation)
                and (mono_type is None or mono_type in POKEMON_INFO[name][1])]

    def pick_starting_pokemon(self) -> List[str]:
        """
        Random starting Pokemon: none above the maximum cost, at least one strong one, and no type appearing twice
        (with Mono Type, only the other type of each Pokemon counts).
        """
        count = self.options.starting_pokemon.value
        max_cost = self.options.starting_pokemon_max_cost.value
        usable = set(self.get_usable_pokemon())
        allowed = [(name, cost) for name, _id, cost in POKEMON if name in usable and cost <= max_cost]
        if not allowed:
            raise OptionError(f"{self.player_name}: no starter Pokemon fits the Mono Generation / Mono Type "
                              f"challenges with a cost of {max_cost} or less")
        strong_cost = min(STRONG_STARTER_MIN_COST, max(cost for _name, cost in allowed))
        strong = [name for name, cost in allowed if cost >= strong_cost]
        mono_type = self.get_mono_type()

        def types(pokemon: str) -> Set[str]:
            return set(POKEMON_INFO[pokemon][1]) - {mono_type}

        best: List[str] = []
        for _attempt in range(200):
            chosen = [self.random.choice(strong)]
            used = types(chosen[0])
            others = [name for name, _cost in allowed if name != chosen[0]]
            self.random.shuffle(others)
            for name in others:
                if len(chosen) >= count:
                    break
                if not types(name) & used:
                    chosen.append(name)
                    used |= types(name)
            if len(chosen) > len(best):
                best = chosen
            if len(best) >= count:
                break
        if len(best) < count:
            # Not enough Pokemon with types not used yet (narrow challenges): complete with any other one
            logging.warning(f"PokeRogue ({self.player_name}): only {len(best)} starting Pokemon with different "
                            f"types could be found, the others may share a type")
            others = [name for name, _cost in allowed if name not in best]
            best += self.random.sample(others, min(count - len(best), len(others)))
        self.random.shuffle(best)
        return best

    def add_location(self, region: Region, name: str) -> Location:
        location = PokeRogueLocation(self.player, name, LOCATION_TABLE[name], region)
        region.locations.append(location)
        return location

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

        # Biome floors: available from the first block where the biome can be reached (with Biome Passes, also
        # needs the passes of a path from the Town to the biome)
        if with_biomes:
            biome_passes = bool(self.options.biome_passes.value)
            for biome_id, depth in sorted(BIOME_DEPTHS.items()):
                for floor in biome_floors(biome_id):
                    location = self.add_location(blocks[depth], biome_location_name(BIOME_NAMES[biome_id], floor))
                    if biome_passes and biome_id in BIOME_PASSES:
                        location.access_rule = lambda state, b=biome_id: can_reach_biome(state, self.player, b)

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

        # Biome passes: one per biome except the Town and the End
        if self.options.biome_passes.value:
            pool += [self.create_item(name) for name in BIOME_PASSES.values()]

        # Pokemon: a few to start with, some more shuffled in the multiworld (only usable ones with the challenges)
        starting = self.pick_starting_pokemon()
        for name in starting:
            self.multiworld.push_precollected(self.create_item(name))
        remaining = [name for name in self.get_usable_pokemon() if name not in starting]
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
                for name in ONCE_PER_WORLD:
                    if len(pool) < location_count:
                        pool.append(self.create_item(name))

        # Starter Limit +1: raise the starter points of the team (10 at first, 30 at most)
        for _ in range(self.options.starter_limit_items.value):
            if len(pool) < location_count:
                pool.append(self.create_item(STARTER_LIMIT))

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
            "trainer_hints": bool(self.options.trainer_hints.value),
            "biome_passes": bool(self.options.biome_passes.value),
            # Challenge values, by name of the game's Challenges enum (0: off)
            "challenges": {
                "SINGLE_GENERATION": self.options.mono_generation.value,
                "SINGLE_TYPE": self.options.mono_type.value,
                "LIMITED_SUPPORT": self.options.limited_support.value,
                "LIMITED_CATCH": self.options.limited_catch.value,
                "HARDCORE": self.options.hardcore.value,
                "MOVESET_RANDOMIZER": self.options.moveset_randomizer.value,
                "ABILITY_RANDOMIZER": self.options.ability_randomizer.value,
                "INVERSE_BATTLE": self.options.inverse_battle.value,
                "FLIP_STAT": self.options.flip_stat.value,
                "PASSIVES": self.options.active_passives.value,
            },
            "final_wave": FINAL_WAVE,
        }
