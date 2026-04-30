// Deterministic city layout — a continuous density gradient from dense
// downtown grid out through suburbs into rural farmsteads. Roads first, then
// lots placed along them with distance-aware spacing, plus suburban
// commercial pockets and farmstead clusters in the rural ring.

import {
  CITY_DOWNTOWN_OUTER,
  CITY_MIDCITY_OUTER,
  CITY_SUBURB_OUTER,
  CITY_ESTATE_OUTER,
  CITY_RURAL_OUTER,
  cityRng,
  isCityObstructionFreeZone,
} from './city';

export type RoadKind = 'arterial' | 'street' | 'gravel';
export type RoadAxis = 'ns' | 'ew';

export interface RoadSeg {
  ax: number; az: number;
  bx: number; bz: number;
  kind: RoadKind;
  axis: RoadAxis;
}

export type LotZone = 'downtown' | 'midrise' | 'house' | 'estate' | 'rural';
export type LotCategoryHint =
  | 'downtown'
  | 'midrise'
  | 'house'
  | 'rural'
  | 'suburban_commercial';

export interface Lot {
  x: number; z: number;
  width: number; depth: number;       // bounding box hint for prototype fit
  rotY: number;
  zone: LotZone;
  // Which prototype CATEGORY to draw from. Most lots match their zone, but
  // suburban commercial pockets place 'suburban_commercial' on a 'house' lot.
  preferCategory: LotCategoryHint;
}

export interface ParkingLot {
  cx: number; cz: number;
  width: number; depth: number;
  rotY: number;
}

export interface CityGraph {
  segments: RoadSeg[];
  lots: Lot[];
  parkingLots: ParkingLot[];
}

// === Tuning constants ===
const DOWNTOWN_BLOCK = 80;
const MID_BLOCK = 130;
const SUBURB_BRANCH_LEN = 320;
// Distance from the road CENTERLINE to the lot CENTER's near edge (= setback
// + lotDepth/2 from road center). Must exceed the road's half-width (arterial
// 6m, street 4m) plus a sidewalk margin so building front faces clear the
// curb even when a max-size prototype fills its lot.
const ROAD_SETBACK_DOWNTOWN = 10;
const ROAD_SETBACK_HOUSE = 10;
const FARMSTEAD_GRID = 1000;       // 1 km between farmsteads in rural ring
const FARMSTEAD_OCCUPANCY = 0.45;  // 45% of grid cells host a farmstead
const COMMERCIAL_SPACING_M = 480;  // every ~480m of arterial in suburb depth → commercial pocket

// === Memoized graph ===
let _graphCache: CityGraph | null = null;
export function getCityGraph(): CityGraph {
  if (!_graphCache) _graphCache = buildCityGraph();
  return _graphCache;
}

// Build the entire road + lot graph. Deterministic — same world every load.
export function buildCityGraph(): CityGraph {
  const segments: RoadSeg[] = [];
  const lots: Lot[] = [];
  const parkingLots: ParkingLot[] = [];
  const rng = cityRng(2025);

  // === Downtown grid (80 m square blocks) ===
  const dt = CITY_DOWNTOWN_OUTER;
  for (let x = -dt; x <= dt; x += DOWNTOWN_BLOCK) {
    addLongitudinal(segments, x, -dt, dt, 'arterial');
  }
  for (let z = -dt; z <= dt; z += DOWNTOWN_BLOCK) {
    addLatitudinal(segments, z, -dt, dt, 'arterial');
  }

  // === Mid-city grid (130 m blocks, drawn as 'street') ===
  const md = CITY_MIDCITY_OUTER;
  for (let x = -md; x <= md; x += MID_BLOCK) {
    if (Math.abs(x) <= dt) continue;
    addLongitudinal(segments, x, -md, md, 'street');
  }
  for (let z = -md; z <= md; z += MID_BLOCK) {
    if (Math.abs(z) <= dt) continue;
    addLatitudinal(segments, z, -md, md, 'street');
  }

  // === Cardinal arterials extend out through suburb + estate rings ===
  // Plus a few sub-cardinals so the suburb has more than 4 connector roads.
  const es = CITY_ESTATE_OUTER;
  // Cardinal arterial extensions (4 of them) running from city edge to estate edge.
  addLongitudinal(segments, 0, -es, -md, 'arterial');
  addLongitudinal(segments, 0, md, es, 'arterial');
  addLatitudinal(segments, 0, -es, -md, 'arterial');
  addLatitudinal(segments, 0, md, es, 'arterial');
  // Sub-cardinals at ±400 m
  for (const off of [-400, 400]) {
    addLongitudinal(segments, off, -es, -md, 'street');
    addLongitudinal(segments, off, md, es, 'street');
    addLatitudinal(segments, off, -es, -md, 'street');
    addLatitudinal(segments, off, md, es, 'street');
  }

  // === Suburb branches: cul-de-sacs and curving residential streets ===
  // Branch off the cardinal arterials every ~220 m.
  generateSuburbBranches(segments, rng);

  // === Walk every segment, place lots with distance-aware density ===
  for (const seg of segments) {
    placeLotsAlongSegment(seg, lots, parkingLots, rng);
  }

  // === Rural farmsteads ===
  generateFarmsteads(segments, lots, rng);

  return { segments, lots, parkingLots };
}

