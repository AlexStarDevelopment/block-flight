import { createNoise2D } from 'simplex-noise';
import { airportSampleAt, AIRPORTS } from './airport';
import { landingSiteSampleAt, landingSiteThemeDelta, LANDING_SITES } from './landingSites';
import { CITY_CENTER, CITY_ESTATE_OUTER } from './city';
import { landmarksDelta } from './landmarks';
import { BLOCK, type BlockId } from './voxel';

// World terrain v2: continent-scale climate model + per-biome elevation
// shapes + hand-placed signature landmarks. Inspired by Minecraft 1.18+'s
// Caves & Cliffs continentalness/erosion/depth/weirdness multi-noise system,
// scaled down to what makes sense for a flying sim — biomes that read clearly
// from cruise altitude and form regions you can navigate by.

const SEED = 1408;

function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(SEED);
// Climate noise (4D space)
const tempNoise = createNoise2D(rng);             // local temperature variation
const moistNoise = createNoise2D(rng);            // local humidity variation
const continentNoise = createNoise2D(rng);        // large land/water shape (~12 km)
const erosionNoise = createNoise2D(rng);          // ruggedness (mountains vs plains)
// Terrain shape noise
const ridgeNoise = createNoise2D(rng);
const ridgeNoise2 = createNoise2D(rng);
const hillNoise = createNoise2D(rng);
const detailNoise = createNoise2D(rng);
const duneNoise = createNoise2D(rng);             // desert dunes
const plateauNoise = createNoise2D(rng);          // badlands stepped layers
const riverNoise = createNoise2D(rng);
// Decoration / variant noise
const colorVarNoise = createNoise2D(rng);
const groveNoise = createNoise2D(rng);

export type Biome =
  | 'forest' | 'desert' | 'tundra' | 'plains'
  | 'savanna' | 'taiga' | 'snowy_tundra' | 'swamp'
  | 'badlands' | 'jungle' | 'mountains' | 'beach'
  | 'frozen_ocean' | 'cherry_grove';

export const SEA_LEVEL = 28;
export const MAX_HEIGHT = 320;        // raised — mountains, the spire and the volcano now reach much higher

// === Public masks / variant helpers ===
export function colorVariantAt(x: number, z: number): number {
  return (colorVarNoise(x / 80, z / 80) + 1) * 0.5;
}
export function groveMaskAt(x: number, z: number): number {
  return (groveNoise(x / 150, z / 150) + 1) * 0.5;
}
export function biomeJitterAt(x: number, z: number): number {
  return colorVarNoise(x / 14, z / 14);
}

export function isDryRiverBed(x: number, z: number): boolean {
  const riv1 = riverNoise(x / 1200, z / 1200);
  const riv2 = riverNoise(z / 1100, x / 1100);
  const riverMask = Math.max(1 - Math.abs(riv1), 1 - Math.abs(riv2));
  return riverMask > 0.93;
}

// === Climate model ===
// Returns the raw climate vector at (x, z). All values in roughly [-1, 1].
//   t  — temperature (cold ↔ hot). North is cold, south is hot, plus noise.
//   m  — humidity (dry ↔ wet). West is dry, east is wet, plus noise.
//   c  — continentalness. < 0 → ocean / coast; > 0 → inland.
//   e  — erosion. > 0 → rugged (mountains); < 0 → flat.
function climateAt(x: number, z: number) {
  // Continental position-based gradients ensure each compass direction has a
  // characteristic biome family; noise breaks up the regularity. Gradient
  // weight (0.75) > noise weight (0.45) so far-north is reliably cold and
  // far-south is reliably warm — no more "ice fields in the desert" rolls.
  const tempBase = -z / 5500;          // north (high z) → cold
  const humidBase = x / 5500;          // east (high x) → wet
  const t = clampSym(tempBase * 0.75 + tempNoise(x / 8000, z / 8000) * 0.45);
  const m = clampSym(humidBase * 0.75 + moistNoise(x / 7000, z / 7000) * 0.45);
  const c = continentNoise(x / 12000, z / 12000) + airportLandBias(x, z) * 0.55;
  const e = erosionNoise(x / 5000, z / 5000);
  return { t, m, c, e };
}

