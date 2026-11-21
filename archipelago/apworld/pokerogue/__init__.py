"""
PokeRogue for Archipelago.

Locations: clearing each floor (1-199) and/or each floor of each biome, buying the Archipelago items offered in
the shops, and obtaining Pokemon (Dexsanity, optional).
Items: Progressive Floor Passes (needed to go past each floor multiple of 10), Biome Passes (optional),
starter Pokemon unlocks, Starter Limit +1, consumables, held items, permanent bonus items, eggs, battle effects and
traps. Goal: beat Eternatus on the last floor, or obtain every Pokemon of the Dexsanity list.

Item / location ids come from data.py, generated from the game sources
(node archipelago/generate-apworld-data.mjs).
"""
from collections import deque
import logging
from typing import Dict, List, Optional, Set

from BaseClasses import CollectionState, Item, ItemClassification, Location, Region
from Options import OptionError
from worlds.AutoWorld import WebWorld, World

from .data import (BASE_ID, BIOME_LOCATION_OFFSET, BIOME_PASS_OFFSET, BIOMES, BLITZ_FINAL_WAVE,
                   BLITZ_SHOP_TIER_WAVES, DEX_LOCATION_OFFSET, DEX_SPECIES, FINAL_WAVE, GAME_NAME, GATE_INTERVAL,
                   ITEM_MAX, ITEMS, POKEMON, POKEMON_INFO, POKEMON_ITEM_OFFSET, SHOP_LOCATION_OFFSET, SHOP_TIER_WAVES,
                   WAVE_BONUS_LOCATION_OFFSET, WAVE_LOCATION_OFFSET)
from .options import BiomePasses, Dexsanity, Goal, LimitedSupport, LocationMode, PokemonPoolCosts, PokeRogueOptions

FLOOR_PASS = "Progressive Floor Pass"
VICTORY = "Victory"
MAP = "Map"
STARTER_LIMIT = "Starter Limit +1"

TOWN_BIOME = 0
END_BIOME = 50

# Starting Pokemon: at least one costs this much (to avoid a too weak starting team)
STRONG_STARTER_MIN_COST = 5
# Starting Pokemon (2 or more): their average cost stays within these bounds (not too many expensive ones)
STARTER_AVERAGE_COST_MIN = 3
STARTER_AVERAGE_COST_MAX = 3.5
# Pokemon in the pool with a low_cost / high_cost bias: weight factor of a cost against the next one
POOL_COST_BIAS = 1.5
# Biome Pass priority: a PokeRogue location never holds the pass of a biome reached this many blocks before it or more
BIOME_PASS_BLOCK_SLACK = 2

# Key trainers giving a hint once beaten (`trainer_hint_locations` slot data): the story battles by their Classic
# floor (rivals, evil team admins and bosses, Elite Four, Champion; the same battles in a Blitz run), and the n-th Gym
# Leader of the run
HINT_TRAINER_KEYS = ([f"fixed_{wave}" for wave in (8, 25, 55, 66, 95, 114, 115, 145, 164, 165, 182, 184, 186, 188, 190,
                                                   195)]
                     + [f"gym_{index}" for index in range(1, 7)])

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
POKEMON_COSTS: Dict[str, int] = {name: cost for name, _id, cost in POKEMON}

# Strong consumables kept out of the random fillers
RARE_CONSUMABLES = {"Sacred Ash", "Rarer Candy", "Master Ball", "DNA Splicers"}
# Items placed once in the pool (the game keeps them for every run, at most once per run)
ONCE_PER_WORLD = ["DNA Splicers"]
CONSUMABLE_FILLERS = [name for name, _id, cat, _cls in ITEMS if cat == "consumable" and name not in RARE_CONSUMABLES]
EFFECT_FILLERS = [name for name, _id, cat, _cls in ITEMS if cat == "effect"]
TRAPS = [name for name, _id, cat, _cls in ITEMS if cat == "trap"]

MAX_SHOP_ITEMS = 350
# Blocks of 10 floors of a Classic run (the Blitz option has BLITZ_FINAL_WAVE // GATE_INTERVAL)
BLOCK_COUNT = FINAL_WAVE // GATE_INTERVAL


def wave_location_name(wave: int) -> str:
    return f"Floor {wave} Cleared"


def wave_bonus_location_name(wave: int) -> str:
    return f"Floor {wave} Bonus"


