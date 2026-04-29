// City around Origin Field — zoning, building placement rules, and shared
// constants used by terrain flatten, building rendering, and tree-OFZ.

import { AIRPORTS } from './airport';
import { LANDING_SITES } from './landingSites';

// Origin Field is the city center.
export const CITY_CENTER = { x: 0, z: 0 };

// Concentric ring radii (m). The city fades smoothly from dense downtown
// out through inner suburbs to outer estates and finally rural farmsteads.
export const CITY_DOWNTOWN_INNER = 320;     // inner OFZ around airport buildings
export const CITY_DOWNTOWN_OUTER = 800;
export const CITY_MIDCITY_OUTER = 1600;
export const CITY_SUBURB_INNER = 1600;      // = midcity outer (alias for clarity)
export const CITY_SUBURB_OUTER = 2800;      // dense suburbs end here
export const CITY_ESTATE_OUTER = 4000;      // big-lot exurb / large houses end here
export const CITY_RURAL_OUTER = 6000;       // rural farmsteads up to here
// Anywhere within this radius of any landing site is "rural" — no city
// buildings, no powerlines, no roads. Bush strips read as remote.
export const LANDING_SITE_RURAL_BUFFER = 1500;

export type CityZone = 'ofz' | 'downtown' | 'midcity' | 'suburb' | 'estate' | 'rural' | 'outside';

// Zone for a given world XZ position (relative to CITY_CENTER).
export function cityZoneAt(x: number, z: number): CityZone {
  const d = Math.hypot(x - CITY_CENTER.x, z - CITY_CENTER.z);
  if (d < CITY_DOWNTOWN_INNER) return 'ofz';
  if (d < CITY_DOWNTOWN_OUTER) return 'downtown';
  if (d < CITY_MIDCITY_OUTER) return 'midcity';
  if (d < CITY_SUBURB_OUTER) return 'suburb';
  if (d < CITY_ESTATE_OUTER) return 'estate';
  if (d < CITY_RURAL_OUTER) return 'rural';
  return 'outside';
}

// Quick boolean: is this position inside the city footprint at all (including
// rural ring — used to suppress trees so farms/buildings aren't choked).
export function isInCity(x: number, z: number): boolean {
  const z2 = cityZoneAt(x, z);
  return z2 !== 'outside';
}

// Tighter check for the "real" urban footprint (downtown + suburbs). Used
// where we don't want rural barns to count as "city".
export function isInUrbanArea(x: number, z: number): boolean {
  const z2 = cityZoneAt(x, z);
  return z2 === 'downtown' || z2 === 'midcity' || z2 === 'suburb' || z2 === 'estate';
}

// Approach corridor of Origin Field — buildings, antennas, powerlines must
// stay clear so terrain + obstructions don't block the glideslope.
// Lazy lookup of the Origin airport to avoid top-level access during the
// circular import (airport.ts imports from this module too).
const APPROACH_HALF_WIDTH = 320;     // m — wider than the terrain corridor for visual margin
const APPROACH_LENGTH = 3200;        // past each runway end
function origin() {
  return AIRPORTS[0];
}
export function isInApproachCorridor(x: number, z: number): boolean {
  const o = origin();
  const halfApronZ = o.apronLength / 2;
  const beyondZ = Math.abs(z - o.cz) - halfApronZ;
  if (beyondZ <= 0 || beyondZ > APPROACH_LENGTH) return false;
  return Math.abs(x - o.cx) < APPROACH_HALF_WIDTH;
}

// True if buildings/obstacles should be excluded here. Composite of inner OFZ,
// every airport's apron + buffer + approach corridor, every landing site's
// 1.5 km rural buffer, and the inner downtown ring around Origin.
const APT_BUFFER = 100;            // m of clearance around any airport apron
const APT_APPROACH_HALFW = 280;    // approach corridor lateral half-width
const APT_APPROACH_LEN = 2200;     // approach corridor length past apron edge
export function isCityObstructionFreeZone(x: number, z: number): boolean {
  // Every AIRPORT's apron + buffer + approach corridor (both runway ends).
  for (const a of AIRPORTS) {
    const dx = Math.abs(x - a.cx);
    const dz = Math.abs(z - a.cz);
    if (dx < a.apronWidth / 2 + APT_BUFFER && dz < a.apronLength / 2 + APT_BUFFER) return true;
    // Approach corridor: narrow band along runway axis past either end.
    const beyondZ = dz - a.apronLength / 2;
    if (beyondZ > 0 && beyondZ < APT_APPROACH_LEN && dx < APT_APPROACH_HALFW) return true;
  }
  // Landing sites get a wide rural buffer — bush strips feel remote without
  // suburbs creeping up to the runway end.
  for (const s of LANDING_SITES) {
    if (Math.hypot(x - s.cx, z - s.cz) < LANDING_SITE_RURAL_BUFFER) return true;
  }
  // Inner downtown ring around Origin reserved for terminal / hangars.
  if (Math.hypot(x - CITY_CENTER.x, z - CITY_CENTER.z) < CITY_DOWNTOWN_INNER) return true;
  return false;
}

// Deterministic RNG (mulberry32) for procedural city placement so the city
// shape is stable across reloads.
export function cityRng(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
