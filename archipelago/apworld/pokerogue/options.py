from dataclasses import dataclass

from Options import Choice, DeathLink, DefaultOnToggle, PerGameCommonOptions, Range


class LocationMode(Choice):
    """Which floor checks exist.
    floors: one check per floor cleared (Floor 1 Cleared ... Floor 199 Cleared).
    biome_floors: one check per floor of each biome (Town - Floor 1 ... Town - Floor 10, Plains - Floor 1...).
    A biome only counts once it can be reached, e.g. Metropolis (after Plains) needs the first Floor Pass.
    both: both kinds of checks."""
    display_name = "Location Mode"
    option_floors = 0
    option_biome_floors = 1
    option_both = 2
    default = 0


class ShopItemCount(Range):
    """Total number of Archipelago items that can be bought in the shops (one location each)."""
    display_name = "Shop Item Count"
    range_start = 0
    range_end = 150
    default = 30


class ShopItemsPerTier(Range):
    """Number of Archipelago shop items made available each time the regular shop gets new items
    (floors 1, 21, 51, 81, 111, 141 and 171). 0: every Archipelago shop item is available from floor 1.
    The total is limited to 7 times this value."""
    display_name = "Shop Items Per Tier"
    range_start = 0
    range_end = 150
    default = 10


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


class BonusItemCopies(Range):
    """Copies of each permanent bonus item (Exp. Share, charms, Amulet Coin...) in the item pool.
    Never more than the game allows to hold (e.g. 5 Exp. Share, 1 Mega Bracelet).
    A copy received while the item is already at its maximum is converted into money (like a Nugget)."""
    display_name = "Bonus Item Copies"
    range_start = 1
    range_end = 5
    default = 1


class EggFillerPercent(Range):
    """Percentage of the filler items that are eggs (hatched during Archipelago runs) instead of consumables."""
    display_name = "Egg Filler Percent"
    range_start = 0
    range_end = 100
    default = 25


class EffectFillerPercent(Range):
    """Percentage of the filler items that are positive battle effects
    (Stat Boost, Reflect, Light Screen, Safeguard, Mist), applied at the next turn of a battle."""
    display_name = "Effect Filler Percent"
    range_start = 0
    range_end = 100
    default = 10


class TrapPercent(Range):
    """Percentage of the filler items replaced by traps: money loss, held item drop, status
    (poison, paralysis, burn, sleep, confusion) or stat drop on the active Pokemon."""
    display_name = "Trap Percent"
    range_start = 0
    range_end = 100
    default = 0


class PokemonInPool(Range):
    """Number of starter Pokemon unlocks shuffled into the multiworld."""
    display_name = "Pokemon In Pool"
    range_start = 0
    range_end = 300
    default = 40


@dataclass
class PokeRogueOptions(PerGameCommonOptions):
    location_mode: LocationMode
    shop_item_count: ShopItemCount
    shop_items_per_tier: ShopItemsPerTier
    shop_items_per_visit: ShopItemsPerVisit
    shop_cost_percent: ShopCostPercent
    starting_pokemon: StartingPokemon
    starting_pokemon_max_cost: StartingPokemonMaxCost
    start_with_map: StartWithMap
    pokemon_in_pool: PokemonInPool
    bonus_item_copies: BonusItemCopies
    egg_filler_percent: EggFillerPercent
    effect_filler_percent: EffectFillerPercent
    trap_percent: TrapPercent
    death_link: DeathLink