function clampSym(v: number): number {
  if (v > 1) return 1;
  if (v < -1) return -1;
  return v;
}

// === Biome selection ===
// Modern Minecraft picks biome from a multi-dimensional table; here we just
// hand-write the decision tree because we only have ~14 biomes. Order matters:
// gates appear before fallbacks.
//
// Per-airport biome overrides force a specific biome around named airports
// so e.g. Alpine Strip is always surrounded by mountains regardless of where
// erosion noise wants to put them.
const AIRPORT_BIOME_OVERRIDES: { name: string; r: number; biome: Biome }[] = [
  // Alpine override kept tight — mountain biome immediately around Alpine
  // Strip but not bleeding into the next-door landing site Ranger Cabin.
  { name: 'Alpine Strip',  r: 1100, biome: 'mountains' },
  { name: 'Stone Plateau', r: 1500, biome: 'badlands' },
];

const LANDING_SITE_BIOME_OVERRIDES: { name: string; r: number; biome: Biome }[] = [
  // Cold/ice sites
  { name: 'Frostlake',   r: 800, biome: 'frozen_ocean' },
  { name: 'Glacier Pad', r: 700, biome: 'snowy_tundra' },
  { name: 'Ice Fields',  r: 800, biome: 'snowy_tundra' },
  // Forest / wildlife sites
  { name: 'Wolf Meadow', r: 700, biome: 'forest' },
  { name: 'Ranger Cabin', r: 700, biome: 'forest' },
  { name: 'Pine Ridge',  r: 700, biome: 'taiga' },
  { name: 'Cedar Bluff', r: 700, biome: 'taiga' },
  // Wetland
  { name: 'Marsh Strip', r: 700, biome: 'swamp' },
  // Arid mesa country
  { name: 'Mesa North',  r: 700, biome: 'badlands' },
  { name: 'Mesa South',  r: 700, biome: 'badlands' },
];

function airportBiomeOverride(x: number, z: number): Biome | null {
  // Check landing site overrides FIRST — they're typically more local than
  // airport overrides, and we want a landing site's named biome (e.g. Ranger
  // Cabin = forest) to win over a nearby airport's broader biome (Alpine =
  // mountains) even when the radii overlap.
  for (const o of LANDING_SITE_BIOME_OVERRIDES) {
    const s = LANDING_SITES.find((ls) => ls.name === o.name);
    if (!s) continue;
    if (Math.hypot(x - s.cx, z - s.cz) < o.r) return o.biome;
  }
  for (const o of AIRPORT_BIOME_OVERRIDES) {
    const a = AIRPORTS.find((ap) => ap.name === o.name);
    if (!a) continue;
    if (Math.hypot(x - a.cx, z - a.cz) < o.r) return o.biome;
  }
  return null;
}

export function biomeAt(x: number, z: number): Biome {
  const override = airportBiomeOverride(x, z);
  if (override) return override;
  const { t, m, c, e } = climateAt(x, z);
  const j = biomeJitterAt(x, z) * 0.05;     // jitter for soft biome boundaries

  // Beach: thin ring where continentalness is borderline (coast).
  if (c < -0.04 && c > -0.18) {
    // Cold beaches → frozen ocean instead.
    if (t < -0.5) return 'frozen_ocean';
    return 'beach';
  }

  // Open ocean (c well below zero): treat as plains for biome categorisation
  // (terrain shape will already pull below sea level). Cold ocean → frozen.
  if (c < -0.18) {
    return t < -0.4 ? 'frozen_ocean' : 'plains';
  }

  // Mountains: high erosion + inland.
  if (e > 0.30 + j && c > 0.05) return 'mountains';

  // Cold zone
  if (t < -0.55) return 'snowy_tundra';
  if (t < -0.25) return m > 0.0 ? 'taiga' : 'tundra';

  // Hot dry zone
  if (m < -0.30) {
    // Badlands inside hot+dry where erosion is moderate (forms plateaus).
    if (t > 0.0 && e > -0.05 && e < 0.30) return 'badlands';
    if (t > 0.05) return 'desert';
    return 'savanna';
  }

  // Hot wet zone
  if (m > 0.30) {
    if (t > 0.20) return 'jungle';
    if (t < -0.05) return 'swamp';
    return 'forest';
  }

  // Cherry grove — rare, mild + slightly wet, picked via weirdness noise.
  if (t > 0.0 && t < 0.35 && m > 0.0 && m < 0.30 && Math.abs(j * 22) > 0.85) {
    return 'cherry_grove';
  }

  // Swamps where it's wet, cool-ish, and low elevation.
  if (m > 0.10 && t < 0.10 && c < 0.15) return 'swamp';

  // Mid-warm wet → forest
  if (m > 0.05) return 'forest';
  // Mid-warm dry → savanna or plains
  if (t > 0.25 && m < 0.0) return 'savanna';

  return 'plains';
}

