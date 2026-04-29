// Worker-safe chunk generation and greedy meshing.
// Returns plain typed arrays so the result can be transferred from a Worker
// without copying. Main thread converts the arrays into a BufferGeometry.

import { AIRPORTS, airportSampleAt, isObstructionFreeZone } from './airport';
import { biomeAt, colorVariantAt, groveMaskAt, heightAt, isDryRiverBed, isInArchipelago, MAX_HEIGHT, SEA_LEVEL, type Biome } from './terrain';
import { isArchCrossbar, landmarkSurfaceAt } from './landmarks';
import { BLOCK, BLOCK_COLOR, VOXEL_SIZE, type BlockId, isSolid } from './voxel';

// Pick the surface block — biome × elevation + a per-cell variant block to
// add patchy color variety so each biome reads as textured, not uniform.
// Farm fields: hand-placed rectangles near home airport. Inside, paint a
// striped pattern of WHEAT_CROP and FARM_DIRT rows so the field reads as
// cultivated land from the air.
const FARM_FIELDS = [
  { cx: 200, cz: 600, w: 80, l: 100 },     // east of Origin Field
  { cx: 200, cz: -600, w: 80, l: 100 },    // south of Origin Field
];
function farmFieldBlock(wx: number, wz: number): BlockId {
  for (const f of FARM_FIELDS) {
    if (Math.abs(wx - f.cx) <= f.w / 2 && Math.abs(wz - f.cz) <= f.l / 2) {
      // Plowed rows alternate every 4 m along Z.
      const row = Math.floor(wz / 4);
      return (row & 1) === 0 ? BLOCK.WHEAT_CROP : BLOCK.FARM_DIRT;
    }
  }
  // Reference AIRPORTS to silence unused import warning when the constant changes.
  void AIRPORTS;
  return BLOCK.AIR;
}

function biomeSurfaceBlock(h: number, b: Biome, variant: number): BlockId {
  // Beach is its own biome, painted before any elevation rules.
  if (b === 'beach') return BLOCK.BEACH_SAND;
  if (b === 'frozen_ocean') return BLOCK.ICE_PACK;
  // Mountain biome: rock at high elev, alpine grass below treeline.
  if (b === 'mountains') {
    if (h > 200) return BLOCK.SNOW;
    if (h > 140) return variant > 0.6 ? BLOCK.SNOW : BLOCK.MOUNTAIN_STONE;
    if (h > 90) return BLOCK.MOUNTAIN_STONE;
    return variant > 0.85 ? BLOCK.MOUNTAIN_STONE : BLOCK.MOUNTAIN_GRASS;
  }
  // Badlands: layered rock based on height — banded mesa look from altitude.
  if (b === 'badlands') {
    const layer = Math.floor((h - 30) / 8);
    if (h > 80) return BLOCK.BADLANDS_TOP;
    if (layer % 2 === 0) return BLOCK.BADLANDS_LAYER_A;
    return BLOCK.BADLANDS_LAYER_B;
  }
  // Jungle: deep saturated jungle floor, very high humidity.
  if (b === 'jungle') {
    if (h > 110) return BLOCK.MOUNTAIN_GRASS;
    return variant > 0.88 ? BLOCK.FOREST_BRIGHT : BLOCK.JUNGLE_GRASS;
  }
  if (b === 'cherry_grove') {
    return variant > 0.7 ? BLOCK.CHERRY_GRASS : BLOCK.GRASS;
  }
  // Default rules.
  if (h <= SEA_LEVEL + 1) return BLOCK.SAND;
  if (h > 150) return BLOCK.SNOW;
  switch (b) {
    case 'snowy_tundra':
      return variant > 0.85 ? BLOCK.TUNDRA_MOSS : BLOCK.SNOW;
    case 'tundra':
      if (h > 75) return BLOCK.SNOW;
      return variant > 0.88 ? BLOCK.TUNDRA_SNOW_PATCH : BLOCK.TUNDRA_MOSS;
    case 'taiga':
      if (h > 100) return BLOCK.SNOW;
      return variant > 0.85 ? BLOCK.FOREST_FLOOR : BLOCK.TAIGA_DIRT;
    case 'desert':
      if (h > 80) return variant > 0.88 ? BLOCK.RED_ROCK_DARK : BLOCK.RED_ROCK;
      return BLOCK.SAND;
    case 'savanna':
      return variant > 0.85 ? BLOCK.WHEAT_DRY : BLOCK.SAVANNA_GRASS;
    case 'swamp':
      return variant > 0.85 ? BLOCK.TAIGA_DIRT : BLOCK.SWAMP_GRASS;
    case 'forest':
      return variant > 0.90 ? BLOCK.FOREST_BRIGHT : BLOCK.FOREST_FLOOR;
    case 'plains':
    default:
      return variant > 0.88 ? BLOCK.WHEAT_DRY : BLOCK.WHEAT;
  }
}

