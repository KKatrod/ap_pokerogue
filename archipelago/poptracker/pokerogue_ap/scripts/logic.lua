-- Logic helpers (used as "$function|argument" in the location rules)
-- The floor rules are plain item rules in the location files ("pass:3"); the biome and shop rules need code,
-- since they depend on the slot options (biome_passes, shop settings).

-- Defaults of the apworld options (replaced by slot_data when connected)
DEFAULT_SETTINGS = {
    location_mode = 0,   -- 0 floors, 1 biome_floors, 2 both
    shop_count = 70,
    shop_per_tier = 10,
    shop_per_visit = 1,
    biome_passes = false,
    end_pass = false,    -- biome_passes: end_only
    blitz = false,
    floor_checks = 1,
    dexsanity = 0,       -- 0 false, 1 starters, 2 all
}

-- Species ids with a Dexsanity check (dexsanity_species of slot_data); nil when not connected: every Pokemon of the
-- mode is shown then
DEX_LIST = nil

local function count(code)
    return Tracker:ProviderCountForCode(code)
end

local function set_count(code, value)
    local obj = Tracker:FindObjectForCode(code)
    if obj then
        obj.AcquiredCount = value
    end
end

local function set_toggle(code, value)
    local obj = Tracker:FindObjectForCode(code)
    if obj then
        obj.Active = value and true or false
    end
end

-- settings: table with the keys of DEFAULT_SETTINGS
function set_settings(settings)
    local mode = Tracker:FindObjectForCode("location_mode")
    if mode then
        mode.CurrentStage = settings.location_mode
    end
    set_toggle("biome_passes", settings.biome_passes)
    set_toggle("end_pass_option", settings.end_pass)
    set_toggle("blitz", settings.blitz)
    set_count("floor_checks", settings.floor_checks)
    local dex = Tracker:FindObjectForCode("dexsanity")
    if dex then
        dex.CurrentStage = settings.dexsanity
    end
    set_count("shop_count", settings.shop_count)
    set_count("shop_per_tier", settings.shop_per_tier)
    set_count("shop_per_visit", settings.shop_per_visit)
end

function set_default_settings()
    set_settings(DEFAULT_SETTINGS)
end

-- Blitz option and floor checks -------------------------------------------------------------------------------

local function is_blitz()
    return count("blitz") > 0
end

-- Last floor of the run: 200, or 100 with the Blitz option
local function final_wave()
    return is_blitz() and BLITZ_FINAL_WAVE or FINAL_WAVE
end

-- Blocks of 10 floors of the run (20, or 10 with the Blitz option)
local function block_count()
    return final_wave() // GATE_INTERVAL
end

-- The block (0-based) of floors exists in this run
function block_exists(block)
    return tonumber(block) < block_count()
end

-- "Floor N Bonus" checks exist (floor_checks: 2)
function floor_bonus()
    return count("floor_checks") >= 2
end

-- Not a Blitz run (the last floor of a Blitz run has no check)
function not_blitz()
    return not is_blitz()
end

-- The End is forced on the last block: one Floor Pass per block before it, and the End Pass with
-- biome_passes: end_only
function end_reachable()
    return count("pass") >= block_count() - 1 and (count("end_pass_option") == 0 or count("end_pass") > 0)
end

-- The block (0-based) of floors can be reached: one Floor Pass per block before it (the End: see end_reachable)
function block_reachable(block)
    block = tonumber(block)
    if block >= block_count() - 1 then
        return end_reachable()
    end
    return count("pass") >= block
end

-- Biome floors ------------------------------------------------------------------------------------------------

local function has_biome_pass(biome_id)
    local code = BIOME_PASS_CODES[biome_id]
    return code ~= nil and count(code) > 0
end

-- Same as can_reach_biome() in the apworld: the biome changes after each floor multiple of 10 (block k needs
-- k Floor Passes), only towards biomes whose Biome Pass was received
function can_reach_biome(target)
    local max_depth = math.min(count("pass"), block_count() - 2)
    local seen = { [TOWN_BIOME] = true }
    local frontier = { TOWN_BIOME }
    for _ = 1, max_depth do
        if seen[target] then
            return true
        end
        local next_frontier = {}
        for _, biome in ipairs(frontier) do
            for _, link in ipairs(BIOME_LINKS[biome] or {}) do
                if link ~= END_BIOME and not seen[link] and has_biome_pass(link) then
                    seen[link] = true
                    table.insert(next_frontier, link)
                end
            end
        end
        if #next_frontier == 0 then
            break
        end
        frontier = next_frontier
    end
    return seen[target] == true
