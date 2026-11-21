from dataclasses import dataclass

from Options import Choice, DeathLink, DefaultOnToggle, OptionSet, PerGameCommonOptions, Range, Toggle

from .data import DEX_SPECIES, POKEMON


class Goal(Choice):
    """eternatus: beat Eternatus on the last floor (200, or 100 with Blitz).
    pokedex: obtain every Pokemon of the Dexsanity list (needs dexsanity)."""
    display_name = "Goal"
    option_eternatus = 0
    option_pokedex = 1
    default = 0


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


class Dexsanity(Choice):
    """Obtaining Pokemon is a check (caught, hatched, given by an event, or evolved with "all").
    false: no Pokedex checks.
    starters: one check per starter not owned at the start, sent by obtaining any Pokemon of its line.
    all: one check per species (evolutions and regional forms included).
    The Mono Generation / Mono Type challenges restrict the list. The first floor of each block of 10 always offers
    a Pokemon of the biome not obtained yet (if any), and the first floor of the End any Pokemon not obtained yet."""
    display_name = "Dexsanity"
    option_false = 0
    option_starters = 1
    option_all = 2
    alias_starter_only = 1
    default = 0


class DexsanityExclude(OptionSet):
    """Pokemon removed from the Dexsanity list, by name (e.g. "Bulbasaur", "Alola Rattata").
    "Legendaries" removes every legendary, sub-legendary and mythical Pokemon."""
    display_name = "Dexsanity Exclude"
    valid_keys = sorted({name for _id, name, *_rest in DEX_SPECIES} | {"Legendaries"})


class ShopItemCount(Range):
    """Total number of Archipelago items that can be bought in the shops (one location each)."""
    display_name = "Shop Item Count"
    range_start = 0
    range_end = 350
    default = 70


class ShopItemsPerTier(Range):
    """Number of Archipelago shop items made available each time the regular shop gets new items
    (floors 1, 21, 51, 81, 111, 141 and 171). 0: every Archipelago shop item is available from floor 1.
    The total is limited to 7 times this value."""
    display_name = "Shop Items Per Tier"
    range_start = 0
    range_end = 50
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
    """Number of random starter Pokemon you begin with ("random" picks a number between 1 and 10).
    No type appears twice among them (with Mono Type, only their other type counts), and with 2 or more their
    average starter cost stays between 3 and 3.5."""
    display_name = "Starting Pokemon"
    range_start = 1
    range_end = 10
    default = 5


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
    """Number of starter Pokemon unlocks shuffled into the multiworld (at most every PokeRogue starter)."""
    display_name = "Pokemon In Pool"
    range_start = 0
    range_end = len(POKEMON)  # every PokeRogue starter
    default = 40


class PokemonPoolCosts(Choice):
    """Starter costs of the Pokemon shuffled into the multiworld (pokemon_in_pool).
    unbiased: picked at random among the usable starters, with no bias (most of them cost 2 to 4).
    varied: as many Pokemon of each cost as possible (1 to 10), for a wide range of costs.
    low_cost: mostly cheap Pokemon. high_cost: mostly expensive Pokemon."""
    display_name = "Pokemon Pool Costs"
    option_unbiased = 0
    option_varied = 1
    option_low_cost = 2
    option_high_cost = 3
    default = 0


class BiomePasses(Choice):
    """true: each biome (except the Town and the End) needs its Biome Pass to be visited, on top of the Floor
    Passes. When none of the next biomes is unlocked, you go back to the Town. With the Map, the Town is always one of
    the choices.
    end_only: a single "Biome Pass - End" is needed to enter the End (the last 10 floors), on top of every Floor Pass.
    The other biomes are open."""
    display_name = "Biome Passes"
    option_false = 0
    option_true = 1
    option_end_only = 2
    default = 0


class BiomePassPriority(DefaultOnToggle):
    """With Biome Passes (true), the generator places the passes of the biomes close to the Town earlier in the multiworld
    than those of the farther biomes, so the biomes come into logic roughly in the order of a run.
    In PokeRogue, the pass of a biome is never found more than 2 floor blocks after the first block where the biome
    can be visited (e.g. the pass of a biome of floors 11-20 is found by floor 40 at most). In the other games of the
    multiworld, it is only a bias of the item placement."""
    display_name = "Biome Pass Priority"


class Blitz(Toggle):
    """Shorter seeds: the run ends on floor 100 instead of 200 (End biome on floors 91-100, Eternatus on floor 100).
    Difficulty, story battles, Gym Leaders and shop tiers are compressed to fit, every battle gives two reward
    phases (the Archipelago shop items are renewed between them) and the money gained is doubled.
    9 Floor Passes instead of 19."""
    display_name = "Blitz"


class FloorChecks(Range):
    """Checks per floor cleared, with the floors and both location modes: 1 = "Floor N Cleared",
    2 = also "Floor N Bonus" (sent at the second reward phase with Blitz, with the first check otherwise).
    The biome floor checks are not affected."""
    display_name = "Floor Checks"
    range_start = 1
    range_end = 2
    default = 1