// Tree placement density per biome.
function treeDensity(b: Biome): number {
  switch (b) {
    case 'forest':       return 0.045;
    case 'taiga':        return 0.055;
    case 'tundra':       return 0.004;
    case 'snowy_tundra': return 0.002;
    case 'plains':       return 0.012;
    case 'savanna':      return 0.010;
    case 'swamp':        return 0.020;
    case 'desert':       return 0.012;     // cacti
    case 'jungle':       return 0.090;     // dense jungle
    case 'cherry_grove': return 0.040;     // cherry blossoms
    case 'mountains':    return 0.018;     // sparse alpine pines
    case 'badlands':     return 0.005;     // very sparse, dead trees
    case 'beach':        return 0.0;
    case 'frozen_ocean': return 0.0;
  }
}

type TreeKind = 'deciduous' | 'pine' | 'cactus' | 'acacia' | 'dead' | 'snowy_pine' | 'palm' | 'jungle_giant' | 'cherry';
function treeKindFor(b: Biome): TreeKind {
  switch (b) {
    case 'taiga':        return 'pine';
    case 'snowy_tundra': return 'snowy_pine';
    case 'tundra':       return 'snowy_pine';
    case 'desert':       return 'cactus';
    case 'savanna':      return 'acacia';
    case 'swamp':        return 'dead';
    case 'jungle':       return 'jungle_giant';
    case 'cherry_grove': return 'cherry';
    case 'mountains':    return 'pine';
    case 'badlands':     return 'dead';
    case 'forest':
    case 'plains':
    default:             return 'deciduous';
  }
}

// Chunk dimensions in VOXEL units. Each voxel is VOXEL_SIZE meters per side,
// so a 16-voxel-wide chunk covers 32m of world (matching the old chunk pitch).
export const CHUNK_SIZE = 16;
export const CHUNK_HEIGHT = Math.ceil(MAX_HEIGHT / VOXEL_SIZE);   // 110 voxels = 220 m

export interface ChunkData {
  cx: number;
  cz: number;
  blocks: Uint8Array;
}

export interface MeshArrays {
  cx: number;
  cz: number;
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
}

function idx(x: number, y: number, z: number): number {
  return (y * CHUNK_SIZE + z) * CHUNK_SIZE + x;
}

