// Off-airport bush strips: small flat patches scattered around the world.
// Player can land + drop cargo at these. Each site has a small flat zone
// (no apron mesh, no runway markings — just the natural surface) plus a
// pickup/delivery zone alongside.
//
// Conventions match Airport: cx/cz center, elev = top voxel y. snapElevations
// runs at startup so the strip is on the local ground.

export type LandingSurface = 'gravel' | 'sand' | 'grass' | 'snow';
// Terrain theme shapes the surrounding land to match the strip's character.
// 'flat' = no shaping. 'water' = surrounded by water (bay/cove/lake/pond).
// 'mesa' = sits on a steep-sided elevated plateau. 'ridge' = elevated linear
// spine. 'valley' = strip in a valley between ridges. 'frozen' = snowy mesa.
export type LandingTheme = 'flat' | 'water' | 'mesa' | 'ridge' | 'valley' | 'frozen';

// Re-exported from airport.ts so callers can talk about difficulty without
// pulling that whole module.
import type { Difficulty } from './airport';
export type { Difficulty } from './airport';

export interface LandingSite {
  name: string;
  cx: number;
  cz: number;
  elev: number;          // snapped at startup from local noise ground
  surface: LandingSurface;
  length: number;        // available landing length (m)
  width: number;         // strip width (m, ~6-12)
  heading: number;       // strip orientation in degrees (0 = N-S, 90 = E-W)
  theme: LandingTheme;   // terrain shape around the strip
  difficulty: Difficulty;
  // True for water-only seaplane bases. No flat sand island; cargo zone sits
  // on a floating dock. Only float-equipped planes can do missions here.
  isSeaplaneBase?: boolean;
}

