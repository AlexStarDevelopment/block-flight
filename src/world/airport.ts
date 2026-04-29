import { BLOCK, VOXEL_SIZE, type BlockId } from './voxel';
import { isLandingSiteOFZ } from './landingSites';
import { POIS } from './pois';
import { isInCity } from './city';

// Snap a height value to the voxel grid such that elev + 1 = voxel top.
// With 2 m blocks, voxel top is even, so elev must be odd.
function alignToVoxelTopMinusOne(h: number): number {
  return Math.floor(h / VOXEL_SIZE) * VOXEL_SIZE + (VOXEL_SIZE - 1);
}

// Snap each airport's elevation to the local noise ground so it doesn't sit
// in a pit when surrounding terrain is mountainous. MUST produce the same
// answer in main and worker — so we sample in a deterministic order with a
// fixed grid and take the median.
let elevSnapped = false;
export function snapAirportElevations(groundFn: (x: number, z: number) => number) {
  if (elevSnapped) return;
  elevSnapped = true;
  for (const a of AIRPORTS) {
    const samples: number[] = [];
    // Use INTEGER step and INTEGER bounds to avoid float-precision differences.
    const halfX = Math.floor(a.apronWidth / 2);
    const halfZ = Math.floor(a.apronLength / 2);
    const step = 8;
    for (let dx = -halfX; dx <= halfX; dx += step) {
      for (let dz = -halfZ; dz <= halfZ; dz += step) {
        samples.push(groundFn(a.cx + dx, a.cz + dz));
      }
    }
    samples.sort((p, q) => p - q);
    const median = samples[samples.length >> 1];
    a.elev = alignToVoxelTopMinusOne(Math.max(36, median));
  }
}

// Runway oriented along world Z axis (heading 0 / 360 = north).
// All sizes in blocks (= meters).
export type AirportTheme = 'flat' | 'lake' | 'plateau' | 'valley';

// Difficulty tier — affects mission payout multiplier, GPS grouping, and
// landing aids (windsocks, runway markings) on landing sites.
export type Difficulty = 'easy' | 'medium' | 'hard' | 'impossible';

export const DIFFICULTY_PAYOUT_MUL: Record<Difficulty, number> = {
  easy: 1.0,
  medium: 1.4,
  hard: 2.0,
  impossible: 3.0,
};

export interface Airport {
  name: string;
  cx: number;
  cz: number;
  elev: number;        // top-of-surface block Y
  apronWidth: number;  // X extent of flat area (runway + grass shoulders)
  apronLength: number; // Z extent of flat area
  runwayWidth: number;
  runwayLength: number;
  falloff: number;     // outside the apron, blend over this many blocks
  theme: AirportTheme; // shapes the surrounding terrain
  difficulty: Difficulty;
}

// Airports placed thoughtfully in their themed biome regions.
//   Origin Field — center, plains/forest, the city hub.
//   Birch Lake   — NE wet region (cool taiga / lakes country).
//   Stone Plateau — SW badlands (red mesa country).
//   Valley Grass — SE savanna in a long valley.
//   Alpine Strip — NW alpine high mountains.
//   Coastal Field — south coast with beach + open ocean to the south.
export const AIRPORTS: Airport[] = [
  {
    // City airport — long paved runway, surrounded by procedurally placed
    // buildings + roads + powerlines. See src/world/city.ts for the city.
    name: 'Origin Field',
    cx: 0,
    cz: 0,
    elev: 40,
    apronWidth: 90,
    apronLength: 2000,
    runwayWidth: 50,
    runwayLength: 1900,
    falloff: 160,
    theme: 'flat',
    difficulty: 'easy',
  },
  {
    // North-east lake country (cool, wet biome).
    name: 'Birch Lake',
    cx: 1800,
    cz: 1800,
    elev: 36,
    apronWidth: 60,
    apronLength: 860,
    runwayWidth: 32,
    runwayLength: 800,
    falloff: 100,
    theme: 'lake',
    difficulty: 'easy',
  },
  {
    // South-west badlands — Utah-mesa country with red rock + arches nearby.
    name: 'Stone Plateau',
    cx: -2400,
    cz: -1800,
    elev: 110,
    apronWidth: 50,
    apronLength: 860,
    runwayWidth: 28,
    runwayLength: 800,
    falloff: 120,
    theme: 'plateau',
    difficulty: 'hard',
  },
  {
    // South-east savanna — long flat valley between rolling hills.
    name: 'Valley Grass',
    cx: 1500,
    cz: -1800,
    elev: 50,
    apronWidth: 50,
    apronLength: 1060,
    runwayWidth: 28,
    runwayLength: 1000,
    falloff: 140,
    theme: 'valley',
    difficulty: 'easy',
  },
  {
    // North-west alpine — high pass between mountain ridges. Valley theme
    // gives ridges to E/W; the climate model + biome override (terrain.ts)
    // forces mountain biome around it so the ridges read as proper alpine.
    name: 'Alpine Strip',
    cx: -3000,
    cz: 1800,
    elev: 180,
    apronWidth: 50,
    apronLength: 660,
    runwayWidth: 28,
    runwayLength: 600,
    falloff: 140,
    theme: 'valley',
    difficulty: 'hard',
  },
  {
    // East coast field — runway sits a few hundred metres west of the open
    // ocean. From here you fly east over water to reach the volcano.
    name: 'Coastal Field',
    cx: 4500,
    cz: -2000,
    elev: 33,
    apronWidth: 60,
    apronLength: 760,
    runwayWidth: 32,
    runwayLength: 700,
    falloff: 110,
    theme: 'flat',
    difficulty: 'easy',
  },
];