function hash2(x: number, z: number): number {
  let h = x * 374761393 + z * 668265263;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function generateChunk(cx: number, cz: number): ChunkData {
  const blocks = new Uint8Array(CHUNK_SIZE * CHUNK_HEIGHT * CHUNK_SIZE);
  // World-space chunk origin in meters.
  const wxOrigin = cx * CHUNK_SIZE * VOXEL_SIZE;
  const wzOrigin = cz * CHUNK_SIZE * VOXEL_SIZE;
  // heightCol stores VOXEL Y index for each column (top of solid).
  const heightCol = new Int16Array(CHUNK_SIZE * CHUNK_SIZE);
  const seaLevelVox = Math.floor(SEA_LEVEL / VOXEL_SIZE);
  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const wx = wxOrigin + x * VOXEL_SIZE;
      const wz = wzOrigin + z * VOXEL_SIZE;
      const hWorld = heightAt(wx, wz);
      // Voxel y containing the surface — voxel j covers y ∈ [j*V, (j+1)*V).
      const hVox = Math.max(0, Math.min(CHUNK_HEIGHT - 1, Math.floor(hWorld / VOXEL_SIZE)));
      heightCol[z * CHUNK_SIZE + x] = hVox;
      const biome = biomeAt(wx, wz);
      const variant = colorVariantAt(wx, wz);
      let surfaceBlock: BlockId = biomeSurfaceBlock(hWorld, biome, variant);
      // Dry river bed: in arid biomes where the river noise carves but no
      // water fills (high elevation), paint sand/gravel for a dry-wash look.
      if ((biome === 'desert' || biome === 'savanna' || biome === 'plains' || biome === 'badlands') &&
          hWorld >= 90 && isDryRiverBed(wx, wz)) {
        surfaceBlock = BLOCK.SAND;
      }
      // Tropical archipelago — overrides biome with white sand on islands.
      const tropical = isInArchipelago(wx, wz);
      if (tropical && hWorld > SEA_LEVEL) {
        surfaceBlock = BLOCK.WHITE_SAND;
      }
      // Hand-placed landmark overrides (volcano basalt, pillar/arch sandstone, lava).
      const landmarkBlock = landmarkSurfaceAt(wx, wz, hWorld);
      if (landmarkBlock !== null) surfaceBlock = landmarkBlock;
      // Farm fields next to home airport — wheat-crop + plowed-dirt rows.
      const farmBlock = farmFieldBlock(wx, wz);
      if (farmBlock !== BLOCK.AIR) surfaceBlock = farmBlock;
      for (let y = 0; y < hVox; y++) {
        // Top 4 voxels under surface = dirt, rest stone (cosmetic — only seen
        // at cliff exposures).
        blocks[idx(x, y, z)] = (y > hVox - 3) ? BLOCK.DIRT : BLOCK.STONE;
      }
      blocks[idx(x, hVox, z)] = surfaceBlock;
      if (hVox < seaLevelVox) {
        // Frozen ocean → fill with water + cap with ice block at the surface.
        if (biome === 'frozen_ocean') {
          for (let y = hVox + 1; y < seaLevelVox; y++) {
            blocks[idx(x, y, z)] = BLOCK.WATER;
          }
          blocks[idx(x, seaLevelVox, z)] = BLOCK.ICE_PACK;
        } else {
          const waterBlock = tropical ? BLOCK.TROPICAL_LAGOON : BLOCK.WATER;
          for (let y = hVox + 1; y <= seaLevelVox; y++) {
            blocks[idx(x, y, z)] = waterBlock;
          }
        }
      }
      // Rock arch crossbar — suspended sandstone bridging two pillars at the
      // archway top. We sample a small Y range above terrain for each cell.
      for (let dy = 1; dy < 14; dy++) {
        const wy = hWorld + dy;
        if (isArchCrossbar(wx, wy, wz)) {
          const vy = Math.floor(wy / VOXEL_SIZE);
          if (vy >= 0 && vy < CHUNK_HEIGHT) {
            blocks[idx(x, vy, z)] = BLOCK.ROCK_ARCH;
          }
        }
      }
    }
  }
  // Cliff pass: where a column is much taller than its neighbor (in voxel y,
  // ≥3 voxels = 6 m drop), expose stone for the upper few cells.
  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const h = heightCol[z * CHUNK_SIZE + x];
      let minNeighbor = h;
      for (const [nx, nz] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
        let nh: number;
        const xi = x + nx, zi = z + nz;
        if (xi >= 0 && xi < CHUNK_SIZE && zi >= 0 && zi < CHUNK_SIZE) {
          nh = heightCol[zi * CHUNK_SIZE + xi];
        } else {
          // World coords for cross-chunk neighbor — in meters.
          const wx = wxOrigin + xi * VOXEL_SIZE;
          const wz = wzOrigin + zi * VOXEL_SIZE;
          nh = Math.floor(heightAt(wx, wz) / VOXEL_SIZE);
        }
        if (nh < minNeighbor) minNeighbor = nh;
      }
      const drop = h - minNeighbor;
      // Only count as cliff if drop ≥ 5 voxels (10 m) — was triggering on
      // every modest hill, scattering grey stone everywhere.
      if (drop >= 5) {
        const exposeDepth = Math.min(drop, 4);
        for (let dy = 0; dy <= exposeDepth; dy++) {
          const y = h - dy;
          if (y < 0) break;
          blocks[idx(x, y, z)] = BLOCK.STONE;
        }
      }
    }
  }

  // Trees: density and viable surface depend on biome. Forest is dense, plains
  // scattered, tundra sparse (and only the lower portion, below the snow line),
  // desert none. Any forest/plains/tundra/wheat-tinted ground qualifies.
  for (let x = 1; x < CHUNK_SIZE - 1; x++) {
    for (let z = 1; z < CHUNK_SIZE - 1; z++) {
      const wx = wxOrigin + x * VOXEL_SIZE;
      const wz = wzOrigin + z * VOXEL_SIZE;
      const h = heightCol[z * CHUNK_SIZE + x];      // voxel y
      const hWorld = h * VOXEL_SIZE;
      if (hWorld <= 33 || hWorld > 110) continue;
      if (isObstructionFreeZone(wx, wz)) continue;
      const surf = blocks[idx(x, h, z)];
      // Surface check — anything plant-able qualifies. Cacti grow on sand too.
      const isVegetable =
        surf === BLOCK.FOREST_FLOOR || surf === BLOCK.FOREST_BRIGHT ||
        surf === BLOCK.WHEAT || surf === BLOCK.WHEAT_DRY ||
        surf === BLOCK.TUNDRA_MOSS || surf === BLOCK.TUNDRA_SNOW_PATCH ||
        surf === BLOCK.SAVANNA_GRASS || surf === BLOCK.SWAMP_GRASS ||
        surf === BLOCK.TAIGA_DIRT || surf === BLOCK.GRASS;
      const isCactusable = surf === BLOCK.SAND;
      const isTropical = surf === BLOCK.WHITE_SAND;
      // Jungle / cherry / mountain / badlands accept their own biome surfaces.
      const isJungle = surf === BLOCK.JUNGLE_GRASS || surf === BLOCK.FOREST_BRIGHT;
      const isCherry = surf === BLOCK.CHERRY_GRASS || surf === BLOCK.GRASS;
      const isAlpine = surf === BLOCK.MOUNTAIN_GRASS;
      const isBadlands = surf === BLOCK.BADLANDS_LAYER_A || surf === BLOCK.BADLANDS_LAYER_B || surf === BLOCK.BADLANDS_TOP;
      const b = biomeAt(wx, wz);
      let treeKind: TreeKind = treeKindFor(b);
      if (isTropical) treeKind = 'palm';

      // Surface compatibility per kind.
      if (treeKind === 'cactus') { if (!isCactusable) continue; }
      else if (treeKind === 'palm') { if (!isTropical) continue; }
      else if (treeKind === 'jungle_giant') { if (!isJungle && !isVegetable) continue; }
      else if (treeKind === 'cherry') { if (!isCherry && !isVegetable) continue; }
      else if (b === 'mountains') { if (!isAlpine && !isVegetable) continue; }
      else if (b === 'badlands') { if (!isBadlands) continue; }
      else { if (!isVegetable) continue; }

      const density = treeKind === 'palm' ? 0.025 : treeDensity(b);
      if (density === 0) continue;
      const grove = groveMaskAt(wx, wz);
      const useGrove = treeKind === 'deciduous' || treeKind === 'pine' || treeKind === 'snowy_pine' || treeKind === 'jungle_giant';
      if (useGrove && grove < 0.45) continue;
      const groveDensity = useGrove ? density * (grove - 0.45) / 0.55 * 4 : density;
      if (hash2(wx, wz) > groveDensity) continue;
      placePlant(blocks, x, h + 1, z, treeKind);
    }
  }
  // Defensive cleanup: a tree just outside the airport's falloff ring can
  // spread leaves one cell inward, leaving wood/leaf blocks floating over the
  // runway approach or apron. Clear ANY solid block above the snapped surface
  // inside any airport-influenced cell.
  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const wx = wxOrigin + x * VOXEL_SIZE;
      const wz = wzOrigin + z * VOXEL_SIZE;
      if (!airportSampleAt(wx, wz)) continue;
      const h = heightCol[z * CHUNK_SIZE + x];
      for (let y = h + 1; y < CHUNK_HEIGHT; y++) {
        blocks[idx(x, y, z)] = BLOCK.AIR;
      }
    }
  }
  return { cx, cz, blocks };
}