// 14 hand-placed sites distributed across the world for variety. Strips snap
// elevation to local terrain at startup so they sit on the ground regardless
// of where procgen put the surrounding noise.
//
// DIFFICULTY:
//   medium     — long strip + windsock + cairns; "easy off-airport".
//   hard       — shorter strip, no windsock; you're on your own.
//   impossible — short approach + bad braking (snow / river bar). Big payouts.
export const LANDING_SITES: LandingSite[] = [
  { name: 'Hidden Cove',   cx:  900,  cz: -1300, elev: 35, surface: 'sand',   length: 175, width: 14, heading: 0, theme: 'water',  difficulty: 'medium'     },
  { name: 'Pine Ridge',    cx: -2200, cz:  -200, elev: 80, surface: 'gravel', length: 150, width: 12, heading: 0, theme: 'ridge',  difficulty: 'medium'     },
  { name: 'Marsh Strip',   cx:  2400, cz:   200, elev: 36, surface: 'grass',  length: 180, width: 14, heading: 0, theme: 'water',  difficulty: 'medium'     },
  { name: 'Glacier Pad',   cx:  -200, cz:  3400, elev: 130, surface: 'snow',  length:  90, width: 12, heading: 0, theme: 'frozen', difficulty: 'impossible' },
  { name: 'Riverbar',      cx:  1900, cz: -2600, elev: 36, surface: 'sand',   length: 110, width: 14, heading: 0, theme: 'water',  difficulty: 'impossible' },
  { name: 'Ranger Cabin',  cx: -2400, cz:  1600, elev: 95, surface: 'grass',  length: 125, width: 12, heading: 0, theme: 'flat',   difficulty: 'hard'       },
  { name: 'Cedar Bluff',   cx:  3200, cz:  2800, elev: 80, surface: 'gravel', length: 150, width: 12, heading: 0, theme: 'mesa',   difficulty: 'medium'     },
  { name: 'Sandy Point',   cx:  -800, cz: -1700, elev: 34, surface: 'sand',   length: 180, width: 14, heading: 0, theme: 'water',  difficulty: 'medium'     },
  { name: 'Wolf Meadow',   cx:  -100, cz:  1800, elev: 60, surface: 'grass',  length: 175, width: 13, heading: 0, theme: 'valley', difficulty: 'medium'     },
  // Frozen lake — small strip on an ice-rimmed island. Lives in the cold NW
  // where the climate is sub-zero, so the surrounding water paints as ice.
  { name: 'Frostlake',     cx: -3000, cz:  2500, elev: 35, surface: 'snow',   length:  90, width: 12, heading: 0, theme: 'water',  difficulty: 'impossible' },
  { name: 'Mesa North',    cx:  3500, cz: -1400, elev: 95, surface: 'gravel', length: 120, width: 12, heading: 0, theme: 'mesa',   difficulty: 'hard'       },
  { name: 'Mesa South',    cx:  3300, cz: -3800, elev: 100, surface: 'gravel', length: 130, width: 13, heading: 0, theme: 'mesa',  difficulty: 'hard'       },
  { name: 'Kettle Pond',   cx: -3400, cz:   400, elev: 50, surface: 'grass',  length: 165, width: 13, heading: 0, theme: 'water',  difficulty: 'medium'     },
  { name: 'Ice Fields',    cx:  1400, cz:  3700, elev: 110, surface: 'snow',  length:  90, width: 12, heading: 0, theme: 'frozen', difficulty: 'impossible' },
  // Atoll: middle of the eastern archipelago. Sandy strip on the main island
  // surrounded by ocean — over-water approach with no diversion options.
  { name: 'Atoll',         cx:  7500, cz: -1500, elev: 36, surface: 'sand',   length: 130, width: 14, heading: 0, theme: 'flat',   difficulty: 'hard'       },
  // === Sea plane bases — water-only, dock-based. Require floats. ===
  // Eagle Cove — NE forest coast lake.
  { name: 'Eagle Cove',    cx:  2200, cz:  2400, elev: 28, surface: 'sand',   length: 200, width: 20, heading: 0, theme: 'water',  difficulty: 'medium',     isSeaplaneBase: true },
  // Tropic Bay — open water in the eastern archipelago, between islands.
  { name: 'Tropic Bay',    cx:  6800, cz:  -200, elev: 28, surface: 'sand',   length: 220, width: 20, heading: 0, theme: 'water',  difficulty: 'medium',     isSeaplaneBase: true },
  // Marina Point — west coastal marina. Sits ~100 m off the natural mainland
  // shoreline so the dock + pier physically attach to land.
  { name: 'Marina Point',  cx: -3150, cz:  -800, elev: 28, surface: 'sand',   length: 200, width: 20, heading: 0, theme: 'water',  difficulty: 'hard',       isSeaplaneBase: true },
];