def shop_location_name(index: int) -> str:
    return f"Shop Item {index}"


def biome_location_name(biome_name: str, floor: int) -> str:
    return f"{biome_name} - Floor {floor}"


def compute_biome_depths() -> Dict[int, int]:
    """
    Earliest floor block (0 = floors 1-10) where each biome can be visited in a Classic run.
    The run starts in the Town, the biome changes after each floor multiple of 10 following the biome links
    (weighted links are only offered sometimes, but are offered eventually), and the End is forced for the last
    block. With the Blitz option (10 blocks) every biome keeps its depth (the deepest one is 6) and the End moves
    to the last block: see PokeRogueWorld.get_biome_depth.
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
BIOME_PASS_IDS: Dict[str, int] = {name: biome_id for biome_id, name in BIOME_PASSES.items()}
# The only Biome Pass with `biome_passes: end_only`: needed to enter the End (last block of floors)
END_PASS = biome_pass_name(END_BIOME)
ITEM_TABLE[END_PASS] = BASE_ID + BIOME_PASS_OFFSET + END_BIOME

# Dexsanity species, by species id: (name, generation, types, legendary, starter id, pre-evolution id, biome ids)
DEX_BY_ID: Dict[int, tuple] = {species_id: rest for species_id, *rest in DEX_SPECIES}
# Species id of each starter Pokemon item
POKEMON_SPECIES_ID: Dict[str, int] = {name: item_id - BASE_ID - POKEMON_ITEM_OFFSET for name, item_id, _cost in POKEMON}


def dex_location_name(species_id: int) -> str:
    return f"Dex - {DEX_BY_ID[species_id][0]}"


def dex_location_id(species_id: int) -> int:
    return BASE_ID + DEX_LOCATION_OFFSET + species_id


def can_reach_biome(state: CollectionState, player: int, target: int, block_count: int = BLOCK_COUNT) -> bool:
    """
    Whether a run can get to the biome with the Floor Passes and Biome Passes collected: the biome changes after each
    floor multiple of 10 (block k needs k Floor Passes), only towards unlocked biomes.
    Going back to the Town (no unlocked next biome) never reaches a biome sooner, so it is not followed.
    """
    max_depth = min(state.count(FLOOR_PASS, player), block_count - 2)
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
LOCATION_TABLE.update({wave_bonus_location_name(w): BASE_ID + WAVE_BONUS_LOCATION_OFFSET + w
                       for w in range(1, FINAL_WAVE)})
LOCATION_TABLE.update({shop_location_name(i): BASE_ID + SHOP_LOCATION_OFFSET + i for i in range(1, MAX_SHOP_ITEMS + 1)})
for _biome_id in sorted(BIOME_DEPTHS):
    for _floor in biome_floors(_biome_id):
        LOCATION_TABLE[biome_location_name(BIOME_NAMES[_biome_id], _floor)] = biome_location_id(_biome_id, _floor)
LOCATION_TABLE.update({dex_location_name(species_id): dex_location_id(species_id) for species_id in DEX_BY_ID})


def shop_item_wave(index: int, per_tier: int, tier_waves: List[int] = SHOP_TIER_WAVES) -> Optional[int]:
    """
    First floor of the shop tier that unlocks the given (1-based) shop item, like the game client: the items are
    unlocked by batches of `per_tier` each time the regular shop gets new items (all at once if `per_tier` is 0).
    Each shop only offers the first `shop_items_per_visit` items not bought yet, but bought items stay bought from
    one run to the next, so over enough runs every item of the tier can be bought from that floor on.
    @returns None if the item is never unlocked (past the last tier)
    """
    tier = (index - 1) // per_tier if per_tier > 0 else 0
    if tier >= len(tier_waves):
        return None
    return tier_waves[tier]


class PokeRogueItem(Item):
    game = GAME_NAME


class PokeRogueLocation(Location):
    game = GAME_NAME


class PokeRogueWeb(WebWorld):
    theme = "grass"


class PokeRogueWorld(World):
    """
    PokeRogue is a Pokemon roguelite: climb 200 floors (100 with the Blitz option) with a team of starters, picking
    items between battles.
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
        "Biome Passes": set(BIOME_PASSES.values()) | {END_PASS},
        "Battle Effects": set(EFFECT_FILLERS),
        "Traps": set(TRAPS),
    }

    starting_pokemon: List[str]

    def generate_early(self) -> None:
        if self.options.goal.value == Goal.option_pokedex:
            if self.options.dexsanity.value == Dexsanity.option_false:
                raise OptionError(f"{self.player_name}: the pokedex goal needs the dexsanity option")
        # Picked before the regions: the starting Pokemon are left out of the Dexsanity list
        self.starting_pokemon = self.pick_starting_pokemon()
        if self.options.goal.value == Goal.option_pokedex and not self.get_dex_species():
            raise OptionError(f"{self.player_name}: the pokedex goal needs at least one Pokemon in the Dexsanity list")

    def uses_biome_passes(self) -> bool:
        """`biome_passes: true`: every biome but the Town and the End needs its pass"""
        return self.options.biome_passes.value == BiomePasses.option_true

    def uses_end_pass(self) -> bool:
        """`biome_passes: end_only`: only the End needs a pass"""
        return self.options.biome_passes.value == BiomePasses.option_end_only

    def can_reach_end(self, state: CollectionState) -> bool:
        """Whether a run can get to the End (the last block of floors)"""
        return (state.has(FLOOR_PASS, self.player, self.get_block_count() - 1)
                and (not self.uses_end_pass() or state.has(END_PASS, self.player)))

    def can_reach_biome_floors(self, state: CollectionState, biome_id: int) -> bool:
        """Whether a run can get to the biome (Floor Passes, and Biome Passes with `biome_passes: true`)"""
        if biome_id == TOWN_BIOME:
            return True
        if biome_id == END_BIOME:
            return self.can_reach_end(state)
        if biome_id not in BIOME_DEPTHS:
            return False
        if self.uses_biome_passes() and biome_id in BIOME_PASSES:
            return can_reach_biome(state, self.player, biome_id, self.get_block_count())
        return state.has(FLOOR_PASS, self.player, BIOME_DEPTHS[biome_id])

    def get_dex_species(self) -> List[int]:
        """
        Species with a Dexsanity check: the starters (`starters`) or every species (`all`) usable with the Mono
        Generation / Mono Type challenges, except the starting Pokemon and the excluded ones
        """
        mode = self.options.dexsanity.value
        if mode == Dexsanity.option_false:
            return []
        excluded = set(self.options.dexsanity_exclude.value)
        no_legendaries = "Legendaries" in excluded
        starting = {POKEMON_SPECIES_ID[name] for name in self.starting_pokemon}
        if mode == Dexsanity.option_starters:
            candidates = [POKEMON_SPECIES_ID[name] for name in self.get_usable_pokemon()]
        else:
            generation = self.options.mono_generation.value
            mono_type = self.get_mono_type()
            candidates = [species_id for species_id, (_name, gen, types, *_rest) in DEX_BY_ID.items()
                          if (not generation or gen == generation) and (mono_type is None or mono_type in types)]
        return sorted(species_id for species_id in candidates
                      if species_id in DEX_BY_ID and species_id not in starting
                      and DEX_BY_ID[species_id][0] not in excluded
                      and not (no_legendaries and DEX_BY_ID[species_id][3]))

    def get_dex_biomes(self, species_id: int) -> Set[int]:
        """
        Biomes where obtaining the species can be done: where it is met in the wild, and where a Pokemon of its line
        is met (`starters`: any Pokemon of the line counts) or one of its pre-evolutions (`all`: it evolves)
        """
        if self.options.dexsanity.value == Dexsanity.option_starters:
            return {biome for line_id, (_n, _g, _t, _l, starter, _p, biomes) in DEX_BY_ID.items()
                    if starter == species_id for biome in biomes}
        biomes: Set[int] = set()
        current: Optional[int] = species_id
        while current is not None and current in DEX_BY_ID:
            biomes |= set(DEX_BY_ID[current][6])
            current = DEX_BY_ID[current][5]
        return biomes

    def is_blitz(self) -> bool:
        return bool(self.options.blitz.value)

    def get_final_wave(self) -> int:
        return BLITZ_FINAL_WAVE if self.is_blitz() else FINAL_WAVE

    def get_block_count(self) -> int:
        return self.get_final_wave() // GATE_INTERVAL

    def get_shop_tier_waves(self) -> List[int]:
        return BLITZ_SHOP_TIER_WAVES if self.is_blitz() else SHOP_TIER_WAVES

    def get_biome_depth(self, biome_id: int) -> int:
        """Earliest block where the biome can be visited (the End is forced on the last block)."""
        return self.get_block_count() - 1 if biome_id == END_BIOME else BIOME_DEPTHS[biome_id]

    def get_shop_item_count(self) -> int:
        # The Limited Support challenge can remove the shop
        if self.options.limited_support.value in (LimitedSupport.option_no_shop, LimitedSupport.option_both):
            return 0
        # Only the items unlocked by one of the shop tiers exist (at most 7 times shop_items_per_tier)
        per_tier = self.options.shop_items_per_tier.value
        count = self.options.shop_item_count.value
        return min(count, len(self.get_shop_tier_waves()) * per_tier) if per_tier > 0 else count

    def create_item(self, name: str) -> Item:
        if name == VICTORY:
            return PokeRogueItem(name, ItemClassification.progression, None, self.player)
        if name in ITEM_CLASSIFICATION:
            classification = CLASSIFICATIONS[ITEM_CLASSIFICATION[name]]
        elif name == END_PASS:
            # Needed to reach the last floors
            classification = ItemClassification.progression
        elif name in BIOME_PASSES.values():
            # Only needed to reach the biome floor checks and the Dexsanity checks
            classification = (ItemClassification.progression
                              if self.has_biome_locations() or self.options.dexsanity.value
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
        Random starting Pokemon: none above the maximum cost, at least one strong one, no type appearing twice
        (with Mono Type, only the other type of each Pokemon counts), and with 2 Pokemon or more an average cost
        between 3 and 3.5.
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

        costs = dict(allowed)
        cheapest = min(costs.values())
        # Total cost bounds (no bound for a single Pokemon: it is the strong one)
        min_total = STARTER_AVERAGE_COST_MIN * count if count > 1 else 0
        max_total = STARTER_AVERAGE_COST_MAX * count if count > 1 else float("inf")

        best: List[str] = []
        best_cost_ok = False
        for _attempt in range(200):
            chosen = [self.random.choice(strong)]
            used = types(chosen[0])
            total = costs[chosen[0]]
            others = [name for name, _cost in allowed if name != chosen[0]]
            self.random.shuffle(others)
            for name in others:
                if len(chosen) >= count:
                    break
                # Keep room for the Pokemon still to pick, at the cheapest cost
                if total + costs[name] + cheapest * (count - len(chosen) - 1) > max_total:
                    continue
                if not types(name) & used:
                    chosen.append(name)
                    used |= types(name)
                    total += costs[name]
            cost_ok = min_total <= total <= max_total
            if (len(chosen), cost_ok) > (len(best), best_cost_ok):
                best, best_cost_ok = chosen, cost_ok
            if len(best) >= count and best_cost_ok:
                break
        if len(best) >= count and not best_cost_ok:
            logging.warning(f"PokeRogue ({self.player_name}): the starting Pokemon could not be given an average "
                            f"cost between {STARTER_AVERAGE_COST_MIN} and {STARTER_AVERAGE_COST_MAX}")
        if len(best) < count:
            # Not enough Pokemon with types not used yet (narrow challenges): complete with any other one
            logging.warning(f"PokeRogue ({self.player_name}): only {len(best)} starting Pokemon with different "
                            f"types could be found, the others may share a type")
            others = [name for name, _cost in allowed if name not in best]
            best += self.random.sample(others, min(count - len(best), len(others)))
        self.random.shuffle(best)
        return best

    def pick_pool_pokemon(self, candidates: List[str], count: int) -> List[str]:
        """
        Pokemon shuffled into the multiworld, following pokemon_pool_costs: at random, the same number of each
        cost (varied), or with a bias towards the cheap or expensive costs (a cost is drawn with a weight growing
        by POOL_COST_BIAS per cost step, among the costs that still have Pokemon, then a Pokemon of that cost).
        """
        mode = self.options.pokemon_pool_costs.value
        if mode == PokemonPoolCosts.option_unbiased:
            picked = list(candidates)
            self.random.shuffle(picked)
            return picked[:count]

        by_cost: Dict[int, List[str]] = {}
        for name in candidates:
            by_cost.setdefault(POKEMON_COSTS[name], []).append(name)
        for names in by_cost.values():
            self.random.shuffle(names)

        picked: List[str] = []
        if mode == PokemonPoolCosts.option_varied:
            # One Pokemon of each cost in turn (random order of the costs at each round)
            while len(picked) < count:
                costs = [cost for cost, names in by_cost.items() if names]
                self.random.shuffle(costs)
                for cost in costs[:count - len(picked)]:
                    picked.append(by_cost[cost].pop())
            return picked

        low = mode == PokemonPoolCosts.option_low_cost
        while len(picked) < count:
            costs = [cost for cost, names in by_cost.items() if names]
            weights = [POOL_COST_BIAS ** (-cost if low else cost) for cost in costs]
            cost = self.random.choices(costs, weights=weights)[0]
            picked.append(by_cost[cost].pop())
        return picked

    @classmethod
    def stage_fill_hook(cls, multiworld, progitempool, usefulitempool, filleritempool, fill_locations) -> None:
        """
        Biome Pass priority: the progression fill places the items of a player from the end of the pool to its
        start, and the items placed last can only go where the items already placed lead, so they land earlier in
        the multiworld. The passes of the near biomes are moved to the start of the pool (the nearest first) and
        those of the far biomes to its end (the farthest last).
        """
        for world in multiworld.get_game_worlds(GAME_NAME):
            if not (world.uses_biome_passes() and world.options.biome_pass_priority.value
                    and world.has_biome_locations()):
                continue
            passes = [item for item in progitempool if item.player == world.player and item.name in BIOME_PASS_IDS]
            if not passes:
                continue
            pass_ids = {id(item) for item in passes}
            progitempool[:] = [item for item in progitempool if id(item) not in pass_ids]
            world.random.shuffle(passes)  # random order within a depth (the sort below is stable)
            passes.sort(key=lambda item: BIOME_DEPTHS[BIOME_PASS_IDS[item.name]])
            middle = max(BIOME_DEPTHS[BIOME_PASS_IDS[item.name]] for item in passes) / 2
            near = [item for item in passes if BIOME_DEPTHS[BIOME_PASS_IDS[item.name]] <= middle]
            far = [item for item in passes if BIOME_DEPTHS[BIOME_PASS_IDS[item.name]] > middle]
            progitempool[:0] = near
            progitempool += far

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

        final_wave = self.get_final_wave()
        block_count = self.get_block_count()
        with_bonus = with_floors and self.options.floor_checks.value >= 2

        # One region per block of 10 floors: block k needs k Floor Passes
        blocks: List[Region] = []
        previous = menu
        for block in range(block_count):
            first, last = block * GATE_INTERVAL + 1, (block + 1) * GATE_INTERVAL
            region = Region(f"Floors {first}-{last}", self.player, self.multiworld)
            if with_floors:
                for wave in range(first, min(last, final_wave - 1) + 1):
                    self.add_location(region, wave_location_name(wave))
                    if with_bonus:
                        self.add_location(region, wave_bonus_location_name(wave))
            self.multiworld.regions.append(region)
            if block == block_count - 1:
                # The End: every Floor Pass, and the End Pass with `biome_passes: end_only`
                previous.connect(region, f"Floor Pass {block}", lambda state: self.can_reach_end(state))
            else:
                previous.connect(region, f"Floor Pass {block}",
                                 lambda state, p=block: state.has(FLOOR_PASS, self.player, p))
            blocks.append(region)
            previous = region

        # Biome floors: available from the first block where the biome can be reached (with Biome Passes, also
        # needs the passes of a path from the Town to the biome)
        if with_biomes:
            biome_passes = self.uses_biome_passes()
            for biome_id in sorted(BIOME_DEPTHS):
                depth = self.get_biome_depth(biome_id)
                for floor in biome_floors(biome_id):
                    location = self.add_location(blocks[depth], biome_location_name(BIOME_NAMES[biome_id], floor))
                    if biome_passes and biome_id in BIOME_PASSES:
                        location.access_rule = lambda state, b=biome_id: can_reach_biome(state, self.player, b,
                                                                                         block_count)

        # Shop items: available from the block of their tier's first floor (over several runs if needed)
        per_tier = self.options.shop_items_per_tier.value
        tier_waves = self.get_shop_tier_waves()
        for index in range(1, self.get_shop_item_count() + 1):
            wave = shop_item_wave(index, per_tier, tier_waves)
            self.add_location(blocks[(wave - 1) // GATE_INTERVAL], shop_location_name(index))

        # Biome Pass priority: the PokeRogue locations of a block don't hold the passes of the biomes much closer
        if with_biomes and self.uses_biome_passes() and self.options.biome_pass_priority.value:
            for block, region in enumerate(blocks):
                for location in region.locations:
                    location.item_rule = lambda item, b=block: not (
                        item.player == self.player and item.name in BIOME_PASS_IDS
                        and BIOME_DEPTHS[BIOME_PASS_IDS[item.name]] + BIOME_PASS_BLOCK_SLACK < b)

        # Dexsanity: obtaining each Pokemon of the list, in a biome where it (or its line) can be met, or on the
        # first floor of the End (which offers any Pokemon not obtained yet)
        dex_locations: List[Location] = []
        for species_id in self.get_dex_species():
            location = self.add_location(menu, dex_location_name(species_id))
            location.access_rule = (lambda state, biomes=frozenset(self.get_dex_biomes(species_id)):
                                    self.can_reach_end(state)
                                    or any(self.can_reach_biome_floors(state, b) for b in biomes))
            dex_locations.append(location)

        if self.options.goal.value == Goal.option_pokedex:
            victory = PokeRogueLocation(self.player, "Pokedex Complete", None, menu)
            # The Dexsanity locations are all in the menu region: their own rules are enough
            victory.access_rule = lambda state: all(location.access_rule(state) for location in dex_locations)
            victory.place_locked_item(self.create_item(VICTORY))
            menu.locations.append(victory)
        else:
            goal_region = blocks[-1]
            victory = PokeRogueLocation(self.player, f"Floor {final_wave} Cleared", None, goal_region)
            victory.place_locked_item(self.create_item(VICTORY))
            goal_region.locations.append(victory)

    def create_items(self) -> None:
        location_count = len(self.multiworld.get_unfilled_locations(self.player))
        pool: List[Item] = []

        # Floor passes: one per gate between the first floor block and the last one
        pool += [self.create_item(FLOOR_PASS) for _ in range(self.get_block_count() - 1)]

        # Biome passes: one per biome except the Town and the End, or the End one only
        if self.uses_biome_passes():
            pool += [self.create_item(name) for name in BIOME_PASSES.values()]
        elif self.uses_end_pass():
            pool.append(self.create_item(END_PASS))

        # Pokemon: a few to start with, some more shuffled in the multiworld (only usable ones with the challenges)
        starting = self.starting_pokemon
        for name in starting:
            self.multiworld.push_precollected(self.create_item(name))
        remaining = [name for name in self.get_usable_pokemon() if name not in starting]
        pokemon_count = min(self.options.pokemon_in_pool.value, len(remaining), max(0, location_count - len(pool)))
        pool += [self.create_item(name) for name in self.pick_pool_pokemon(remaining, pokemon_count)]

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
            "biome_passes": self.uses_biome_passes(),
            "end_pass": self.uses_end_pass(),
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
            "blitz": self.is_blitz(),
            "floor_checks": self.options.floor_checks.value,
            "final_wave": self.get_final_wave(),
            "shop_tier_waves": self.get_shop_tier_waves(),
            "goal": self.options.goal.value,
            "dexsanity": self.options.dexsanity.value,
            "dexsanity_species": self.get_dex_species(),
            "trainer_hint_locations": self.get_trainer_hint_locations(),
        }

    def get_trainer_hint_locations(self) -> Dict[str, int]:
        """
        Location hinted by each key trainer, chosen once the items are placed: progression items for other players
        first, then this player's progression items, then useful items, then any item (all different)
        """
        if not self.options.trainer_hints.value:
            return {}
        groups: List[List[Location]] = [[], [], [], [], []]
        for location in self.multiworld.get_locations(self.player):
            item = location.item
            if location.address is None or item is None or item.code is None:
                continue
            other = item.player != self.player
            if item.advancement:
                groups[0 if other else 1].append(location)
            elif item.useful:
                groups[2 if other else 3].append(location)
            else:
                groups[4].append(location)
        chosen: List[int] = []
        for group in groups:
            group.sort(key=lambda location: location.address)
            self.random.shuffle(group)
            chosen += [location.address for location in group]
        keys = list(HINT_TRAINER_KEYS)
        self.random.shuffle(keys)
        return dict(zip(keys, chosen))
