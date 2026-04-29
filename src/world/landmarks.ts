// Hand-placed signature landmarks. Each is a height-delta function applied
// in noiseHeight after biome shaping but before airport themes — so the
// landmarks rise above the surrounding terrain like real geological features.
//
// Functions return delta in meters to add to terrain height. A landmark may
// also expose a "block override" (e.g., volcano paints VOLCANIC_ROCK on its
// flanks) — see chunkData for surface painting.

import { BLOCK, type BlockId } from './voxel';

export interface LandmarkSurface {
  block: BlockId;
}

// === The Spire — single 280m peak, NW remote ===
const SPIRE = { cx: -4500, cz: 3500, peakH: 280, baseR: 380 };

function spireDelta(x: number, z: number): number {
  const d = Math.hypot(x - SPIRE.cx, z - SPIRE.cz);
  if (d > SPIRE.baseR) return 0;
  const w = 1 - d / SPIRE.baseR;
  // Sharp pinnacle: pow shape so the lift concentrates at center.
  const ws = Math.pow(w, 2.3);
  return SPIRE.peakH * ws;
}

// === Two Sisters — twin peaks, W mountain border ===
const TWO_SISTERS = [
  { cx: -3500, cz:  300, peakH: 220, baseR: 340 },
  { cx: -3500, cz: -300, peakH: 200, baseR: 320 },
];

function twoSistersDelta(x: number, z: number): number {
  let total = 0;
  for (const p of TWO_SISTERS) {
    const d = Math.hypot(x - p.cx, z - p.cz);
    if (d > p.baseR) continue;
    const w = 1 - d / p.baseR;
    total += p.peakH * Math.pow(w, 2.0);
  }
  return total;
}

// === Second canyon — perpendicular-ish to existing canyon ===
// Existing runs SW→NE from (-2500,-3000) to (1500,3500).
// Second runs roughly W→E from (-3200, -1200) to (4000, -800).
const CANYON_2 = {
  ax: -3200, az: -1200,
  bx:  4000, bz:  -800,
  width: 180,
  depth: 65,
};

function secondCanyonDelta(x: number, z: number, naturalH: number): number {
  const ax = CANYON_2.ax, az = CANYON_2.az;
  const bx = CANYON_2.bx, bz = CANYON_2.bz;
  const cdx = bx - ax, cdz = bz - az;
  const lenSq = cdx * cdx + cdz * cdz;
  const t = Math.max(0, Math.min(1, ((x - ax) * cdx + (z - az) * cdz) / lenSq));
  const px = ax + t * cdx;
  const pz = az + t * cdz;
  const d = Math.hypot(x - px, z - pz);
  if (d > CANYON_2.width || naturalH < 32) return 0;
  const cw = d / CANYON_2.width;
  const cFactor = 1 - cw * cw;
  return -CANYON_2.depth * cFactor;
}

// === Crater Lake — round filled-volcano lake ===
const CRATER_LAKE = { cx: 3500, cz: 2500, r: 360, depth: 18 };

function craterLakeDelta(x: number, z: number, naturalH: number): number {
  const d = Math.hypot(x - CRATER_LAKE.cx, z - CRATER_LAKE.cz);
  if (d > CRATER_LAKE.r) return 0;
  const w = 1 - d / CRATER_LAKE.r;
  const ws = w * w * (3 - 2 * w);
  // Outer rim slightly raised, inner pit dropped below sea level.
  const rimRise = 14 * ws * Math.max(0, 1 - 2 * (1 - w));
  // Inner depression: deeper near center, naturalH protected
  const innerW = Math.max(0, 1 - d / (CRATER_LAKE.r * 0.7));
  const dip = -CRATER_LAKE.depth * innerW * innerW * 1.6;
  void naturalH;
  return dip + rimRise;
}