// Theme delta function — mirrors airportThemeShape but for landing sites.
// Returns a height delta to add to natural terrain. The strip's own flat
// patch (handled by landingSiteSampleAt) sits on top of this shaped terrain.
export function landingSiteThemeDelta(x: number, z: number): number {
  let total = 0;
  for (const s of LANDING_SITES) {
    if (s.theme === 'flat') continue;
    const dx = x - s.cx;
    const dz = z - s.cz;

    // Riverbar gets its OWN influence range (long N-S river channel),
    // not the global 700 m circle. Run before the radial cap so the river
    // can extend far up and downstream.
    if (s.theme === 'water' && s.name === 'Riverbar') {
      const channelHalfWidthX = 120;       // 240 m wide river
      const channelLongZ = 1000;           // ±1 km up/downstream
      if (Math.abs(dx) > channelHalfWidthX) continue;
      if (Math.abs(dz) > channelLongZ) continue;
      const tLat = 1 - Math.abs(dx) / channelHalfWidthX;
      const wLat = tLat * tLat * (3 - 2 * tLat);
      const tLong = 1 - Math.abs(dz) / channelLongZ;
      const wLong = tLong * tLong * (3 - 2 * tLong);
      total += -36 * wLat * wLong;
      continue;
    }

    // Seaplane bases need a deep, guaranteed water bowl regardless of the
    // surrounding biome (forest hills can sit 60+ m above sea level). Carve
    // hard so the area always falls below SEA_LEVEL=28 and water fills in.
    if (s.isSeaplaneBase) {
      const dist0 = Math.hypot(dx, dz);
      // Marina Point uses a tight carve so the natural eastern shoreline
      // (~100 m east of center) stays intact for the dock/pier to attach to.
      if (s.name === 'Marina Point') {
        const r = 180;
        if (dist0 > r) continue;
        const w0 = 1 - dist0 / r;
        const ws0 = w0 * w0 * w0 * (w0 * (w0 * 6 - 15) + 10);
        total += -50 * ws0;
        continue;
      }
      const r = 600;
      if (dist0 > r) continue;
      const w0 = 1 - dist0 / r;
      const ws0 = w0 * w0 * w0 * (w0 * (w0 * 6 - 15) + 10);
      total += -120 * ws0;
      continue;
    }

    const dist = Math.hypot(dx, dz);
    const r = 700;                            // theme influence radius
    if (dist > r) continue;
    const w = 1 - dist / r;
    const ws = w * w * w * (w * (w * 6 - 15) + 10);    // quintic smoothstep

    if (s.theme === 'water') {
      // Bowl carved DOWN around the strip — natural noise + bowl ends up
      // below sea level so water fills in. Strip itself stays above (its
      // own flat patch overrides the carving in the immediate area).
      if (s.name === 'Hidden Cove') {
        // A real cove: half-disc of water on the SE, sheltering land arm
        // wrapping the NW. We use a sharp half-plane cutoff so the cove
        // shape reads clearly from the air.
        const openX = 0.7071, openZ = -0.7071;     // SE unit vector
        const projection = dx * openX + dz * openZ;
        if (projection < -40) continue;            // sheltered side: no carve
        const r2 = 600;
        if (dist > r2) continue;
        const wRadial = 1 - dist / r2;
        const wsRadial = wRadial * wRadial * (3 - 2 * wRadial);
        // Side ramp: 0 at midline, 1 at full open.
        let sideMul = projection > 0
          ? Math.min(1, projection / (dist * 0.7))   // ramps up to ~1 within 30°
          : Math.max(0, (projection + 40) / 40);     // soft fade across midline
        sideMul = sideMul * sideMul * (3 - 2 * sideMul);
        total += -42 * wsRadial * sideMul;
        continue;
      }
      total += -22 * ws;
    } else if (s.theme === 'mesa') {
      // Dramatic isolated Utah-style mesa — flat top, steep cliff edges, tall
      // enough to read as a landmark from kilometres out. Sharper and taller
      // than the previous gradual smoothstep lift.
      const mesaR = 520;
      if (dist > mesaR) continue;
      const wM = 1 - dist / mesaR;
      let mesaShape: number;
      if (wM > 0.55) mesaShape = 1.0;          // wider flat top
      else if (wM > 0.38) {
        const t = (wM - 0.38) / 0.17;          // narrow cliff face
        mesaShape = t * t * (3 - 2 * t);
      } else mesaShape = 0;
      total += 95 * mesaShape;
    } else if (s.theme === 'ridge') {
      // Anisotropic lift along the strip axis (heading 0 = N-S, so X is
      // perpendicular). Higher in centerline, falls off laterally fast.
      const lateral = Math.abs(dx) / r;
      const lateralFactor = Math.max(0, 1 - lateral * 2);
      total += 38 * ws * lateralFactor;
    } else if (s.theme === 'valley') {
      // Strip in a valley: lateral ridges, gentle dip near center.
      const lateral = Math.abs(dx) / r;
      const ridgeRise = 28 * ws * lateral * lateral;
      const dip = -4 * ws * (1 - lateral);
      total += ridgeRise + dip;
    } else if (s.theme === 'frozen') {
      // Snowy elevated plateau — lift to the snow line so it gets snow surface.
      total += 65 * ws;
    }
  }
  return total;
}

