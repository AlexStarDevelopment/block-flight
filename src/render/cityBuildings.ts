import * as THREE from 'three';
import { heightAt } from '../world/terrain';
import { VOXEL_SIZE } from '../world/voxel';
import { getCityGraph, type Lot, type LotZone } from '../world/cityLayout';
import { getBuildingPrototypes, type BuildingPrototype } from './buildingPrototypes';

// City buildings — placed deterministically along the road network from
// cityLayout. Each prototype renders as one InstancedMesh, so 31 distinct
// building shapes cost 31 draw calls regardless of placement count.

export interface BuildingBox {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
  zone: LotZone;
}

const BUILDING_BOXES: BuildingBox[] = [];
export function getCityBuildingBoxes(): BuildingBox[] {
  return BUILDING_BOXES;
}

const SEA_LEVEL = 28;

export interface CityBuildings {
  group: THREE.Group;
  // Per-frame update — toggles per-zone visibility based on camera distance
  // so suburbs disappear when you fly out of city, freeing GPU work.
  update(cameraPos: THREE.Vector3): void;
  // 0 = full daylight, 1 = deep night. Drives a warm window-glow term
  // injected into the building shader so cities light up after sunset.
  setNightFactor(nightFactor: number): void;
}

// Shared uniform — every building material references this same object, so
// one assignment per frame lights up the entire city.
const NIGHT_UNIFORM: { value: number } = { value: 0 };