class StarterLimitItems(Range):
    """Number of "Starter Limit +1" items in the pool: each one raises the starter points of your team by 1
    (10 at first, 30 at most)."""
    display_name = "Starter Limit Items"
    range_start = 0
    range_end = 20
    default = 20


# --- Challenges of the PokeRogue Challenge mode, applied to every Archipelago run (Fresh Start excepted) ---


class MonoGeneration(Choice):
    """[Challenge - Starters] Only Pokemon of this generation can be used.
    The starting Pokemon and the Pokemon in the pool are taken from it."""
    display_name = "Mono Generation"
    option_off = 0
    option_gen_1 = 1
    option_gen_2 = 2
    option_gen_3 = 3
    option_gen_4 = 4
    option_gen_5 = 5
    option_gen_6 = 6
    option_gen_7 = 7
    option_gen_8 = 8
    option_gen_9 = 9
    default = 0


class MonoType(Choice):
    """[Challenge - Starters] Only Pokemon of this type can be used.
    The starting Pokemon and the Pokemon in the pool are taken from it."""
    display_name = "Mono Type"
    option_off = 0
    option_normal = 1
    option_fighting = 2
    option_flying = 3
    option_poison = 4
    option_ground = 5
    option_rock = 6
    option_bug = 7
    option_ghost = 8
    option_steel = 9
    option_fire = 10
    option_water = 11
    option_grass = 12
    option_electric = 13
    option_psychic = 14
    option_ice = 15
    option_dragon = 16
    option_dark = 17
    option_fairy = 18
    default = 0


class LimitedSupport(Choice):
    """[Challenge - Difficulty] no_heal: no free healing at the end of each biome (a reward choice instead).
    no_shop: no shop in the rewards (no Archipelago shop items then). both: both."""
    display_name = "Limited Support"
    option_off = 0
    option_no_heal = 1
    option_no_shop = 2
    option_both = 3
    default = 0


class LimitedCatch(Toggle):
    """[Challenge - Difficulty] Only the first Pokemon of each biome can join the team."""
    display_name = "Limited Catch"


class Hardcore(Toggle):
    """[Challenge - Difficulty] Fainted Pokemon can no longer be revived."""
    display_name = "Hardcore"


class MovesetRandomizer(Choice):
    """[Challenge - Randomizer] Randomizes the level up moves of each species.
    lite: also removes the move requirement of move-based evolutions."""
    display_name = "Moveset Randomizer"
    option_off = 0
    option_on = 1
    option_lite = 2
    default = 0


class AbilityRandomizer(Choice):
    """[Challenge - Randomizer] abilities: randomizes the abilities of each species. all: abilities and passives.
    lite: abilities and passives, except the abilities that change forms."""
    display_name = "Ability Randomizer"
    option_off = 0
    option_abilities = 1
    option_all = 2
    option_lite = 3
    default = 0


class InverseBattle(Toggle):
    """[Challenge - Gimmick] Type matchups are reversed and no type is immune to another."""
    display_name = "Inverse Battle"


class FlipStat(Toggle):
    """[Challenge - Gimmick] HP and Speed, Attack and Sp. Def, Defense and Sp. Atk are swapped."""
    display_name = "Flip Stat"


class ActivePassives(Choice):
    """[Challenge - Gimmick] trainers: the Pokemon of trainers have their passive ability.
    all: every Pokemon, yours included."""
    display_name = "Active Passives"
    option_off = 0
    option_trainers = 1
    option_all = 2
    default = 0


class TrainerHints(DefaultOnToggle):
    """Key trainers (rival, Gym Leaders, Elite Four, Champion, evil team bosses and admins) give, once beaten,
    a hint about a progression item hidden in PokeRogue for another player."""
    display_name = "Trainer Hints"


@dataclass
class PokeRogueOptions(PerGameCommonOptions):
    goal: Goal
    location_mode: LocationMode
    dexsanity: Dexsanity
    dexsanity_exclude: DexsanityExclude
    blitz: Blitz
    floor_checks: FloorChecks
    shop_item_count: ShopItemCount
    shop_items_per_tier: ShopItemsPerTier
    shop_items_per_visit: ShopItemsPerVisit
    shop_cost_percent: ShopCostPercent
    starting_pokemon: StartingPokemon
    starting_pokemon_max_cost: StartingPokemonMaxCost
    start_with_map: StartWithMap
    pokemon_in_pool: PokemonInPool
    pokemon_pool_costs: PokemonPoolCosts
    bonus_item_copies: BonusItemCopies
    egg_filler_percent: EggFillerPercent
    effect_filler_percent: EffectFillerPercent
    trap_percent: TrapPercent
    death_link: DeathLink
    trainer_hints: TrainerHints
    biome_passes: BiomePasses
    biome_pass_priority: BiomePassPriority
    starter_limit_items: StarterLimitItems
    mono_generation: MonoGeneration
    mono_type: MonoType
    limited_support: LimitedSupport
    limited_catch: LimitedCatch
    hardcore: Hardcore
    moveset_randomizer: MovesetRandomizer
    ability_randomizer: AbilityRandomizer
    inverse_battle: InverseBattle
    flip_stat: FlipStat
    active_passives: ActivePassives