// === Per-biome elevation shaping ===
// Each biome has its own contribution on top of the continentalness base. The
// baseElev itself comes from continentalness — high inland, low coastal,
// negative offshore.

function biomeElevation(b: Biome, x: number, z: number, e: number): number {
  switch (b) {
    case 'mountains': {
      // Steep ridge mountains — primary feature of the world.
      const r1 = ridgeNoise(x / 360, z / 1200);
      const r2 = ridgeNoise2(x / 1200, z / 360);
      const ridge = Math.max(1 - Math.abs(r1), 1 - Math.abs(r2));
      const ridgeShape = Math.pow(ridge, 1.4);
      const erosionBoost = Math.max(0, e + 0.3) * 1.4;
      return ridgeShape * 160 * erosionBoost
           + hillNoise(x / 280, z / 280) * 18
           + detailNoise(x / 90, z / 90) * 4;
    }
    case 'badlands': {
      // Layered plateaus — three discrete elevation steps + cliffs.
      const p = plateauNoise(x / 480, z / 480);
      // Quantize to 3 levels: low, mid, high.
      let layer: number;
      if (p > 0.35) layer = 60;
      else if (p > -0.05) layer = 30;
      else if (p > -0.4) layer = 15;
      else layer = 0;
      // Soften step edges very slightly so they're walkable.
      const edge = (p % 0.05) * 4;
      return layer + edge + detailNoise(x / 70, z / 70) * 2;
    }
    case 'desert': {
      // Sinusoidal dunes. Each dune is a long ridge ~150m wavelength.
      const dune = duneNoise(x / 320, z / 320);
      const duneSharp = Math.pow(Math.abs(dune), 0.7) * Math.sign(dune);
      return 8 + duneSharp * 14
           + hillNoise(x / 600, z / 600) * 6;
    }
    case 'jungle': {
      // Tall hills with dense canopy implied by tree placement.
      const hill = hillNoise(x / 200, z / 200);
      return 14 + Math.max(0, hill) * 32
           + detailNoise(x / 80, z / 80) * 3;
    }
    case 'savanna': {
      // Flat with occasional gentle plateau steps.
      const plat = plateauNoise(x / 700, z / 700);
      const step = plat > 0.25 ? 8 : 0;
      return 4 + step + hillNoise(x / 380, z / 380) * 5;
    }
    case 'beach': {
      // Very flat, just above sea level.
      return 1 + detailNoise(x / 120, z / 120) * 1.5;
    }
    case 'frozen_ocean': {
      // Below sea level — chunkData paints ICE_PACK over the water.
      return -8 + detailNoise(x / 200, z / 200) * 2;
    }
    case 'snowy_tundra':
    case 'tundra': {
      // Flat with subtle rolling.
      return 2 + hillNoise(x / 500, z / 500) * 6;
    }
    case 'taiga': {
      // Rolling pine hills, modest amplitude.
      return 6 + hillNoise(x / 320, z / 320) * 14
           + detailNoise(x / 90, z / 90) * 3;
    }
    case 'swamp': {
      // Low and flat, slightly below typical land elevation.
      return -4 + detailNoise(x / 140, z / 140) * 2;
    }
    case 'cherry_grove': {
      // Gentle rolling, similar to plains but with slightly more variation.
      return 6 + hillNoise(x / 260, z / 260) * 12
           + detailNoise(x / 80, z / 80) * 2;
    }
    case 'forest': {
      // Modest rolling.
      return 5 + hillNoise(x / 320, z / 320) * 14
           + detailNoise(x / 80, z / 80) * 3;
    }
    case 'plains':
    default: {
      // Gentle rolling, flat overall.
      return 3 + hillNoise(x / 380, z / 380) * 8
           + detailNoise(x / 90, z / 90) * 2;
    }
  }
}

