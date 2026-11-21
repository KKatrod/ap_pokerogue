/**
 * Exports the species data used by the Dexsanity option of the apworld to `archipelago/dex-data.json`:
 * every species (generation, types, legendary status, starter and pre-evolution) and the biomes where it can be met
 * in the wild. `archipelago/generate-apworld-data.mjs` turns it into Python data.
 *
 * Usage: npx vitest run --config scripts/archipelago-dex-exporter/vitest.config.ts
 */

import { speciesDataRegistry } from "#app/global-species-data-registry";
import { initBiomes } from "#app/init/init-biomes";
import { allBiomes } from "#data/data-lists";
import { BiomeId } from "#enums/biome-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";

interface DexSpeciesEntry {
  id: number;
  key: string;
  generation: number;
  types: string[];
  legendary: boolean;
  starter: number;
  prevolution: number | null;
  biomes: number[];
}

test("export the Dexsanity species data", () => {
  if (allBiomes.size === 0) {
    initBiomes();
  }
  const biomesBySpecies = new Map<number, Set<number>>();
  for (const [biomeId, biome] of allBiomes.entries()) {
    for (const byTime of Object.values(biome.pokemonPool)) {
      for (const ids of Object.values(byTime as Record<string, readonly SpeciesId[]>)) {
        for (const id of ids) {
          if (!biomesBySpecies.has(id)) {
            biomesBySpecies.set(id, new Set());
          }
          biomesBySpecies.get(id)!.add(biomeId);
        }
      }
    }
  }

  const entries: DexSpeciesEntry[] = [];
  for (const speciesData of Object.values(speciesDataRegistry.data)) {
    const species = speciesData.species;
    entries.push({
      id: species.speciesId,
      key: SpeciesId[species.speciesId],
      generation: species.generation,
      types: [PokemonType[species.type1], ...(species.type2 == null ? [] : [PokemonType[species.type2]])].filter(
        (t, i, all) => all.indexOf(t) === i,
      ),
      legendary: species.legendary || species.subLegendary || species.mythical,
      starter: speciesData.starter,
      prevolution: speciesData.prevolution ?? null,
      biomes: [...(biomesBySpecies.get(species.speciesId) ?? [])].sort((a, b) => a - b),
    });
  }
  entries.sort((a, b) => a.id - b.id);

  const out = join(import.meta.dirname, "..", "..", "archipelago", "dex-data.json");
  writeFileSync(
    out,
    `${JSON.stringify({ end_biome: BiomeId.END, species: entries }, null, 0).replace(/\},\{/g, "},\n{")}\n`,
    "utf-8",
  );
  console.log(`Wrote ${entries.length} species to ${out}`);
});
