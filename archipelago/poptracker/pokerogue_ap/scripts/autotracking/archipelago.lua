-- Archipelago auto-tracking: checked locations, received items and options from slot_data
-- (LOCATION_MAPPING and ITEM_MAPPING come from scripts/autotracking/mapping.lua)

CUR_INDEX = -1
SLOT_DATA = nil
local applying_settings = false

-- A location id maps to one section ("@Location/Section"), or to several (a shop item is listed in each tier
-- it can belong to)
local function each_section(codes, callback)
    if type(codes) == "table" then
        for _, code in ipairs(codes) do
            callback(code)
        end
    elseif codes then
        callback(codes)
    end
end

local function reset_items()
    for _, v in pairs(ITEM_MAPPING) do
        local obj = Tracker:FindObjectForCode(v[1])
        if obj then
            if v[2] == "toggle" then
                obj.Active = false
            elseif v[2] == "consumable" then
                obj.AcquiredCount = 0
            end
        end
    end
end

local function reset_locations()
    for _, codes in pairs(LOCATION_MAPPING) do
        each_section(codes, function(code)
            local obj = Tracker:FindObjectForCode(code)
            if obj then
                obj.AvailableChestCount = obj.ChestCount
            end
        end)
    end
end

local function slot_number(slot_data, key, default)
    local value = slot_data and slot_data[key]
    if type(value) == "boolean" then
        return value and 1 or 0
    end
    return tonumber(value) or default
end

-- Shows the options of the slot (or the defaults when not connected)
local function apply_settings()
    applying_settings = true
    if SLOT_DATA then
        set_settings({
            location_mode = slot_number(SLOT_DATA, "location_mode", DEFAULT_SETTINGS.location_mode),
            shop_count = slot_number(SLOT_DATA, "shop_item_count", DEFAULT_SETTINGS.shop_count),
            shop_per_tier = slot_number(SLOT_DATA, "shop_items_per_tier", DEFAULT_SETTINGS.shop_per_tier),
            shop_per_visit = slot_number(SLOT_DATA, "shop_items_per_visit", DEFAULT_SETTINGS.shop_per_visit),
            biome_passes = slot_number(SLOT_DATA, "biome_passes", 0) ~= 0,
            blitz = slot_number(SLOT_DATA, "blitz", 0) ~= 0,
            floor_checks = slot_number(SLOT_DATA, "floor_checks", DEFAULT_SETTINGS.floor_checks),
        })
    end
    applying_settings = false
end

-- Once the server sent the options, the settings cannot be changed by hand: a click is undone
local function on_setting_changed(_code)
    if SLOT_DATA and not applying_settings then
        apply_settings()
    end
end

for _, code in ipairs({ "location_mode", "biome_passes", "blitz", "floor_checks", "shop_count", "shop_per_tier",
    "shop_per_visit" }) do
    ScriptHost:AddWatchForCode("lock setting " .. code, code, on_setting_changed)
end

function onClear(slot_data)
    SLOT_DATA = slot_data
    CUR_INDEX = -1
    reset_locations()
    reset_items()
    apply_settings()
end

function onItem(index, item_id, item_name, player_number)
    if index <= CUR_INDEX then
        return
    end
    CUR_INDEX = index
    local v = ITEM_MAPPING[item_id]
    if not v then
        return
    end
    local obj = Tracker:FindObjectForCode(v[1])
    if not obj then
        return
    end
    if v[2] == "toggle" then
        obj.Active = true
    elseif v[2] == "consumable" then
        obj.AcquiredCount = obj.AcquiredCount + obj.Increment
    end
end

function onLocation(location_id, location_name)
    each_section(LOCATION_MAPPING[location_id], function(code)
        local obj = Tracker:FindObjectForCode(code)
        if obj and obj.AvailableChestCount > 0 then
            obj.AvailableChestCount = obj.AvailableChestCount - 1
        end
    end)
end

Archipelago:AddClearHandler("pokerogue clear handler", onClear)
Archipelago:AddItemHandler("pokerogue item handler", onItem)
Archipelago:AddLocationHandler("pokerogue location handler", onLocation)
