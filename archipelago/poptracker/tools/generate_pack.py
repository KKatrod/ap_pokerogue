"""
Generates the PokeRogue Archipelago PopTracker pack (archipelago/poptracker/pokerogue_ap/) from the apworld data.

Usage (from the repository root):
    python archipelago/poptracker/tools/generate_pack.py

It reads archipelago/apworld/pokerogue/data.py (names, ids, biome links) so the pack always matches the apworld,
then writes the items, locations, maps, layouts, the location/item id mappings and the generated images.
The biome chart comes from tools/biome_chart_source.png (see pokerogue_ap/images/maps/CREDITS.md): the generator
puts it on a white background, adds a box for the End (not on the chart) and writes images/maps/biome_chart.png;
the markers are placed with tools/biome_chart_positions.json (biome name -> [x, y] in chart pixels). Without
the source image, the Biomes tab uses only the generated grid.
"""
import json
import math
import os
from collections import deque

from PIL import Image, ImageDraw, ImageFont

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
POPTRACKER_DIR = os.path.dirname(TOOLS_DIR)
PACK_DIR = os.path.join(POPTRACKER_DIR, "pokerogue_ap")
DATA_PY = os.path.join(POPTRACKER_DIR, "..", "apworld", "pokerogue", "data.py")
CHART_POSITIONS = os.path.join(TOOLS_DIR, "biome_chart_positions.json")
CHART_SOURCE = os.path.join(TOOLS_DIR, "biome_chart_source.png")
CHART_IMAGE = "images/maps/biome_chart.png"

data = {}
with open(DATA_PY, encoding="utf-8") as f:
    exec(f.read(), data)  # noqa: S102 - generated constants only

BASE_ID = data["BASE_ID"]
FINAL_WAVE = data["FINAL_WAVE"]
GATE = data["GATE_INTERVAL"]
BLOCK_COUNT = FINAL_WAVE // GATE
TOWN, PLAINS, END = 0, 1, 50
ITEM_IDS = {name: item_id for name, item_id, _cat, _cls in data["ITEMS"]}
MAX_SHOP_ITEMS = 350  # ShopItemCount.range_end in options.py
MAX_SHOP_ITEMS_PER_TIER = 50  # ShopItemsPerTier.range_end in options.py


def compute_biome_depths():
    """Same as compute_biome_depths() in archipelago/apworld/pokerogue/__init__.py."""
    links = {biome_id: biome_links for biome_id, _name, biome_links in data["BIOMES"]}
    depths = {TOWN: 0}
    queue = deque([TOWN])
    while queue:
        biome = queue.popleft()
        for target in links.get(biome, []):
            if target != END and target not in depths and depths[biome] + 1 < BLOCK_COUNT - 1:
                depths[target] = depths[biome] + 1
                queue.append(target)
    depths[END] = BLOCK_COUNT - 1
    return depths


DEPTHS = compute_biome_depths()
BIOME_NAMES = {biome_id: name for biome_id, name, _links in data["BIOMES"]}
BIOMES = sorted(DEPTHS, key=lambda b: (DEPTHS[b], BIOME_NAMES[b]))
BIOME_LINKS = {biome_id: biome_links for biome_id, _name, biome_links in data["BIOMES"]}
# Same as BIOME_PASSES in the apworld: every biome except the Town and the End
BIOME_PASSES = [b for b in BIOMES if b not in (TOWN, END)]


def biome_pass_code(biome_id):
    return f"biome_pass_{biome_id}"


# The pass of the End (biome_passes: end_only)
END_PASS_CODE = "end_pass"


def biome_abbreviations():
    """Short labels for the Biome Pass icons: initials of a multi-word name, else the first 3 letters."""
    def short(name, fallback=False):
        words = name.split()
        if len(words) > 1:
            return "".join(w[0] for w in words).upper()
        return (name[:2] + name[-1]).upper() if fallback else name[:3].upper()
    labels = {b: short(BIOME_NAMES[b]) for b in BIOME_PASSES}
    clashes = {b for b in labels if list(labels.values()).count(labels[b]) > 1}
    for b in clashes:
        labels[b] = short(BIOME_NAMES[b], fallback=True)
    if len(set(labels.values())) != len(labels):
        raise SystemExit(f"Biome Pass labels are not unique: {labels}")
    return labels