// === Suburb branch generation ===
function generateSuburbBranches(segments: RoadSeg[], rng: () => number) {
  const md = CITY_MIDCITY_OUTER;
  const sb = CITY_SUBURB_OUTER;
  // North arterial (z > md, x = 0) — branches to the east/west.
  for (let z = md + 110; z < sb; z += 220) {
    const len = SUBURB_BRANCH_LEN * (0.7 + rng() * 0.6);
    const side = rng() < 0.5 ? -1 : 1;
    if (!isCityObstructionFreeZone(0, z) && !isCityObstructionFreeZone(side * len, z)) {
      segments.push({ ax: 0, az: z, bx: side * len, bz: z, kind: 'street', axis: 'ew' });
    }
  }
  // South arterial.
  for (let z = -md - 110; z > -sb; z -= 220) {
    const len = SUBURB_BRANCH_LEN * (0.7 + rng() * 0.6);
    const side = rng() < 0.5 ? -1 : 1;
    if (!isCityObstructionFreeZone(0, z) && !isCityObstructionFreeZone(side * len, z)) {
      segments.push({ ax: 0, az: z, bx: side * len, bz: z, kind: 'street', axis: 'ew' });
    }
  }
  // East arterial.
  for (let x = md + 110; x < sb; x += 220) {
    const len = SUBURB_BRANCH_LEN * (0.7 + rng() * 0.6);
    const side = rng() < 0.5 ? -1 : 1;
    if (!isCityObstructionFreeZone(x, 0) && !isCityObstructionFreeZone(x, side * len)) {
      segments.push({ ax: x, az: 0, bx: x, bz: side * len, kind: 'street', axis: 'ns' });
    }
  }
  // West arterial.
  for (let x = -md - 110; x > -sb; x -= 220) {
    const len = SUBURB_BRANCH_LEN * (0.7 + rng() * 0.6);
    const side = rng() < 0.5 ? -1 : 1;
    if (!isCityObstructionFreeZone(x, 0) && !isCityObstructionFreeZone(x, side * len)) {
      segments.push({ ax: x, az: 0, bx: x, bz: side * len, kind: 'street', axis: 'ns' });
    }
  }
}

// === Helpers ===

function addLongitudinal(
  segments: RoadSeg[], x: number, zStart: number, zEnd: number, kind: RoadKind,
) {
  let curStart: number | null = null;
  const STEP = 8;
  for (let z = zStart; z <= zEnd; z += STEP) {
    const allowed = !isCityObstructionFreeZone(x, z);
    if (allowed && curStart === null) curStart = z;
    if (!allowed && curStart !== null) {
      if (z - curStart >= 16) {
        segments.push({ ax: x, az: curStart, bx: x, bz: z, kind, axis: 'ns' });
      }
      curStart = null;
    }
  }
  if (curStart !== null && zEnd - curStart >= 16) {
    segments.push({ ax: x, az: curStart, bx: x, bz: zEnd, kind, axis: 'ns' });
  }
}

function addLatitudinal(
  segments: RoadSeg[], z: number, xStart: number, xEnd: number, kind: RoadKind,
) {
  let curStart: number | null = null;
  const STEP = 8;
  for (let x = xStart; x <= xEnd; x += STEP) {
    const allowed = !isCityObstructionFreeZone(x, z);
    if (allowed && curStart === null) curStart = x;
    if (!allowed && curStart !== null) {
      if (x - curStart >= 16) {
        segments.push({ ax: curStart, az: z, bx: x, bz: z, kind, axis: 'ew' });
      }
      curStart = null;
    }
  }
  if (curStart !== null && xEnd - curStart >= 16) {
    segments.push({ ax: curStart, az: z, bx: xEnd, bz: z, kind, axis: 'ew' });
  }
}