// === Pillar Forest — Zhangjiajie-style cluster of stone columns ===
const PILLARS_CENTER = { cx: 4500, cz: -3500, r: 700 };
// Hand-placed columns inside the cluster.
const PILLARS: { cx: number; cz: number; r: number; h: number }[] = [
  { cx: 4500, cz: -3500, r: 32, h: 180 },
  { cx: 4380, cz: -3650, r: 24, h: 150 },
  { cx: 4640, cz: -3620, r: 28, h: 165 },
  { cx: 4400, cz: -3380, r: 22, h: 140 },
  { cx: 4620, cz: -3380, r: 26, h: 155 },
  { cx: 4250, cz: -3500, r: 20, h: 130 },
  { cx: 4750, cz: -3500, r: 24, h: 145 },
  { cx: 4500, cz: -3700, r: 26, h: 160 },
  { cx: 4500, cz: -3300, r: 22, h: 135 },
  { cx: 4350, cz: -3250, r: 18, h: 120 },
];

function pillarForestDelta(x: number, z: number): number {
  // Far from cluster? skip.
  if (Math.hypot(x - PILLARS_CENTER.cx, z - PILLARS_CENTER.cz) > PILLARS_CENTER.r) return 0;
  let maxLift = 0;
  for (const p of PILLARS) {
    const d = Math.hypot(x - p.cx, z - p.cz);
    if (d > p.r) continue;
    // Sharp cylinder — drops off fast at the edge so the columns have
    // near-vertical sides like the Avatar mountains.
    const t = 1 - d / p.r;
    const w = t > 0.6 ? 1 : t / 0.6;
    const ws = w * w * (3 - 2 * w);
    const lift = p.h * ws;
    if (lift > maxLift) maxLift = lift;
  }
  return maxLift;
}

// === Volcano — giant cone in the archipelago, with crater ===
const VOLCANO = {
  cx: 7800, cz: -2200,
  baseR: 800,         // base radius
  peakH: 320,         // height above sea level
  craterR: 60,        // crater radius
  craterDepth: 40,    // crater pit depth
};

function volcanoDelta(x: number, z: number): number {
  const d = Math.hypot(x - VOLCANO.cx, z - VOLCANO.cz);
  if (d > VOLCANO.baseR) return 0;
  const w = 1 - d / VOLCANO.baseR;
  // Conical rise — power < 1 gives a flatter base + steeper top.
  const cone = Math.pow(w, 1.4) * VOLCANO.peakH;
  // Carve crater at peak.
  if (d < VOLCANO.craterR) {
    const cw = 1 - d / VOLCANO.craterR;
    const crater = -VOLCANO.craterDepth * cw * cw;
    return cone + crater;
  }
  return cone;
}

export function isVolcanicRock(x: number, z: number, h: number): boolean {
  const d = Math.hypot(x - VOLCANO.cx, z - VOLCANO.cz);
  if (d > VOLCANO.baseR) return false;
  // Volcanic basalt on the cone (the upper portion).
  return h > 50;
}

export function isLavaCrater(x: number, z: number): boolean {
  const d = Math.hypot(x - VOLCANO.cx, z - VOLCANO.cz);
  return d < VOLCANO.craterR * 0.6;
}

// === Rock Arches — small natural arches in the SW badlands ===
// Each arch is two stone pillars with a "crossbar" of stone above.
// We model only the lift here; chunkData paints with ROCK_ARCH block.
interface RockArch {
  cx: number; cz: number;
  axisAngle: number;       // radians — orientation of arch span
  span: number;            // distance between pillar centers
  pillarR: number;
  pillarH: number;
  archThickness: number;   // height of the crossbar above ground
}
const ARCHES: RockArch[] = [
  { cx: -2700, cz: -2600, axisAngle: 0.4, span: 24, pillarR: 8, pillarH: 38, archThickness: 8 },
  { cx: -3100, cz: -2200, axisAngle: 1.1, span: 30, pillarR: 9, pillarH: 42, archThickness: 9 },
  { cx: -2500, cz: -3100, axisAngle: -0.6, span: 22, pillarR: 7, pillarH: 35, archThickness: 7 },
  { cx: -3400, cz: -2900, axisAngle: 1.6, span: 28, pillarR: 8, pillarH: 40, archThickness: 8 },
];

