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
}

local function count(code)
    return Tracker:ProviderCountForCode(code)
end

local function set_count(code, value)
    local obj = Tracker:FindObjectForCode(code)
    if obj then
        obj.AcquiredCount = value
    end
end

function set_settings(location_mode, shop_count, shop_per_tier, shop_per_visit, biome_passes)
    local mode = Tracker:FindObjectForCode("location_mode")
    if mode then
        mode.CurrentStage = location_mode
    end
    local passes = Tracker:FindObjectForCode("biome_passes")
    if passes then
        passes.Active = biome_passes and true or false
    end
    set_count("shop_count", shop_count)
    set_count("shop_per_tier", shop_per_tier)
    set_count("shop_per_visit", shop_per_visit)
end

function set_default_settings()
    set_settings(DEFAULT_SETTINGS.location_mode, DEFAULT_SETTINGS.shop_count, DEFAULT_SETTINGS.shop_per_tier,
        DEFAULT_SETTINGS.shop_per_visit, DEFAULT_SETTINGS.biome_passes)
end

-- Biome floors ------------------------------------------------------------------------------------------------

local function has_biome_pass(biome_id)
    local code = BIOME_PASS_CODES[biome_id]
    return code ~= nil and count(code) > 0
end

-- Same as can_reach_biome() in the apworld: the biome changes after each floor multiple of 10 (block k needs
-- k Floor Passes), only towards biomes whose Biome Pass was received
function can_reach_biome(target)
    local max_depth = math.min(count("pass"), BLOCK_COUNT - 2)
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
    local first_wave = SHOP_TIER_WAVES[shop_tier(index) + 1]
    return count("pass") >= (first_wave - 1) // GATE_INTERVAL
end