// Snap each site's elev to the local noise ground. Same trick as airports.
let elevSnapped = false;
export function snapLandingSiteElevations(groundFn: (x: number, z: number) => number) {
  if (elevSnapped) return;
  elevSnapped = true;
  for (const s of LANDING_SITES) {
    const samples: number[] = [];
    const halfL = Math.floor(s.length / 2);
    const halfW = Math.floor(s.width / 2);
    for (let dx = -halfW; dx <= halfW; dx += 4) {
      for (let dz = -halfL; dz <= halfL; dz += 8) {
        samples.push(groundFn(s.cx + dx, s.cz + dz));
      }
    }
    samples.sort((a, b) => a - b);
    const median = samples[samples.length >> 1];
    const minElev = s.surface === 'sand' ? 33 : 35;
    const VOX = 2;
    const raw = Math.max(minElev, median);
    s.elev = Math.floor(raw / VOX) * VOX + (VOX - 1);   // align so elev+1 = voxel top
  }
}

export interface LandingSiteSample {
  site: LandingSite;
  flatElev: number;
  weight: number;        // 1 = inside flat strip, smoothstep down through falloff
}

const STRIP_FALLOFF_DEFAULT = 90;     // wider so strips on coast read as visible islands
const STRIP_FALLOFF_NARROW = 14;      // for sites that want water tight to the runway

// Sites that want water IMMEDIATELY next to the runway (river bars, beaches).
// Use a tight falloff so the flat patch is barely wider than the strip itself.
export const TIGHT_WATER_SITES = new Set(['Riverbar']);

export function landingSiteSampleAt(x: number, z: number): LandingSiteSample | null {
  for (const s of LANDING_SITES) {
    // Seaplane bases have no flat island — they're open water. Skip the
    // strip/falloff overlay so the water-theme bowl fills naturally.
    if (s.isSeaplaneBase) continue;
    const dx = x - s.cx;
    const dz = z - s.cz;
    const halfW = s.width / 2;
    const halfL = s.length / 2;
    if (Math.abs(dx) <= halfW && Math.abs(dz) <= halfL) {
      return { site: s, flatElev: s.elev, weight: 1 };
    }
    const falloff = TIGHT_WATER_SITES.has(s.name) ? STRIP_FALLOFF_NARROW : STRIP_FALLOFF_DEFAULT;
    const ox = Math.max(0, Math.abs(dx) - halfW);
    const oz = Math.max(0, Math.abs(dz) - halfL);
    const dist = Math.hypot(ox, oz);
    if (dist > 0 && dist < falloff) {
      const w = 1 - dist / falloff;
      const ws = w * w * (3 - 2 * w);
      return { site: s, flatElev: s.elev, weight: ws };
    }
  }
  return null;
}

// Small obstruction-free zone around each strip — no trees within ~80m.
export function isLandingSiteOFZ(x: number, z: number): boolean {
  for (const s of LANDING_SITES) {
    const dx = x - s.cx;
    const dz = z - s.cz;
    const ox = Math.max(0, Math.abs(dx) - s.width / 2);
    const oz = Math.max(0, Math.abs(dz) - s.length / 2);
    if (Math.hypot(ox, oz) < 80) return true;
  }
  return false;
}

// True if the position sits on a snow/ice surface (icy landing site or
// natural snow biome). Used by plane gear physics to reduce friction.
export function isIcySurfaceAt(x: number, z: number): boolean {
  for (const s of LANDING_SITES) {
    if (s.surface !== 'snow') continue;
    const dx = x - s.cx;
    const dz = z - s.cz;
    if (Math.abs(dx) <= s.width / 2 + 30 && Math.abs(dz) <= s.length / 2 + 30) {
      return true;
    }
  }
  return false;
}