// === Airport / theme support ===

function airportThemeShape(x: number, z: number): { delta: number; weight: number; isLake: boolean } | null {
  for (const a of AIRPORTS) {
    if (a.theme === 'flat') continue;
    const dx = x - a.cx;
    const dz = z - a.cz;
    const dist = Math.hypot(dx, dz);
    if (a.theme === 'lake') {
      const r = 1400;
      if (dist > r) continue;
      const w = 1 - dist / r;
      const ws = w * w * w * (w * (w * 6 - 15) + 10);
      const middleProtect = Math.max(0, 1 - dist / 200);
      const bowlDepth = -25 * (1 - middleProtect * 0.6);
      return { delta: bowlDepth * ws, weight: ws, isLake: true };
    }
    if (a.theme === 'plateau') {
      // Dramatic Utah-style mesa: very flat top, near-vertical cliff edge,
      // tall enough to read as an isolated landmark from kilometres away.
      const r = 850;
      if (dist > r) continue;
      const w = 1 - dist / r;
      let mesaShape: number;
      if (w > 0.55) mesaShape = 1.0;          // wider flat top
      else if (w > 0.40) {
        const t = (w - 0.40) / 0.15;          // narrow steep cliff face
        mesaShape = t * t * (3 - 2 * t);
      } else mesaShape = 0;
      return { delta: 110 * mesaShape, weight: mesaShape, isLake: false };
    }
    if (a.theme === 'valley') {
      const r = 1300;
      if (dist > r) continue;
      const w = 1 - dist / r;
      const ws = w * w * w * (w * (w * 6 - 15) + 10);
      const lateral = Math.abs(dx) / r;
      const ridgeRise = 50 * ws * lateral * lateral;
      const valleyDip = -4 * ws * (1 - lateral);
      return { delta: ridgeRise + valleyDip, weight: ws, isLake: false };
    }
  }
  return null;
}

const CORRIDOR_HARD_HALFW = 220;
const CORRIDOR_SOFT_HALFW = 700;
const CORRIDOR_HARD_LEN = 1600;
const CORRIDOR_SOFT_LEN = 3200;
const CORRIDOR_BASE_OFFSET = -3;
const CORRIDOR_SLOPE = 0.025;

function approachCeiling(x: number, z: number): number {
  let minCap = Infinity;
  for (const a of AIRPORTS) {
    const dx = x - a.cx;
    const dz = z - a.cz;
    const beyondZ = Math.abs(dz) - a.apronLength / 2;
    if (beyondZ <= 0 || beyondZ > CORRIDOR_SOFT_LEN) continue;
    const lateralAbs = Math.abs(dx);
    if (lateralAbs > CORRIDOR_SOFT_HALFW) continue;
    const slopeCap = a.elev + CORRIDOR_BASE_OFFSET + beyondZ * CORRIDOR_SLOPE;
    let lateralBlend: number;
    if (lateralAbs <= CORRIDOR_HARD_HALFW) lateralBlend = 1;
    else {
      const t = (CORRIDOR_SOFT_HALFW - lateralAbs) / (CORRIDOR_SOFT_HALFW - CORRIDOR_HARD_HALFW);
      lateralBlend = t * t * (3 - 2 * t);
    }
    let longBlend: number;
    if (beyondZ <= CORRIDOR_HARD_LEN) longBlend = 1;
    else {
      const t = (CORRIDOR_SOFT_LEN - beyondZ) / (CORRIDOR_SOFT_LEN - CORRIDOR_HARD_LEN);
      longBlend = t * t * (3 - 2 * t);
    }
    const blend = lateralBlend * longBlend;
    const blendedCap = slopeCap * blend + 5000 * (1 - blend);
    if (blendedCap < minCap) minCap = blendedCap;
  }
  return minCap;
}

