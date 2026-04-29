import * as THREE from 'three';
import { biomeAt, heightAt, heightAtCoarse, heightAtFast, SEA_LEVEL } from './terrain';
import { AIRPORTS } from './airport';

// Coarse heightmap mesh centered on the player. Used beyond voxel chunks.
// Cells inside `innerRadius` are excluded from the index buffer entirely so
// there is no z-fighting or visible "pit" under the voxel chunks.

// Match BLOCK_COLOR palette so the LOD ring blends seamlessly into voxel chunks.
const COLOR_SAND = new THREE.Color(0.85, 0.78, 0.55);
const COLOR_SNOW = new THREE.Color(0.95, 0.96, 0.98);
const COLOR_WATER = new THREE.Color(0.20, 0.45, 0.70);
const COLOR_FOREST = new THREE.Color(0.18, 0.34, 0.18);
const COLOR_DESERT = new THREE.Color(0.85, 0.78, 0.55);
const COLOR_RED_ROCK = new THREE.Color(0.70, 0.42, 0.25);
const COLOR_TUNDRA = new THREE.Color(0.48, 0.55, 0.42);
const COLOR_WHEAT = new THREE.Color(0.78, 0.66, 0.30);
const COLOR_SAVANNA = new THREE.Color(0.72, 0.62, 0.28);
const COLOR_TAIGA = new THREE.Color(0.20, 0.30, 0.18);
const COLOR_SWAMP = new THREE.Color(0.30, 0.40, 0.25);

export class DistantTerrain {
  group: THREE.Group;
  private step: number;
  private cells: number;
  private mesh: THREE.Mesh;
  private positions: Float32Array;
  private colors: Float32Array;
  private centerX = Number.NaN;
  private centerZ = Number.NaN;
  private cheap: boolean;

  // `cheap` = MeshBasic + heightAtCoarse (2 noise octaves instead of 4).
  // Use for the far ring where detail is invisible.
  constructor(size = 6000, step = 48, innerRadius = 224, cheap = false) {
    this.group = new THREE.Group();
    this.step = step;
    this.cells = Math.floor(size / step);
    this.cheap = cheap;

    const n = this.cells + 1;
    this.positions = new Float32Array(n * n * 3);
    this.colors = new Float32Array(n * n * 3);

    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const v = (j * n + i) * 3;
        this.positions[v] = (i - this.cells / 2) * step;
        this.positions[v + 1] = 0;
        this.positions[v + 2] = (j - this.cells / 2) * step;
      }
    }

    // Index buffer skips quads that have any vertex inside innerRadius.
    const indices: number[] = [];
    const inner2 = innerRadius * innerRadius;
    for (let j = 0; j < this.cells; j++) {
      for (let i = 0; i < this.cells; i++) {
        // sample center of quad
        const lx = (i - this.cells / 2 + 0.5) * step;
        const lz = (j - this.cells / 2 + 0.5) * step;
        if (lx * lx + lz * lz < inner2) continue; // hole in the middle
        const a = j * n + i;
        const b = j * n + (i + 1);
        const c = (j + 1) * n + i;
        const d = (j + 1) * n + (i + 1);
        // Wind so the surface normal is +Y (up). a,c,b is CCW when viewed from above.
        indices.push(a, c, b, c, d, b);
      }
    }

    const geo = new THREE.BufferGeometry();
    // Use BufferAttribute (not Float32BufferAttribute) so the typed array is
    // shared, not copied. Otherwise update() mutates a dead buffer.
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    geo.setIndex(indices);

    const mat = this.cheap
      ? new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.FrontSide })
      : new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.FrontSide });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.renderOrder = -10;
    this.group.add(this.mesh);
  }

  update(viewerX: number, viewerZ: number) {
    // Snap centre to step grid; only resample if it moved.
    const cx = Math.round(viewerX / this.step) * this.step;
    const cz = Math.round(viewerZ / this.step) * this.step;
    if (cx === this.centerX && cz === this.centerZ) return;
    this.centerX = cx;
    this.centerZ = cz;
    this.mesh.position.set(cx, 0, cz);

    const n = this.cells + 1;
    // Quick AABB per airport so we can skip the airport check for the vast
    // majority of LOD vertices that are nowhere near a runway.
    const airportRanges = AIRPORTS.map((a) => {
      const ext = a.apronWidth / 2 + a.apronLength / 2 + a.falloff + 200;
      return { x: a.cx, z: a.cz, ext };
    });
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const lx = (i - this.cells / 2) * this.step;
        const lz = (j - this.cells / 2) * this.step;
        const v = (j * n + i) * 3;
        const wx = cx + lx;
        const wz = cz + lz;
        let nearAirport = false;
        for (const ar of airportRanges) {
          if (Math.abs(wx - ar.x) < ar.ext && Math.abs(wz - ar.z) < ar.ext) {
            nearAirport = true;
            break;
          }
        }
        const hRaw = nearAirport
          ? heightAt(wx, wz)
          : (this.cheap ? heightAtCoarse(wx, wz) : heightAtFast(wx, wz));
        // Drop LOD just below the voxel-grid surface so chunks always render
        // on top at the seam. Eliminates z-fight flicker at the inner edge.
        const h = hRaw - 1.5;
        this.positions[v + 1] = h;
        const col = colorForBiome(h, biomeAt(wx, wz));
        this.colors[v] = col.r;
        this.colors[v + 1] = col.g;
        this.colors[v + 2] = col.b;
      }
    }
    const geo = this.mesh.geometry;
    (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
  }
}

function colorForBiome(h: number, b: import('./terrain').Biome): THREE.Color {
  if (h <= SEA_LEVEL) return COLOR_WATER;
  if (h <= SEA_LEVEL + 1) return COLOR_SAND;
  if (h > 130) return COLOR_SNOW;
  switch (b) {
    case 'snowy_tundra': return COLOR_SNOW;
    case 'tundra':       return h > 75 ? COLOR_SNOW : COLOR_TUNDRA;
    case 'taiga':        return h > 90 ? COLOR_SNOW : COLOR_TAIGA;
    case 'desert':       return h > 80 ? COLOR_RED_ROCK : COLOR_DESERT;
    case 'savanna':      return COLOR_SAVANNA;
    case 'swamp':        return COLOR_SWAMP;
    case 'forest':       return COLOR_FOREST;
    case 'plains':
    default:             return COLOR_WHEAT;
  }
}