# ---------------------------------------------------------------- Dexsanity

DEX_NAMES = {species_id: name for species_id, name, *_rest in data["DEX_SPECIES"]}
DEX_BIOMES = {species_id: biomes for species_id, *_rest, biomes in data["DEX_SPECIES"]}
DEX_PREVOLUTION = {species_id: prevolution for species_id, *_rest, prevolution, _biomes in data["DEX_SPECIES"]}
DEX_STARTER = {species_id: starter for species_id, _n, _g, _t, _l, starter, _p, _b in data["DEX_SPECIES"]}
# Species id of each starter (the Dexsanity checks of `dexsanity: starters`)
DEX_STARTERS = {item_id - BASE_ID - data["POKEMON_ITEM_OFFSET"] for _name, item_id, _cost in data["POKEMON"]}
# Box of the Pokedex tab for the Pokemon met in no biome: only the first floor of the End offers them
DEX_ANYWHERE = "Pokedex - Anywhere (End, floor 1)"


def dex_biomes_all(species_id):
    """dexsanity: all - same as get_dex_biomes in the apworld: the biomes of the species and its pre-evolutions"""
    biomes, current = set(), species_id
    while current is not None and current in DEX_BIOMES:
        biomes |= set(DEX_BIOMES[current])
        current = DEX_PREVOLUTION[current]
    return biomes & set(DEPTHS)


def dex_biomes_starters(species_id):
    """dexsanity: starters - the biomes of any Pokemon of the starter's line"""
    return {b for s, starter in DEX_STARTER.items() if starter == species_id for b in DEX_BIOMES[s]} & set(DEPTHS)


DEX_ALL = {s: dex_biomes_all(s) for s in DEX_NAMES}
DEX_LINE = {s: dex_biomes_starters(s) for s in DEX_STARTERS if s in DEX_NAMES}


def dex_box_name(biome_id):
    return f"Pokedex - {BIOME_NAMES[biome_id]}"


def dex_visibility(species_id, biome_id):
    """
    The section of the Pokemon in the box of the biome (None: the anywhere box) is shown with the slot's Dexsanity
    mode when the Pokemon is in the slot's list (scripts/logic.lua)
    """
    rules = []
    all_biomes = DEX_ALL[species_id]
    if (biome_id in all_biomes) if biome_id is not None else not all_biomes:
        rules.append(f"$dex_all|{species_id}")
    if species_id in DEX_LINE:
        line = DEX_LINE[species_id]
        if (biome_id in line) if biome_id is not None else not line:
            rules.append(f"$dex_starter|{species_id}")
    return rules


def dex_boxes():
    """(box name, biome id or None, [(species id, visibility rules)])"""
    boxes = []
    for biome_id in BIOMES:
        sections = [(s, dex_visibility(s, biome_id)) for s in sorted(DEX_NAMES)]
        boxes.append((dex_box_name(biome_id), biome_id, [(s, r) for s, r in sections if r]))
    anywhere = [(s, dex_visibility(s, None)) for s in sorted(DEX_NAMES)]
    boxes.append((DEX_ANYWHERE, None, [(s, r) for s, r in anywhere if r]))
    return boxes


def biome_floors(biome_id):
    return range(1, GATE) if biome_id == END else range(1, GATE + 1)


def block_name(block):
    first, last = block * GATE + 1, min((block + 1) * GATE, FINAL_WAVE - 1)
    return f"Floors {first}-{last}"


TIER_COUNT = len(data["SHOP_TIER_WAVES"])


def shop_tier_name(tier):
    return f"Shop Tier {tier + 1}"


