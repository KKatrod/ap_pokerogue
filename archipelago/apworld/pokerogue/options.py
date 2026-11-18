from dataclasses import dataclass

from Options import DefaultOnToggle, PerGameCommonOptions, Range


class ShopItemCount(Range):
    """Total number of Archipelago items that can be bought in the shops (one location each)."""
    display_name = "Shop Item Count"
    range_start = 0
    range_end = 150
    default = 30


class ShopItemsPerVisit(Range):
    """How many Archipelago items are offered at most in each shop visit."""
    display_name = "Shop Items Per Visit"
    range_start = 1
    range_end = 3
    default = 1


class ShopCostPercent(Range):
    """Price of an Archipelago shop item, in percent of the money earned in a wave."""
    display_name = "Shop Cost Percent"
    range_start = 10
    range_end = 500
    default = 100


class StartingPokemon(Range):
    """Number of random starter Pokemon you begin with."""
    display_name = "Starting Pokemon"
    range_start = 1
    range_end = 10
    default = 3


class StartingPokemonMaxCost(Range):
    """Maximum starter cost of the starting Pokemon (legendaries cost 7 to 10).
    At least one starting Pokemon costs 5 or more (or this maximum if it is lower)."""
    display_name = "Starting Pokemon Max Cost"
    range_start = 1
    range_end = 10
    default = 6


class StartWithMap(DefaultOnToggle):
    """Start every run with a Map (lets you choose the next biome)."""
    display_name = "Start With Map"


class EggFillerPercent(Range):
    """Percentage of the filler items that are eggs (hatched during Archipelago runs) instead of consumables."""
    display_name = "Egg Filler Percent"
    range_start = 0
    range_end = 100
    default = 25


class PokemonInPool(Range):
    """Number of starter Pokemon unlocks shuffled into the multiworld."""
    display_name = "Pokemon In Pool"
    range_start = 0
    range_end = 300
    default = 40


@dataclass
class PokeRogueOptions(PerGameCommonOptions):
    shop_item_count: ShopItemCount
    shop_items_per_visit: ShopItemsPerVisit
    shop_cost_percent: ShopCostPercent
    starting_pokemon: StartingPokemon
    starting_pokemon_max_cost: StartingPokemonMaxCost
    start_with_map: StartWithMap
    pokemon_in_pool: PokemonInPool
    egg_filler_percent: EggFillerPercent