end

local function biome_passes_enabled()
    return count("biome_passes") > 0
end

-- Biome floors are reachable with the Floor Passes of their block, and in logic with:
-- * the biome_passes option: the apworld rule (Floor Passes and the Biome Passes of a path from the Town); a biome
--   without such a path cannot come up at all;
-- * no option: the Map after the Plains (tracker-only rule: without the Map the next biome is random, so the
--   floors are a sequence break)
function biome_reachable(biome_id)
    biome_id = tonumber(biome_id)
    if biome_passes_enabled() then
        return can_reach_biome(biome_id)
    end
    return count("pass") >= BIOME_DEPTHS[biome_id]
end

function biome_in_logic(biome_id)
    biome_id = tonumber(biome_id)
    if biome_passes_enabled() then
        return can_reach_biome(biome_id)
    end
    return count("pass") >= BIOME_DEPTHS[biome_id] and (biome_id == PLAINS_BIOME or count("map") > 0)
end

-- Dexsanity -------------------------------------------------------------------------------------------------

local function dexsanity_mode()
    local dex = Tracker:FindObjectForCode("dexsanity")
    return dex and dex.CurrentStage or 0
end

function dexsanity_on()
    return dexsanity_mode() > 0
end

local function in_dex_list(species_id)
    return DEX_LIST == nil or DEX_LIST[tonumber(species_id)] == true
end

-- The Pokemon is in the slot's list, with dexsanity: all
function dex_all(species_id)
    return dexsanity_mode() == 2 and in_dex_list(species_id)
end

-- The starter is in the slot's list, with dexsanity: starters
function dex_starter(species_id)
    return dexsanity_mode() == 1 and in_dex_list(species_id)
end

-- Same as the Dexsanity rule of the apworld: a biome where the Pokemon is met can be reached, or the End (its
-- first floor offers any Pokemon not obtained yet)
function dex_box_reachable(biome_id)
    if end_reachable() then
        return true
    end
    if biome_id == "any" then
        return false
    end
    biome_id = tonumber(biome_id)
    if biome_id == TOWN_BIOME then
        return true
    end
    return biome_reachable(biome_id)
end

-- Shop items ---------------------------------------------------------------------------------------------------
-- Same rule as the apworld: the items are unlocked by batches of shop_items_per_tier each time the regular shop
-- gets new items (all at once with 0). Each shop offers only the first shop_items_per_visit items not bought yet,
-- but bought items stay bought from one run to the next, so every item of a tier can be bought (over several runs
-- if needed) as soon as the tier's first floor can be reached.

-- Tier (0-based) of the regular shop that unlocks the shop item
local function shop_tier(index)
    local per_tier = count("shop_per_tier")
    if per_tier <= 0 then
        return 0
    end
    return (index - 1) // per_tier
end

-- The shop item exists in this seed (shop_item_count from slot_data is already limited to 7 tiers)
function shop_exists(index)
    index = tonumber(index)
    return index <= count("shop_count") and shop_tier(index) < #SHOP_TIER_WAVES
end

-- "tier_index": the shop item exists and belongs to this tier with the slot's shop_items_per_tier
function shop_in_tier(arg)
    local tier, index = string.match(arg, "^(%d+)_(%d+)$")
    tier, index = tonumber(tier), tonumber(index)
    return shop_exists(index) and shop_tier(index) == tier
end

-- At least one shop item belongs to the tier
function shop_tier_exists(tier)
    tier = tonumber(tier)
    local per_tier = count("shop_per_tier")
    if per_tier <= 0 then
        return tier == 0 and shop_exists(1)
    end
    return shop_exists(tier * per_tier + 1)
end

-- Enough Floor Passes to reach the first floor of the item's tier
function shop_reachable(index)
    index = tonumber(index)
    if not shop_exists(index) then
        return false
    end
    local tier_waves = is_blitz() and BLITZ_SHOP_TIER_WAVES or SHOP_TIER_WAVES
    local first_wave = tier_waves[shop_tier(index) + 1]
    return count("pass") >= (first_wave - 1) // GATE_INTERVAL
end