function placePlant(blocks: Uint8Array, x: number, y0: number, z: number, kind: TreeKind) {
  switch (kind) {
    case 'deciduous':    return placeDeciduous(blocks, x, y0, z);
    case 'pine':         return placePine(blocks, x, y0, z, false);
    case 'snowy_pine':   return placePine(blocks, x, y0, z, true);
    case 'cactus':       return placeCactus(blocks, x, y0, z);
    case 'acacia':       return placeAcacia(blocks, x, y0, z);
    case 'dead':         return placeDead(blocks, x, y0, z);
    case 'palm':         return placePalm(blocks, x, y0, z);
    case 'jungle_giant': return placeJungleGiant(blocks, x, y0, z);
    case 'cherry':       return placeCherry(blocks, x, y0, z);
  }
}

function setBlock(blocks: Uint8Array, x: number, y: number, z: number, id: number) {
  if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE) return;
  if (y < 0 || y >= CHUNK_HEIGHT) return;
  if (blocks[idx(x, y, z)] !== BLOCK.AIR) return;
  blocks[idx(x, y, z)] = id;
}

function placeDeciduous(blocks: Uint8Array, x: number, y0: number, z: number) {
  const trunkH = 4 + Math.floor(hash2(x * 3 + 7, z * 5 + 11) * 3);
  for (let dy = 0; dy < trunkH; dy++) setBlock(blocks, x, y0 + dy, z, BLOCK.WOOD);
  const top = y0 + trunkH - 1;
  for (let dx = -1; dx <= 1; dx++)
    for (let dz = -1; dz <= 1; dz++)
      for (let dy = 0; dy <= 1; dy++)
        setBlock(blocks, x + dx, top + dy, z + dz, BLOCK.LEAF);
  setBlock(blocks, x, top + 2, z, BLOCK.LEAF);
}

