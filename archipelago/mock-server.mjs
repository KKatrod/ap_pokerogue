// Tiny fake Archipelago server to test the PokeRogue client without a real multiworld.
// Usage: node archipelago/mock-server.mjs [port]   (default 38281), then connect to localhost:38281
// It gives 3 starters + a few items, scouts shop locations as items for a fake "Friend" player,
// and sends a Progressive Floor Pass each time a floor multiple of 5 is cleared.
// Environment: PASS_EVERY, LOCATION_MODE, SHOP_PER_TIER, DEATHLINK_AT, ITEMS_AT (see below).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const apData = JSON.parse(readFileSync(join(root, "src/archipelago/ap-data.json"), "utf-8"));
const port = Number.parseInt(process.argv[2] ?? "38281");
// Send a Progressive Floor Pass each time a floor multiple of this value is cleared (0 = never, to test the gate)
const passEvery = Number.parseInt(process.env.PASS_EVERY ?? "5");
const base = apData.base_id;
const item = key => base + apData.items.find(i => i.key === key).offset;
const pokemon = speciesId => base + apData.pokemon_item_offset + speciesId;

const itemNames = Object.fromEntries(apData.items.map(i => [i.name, base + i.offset]));
const locationNames = {};
for (let w = 1; w < apData.final_wave; w++) {
  locationNames[`Floor ${w} Cleared`] = base + apData.wave_location_offset + w;
}
const shopCount = 5;
for (let i = 1; i <= shopCount; i++) {
  locationNames[`Shop Item ${i}`] = base + apData.shop_location_offset + i;
}
// Biome floor locations (ids only: the mock does not know the biome names)
for (let biome = 0; biome <= 50; biome++) {
  for (let floor = 1; floor <= 10; floor++) {
    locationNames[`Biome ${biome} - Floor ${floor}`] = base + apData.biome_location_offset + biome * 10 + floor - 1;
  }
}
// Options sent in slot_data (LOCATION_MODE: 0 floors, 1 biome floors, 2 both)
const locationMode = Number.parseInt(process.env.LOCATION_MODE ?? "2");
const shopItemsPerTier = Number.parseInt(process.env.SHOP_PER_TIER ?? "2");
// Send a DeathLink when this floor is cleared (0 = never)
const deathLinkAt = Number.parseInt(process.env.DEATHLINK_AT ?? "0");
// Items sent when a floor is cleared, e.g. ITEMS_AT="2:TRAP_POISON,EFFECT_STAT_UP;3:MAP"
const itemsAt = new Map(
  (process.env.ITEMS_AT ?? "")
    .split(";")
    .filter(Boolean)
    .map(entry => {
      const [floor, keys] = entry.split(":");
      return [Number.parseInt(floor), keys.split(",")];
    }),
);

const received = [
  { item: pokemon(1), location: -2, player: 0, flags: 1 }, // Bulbasaur
  { item: pokemon(4), location: -2, player: 0, flags: 1 }, // Charmander
  { item: pokemon(7), location: -2, player: 0, flags: 1 }, // Squirtle
  { item: item("EXP_CHARM"), location: -2, player: 0, flags: 2 },
  { item: item("POTION"), location: -2, player: 0, flags: 0 },
];
const checked = new Set();

const wss = new WebSocketServer({ port });
console.log(`Mock Archipelago server listening on ws://localhost:${port}`);

wss.on("connection", socket => {
  const send = packets => socket.send(JSON.stringify(packets));
  send([
    {
      cmd: "RoomInfo",
      seed_name: "MOCKSEED",
      games: [apData.game, "Other Game"],
      password: false,
      tags: [],
      version: { major: 0, minor: 5, build: 1, class: "Version" },
    },
  ]);

  socket.on("message", raw => {
    for (const packet of JSON.parse(raw.toString())) {
      console.log("<-", JSON.stringify(packet).slice(0, 200));
      switch (packet.cmd) {
        case "Connect":
          if (packet.game !== apData.game) {
            send([{ cmd: "ConnectionRefused", errors: ["InvalidGame"] }]);
            break;
          }
          send([
            {
              cmd: "Connected",
              team: 0,
              slot: 1,
              players: [
                { team: 0, slot: 1, alias: packet.name, name: packet.name },
                { team: 0, slot: 2, alias: "Friend", name: "Friend" },
              ],
              missing_locations: Object.values(locationNames).filter(l => !checked.has(l)),
              checked_locations: [...checked],
              slot_data: {
                location_mode: locationMode,
                shop_items_per_tier: shopItemsPerTier,
                death_link: deathLinkAt > 0,
                shop_item_count: shopCount,
                shop_items_per_visit: 2,
                shop_cost_percent: 50,
                final_wave: apData.final_wave,
              },
              slot_info: {
                1: { name: packet.name, game: apData.game, type: 1 },
                2: { name: "Friend", game: "Other Game", type: 1 },
              },
            },
            { cmd: "ReceivedItems", index: 0, items: received },
          ]);
          break;
        case "GetDataPackage":
          send([
            {
              cmd: "DataPackage",
              data: {
                games: {
                  [apData.game]: { item_name_to_id: itemNames, location_name_to_id: locationNames, checksum: "mock" },
                  "Other Game": {
                    item_name_to_id: { Hookshot: 1, "Heart Container": 2 },
                    location_name_to_id: {},
                    checksum: "mock2",
                  },
                },
              },
            },
          ]);
          break;
        case "LocationScouts":
          send([
            {
              cmd: "LocationInfo",
              locations: packet.locations.map((l, i) => ({
                item: (i % 2) + 1,
                location: l,
                player: 2,
                flags: i % 2 ? 2 : 1,
              })),
            },
          ]);
          break;
        case "LocationChecks":
          for (const l of packet.locations) {
            checked.add(l);
            // Floor checks, or Town floor checks (the Town is always floors 1-10) in biome floor mode
            const townFloor = l - base - apData.biome_location_offset;
            const wave = townFloor >= 0 && townFloor < 10 ? townFloor + 1 : l - base - apData.wave_location_offset;
            if (passEvery > 0 && wave > 0 && wave < apData.final_wave && wave % passEvery === 0) {
              const newItem = { item: item("FLOOR_PASS"), location: l, player: 1, flags: 1 };
              received.push(newItem);
              send([{ cmd: "ReceivedItems", index: received.length - 1, items: [newItem] }]);
            }
            if (wave > 0 && wave < apData.final_wave) {
              for (const key of itemsAt.get(wave) ?? []) {
                const newItem = { item: item(key), location: l, player: 2, flags: key.startsWith("TRAP") ? 4 : 0 };
                received.push(newItem);
                send([{ cmd: "ReceivedItems", index: received.length - 1, items: [newItem] }]);
              }
              if (wave === deathLinkAt) {
                send([
                  {
                    cmd: "Bounced",
                    tags: ["DeathLink"],
                    data: { time: Date.now() / 1000, source: "Friend", cause: "Friend fell into a pit." },
                  },
                ]);
              }
            }
          }
          send([{ cmd: "RoomUpdate", checked_locations: packet.locations }]);
          break;
        case "ConnectUpdate":
          console.log("Tags:", packet.tags);
          break;
        case "Bounce":
          console.log("Bounce:", JSON.stringify(packet));
          break;
        case "StatusUpdate":
          console.log("Status:", packet.status);
          break;
      }
    }
  });
});