// Continuous density LERP — spacing in meters as a function of distance from
// origin. Smoothly transitions between zone bands.
function lotSpacingForDistance(d: number): number {
  if (d < CITY_DOWNTOWN_OUTER) return DOWNTOWN_BLOCK;       // 80 m
  if (d < CITY_MIDCITY_OUTER) return 50;                    // mid-city
  // Suburb gradient: 28 m (inner) → 65 m (estate edge)
  if (d < CITY_ESTATE_OUTER) {
    const t = (d - CITY_MIDCITY_OUTER) / (CITY_ESTATE_OUTER - CITY_MIDCITY_OUTER);
    return 28 + t * 37;
  }
  return 100;        // rural fallback
}

function emptyChanceForDistance(d: number): number {
  if (d < CITY_DOWNTOWN_OUTER) return 0.05;
  if (d < CITY_MIDCITY_OUTER) return 0.15;
  if (d < CITY_ESTATE_OUTER) {
    const t = (d - CITY_MIDCITY_OUTER) / (CITY_ESTATE_OUTER - CITY_MIDCITY_OUTER);
    return 0.25 + t * 0.30;
  }
  return 0.7;
}

// === Lot placement along a single road segment ===
function placeLotsAlongSegment(
  seg: RoadSeg,
  lots: Lot[],
  parkingLots: ParkingLot[],
  rng: () => number,
) {
  const dx = seg.bx - seg.ax;
  const dz = seg.bz - seg.az;
  const len = Math.hypot(dx, dz);
  if (len < 32) return;
  const ux = dx / len, uz = dz / len;
  const nx = -uz, nz = ux;

  // Sample distance at each step along the segment to determine zone + density.
  // We walk in steps and stop when we leave the buildable area.
  const startDist = Math.hypot((seg.ax + seg.bx) / 2, (seg.az + seg.bz) / 2);

  // Skip placement on rural / gravel segments — those connect farmsteads only.
  if (seg.kind === 'gravel') return;

  // Walk along the segment placing lots.
  let s = 0;
  let nextCommercialS = startDist > CITY_MIDCITY_OUTER ? COMMERCIAL_SPACING_M / 2 : Infinity;
  while (s < len) {
    const px = seg.ax + s * ux;
    const pz = seg.az + s * uz;
    const distFromOrigin = Math.hypot(px, pz);
    const spacing = lotSpacingForDistance(distFromOrigin);
    const emptyP = emptyChanceForDistance(distFromOrigin);

    // Determine zone.
    let zone: LotZone;
    if (distFromOrigin < CITY_DOWNTOWN_OUTER) zone = 'downtown';
    else if (distFromOrigin < CITY_MIDCITY_OUTER) zone = 'midrise';
    else if (distFromOrigin < CITY_SUBURB_OUTER) zone = 'house';
    else if (distFromOrigin < CITY_ESTATE_OUTER) zone = 'estate';
    else { s += spacing; continue; }

    s += spacing;

    // Right + left placements per slot — interleaved.
    for (const side of [-1, 1] as const) {
      // Suburban commercial pocket: every ~480m of arterial, on one side,
      // override residential with a commercial lot + parking.
      const isArterial = seg.kind === 'arterial';
      const inSuburbDepth = zone === 'house' || zone === 'estate';
      let isCommercial = false;
      if (isArterial && inSuburbDepth && side === 1 && s >= nextCommercialS) {
        isCommercial = true;
        nextCommercialS = s + COMMERCIAL_SPACING_M;
      }

      // Empty lot chance (yards, gaps).
      if (!isCommercial && rng() < emptyP) continue;

      // Lot dimensions vary by zone.
      let lotW: number, lotD: number, setback: number;
      if (zone === 'downtown') {
        lotW = 28; lotD = 30; setback = ROAD_SETBACK_DOWNTOWN;
      } else if (zone === 'midrise') {
        lotW = 22; lotD = 22; setback = ROAD_SETBACK_DOWNTOWN;
      } else if (zone === 'house') {
        lotW = 16; lotD = 18; setback = ROAD_SETBACK_HOUSE;
      } else {
        lotW = 24; lotD = 28; setback = ROAD_SETBACK_HOUSE;
      }
      // Commercial lots are bigger.
      if (isCommercial) {
        lotW = 30; lotD = 32; setback = 8;
      }

      const setbackTotal = setback + lotD / 2;
      const cx = px + side * setbackTotal * nx;
      const cz = pz + side * setbackTotal * nz;
      if (isCityObstructionFreeZone(cx, cz)) continue;

      const fx = -side * nx;
      const fz = -side * nz;
      const rotY = Math.atan2(fx, fz);

      const preferCategory: LotCategoryHint =
        isCommercial ? 'suburban_commercial'
        : zone === 'downtown' ? 'downtown'
        : zone === 'midrise' ? 'midrise'
        : 'house';

      lots.push({
        x: cx, z: cz,
        width: lotW, depth: lotD,
        rotY, zone, preferCategory,
      });

      // Parking lot for commercial — sits behind the building (further from
      // road than the building itself), oriented with the building.
      if (isCommercial) {
        // Parking is offset farther from the road than the building.
        const parkOffset = setbackTotal + lotD / 2 + 18;       // behind the building
        const pcx = px + side * parkOffset * nx;
        const pcz = pz + side * parkOffset * nz;
        parkingLots.push({
          cx: pcx, cz: pcz,
          width: 36, depth: 32,
          rotY,
        });
      }
    }
  }
}