function placePine(blocks: Uint8Array, x: number, y0: number, z: number, snowy: boolean) {
  const trunkH = 5 + Math.floor(hash2(x * 5 + 13, z * 7 + 17) * 3);
  for (let dy = 0; dy < trunkH; dy++) setBlock(blocks, x, y0 + dy, z, BLOCK.WOOD);
  const top = y0 + trunkH - 1;
  const leaf = snowy ? BLOCK.LEAF_SNOWY : BLOCK.LEAF_PINE;
  // Stacked cones, narrower as we go up.
  // Layer 1 (widest, 3x3 minus corners), layer 2 (3x3 plus column), layer 3 (1x1 at top).
  for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1], [0, 0]] as const) {
    setBlock(blocks, x + dx, top - 2, z + dz, leaf);
  }
  for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1], [0, 0]] as const) {
    setBlock(blocks, x + dx, top - 1, z + dz, leaf);
  }
  setBlock(blocks, x, top, z, leaf);
  setBlock(blocks, x, top + 1, z, leaf);
}

function placeCactus(blocks: Uint8Array, x: number, y0: number, z: number) {
  const h = 2 + Math.floor(hash2(x * 11, z * 13) * 3);   // 2-4 tall
  for (let dy = 0; dy < h; dy++) setBlock(blocks, x, y0 + dy, z, BLOCK.CACTUS);
}

function placeAcacia(blocks: Uint8Array, x: number, y0: number, z: number) {
  const trunkH = 3 + Math.floor(hash2(x * 17, z * 19) * 2);
  for (let dy = 0; dy < trunkH; dy++) setBlock(blocks, x, y0 + dy, z, BLOCK.WOOD);
  const top = y0 + trunkH - 1;
  // Wide flat canopy — 5x5 at one layer.
  for (let dx = -2; dx <= 2; dx++)
    for (let dz = -2; dz <= 2; dz++) {
      // Cut corners for a more umbrella-like shape.
      if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
      setBlock(blocks, x + dx, top + 1, z + dz, BLOCK.LEAF_ACACIA);
    }
}

function placeDead(blocks: Uint8Array, x: number, y0: number, z: number) {
  const trunkH = 3 + Math.floor(hash2(x * 23, z * 29) * 3);
  for (let dy = 0; dy < trunkH; dy++) setBlock(blocks, x, y0 + dy, z, BLOCK.WOOD);
  // A few bare branches near the top.
  const top = y0 + trunkH - 1;
  if (hash2(x, z + 1) > 0.5) setBlock(blocks, x + 1, top, z, BLOCK.WOOD);
  if (hash2(x + 1, z) > 0.5) setBlock(blocks, x, top, z + 1, BLOCK.WOOD);
  if (hash2(x + 2, z) > 0.5) setBlock(blocks, x - 1, top - 1, z, BLOCK.WOOD);
}