def shop_tier_floors(tier, blitz=False):
    """Floors of the regular shop tier: from its first wave to the floor before the next tier."""
    waves = data["BLITZ_SHOP_TIER_WAVES" if blitz else "SHOP_TIER_WAVES"]
    final_wave = data["BLITZ_FINAL_WAVE"] if blitz else FINAL_WAVE
    last = waves[tier + 1] - 1 if tier + 1 < len(waves) else final_wave - 1
    return waves[tier], last


def shop_tier_items(tier):
    """Shop items that can belong to the tier for some shop_items_per_tier value: every item for the first tier
    (per tier 0: all from floor 1), items k+1 to 50*(k+1) for tier k."""
    if tier == 0:
        return range(1, MAX_SHOP_ITEMS + 1)
    return range(tier + 1, min(MAX_SHOP_ITEMS, MAX_SHOP_ITEMS_PER_TIER * (tier + 1)) + 1)


def write(path, content):
    full = os.path.join(PACK_DIR, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w", encoding="utf-8", newline="\n") as f:
        f.write(content if isinstance(content, str) else json.dumps(content, indent=2, ensure_ascii=False) + "\n")


# ---------------------------------------------------------------- images

def font(size):
    for name in ("arialbd.ttf", "DejaVuSans-Bold.ttf", "arial.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def save_image(img, path):
    full = os.path.join(PACK_DIR, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    img.save(full)


def icon(path, text, color, shape="circle"):
    img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    if shape == "circle":
        draw.ellipse((4, 4, 60, 60), fill=color, outline=(255, 255, 255, 255), width=3)
    else:
        draw.rounded_rectangle((4, 4, 60, 60), radius=10, fill=color, outline=(255, 255, 255, 255), width=3)
    f = font(26 if len(text) <= 2 else 18)
    draw.text((32, 32), text, font=f, fill=(255, 255, 255, 255), anchor="mm")
    save_image(img, path)


def grid_map(path, title, cells, columns, cell_w, cell_h):
    """Draws a grid of labelled boxes; returns the centre of each cell (for the map markers)."""
    rows = math.ceil(len(cells) / columns)
    header = 60
    img = Image.new("RGB", (columns * cell_w, header + rows * cell_h), (24, 26, 34))
    draw = ImageDraw.Draw(img)
    draw.text((columns * cell_w // 2, header // 2), title, font=font(30), fill=(240, 240, 240), anchor="mm")
    centres = []
    for i, (label, sub, color) in enumerate(cells):
        x, y = (i % columns) * cell_w, header + (i // columns) * cell_h
        draw.rounded_rectangle((x + 6, y + 6, x + cell_w - 6, y + cell_h - 6), radius=14, fill=color,
                               outline=(230, 230, 230), width=2)
        draw.text((x + cell_w // 2, y + 26), label, font=font(22), fill=(255, 255, 255), anchor="mm")
        draw.text((x + cell_w // 2, y + cell_h - 22), sub, font=font(16), fill=(235, 235, 235), anchor="mm")
        centres.append((x + cell_w // 2, y + cell_h // 2 + 4))
    save_image(img, path)
    return centres


def block_color(block):
    """From green (early) to purple (late)."""
    t = block / (BLOCK_COUNT - 1)
    return (int(40 + 110 * t), int(130 - 80 * t), int(80 + 90 * t))


def passes_label(count):
    return "no pass needed" if count == 0 else f"{count} pass{'es' if count > 1 else ''}"


# ---------------------------------------------------------------- items

def items_json():
    return [
        {"name": "Progressive Floor Pass", "type": "consumable", "img": "images/items/floor_pass.png",
         "codes": "pass", "min_quantity": 0, "max_quantity": BLOCK_COUNT - 1, "increment": 1},
        {"name": "Map", "type": "toggle", "img": "images/items/map.png", "codes": "map"},
        {"name": "Biome Pass - End (biome_passes: end_only)", "type": "toggle", "img": "images/items/end_pass.png",
         "codes": END_PASS_CODE},
        *[{"name": f"Biome Pass - {BIOME_NAMES[b]}", "type": "toggle",
           "img": f"images/items/biome_pass_{b}.png", "codes": biome_pass_code(b)} for b in BIOME_PASSES],
        {"name": "Location Mode", "type": "progressive", "loop": True, "allow_disabled": False,
         "codes": "location_mode",
         "stages": [
             {"name": "Location Mode: floors", "img": "images/settings/mode_floors.png", "codes": "floors",
              "inherit_codes": False},
             {"name": "Location Mode: biome_floors", "img": "images/settings/mode_biomes.png", "codes": "biomes",
              "inherit_codes": False},
             {"name": "Location Mode: both", "img": "images/settings/mode_both.png", "codes": "floors,biomes",
              "inherit_codes": False},
         ]},
        {"name": "Shop Item Count", "type": "consumable", "img": "images/settings/shop_count.png",
         "codes": "shop_count", "min_quantity": 0, "max_quantity": MAX_SHOP_ITEMS, "increment": 1},
        {"name": "Shop Items Per Tier (0: all from floor 1)", "type": "consumable",
         "img": "images/settings/per_tier.png", "codes": "shop_per_tier", "min_quantity": 0,
         "max_quantity": MAX_SHOP_ITEMS_PER_TIER, "increment": 1},
        {"name": "Shop Items Per Visit", "type": "consumable", "img": "images/settings/per_visit.png",
         "codes": "shop_per_visit", "min_quantity": 1, "max_quantity": 3, "increment": 1},
        {"name": "Biome Passes (option)", "type": "toggle", "img": "images/settings/biome_passes.png",
         "codes": "biome_passes"},
        {"name": "End Pass (option biome_passes: end_only)", "type": "toggle", "img": "images/settings/end_pass.png",
         "codes": "end_pass_option"},
        {"name": "Blitz (option): 100 floors", "type": "toggle", "img": "images/settings/blitz.png",
         "codes": "blitz"},
        {"name": "Dexsanity (option)", "type": "progressive", "loop": True, "allow_disabled": False,
         "codes": "dexsanity",
         "stages": [
             {"name": "Dexsanity: false", "img": "images/settings/dex_off.png", "codes": "dex_off",
              "inherit_codes": False},
             {"name": "Dexsanity: starters", "img": "images/settings/dex_starters.png", "codes": "dex_starters",
              "inherit_codes": False},
             {"name": "Dexsanity: all", "img": "images/settings/dex_all.png", "codes": "dex_all",
              "inherit_codes": False},
         ]},
        {"name": "Floor Checks (option): 1 or 2 per floor", "type": "consumable",
         "img": "images/settings/floor_checks.png", "codes": "floor_checks", "min_quantity": 1, "max_quantity": 2,
         "increment": 1},
    ]


# ---------------------------------------------------------------- locations and maps

def floor_locations(centres):
    locations = []
    for block in range(BLOCK_COUNT):
        first, last = block * GATE + 1, min((block + 1) * GATE, FINAL_WAVE - 1)
        sections = []
        for wave in range(first, last + 1):
            # The last floor of a Blitz run is the final boss: no check
            blitz_final = wave == data["BLITZ_FINAL_WAVE"]
            sections.append({"name": f"Floor {wave} Cleared", **({"visibility_rules": ["$not_blitz"]}
                                                                  if blitz_final else {})})
            # Second check of the floor (floor_checks: 2)
            sections.append({"name": f"Floor {wave} Bonus",
                             "visibility_rules": ["$floor_bonus,$not_blitz" if blitz_final else "$floor_bonus"]})
        location = {
            "name": block_name(block),
            # The blocks past the last floor of a Blitz run are hidden
            "visibility_rules": [f"floors,$block_exists|{block}"],
            "sections": sections,
            "map_locations": [{"map": "floors", "x": centres[block][0], "y": centres[block][1]}],
        }
        if block:
            # The Floor Passes, and the End Pass for the last block with biome_passes: end_only
            location["access_rules"] = [f"$block_reachable|{block}"]
        locations.append(location)
    return locations


def biome_access_rules(biome_id):
    if biome_id == TOWN:
        return None
    if biome_id == END:
        return ["$end_reachable"]  # forced at the last block (19, or 9 with Blitz), End Pass with end_only
    # scripts/logic.lua: reachable with the Floor Passes (and the Biome Passes with the biome_passes option);
    # in logic once biome_in_logic is also true, otherwise a sequence break ([...] is an optional requirement)
    return [f"$biome_reachable|{biome_id},[$biome_in_logic|{biome_id}]"]


def biome_locations(grid_centres, chart_positions):
    locations = []
    for i, biome_id in enumerate(BIOMES):
        name = BIOME_NAMES[biome_id]
        map_locations = [{"map": "biomes_grid", "x": grid_centres[i][0], "y": grid_centres[i][1]}]
        if chart_positions is not None:
            x, y = chart_positions[name]
            map_locations.insert(0, {"map": "biome_chart", "x": x, "y": y})
        location = {
            "name": name,
            "visibility_rules": ["biomes"],
            "sections": [{"name": f"Floor {floor}"} for floor in biome_floors(biome_id)],
            "map_locations": map_locations,
        }
        rules = biome_access_rules(biome_id)
        if rules:
            location["access_rules"] = rules
        locations.append(location)
    return locations


def shop_locations(centres):
    """One location per regular shop tier; its sections are shown only for the items of the tier with the slot's
    shop_items_per_tier (scripts/logic.lua)."""
    locations = []
    for tier in range(TIER_COUNT):
        locations.append({
            "name": shop_tier_name(tier),
            "visibility_rules": [f"$shop_tier_exists|{tier}"],
            "sections": [
                {"name": f"Shop Item {n}", "access_rules": [f"$shop_reachable|{n}"],
                 "visibility_rules": [f"$shop_in_tier|{tier}_{n}"]}
                for n in shop_tier_items(tier)
            ],
            "map_locations": [{"map": "shop", "x": centres[tier][0], "y": centres[tier][1]}],
        })
    return locations


def dex_locations(centres):
    """Pokedex tab: one box per biome with the Pokemon met there (and the anywhere box)"""
    locations = []
    for i, (name, biome_id, sections) in enumerate(dex_boxes()):
        locations.append({
            "name": name,
            "visibility_rules": ["$dexsanity_on"],
            # The biome can be reached (Floor Passes, and Biome Passes with biome_passes: true), or the End
            "access_rules": [f"$dex_box_reachable|{'any' if biome_id is None else biome_id}"],
            "sections": [{"name": DEX_NAMES[s], "visibility_rules": rules} for s, rules in sections],
            "map_locations": [{"map": "pokedex", "x": centres[i][0], "y": centres[i][1]}],
        })
    return locations


def location_mapping_lua():
    lines = [
        "-- Generated by archipelago/poptracker/tools/generate_pack.py - do not edit by hand.",
        "-- Archipelago location id -> PopTracker section (\"@Location/Section\")",
        "LOCATION_MAPPING = {",
    ]
    for wave in range(1, FINAL_WAVE):
        block = (wave - 1) // GATE
        lines.append(f'  [{BASE_ID + data["WAVE_LOCATION_OFFSET"] + wave}] = "@{block_name(block)}/Floor {wave} Cleared",')
        lines.append(f'  [{BASE_ID + data["WAVE_BONUS_LOCATION_OFFSET"] + wave}] = "@{block_name(block)}/Floor {wave} Bonus",')
    # A shop item is listed in every tier it can belong to (only the one of the slot's settings is shown)
    for n in range(1, MAX_SHOP_ITEMS + 1):
        codes = ", ".join(f'"@{shop_tier_name(t)}/Shop Item {n}"' for t in range(TIER_COUNT) if n in shop_tier_items(t))
        lines.append(f'  [{BASE_ID + data["SHOP_LOCATION_OFFSET"] + n}] = {{{codes}}},')
    for biome_id in sorted(DEPTHS):
        for floor in biome_floors(biome_id):
            location_id = BASE_ID + data["BIOME_LOCATION_OFFSET"] + biome_id * 10 + floor - 1
            lines.append(f'  [{location_id}] = "@{BIOME_NAMES[biome_id]}/Floor {floor}",')
    # A Pokemon is listed in every box where it can be met (only the boxes of the slot's mode show it)
    boxes_of = {}
    for name, _biome_id, sections in dex_boxes():
        for species_id, _rules in sections:
            boxes_of.setdefault(species_id, []).append(name)
    for species_id in sorted(boxes_of):
        codes = ", ".join(f'"@{name}/{DEX_NAMES[species_id]}"' for name in boxes_of[species_id])
        lines.append(f'  [{BASE_ID + data["DEX_LOCATION_OFFSET"] + species_id}] = {{{codes}}},')
    lines.append("}")
    lines += [
        "",
        "-- Archipelago item id -> {code, type} of the tracked items",
        "ITEM_MAPPING = {",
        f'  [{ITEM_IDS["Progressive Floor Pass"]}] = {{"pass", "consumable"}},',
        f'  [{ITEM_IDS["Map"]}] = {{"map", "toggle"}},',
        *[f'  [{BASE_ID + data["BIOME_PASS_OFFSET"] + b}] = {{"{biome_pass_code(b)}", "toggle"}},  '
          f'-- Biome Pass - {BIOME_NAMES[b]}' for b in BIOME_PASSES],
        f'  [{BASE_ID + data["BIOME_PASS_OFFSET"] + END}] = {{"{END_PASS_CODE}", "toggle"}},  -- Biome Pass - End',
        "}",
        "",
        "-- Biome links (biome id -> next biome ids), floor block of each biome, and the Biome Pass codes",
        "BIOME_LINKS = {",
        *[f"  [{b}] = {{{', '.join(str(link) for link in BIOME_LINKS.get(b, []))}}},  -- {BIOME_NAMES[b]}"
          for b in sorted(DEPTHS)],
        "}",
        "BIOME_DEPTHS = {" + ", ".join(f"[{b}] = {DEPTHS[b]}" for b in sorted(DEPTHS)) + "}",
        "BIOME_PASS_CODES = {" + ", ".join(f'[{b}] = "{biome_pass_code(b)}"' for b in BIOME_PASSES) + "}",
        f"TOWN_BIOME = {TOWN}",
        f"PLAINS_BIOME = {PLAINS}",
        f"END_BIOME = {END}",
        f"BLOCK_COUNT = {BLOCK_COUNT}",
        "",
        f"FINAL_WAVE = {FINAL_WAVE}",
        f"GATE_INTERVAL = {GATE}",
        "SHOP_TIER_WAVES = {" + ", ".join(str(w) for w in data["SHOP_TIER_WAVES"]) + "}",
        "-- Blitz option: last floor and shop tiers",
        f"BLITZ_FINAL_WAVE = {data['BLITZ_FINAL_WAVE']}",
        "BLITZ_SHOP_TIER_WAVES = {" + ", ".join(str(w) for w in data["BLITZ_SHOP_TIER_WAVES"]) + "}",
        "",
    ]
    return "\n".join(lines)


def build_chart(end_position):
    """White background (the source is transparent) and an End box, since the chart does not show the End."""
    source = Image.open(CHART_SOURCE).convert("RGBA")
    chart = Image.new("RGBA", source.size, (255, 255, 255, 255))
    chart.alpha_composite(source)
    draw = ImageDraw.Draw(chart)
    x, y = end_position
    draw.rounded_rectangle((x - 75, y - 52, x + 75, y + 52), radius=8, fill=(150, 50, 160), outline=(60, 60, 60),
                           width=3)
    draw.text((x, y - 38), "End (forced)", font=font(16), fill=(255, 255, 255), anchor="mm")
    draw.text((x, y + 38), "last 10 floors", font=font(13), fill=(255, 255, 255), anchor="mm")
    save_image(chart.convert("RGB"), CHART_IMAGE)
    return chart.size


def main():
    chart_positions = None
    chart_size = None
    if os.path.exists(CHART_SOURCE) and os.path.exists(CHART_POSITIONS):
        with open(CHART_POSITIONS, encoding="utf-8") as f:
            chart_positions = {k: v for k, v in json.load(f).items() if not k.startswith("_")}
        missing = [BIOME_NAMES[b] for b in DEPTHS if BIOME_NAMES[b] not in chart_positions]
        if missing:
            raise SystemExit(f"biome_chart_positions.json has no position for: {', '.join(missing)}")
        chart_size = build_chart(chart_positions[BIOME_NAMES[END]])

    # Icons
    icon("images/items/floor_pass.png", "FP", (200, 60, 60, 255), "rect")
    icon("images/items/map.png", "MAP", (40, 120, 200, 255), "rect")
    icon("images/settings/mode_floors.png", "FL", (90, 90, 110, 255))
    icon("images/settings/mode_biomes.png", "BI", (60, 140, 90, 255))
    icon("images/settings/mode_both.png", "F+B", (130, 90, 150, 255))
    icon("images/settings/shop_count.png", "SH", (150, 110, 40, 255))
    icon("images/settings/per_tier.png", "/T", (150, 110, 40, 255))
    icon("images/settings/per_visit.png", "/V", (150, 110, 40, 255))
    icon("images/settings/biome_passes.png", "BP", (60, 140, 90, 255))
    icon("images/settings/end_pass.png", "EP", (150, 50, 160, 255))
    icon("images/items/end_pass.png", "END", (150, 50, 160, 255), "rect")
    icon("images/settings/blitz.png", "BZ", (190, 70, 40, 255))
    icon("images/settings/floor_checks.png", "FC", (90, 90, 110, 255))
    icon("images/settings/dex_off.png", "DX", (90, 90, 110, 255))
    icon("images/settings/dex_starters.png", "DX:S", (200, 60, 60, 255))
    icon("images/settings/dex_all.png", "DX:A", (200, 60, 60, 255))
    for b, label in biome_abbreviations().items():
        icon(f"images/items/biome_pass_{b}.png", label, block_color(DEPTHS[b]) + (255,), "rect")

    # Maps
    floor_centres = grid_map(
        "images/maps/floors.png", "Floors - one box per block of 10 floors",
        [(block_name(b), passes_label(b), block_color(b)) for b in range(BLOCK_COUNT)], 5, 220, 150)
    biome_centres = grid_map(
        "images/maps/biomes_grid.png", "Biomes - earliest block where each biome can be reached",
        [(BIOME_NAMES[b], f"{block_name(DEPTHS[b])} - {passes_label(DEPTHS[b])}" if b != END
          else "last block - 19 passes (Blitz 9)", block_color(DEPTHS[b]))
         for b in BIOMES], 5, 260, 130)
    dex_cells = [(BIOME_NAMES[b], f"{block_name(DEPTHS[b])} - {passes_label(DEPTHS[b])}" if b != END
                  else "last block", block_color(DEPTHS[b])) for b in BIOMES]
    dex_cells.append(("Anywhere", "first floor of the End", block_color(BLOCK_COUNT - 1)))
    dex_centres = grid_map(
        "images/maps/pokedex.png", "Pokedex - the Pokemon to obtain, by biome where they are met",
        dex_cells, 6, 230, 120)
    shop_centres = grid_map(
        "images/maps/shop.png", "Archipelago shop items - by tier of the regular shop",
        [(f"{shop_tier_name(t)}: floors {shop_tier_floors(t)[0]}-{shop_tier_floors(t)[1]}",
          f"Blitz: floors {shop_tier_floors(t, True)[0]}-{shop_tier_floors(t, True)[1]}",
          block_color((shop_tier_floors(t)[0] - 1) // GATE))
         for t in range(TIER_COUNT)], 4, 330, 170)

    maps = [
        {"name": "floors", "location_size": 56, "location_border_thickness": 4, "img": "images/maps/floors.png"},
        {"name": "biomes_grid", "location_size": 52, "location_border_thickness": 4,
         "img": "images/maps/biomes_grid.png"},
        {"name": "shop", "location_size": 64, "location_border_thickness": 4, "img": "images/maps/shop.png"},
        {"name": "pokedex", "location_size": 48, "location_border_thickness": 4, "img": "images/maps/pokedex.png"},
    ]
    if chart_positions is not None:
        size = max(24, round(min(chart_size) / 30))
        maps.insert(1, {"name": "biome_chart", "location_size": size, "location_border_thickness": max(2, size // 10),
                        "img": CHART_IMAGE})

    write("items/items.json", items_json())
    write("maps/maps.json", maps)
    write("locations/floors.json", floor_locations(floor_centres))
    write("locations/biomes.json", biome_locations(biome_centres, chart_positions))
    write("locations/shop.json", shop_locations(shop_centres))
    write("locations/pokedex.json", dex_locations(dex_centres))
    write("scripts/autotracking/mapping.lua", location_mapping_lua())

    biome_tab_map = "biome_chart" if chart_positions is not None else "biomes_grid"
    biome_tabs = [{"title": "Biomes", "content": {"type": "map", "maps": [biome_tab_map]}}]
    if chart_positions is not None:
        biome_tabs.append({"title": "Biomes (grid)", "content": {"type": "map", "maps": ["biomes_grid"]}})
    write("layouts/tracker.json", {
        "tracker_default": {
            "type": "container",
            "background": "#00000000",
            "content": {
                "type": "dock",
                "dropshadow": True,
                "content": [
                    {"type": "dock", "dock": "left", "v_alignment": "stretch",
                     "content": [{"type": "layout", "key": "shared_item_grid"}]},
                    {"type": "tabbed", "tabs": [
                        {"title": "Floors", "content": {"type": "map", "maps": ["floors"]}},
                        *biome_tabs,
                        {"title": "Shop", "content": {"type": "map", "maps": ["shop"]}},
                        {"title": "Pokedex", "content": {"type": "map", "maps": ["pokedex"]}},
                    ]},
                ],
            },
        },
        "shared_item_grid": {
            "type": "array",
            "orientation": "vertical",
            "margin": "0,0",
            "content": [
                {"type": "group", "header": "Items", "content": {
                    "type": "itemgrid", "item_margin": "4,4", "item_size": 48,
                    "rows": [["pass", "map", END_PASS_CODE]]}},
                {"type": "group", "header": "Biome Passes", "content": {
                    "type": "itemgrid", "item_margin": "3,3", "item_size": 36,
                    "rows": [[biome_pass_code(b) for b in BIOME_PASSES[i:i + 6]]
                             for i in range(0, len(BIOME_PASSES), 6)]}},
                {"type": "group", "header": "Settings (from the server)", "content": {
                    "type": "itemgrid", "item_margin": "4,4", "item_size": 48,
                    "rows": [["location_mode", "biome_passes", "end_pass_option", "blitz", "floor_checks"],
                             ["shop_count", "shop_per_tier", "shop_per_visit", "dexsanity"]]}},
            ],
        },
        "tracker_broadcast": {
            "type": "array",
            "orientation": "horizontal",
            "content": [{"type": "itemgrid", "item_margin": "4,4", "item_size": 48,
                         "rows": [["pass", "map"]]}],
        },
    })

    count = sum(len(list(biome_floors(b))) for b in DEPTHS)
    print(f"Pack written to {PACK_DIR}: {FINAL_WAVE - 1} floor, {count} biome floor and {MAX_SHOP_ITEMS} shop "
          f"locations; biome chart {'used' if chart_positions is not None else 'missing (grid only)'}")


if __name__ == "__main__":
    main()