function makeBuildingMaterial(): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNightFactor = NIGHT_UNIFORM;
    shader.fragmentShader =
      'uniform float uNightFactor;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `
      #ifdef USE_COLOR
        {
          // Detect window-ish vertex colors: blue-dominant (windowDay) or
          // warm yellow (windowGlow). Walls in the palette are mostly neutral
          // pastels, concrete, or muted earth tones, so this picks out
          // windows without a per-vertex flag.
          vec3 vc = vColor.rgb;
          float bluish = vc.b - max(vc.r, vc.g);
          float warmish = min(vc.r, vc.g) - vc.b;
          float windowness = clamp(max(bluish, warmish) * 4.0, 0.0, 1.0);
          // Gate by luminance — dark glass walls (glassBlue) read as blue
          // too but are dim; this filter keeps the glow on bright window
          // stripes only.
          float lum = dot(vc, vec3(0.299, 0.587, 0.114));
          windowness *= smoothstep(0.45, 0.7, lum);
          vec3 warmGlow = vec3(1.0, 0.82, 0.45);
          // Replace the dim night-side colour on window vertices with a bright
          // warm glow so windows actually pop against a dark city. Walls glow
          // weakly via the residual additive term so the building silhouette
          // doesn't disappear.
          float glow = windowness * uNightFactor;
          outgoingLight = mix(outgoingLight, warmGlow * 1.6, glow);
          outgoingLight += warmGlow * 0.06 * uNightFactor * (1.0 - windowness);
        }
      #endif
      #include <opaque_fragment>
      `,
    );
  };
  return mat;
}

// Distance LOD thresholds (metres from CITY_CENTER 0,0 to camera position).
const SUBURB_HIDE_DIST = 3500;
const MIDRISE_HIDE_DIST = 5500;
const DOWNTOWN_HIDE_DIST = 9000;        // even tall towers fade out eventually

export function buildCity(): CityBuildings {
  const root = new THREE.Group();
  const graph = getCityGraph();
  const prototypes = getBuildingPrototypes();

  // Bucket prototypes by category for quick zone-aware lookup.
  const byCategory = new Map<string, BuildingPrototype[]>();
  for (const p of prototypes) {
    let bucket = byCategory.get(p.category);
    if (!bucket) {
      bucket = [];
      byCategory.set(p.category, bucket);
    }
    bucket.push(p);
  }

  // Hash a lot's position to a deterministic prototype index, drawing from
  // the lot's preferred category. Estate lots prefer larger houses; commercial
  // suburban lots draw from suburban_commercial.
  function pickProto(lot: Lot): BuildingPrototype | null {
    const cat: BuildingPrototype['category'] =
      lot.preferCategory === 'suburban_commercial' ? 'suburban_commercial'
      : lot.preferCategory === 'downtown' ? 'downtown'
      : lot.preferCategory === 'midrise' ? 'midrise'
      : lot.preferCategory === 'house' ? 'house'
      : 'rural';
    const candidates = byCategory.get(cat) ?? prototypes;
    // For estate zone, bias toward larger house prototypes.
    const wantLarge = lot.zone === 'estate';
    // Strict fit — building must not exceed the lot footprint, otherwise it
    // overflows into the adjacent road. Lots with no candidate are left empty.
    const fitting = candidates.filter((p) => {
      const fits = p.width <= lot.width && p.depth <= lot.depth;
      if (wantLarge) {
        // Estate: only houses with footprint area > 100 m².
        return fits && p.width * p.depth > 100;
      }
      return fits;
    });
    if (fitting.length === 0) return null;
    const h = hash2(lot.x, lot.z);
    const idx = Math.floor(h * fitting.length) % fitting.length;
    return fitting[idx];
  }

  // Group lots by chosen prototype so each prototype gets one InstancedMesh.
  const instancesByProto = new Map<string, { proto: BuildingPrototype; lots: Lot[] }>();
  for (const lot of graph.lots) {
    const proto = pickProto(lot);
    if (!proto) continue;     // no prototype fits — leave the lot empty
    let entry = instancesByProto.get(proto.id);
    if (!entry) {
      entry = { proto, lots: [] };
      instancesByProto.set(proto.id, entry);
    }
    entry.lots.push(lot);
  }

  // Track per-zone meshes so we can toggle them with distance LOD.
  const downtownMeshes: THREE.InstancedMesh[] = [];
  const midriseMeshes: THREE.InstancedMesh[] = [];
  const suburbMeshes: THREE.InstancedMesh[] = [];

  // Build one InstancedMesh per prototype.
  for (const { proto, lots } of instancesByProto.values()) {
    if (lots.length === 0) continue;
    const mat = makeBuildingMaterial();
    const mesh = new THREE.InstancedMesh(proto.geometry, mat, lots.length);
    const m = new THREE.Matrix4();
    const rot = new THREE.Matrix4();
    const pos = new THREE.Matrix4();
    let written = 0;
    for (const lot of lots) {
      // Skip if this lot is below sea level — would put buildings underwater.
      const surf = surfaceTopY(lot.x, lot.z);
      if (surf <= SEA_LEVEL + 1) continue;
      rot.makeRotationY(lot.rotY);
      pos.makeTranslation(lot.x, surf, lot.z);
      m.multiplyMatrices(pos, rot);
      mesh.setMatrixAt(written, m);
      // Register collision AABB. Footprint depends on rotation — for rotations
      // ±π/2, w and d swap.
      const sin = Math.abs(Math.sin(lot.rotY));
      const cos = Math.abs(Math.cos(lot.rotY));
      const halfW = (proto.width * cos + proto.depth * sin) / 2;
      const halfD = (proto.width * sin + proto.depth * cos) / 2;
      BUILDING_BOXES.push({
        minX: lot.x - halfW, maxX: lot.x + halfW,
        minY: surf,          maxY: surf + proto.height,
        minZ: lot.z - halfD, maxZ: lot.z + halfD,
        zone: lot.zone,
      });
      written++;
    }
    mesh.count = written;
    mesh.instanceMatrix.needsUpdate = true;
    root.add(mesh);
    // Bucket by category so distance LOD can hide whole zones at once.
    if (proto.category === 'downtown') downtownMeshes.push(mesh);
    else if (proto.category === 'midrise' || proto.category === 'suburban_commercial') midriseMeshes.push(mesh);
    else if (proto.category === 'house') suburbMeshes.push(mesh);
    // Rural buildings stay visible — they're sparse and you fly past them.
  }

  return {
    group: root,
    update(cameraPos: THREE.Vector3) {
      // Camera distance from city center — hide far zones.
      const dist = Math.hypot(cameraPos.x, cameraPos.z);
      const showSuburb = dist < SUBURB_HIDE_DIST;
      const showMidrise = dist < MIDRISE_HIDE_DIST;
      const showDowntown = dist < DOWNTOWN_HIDE_DIST;
      for (const m of suburbMeshes)   m.visible = showSuburb;
      for (const m of midriseMeshes)  m.visible = showMidrise;
      for (const m of downtownMeshes) m.visible = showDowntown;
    },
    setNightFactor(nightFactor: number) {
      NIGHT_UNIFORM.value = Math.max(0, Math.min(1, nightFactor));
    },
  };
}

function surfaceTopY(x: number, z: number): number {
  const h = heightAt(Math.floor(x), Math.floor(z));
  return Math.floor(h / VOXEL_SIZE) * VOXEL_SIZE + VOXEL_SIZE;
}

// Stable hash for picking prototypes deterministically from lot coords.
function hash2(x: number, z: number): number {
  let h = Math.floor(x) * 374761393 + Math.floor(z) * 668265263;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