function placePalm(blocks: Uint8Array, x: number, y0: number, z: number) {
  // Tall thin trunk + 4 fronds at the top spread horizontally.
  const trunkH = 5 + Math.floor(hash2(x * 31, z * 37) * 3);
  for (let dy = 0; dy < trunkH; dy++) setBlock(blocks, x, y0 + dy, z, BLOCK.PALM_TRUNK);
  const top = y0 + trunkH;
  setBlock(blocks, x, top, z, BLOCK.PALM_LEAF);
  for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
    setBlock(blocks, x + dx, top, z + dz, BLOCK.PALM_LEAF);
    setBlock(blocks, x + dx * 2, top - 1, z + dz * 2, BLOCK.PALM_LEAF);
  }
  setBlock(blocks, x, top + 1, z, BLOCK.PALM_LEAF);
}

function placeJungleGiant(blocks: Uint8Array, x: number, y0: number, z: number) {
  // Tall trunk with broad multi-tier canopy.
  const trunkH = 7 + Math.floor(hash2(x * 41, z * 43) * 4);
  for (let dy = 0; dy < trunkH; dy++) setBlock(blocks, x, y0 + dy, z, BLOCK.WOOD);
  const top = y0 + trunkH - 1;
  // Wide lower canopy (5x5)
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
    if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
    setBlock(blocks, x + dx, top - 1, z + dz, BLOCK.LEAF_JUNGLE);
  }
  // Mid layer (3x3)
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    setBlock(blocks, x + dx, top, z + dz, BLOCK.LEAF_JUNGLE);
    setBlock(blocks, x + dx, top + 1, z + dz, BLOCK.LEAF_JUNGLE);
  }
  // Crown
  setBlock(blocks, x, top + 2, z, BLOCK.LEAF_JUNGLE);
}

function placeCherry(blocks: Uint8Array, x: number, y0: number, z: number) {
  // Short trunk + puffy pink canopy.
  const trunkH = 3 + Math.floor(hash2(x * 47, z * 53) * 2);
  for (let dy = 0; dy < trunkH; dy++) setBlock(blocks, x, y0 + dy, z, BLOCK.WOOD);
  const top = y0 + trunkH - 1;
  // Wide flat canopy with cherry blossom leaves.
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
    if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
    setBlock(blocks, x + dx, top + 1, z + dz, BLOCK.LEAF_CHERRY);
  }
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    setBlock(blocks, x + dx, top + 2, z + dz, BLOCK.LEAF_CHERRY);
  }
  setBlock(blocks, x, top + 3, z, BLOCK.LEAF_CHERRY);
}

function getBlock(chunk: ChunkData, x: number, y: number, z: number): number {
  if (y < 0 || y >= CHUNK_HEIGHT) return BLOCK.AIR;
  if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE) {
    // Convert voxel coords (chunk + offset) to world meters for the height
    // lookup. The mesher only needs to know solid vs non-solid for face
    // culling, so we pick STONE for solid + WATER/AIR above ground.
    const wx = (chunk.cx * CHUNK_SIZE + x) * VOXEL_SIZE;
    const wz = (chunk.cz * CHUNK_SIZE + z) * VOXEL_SIZE;
    const hWorld = heightAt(wx, wz);
    const hVox = Math.floor(hWorld / VOXEL_SIZE);
    if (y > hVox) {
      const seaLevelVox = Math.floor(SEA_LEVEL / VOXEL_SIZE);
      return y <= seaLevelVox ? BLOCK.WATER : BLOCK.AIR;
    }
    return BLOCK.STONE;
  }
  return chunk.blocks[idx(x, y, z)];
}

const SHADE_PLUS_X = 0.78;
const SHADE_PLUS_Y = 1.0;
const SHADE_MINUS_Y = 0.55;
const SHADE_PLUS_Z = 0.88;