// Returns flat-target elevation if (x, z) is within the airport's smoothed influence.
// Inside the apron rectangle the flat elevation is exact; in the falloff ring it's
// returned with a 0..1 weight so the caller can blend with noise.
export interface AirportSample {
  airport: Airport;
  flatElev: number;
  weight: number;          // 1 = fully flat, 0 = unaffected
  surface: BlockId | null; // ASPHALT on runway, GRASS on apron, null in falloff
  isCenterStripe: boolean; // for paint markings
}

// Asymmetric east extension: the cargo zone sits ~14m past the visual apron
// edge. Without this, voxel terrain at the cargo zone is in the falloff ring
// and noise pulls it 1–3m below the apron, so the plane drops while the
// yellow marker hovers above.
const CARGO_FLAT_EXT = 30;     // m of fully-flat terrain past the apron east edge

// Real airports clear obstructions well past the apron — a wide circle around
// the field plus a long approach corridor at each runway end. Returns true
// for positions that should never have trees, towers, or other tall blocks.
// Also covers off-airport landing sites (smaller OFZ).
export function isObstructionFreeZone(x: number, z: number): boolean {
  for (const a of AIRPORTS) {
    const dx = x - a.cx;
    const dz = z - a.cz;
    const halfApronX = a.apronWidth / 2;
    const halfApronZ = a.apronLength / 2;

    // Radial OFZ: 300m past the apron rectangle in any direction.
    const ox = Math.max(0, Math.abs(dx) - halfApronX);
    const oz = Math.max(0, Math.abs(dz) - halfApronZ);
    if (Math.hypot(ox, oz) < 300) return true;

    // Approach corridor: narrow band along the runway axis past either end —
    // matches the terrain glide-slope clearance carved by approachCeiling.
    const beyondZ = Math.abs(dz) - halfApronZ;
    if (beyondZ > 0 && beyondZ < 1800 && Math.abs(dx) < 280) return true;
  }
  // Landing-site OFZ — smaller scale, no approach corridor.
  if (isLandingSiteOFZ(x, z)) return true;
  // POI clearance — small circle around each so trees don't sprout on cabins.
  for (const p of POIS) {
    const dx = x - p.cx;
    const dz = z - p.cz;
    if (dx * dx + dz * dz < 8 * 8) return true;
  }
  // Whole city footprint — buildings + roads, no trees.
  if (isInCity(x, z)) return true;
  return false;
}

export function airportSampleAt(x: number, z: number): AirportSample | null {
  for (const a of AIRPORTS) {
    const dx = x - a.cx;
    const dz = z - a.cz;
    const halfApronX = a.apronWidth / 2;
    const halfApronZ = a.apronLength / 2;
    const halfRwyX = a.runwayWidth / 2;
    const halfRwyZ = a.runwayLength / 2;

    const insideApron = Math.abs(dx) <= halfApronX && Math.abs(dz) <= halfApronZ;
    if (insideApron) {
      const onRunway = Math.abs(dx) <= halfRwyX && Math.abs(dz) <= halfRwyZ;
      let surface: BlockId = onRunway ? BLOCK.ASPHALT : BLOCK.APRON_DIRT;
      if (onRunway) {
        if (Math.abs(dx) < 1) surface = BLOCK.RUNWAY_LINE;
        if (Math.abs(Math.abs(dz) - halfRwyZ) <= 1.5) surface = BLOCK.RUNWAY_LINE;
      }
      return { airport: a, flatElev: a.elev, weight: 1, surface, isCenterStripe: false };
    }

    // East cargo-zone flat extension (no special surface — keeps grass color).
    const eastEdge = halfApronX + CARGO_FLAT_EXT;
    const insideCargoFlat = dx > halfApronX && dx <= eastEdge && Math.abs(dz) <= halfApronZ;
    if (insideCargoFlat) {
      return { airport: a, flatElev: a.elev, weight: 1, surface: null, isCenterStripe: false };
    }

    // Falloff ring — measure from the asymmetric edge (extended on the east side).
    const xEdge = dx > 0 ? eastEdge : halfApronX;
    const ox = Math.max(0, Math.abs(dx) - xEdge);
    const oz = Math.max(0, Math.abs(dz) - halfApronZ);
    const dist = Math.hypot(ox, oz);
    if (dist > 0 && dist < a.falloff) {
      const w = 1 - dist / a.falloff;
      // smoothstep
      const ws = w * w * (3 - 2 * w);
      return { airport: a, flatElev: a.elev, weight: ws, surface: null, isCenterStripe: false };
    }
  }
  return null;
}