const CITY_TARGET_ELEV = 41;
function cityFlattenDelta(x: number, z: number, naturalH: number): number {
  const dx = x - CITY_CENTER.x;
  const dz = z - CITY_CENTER.z;
  const dist = Math.hypot(dx, dz);
  if (dist > CITY_ESTATE_OUTER) return 0;
  const diff = CITY_TARGET_ELEV - naturalH;
  if (diff > 25) return 0;
  if (diff < -45) return 0;
  const w = 1 - dist / CITY_ESTATE_OUTER;
  const ws = w * w * w * (w * (w * 6 - 15) + 10);
  return diff * 0.7 * ws;
}

// === Ocean + archipelago (kept from v1 — tropical region east of city) ===
const OCEAN_CX = 7500;
const OCEAN_CZ = -1500;
const OCEAN_R = 4500;
interface IslandBump { cx: number; cz: number; r: number; height: number; }
const ARCHIPELAGO: IslandBump[] = [
  { cx: 7500, cz: -1500, r: 240, height: 56 },
  { cx: 7900, cz:  -700, r: 170, height: 32 },
  { cx: 7100, cz: -2400, r: 150, height: 26 },
  { cx: 8300, cz: -1900, r: 140, height: 22 },
  { cx: 6900, cz: -1000, r: 120, height: 18 },
  { cx: 7800, cz: -2700, r: 110, height: 16 },
];
function oceanArchipelagoDelta(x: number, z: number): number {
  const dx = x - OCEAN_CX;
  const dz = z - OCEAN_CZ;
  const dist = Math.hypot(dx, dz);
  if (dist > OCEAN_R) return 0;
  const w = 1 - dist / OCEAN_R;
  const oceanWeight = w * w * (3 - 2 * w);
  let delta = -48 * oceanWeight;
  for (const isl of ARCHIPELAGO) {
    const id = Math.hypot(x - isl.cx, z - isl.cz);
    if (id > isl.r) continue;
    const iw = 1 - id / isl.r;
    const iws = iw * iw * (3 - 2 * iw);
    delta += isl.height * iws;
  }
  return delta;
}
export function isInArchipelago(x: number, z: number): boolean {
  return Math.hypot(x - OCEAN_CX, z - OCEAN_CZ) < OCEAN_R;
}
export function islandBumpAt(x: number, z: number): number {
  let bump = 0;
  for (const isl of ARCHIPELAGO) {
    const id = Math.hypot(x - isl.cx, z - isl.cz);
    if (id > isl.r) continue;
    const iw = 1 - id / isl.r;
    const iws = iw * iw * (3 - 2 * iw);
    bump = Math.max(bump, isl.height * iws);
  }
  return bump;
}

function airportLandBias(x: number, z: number): number {
  let bias = 0;
  for (const a of AIRPORTS) {
    if (a.theme === 'lake') continue;
    // Coastal Field gets a tight land bias (1.2 km) so the ocean carve
    // dominates immediately east of the runway — the player sees real water
    // right off the threshold instead of being on a phantom inland island.
    const radius = a.name === 'Coastal Field' ? 1200 : 4000;
    const d = Math.hypot(x - a.cx, z - a.cz);
    if (d > radius) continue;
    const t = Math.max(0, 1 - d / radius);
    const b = t * t * (3 - 2 * t);
    if (b > bias) bias = b;
  }
  return bias;
}

