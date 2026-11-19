-- Archipelago auto-tracking: checked locations, received items and options from slot_data
-- (LOCATION_MAPPING and ITEM_MAPPING come from scripts/autotracking/mapping.lua)

CUR_INDEX = -1
SLOT_DATA = nil

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
    for _, code in pairs(LOCATION_MAPPING) do
        local obj = Tracker:FindObjectForCode(code)
        if obj then
            obj.AvailableChestCount = obj.ChestCount
        end
    end
end

local function slot_number(slot_data, key, default)
    local value = slot_data and slot_data[key]
    if type(value) == "boolean" then
        return value and 1 or 0
    end
    return tonumber(value) or default
end

function onClear(slot_data)
    SLOT_DATA = slot_data
    CUR_INDEX = -1
    reset_locations()
    reset_items()
    set_settings(
        slot_number(slot_data, "location_mode", DEFAULT_SETTINGS.location_mode),
        slot_number(slot_data, "shop_item_count", DEFAULT_SETTINGS.shop_count),
        slot_number(slot_data, "shop_items_per_tier", DEFAULT_SETTINGS.shop_per_tier),
        slot_number(slot_data, "shop_items_per_visit", DEFAULT_SETTINGS.shop_per_visit),
        slot_number(slot_data, "biome_passes", 0) ~= 0)
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
    local code = LOCATION_MAPPING[location_id]
    if not code then
        return
    end
    local obj = Tracker:FindObjectForCode(code)
    if obj and obj.AvailableChestCount > 0 then
        obj.AvailableChestCount = obj.AvailableChestCount - 1
    end
end

Archipelago:AddClearHandler("pokerogue clear handler", onClear)
Archipelago:AddItemHandler("pokerogue item handler", onItem)
Archipelago:AddLocationHandler("pokerogue location handler", onLocation)
