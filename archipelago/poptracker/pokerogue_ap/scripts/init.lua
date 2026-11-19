-- PokeRogue Archipelago tracker: entry point of the pack
ScriptHost:LoadScript("scripts/autotracking/mapping.lua")
ScriptHost:LoadScript("scripts/logic.lua")

Tracker:AddItems("items/items.json")
Tracker:AddMaps("maps/maps.json")
Tracker:AddLocations("locations/floors.json")
Tracker:AddLocations("locations/biomes.json")
Tracker:AddLocations("locations/shop.json")
Tracker:AddLayouts("layouts/tracker.json")

set_default_settings()

if PopVersion and PopVersion >= "0.18.0" then
    ScriptHost:LoadScript("scripts/autotracking/archipelago.lua")
end