// === Main height function ===
function noiseHeight(x: number, z: number): number {
  const { c } = climateAt(x, z);
  const eClimate = erosionNoise(x / 5000, z / 5000);
  const b = biomeAt(x, z);

  // Continentalness drives the base elevation curve. Below -0.2 → seafloor;
  // above 0.2 → solid inland; smooth transition through coastline.
  let base: number;
  if (c < -0.2) {
    base = SEA_LEVEL - 8 + (c + 0.2) * 30;       // deep ocean
  } else if (c < 0.0) {
    // Coastal shelf — climbs toward sea level.
    const t = (c + 0.2) / 0.2;
    base = (SEA_LEVEL - 8) + t * 12;             // -8 → +4 above sea
  } else {
    // Inland — gentle baseline that matches continentalness.
    base = SEA_LEVEL + 4 + c * 22;
  }

  // Per-biome elevation contribution.
  const biomeElev = biomeElevation(b, x, z, eClimate);
  let h = base + biomeElev;

  // River carving — only at modest elevations (no canyons through mountains).
  const riv1 = riverNoise(x / 1200, z / 1200);
  const riv2 = riverNoise(z / 1100, x / 1100);
  const riverMask = Math.max(1 - Math.abs(riv1), 1 - Math.abs(riv2));
  if (riverMask > 0.94 && h < 90 && h > SEA_LEVEL) {
    const t = Math.min(1, (riverMask - 0.94) / 0.04);
    const carve = (h - (SEA_LEVEL - 2)) * t;
    h -= carve;
  }

  // === The Great Canyon (signature SW→NE chasm) ===
  const canyonAx = -2500, canyonAz = -3000;
  const canyonBx = 1500, canyonBz = 3500;
  const cdx = canyonBx - canyonAx;
  const cdz = canyonBz - canyonAz;
  const lenSq = cdx * cdx + cdz * cdz;
  const tCanyon = Math.max(0, Math.min(1, ((x - canyonAx) * cdx + (z - canyonAz) * cdz) / lenSq));
  const projX = canyonAx + tCanyon * cdx;
  const projZ = canyonAz + tCanyon * cdz;
  const canyonD = Math.hypot(x - projX, z - projZ);
  if (canyonD < 200 && h > SEA_LEVEL + 5) {
    const cw = canyonD / 200;
    const cFactor = 1 - cw * cw;
    const carve = 75 * cFactor;
    h = Math.max(SEA_LEVEL + 1, h - carve);
  }

  // === Hand-placed signature landmarks ===
  h += landmarksDelta(x, z, h);

  // Airport + landing site theme shaping (lake bowl, mesa, valley).
  const shape = airportThemeShape(x, z);
  if (shape) h = h + shape.delta;
  h += landingSiteThemeDelta(x, z);

  // Tropical archipelago (east of city).
  h += oceanArchipelagoDelta(x, z);

  // City flatten (gentle pull toward target elev within city footprint).
  h += cityFlattenDelta(x, z, h);

  // Approach corridor cap.
  const cap = approachCeiling(x, z);
  if (cap < h) h = cap;

  return Math.max(1, Math.min(MAX_HEIGHT - 1, h));
}

export function groundNoiseHeight(x: number, z: number): number {
  return Math.floor(noiseHeight(x, z));
}

export function heightAt(x: number, z: number): number {
  const ap = airportSampleAt(x, z);
  const nh = noiseHeight(x, z);
  if (ap) {
    const blended = ap.flatElev * ap.weight + nh * (1 - ap.weight);
    return Math.floor(Math.max(SEA_LEVEL + 1, blended));
  }
  const ls = landingSiteSampleAt(x, z);
  if (ls) {
    const blended = ls.flatElev * ls.weight + nh * (1 - ls.weight);
    return Math.floor(Math.max(SEA_LEVEL + 1, blended));
  }
  return Math.floor(nh);
}

export function heightAtFast(x: number, z: number): number {
  return Math.floor(noiseHeight(x, z));
}

export function heightAtCoarse(x: number, z: number): number {
  // Cheap LOD variant for far-distance vertices — just continentalness +
  // ridge noise. Loses biome detail but the vertex is so far away you can't
  // see surface variation anyway.
  const cont = continentNoise(x / 800, z / 800);
  const r1 = ridgeNoise(x / 320, z / 320);
  const ridge = 1 - Math.abs(r1);
  const base = SEA_LEVEL + 22 + cont * 16;
  const mountains = ridge * ridge * 110 * Math.max(0, cont + 0.1);
  const h = base + mountains;
  return Math.max(1, Math.min(MAX_HEIGHT - 1, Math.floor(h)));
}

export function blockAt(x: number, y: number, z: number): BlockId {
  const h = heightAt(x, z);
  if (y > h) {
    return y <= SEA_LEVEL ? BLOCK.WATER : BLOCK.AIR;
  }
  if (y === h) {
    if (h <= SEA_LEVEL + 1) return BLOCK.SAND;
    if (h > 130) return BLOCK.SNOW;
    const b = biomeAt(x, z);
    if (b === 'desert') return BLOCK.SAND;
    if (b === 'tundra') return BLOCK.STONE;
    return BLOCK.GRASS;
  }
  if (y > h - 4) return BLOCK.DIRT;
  return BLOCK.STONE;
}