// === Rural farmsteads ===
// Each farmstead is a cluster of 3-4 lots (farmhouse + barns) at one anchor.
// Connected to the nearest arterial via a short gravel road.
function generateFarmsteads(segments: RoadSeg[], lots: Lot[], rng: () => number) {
  for (let gx = -CITY_RURAL_OUTER; gx <= CITY_RURAL_OUTER; gx += FARMSTEAD_GRID) {
    for (let gz = -CITY_RURAL_OUTER; gz <= CITY_RURAL_OUTER; gz += FARMSTEAD_GRID) {
      const cx = gx + (rng() - 0.5) * (FARMSTEAD_GRID * 0.6);
      const cz = gz + (rng() - 0.5) * (FARMSTEAD_GRID * 0.6);
      const dist = Math.hypot(cx, cz);
      // Only in the rural ring (between city edge and rural outer).
      if (dist < CITY_ESTATE_OUTER + 200) continue;
      if (dist > CITY_RURAL_OUTER) continue;
      if (isCityObstructionFreeZone(cx, cz)) continue;
      if (rng() > FARMSTEAD_OCCUPANCY) continue;

      // Connect to nearest cardinal arterial via a gravel road segment.
      // Pick whichever cardinal axis is closer (x=0 or z=0).
      const connectGravel = rng() < 0.7;
      if (connectGravel) {
        if (Math.abs(cx) < Math.abs(cz)) {
          // Closer to x=0 axis — connect along z.
          segments.push({
            ax: cx, az: cz < 0 ? cz : cz,
            bx: 0, bz: cz < 0 ? cz : cz,
            kind: 'gravel', axis: 'ew',
          });
        } else {
          segments.push({
            ax: cx < 0 ? cx : cx, az: cz,
            bx: cx < 0 ? cx : cx, bz: 0,
            kind: 'gravel', axis: 'ns',
          });
        }
      }

      // Cluster: farmhouse + 1-3 barns. Random rotation per farmstead.
      const compoundRotY = Math.floor(rng() * 4) * (Math.PI / 2);
      // Farmhouse anchor
      lots.push({
        x: cx, z: cz,
        width: 30, depth: 30,
        rotY: compoundRotY,
        zone: 'rural',
        preferCategory: 'rural',
      });
      // 1-3 barns scattered nearby
      const barnCount = 1 + Math.floor(rng() * 3);
      const offsets: [number, number][] = [
        [40, 30], [-40, 35], [25, -45], [-30, -40], [50, -10], [-50, 20],
      ];
      for (let i = 0; i < barnCount && i < offsets.length; i++) {
        const [ox, oz] = offsets[i];
        const bx = cx + ox;
        const bz = cz + oz;
        if (isCityObstructionFreeZone(bx, bz)) continue;
        lots.push({
          x: bx, z: bz,
          width: 22, depth: 24,
          rotY: compoundRotY,
          zone: 'rural',
          preferCategory: 'rural',
        });
      }
    }
  }
}