function pushQuad(
  positions: number[], normals: number[], colors: number[], indices: number[],
  axis: number, dirSign: number,
  i: number, j: number, k: number,
  w: number, h: number,
  blockId: number, shade: number,
) {
  const color = BLOCK_COLOR[blockId] ?? [1, 1, 1];
  const r = color[0] * shade;
  const g = color[1] * shade;
  const b = color[2] * shade;
  const slice = dirSign > 0 ? k + 1 : k;

  let v0: [number, number, number];
  let v1: [number, number, number];
  let v2: [number, number, number];
  let v3: [number, number, number];
  let nx = 0, ny = 0, nz = 0;

  if (axis === 0) {
    nx = dirSign;
    v0 = [slice, i, j];
    v1 = [slice, i + w, j];
    v2 = [slice, i + w, j + h];
    v3 = [slice, i, j + h];
  } else if (axis === 1) {
    // Main loop sets xyz[u=2(Z)] = i and xyz[v=0(X)] = j, so i is Z and
    // j is X. Vertices need (X, Y, Z) so swap: X uses j, Z uses i.
    ny = dirSign;
    v0 = [j, slice, i];
    v1 = [j + h, slice, i];
    v2 = [j + h, slice, i + w];
    v3 = [j, slice, i + w];
  } else {
    nz = dirSign;
    v0 = [i, j, slice];
    v1 = [i + w, j, slice];
    v2 = [i + w, j + h, slice];
    v3 = [i, j + h, slice];
  }

  const flipForAxis1 = axis === 1;
  const wantPlus = dirSign > 0;
  const ccw = flipForAxis1 ? !wantPlus : wantPlus;
  const order: [number, number, number, number] = ccw
    ? [0, 1, 2, 3]
    : [0, 3, 2, 1];

  const start = positions.length / 3;
  const verts = [v0, v1, v2, v3];
  for (const oi of order) {
    const v = verts[oi];
    // Scale voxel-unit positions to world meters at write time.
    positions.push(v[0] * VOXEL_SIZE, v[1] * VOXEL_SIZE, v[2] * VOXEL_SIZE);
    normals.push(nx, ny, nz);
    colors.push(r, g, b);
  }
  indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
}

function exposed(blockId: number, neighborId: number, axis: number, dirSign: number): boolean {
  void axis; void dirSign;
  if (blockId === BLOCK.AIR) return false;
  if (blockId === BLOCK.WATER) {
    // Render every water face that touches air. Without side/bottom faces,
    // the camera sees straight through water columns from low angles —
    // looks like holes in the terrain.
    return neighborId === BLOCK.AIR;
  }
  return !isSolid(neighborId);
}

export function buildMeshArrays(chunk: ChunkData): MeshArrays {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const dimsXYZ = [CHUNK_SIZE, CHUNK_HEIGHT, CHUNK_SIZE];

  for (let axis = 0; axis < 3; axis++) {
    const u = (axis + 1) % 3;
    const v = (axis + 2) % 3;
    const W = dimsXYZ[u];
    const H = dimsXYZ[v];
    const D = dimsXYZ[axis];
    const mask = new Uint8Array(W * H);

    for (let dirSign = -1; dirSign <= 1; dirSign += 2) {
      const shade =
        axis === 1
          ? (dirSign > 0 ? SHADE_PLUS_Y : SHADE_MINUS_Y)
          : axis === 0
            ? SHADE_PLUS_X
            : SHADE_PLUS_Z;

      for (let k = 0; k < D; k++) {
        for (let j = 0; j < H; j++) {
          for (let i = 0; i < W; i++) {
            const xyz = [0, 0, 0];
            xyz[axis] = k;
            xyz[u] = i;
            xyz[v] = j;
            const block = getBlock(chunk, xyz[0], xyz[1], xyz[2]);
            xyz[axis] = k + dirSign;
            const neighbor = getBlock(chunk, xyz[0], xyz[1], xyz[2]);
            if (exposed(block, neighbor, axis, dirSign)) {
              mask[j * W + i] = block;
            } else {
              mask[j * W + i] = 0;
            }
          }
        }
        for (let j = 0; j < H; j++) {
          let i = 0;
          while (i < W) {
            const c = mask[j * W + i];
            if (c === 0) { i++; continue; }
            let w = 1;
            while (i + w < W && mask[j * W + i + w] === c) w++;
            let h = 1;
            outer: while (j + h < H) {
              for (let ii = 0; ii < w; ii++) {
                if (mask[(j + h) * W + i + ii] !== c) break outer;
              }
              h++;
            }
            pushQuad(positions, normals, colors, indices, axis, dirSign, i, j, k, w, h, c, shade);
            for (let jj = 0; jj < h; jj++) {
              for (let ii = 0; ii < w; ii++) {
                mask[(j + jj) * W + i + ii] = 0;
              }
            }
            i += w;
          }
        }
      }
    }
  }

  return {
    cx: chunk.cx,
    cz: chunk.cz,
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colors: new Float32Array(colors),
    indices: new Uint32Array(indices),
  };
}