// The arch is implemented as the union of two pillar lifts. The "crossbar"
// is rendered separately in chunkData by checking arch overhang positions
// at the right Y range.
function rockArchPillarDelta(x: number, z: number): number {
  let maxLift = 0;
  for (const a of ARCHES) {
    const ax = a.cx + Math.cos(a.axisAngle) * (a.span / 2);
    const az = a.cz + Math.sin(a.axisAngle) * (a.span / 2);
    const bx = a.cx - Math.cos(a.axisAngle) * (a.span / 2);
    const bz = a.cz - Math.sin(a.axisAngle) * (a.span / 2);
    for (const [px, pz] of [[ax, az], [bx, bz]]) {
      const d = Math.hypot(x - px, z - pz);
      if (d > a.pillarR) continue;
      const t = 1 - d / a.pillarR;
      const w = t > 0.65 ? 1 : t / 0.65;
      const ws = w * w * (3 - 2 * w);
      const lift = a.pillarH * ws;
      if (lift > maxLift) maxLift = lift;
    }
  }
  return maxLift;
}

// True if the world-space block (x, y, z) sits inside an arch's overhead
// crossbar. Used by chunkData to paint suspended sandstone blocks above the
// gap between pillars.
export function isArchCrossbar(x: number, y: number, z: number): boolean {
  for (const a of ARCHES) {
    const ax = a.cx + Math.cos(a.axisAngle) * (a.span / 2);
    const az = a.cz + Math.sin(a.axisAngle) * (a.span / 2);
    const bx = a.cx - Math.cos(a.axisAngle) * (a.span / 2);
    const bz = a.cz - Math.sin(a.axisAngle) * (a.span / 2);
    // Project (x, z) onto pillar-to-pillar segment.
    const dx = bx - ax, dz = bz - az;
    const lenSq = dx * dx + dz * dz;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / lenSq));
    const px = ax + t * dx;
    const pz = az + t * dz;
    const lateral = Math.hypot(x - px, z - pz);
    if (lateral > a.pillarR * 0.7) continue;
    // Crossbar at the TOP of the pillars only — a band of height a.archThickness.
    const topY = a.pillarH + 36;          // approx surface ~36 + lift
    if (y >= topY - a.archThickness && y <= topY) {
      // Skip the regions inside the pillars themselves (they're already filled).
      const distFromA = Math.hypot(x - ax, z - az);
      const distFromB = Math.hypot(x - bx, z - bz);
      if (distFromA < a.pillarR * 0.8 || distFromB < a.pillarR * 0.8) return false;
      return true;
    }
  }
  return false;
}

// === Public combined delta ===
// Sum of every landmark's height contribution at this position. Called from
// terrain.ts noiseHeight.
export function landmarksDelta(x: number, z: number, naturalH: number): number {
  let d = 0;
  d += spireDelta(x, z);
  d += twoSistersDelta(x, z);
  d += secondCanyonDelta(x, z, naturalH);
  d += craterLakeDelta(x, z, naturalH);
  d += pillarForestDelta(x, z);
  d += volcanoDelta(x, z);
  d += rockArchPillarDelta(x, z);
  return d;
}

// Surface override at this position (returns null for default biome surface).
// Used for volcanic basalt + sandstone arches + crater lava.
export function landmarkSurfaceAt(x: number, z: number, h: number): BlockId | null {
  if (isLavaCrater(x, z)) return BLOCK.LAVA;
  if (isVolcanicRock(x, z, h)) return BLOCK.VOLCANIC_ROCK;
  // Pillar tops and rock arches use sandstone.
  if (Math.hypot(x - PILLARS_CENTER.cx, z - PILLARS_CENTER.cz) < PILLARS_CENTER.r) {
    for (const p of PILLARS) {
      const d = Math.hypot(x - p.cx, z - p.cz);
      if (d < p.r) return BLOCK.ROCK_ARCH;
    }
  }
  for (const a of ARCHES) {
    const d = Math.hypot(x - a.cx, z - a.cz);
    if (d < a.span) return BLOCK.ROCK_ARCH;
  }
  return null;
}
