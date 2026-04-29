import * as THREE from 'three';
import ChunkWorker from './chunkWorker?worker';
import { CHUNK_SIZE, type MeshArrays } from './chunkData';
import { VOXEL_SIZE } from './voxel';
import { getCachedChunk, putCachedChunk } from './chunkCache';

// World meters per chunk side. Chunks index by integer cx/cz which span
// CHUNK_PITCH_M of world space each.
const CHUNK_PITCH_M = CHUNK_SIZE * VOXEL_SIZE;     // 16 voxels × 2 m = 32 m

interface LoadedChunk {
  mesh: THREE.Mesh;
}

interface PendingRequest {
  id: number;
  cx: number;
  cz: number;
  age: number;
}

// More workers + bigger inflight budget = leading edge of voxel detail stays
// ahead of the player at speed, instead of "printing" chunks behind you.
const WORKER_COUNT = 12;
const MAX_INFLIGHT = 48;

export class World {
  scene: THREE.Scene;
  loaded = new Map<string, LoadedChunk>();
  viewRadius: number;
  lookahead: { x: number; z: number } = { x: 0, z: 0 };

  private workers: Worker[] = [];
  private nextWorkerIdx = 0;
  private inFlight = new Map<number, PendingRequest>();
  private nextId = 1;
  private mat: THREE.MeshLambertMaterial;

  constructor(scene: THREE.Scene, viewRadius = 5) {
    this.scene = scene;
    this.viewRadius = viewRadius;
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true });

    for (let i = 0; i < WORKER_COUNT; i++) {
      const w = new ChunkWorker();
      w.onmessage = (e: MessageEvent<MeshArrays>) => {
        this.onChunkReady(e.data);
        // Cache the freshly-generated chunk for next session.
        putCachedChunk(e.data);
      };
      this.workers.push(w);
    }
  }

  private key(cx: number, cz: number) {
    return `${cx},${cz}`;
  }

  isLoadedAt(x: number, z: number): boolean {
    const cx = Math.floor(x / CHUNK_PITCH_M);
    const cz = Math.floor(z / CHUNK_PITCH_M);
    return this.loaded.has(this.key(cx, cz));
  }

  loadedCount(): number {
    return this.loaded.size;
  }

  pendingCount(): number {
    return this.inFlight.size;
  }

  /**
   * Update which chunks are resident around the viewer.
   * @param viewerX/Z player position
   * @param hintVX/VZ player velocity (for predictive loading)
   * @param budget max new chunk requests per call (we cap at MAX_INFLIGHT total)
   */
  update(viewerX: number, viewerZ: number, hintVX = 0, hintVZ = 0, budget = 8) {
    const ccx = Math.floor(viewerX / CHUNK_PITCH_M);
    const ccz = Math.floor(viewerZ / CHUNK_PITCH_M);
    const r = this.viewRadius;
    const speed = Math.hypot(hintVX, hintVZ);
    const dirX = speed > 0.1 ? hintVX / speed : 0;
    const dirZ = speed > 0.1 ? hintVZ / speed : 0;

    // Velocity-direction overshoot: at speed, load chunks BEYOND the normal
    // view radius along the velocity vector so the leading edge stays ahead
    // of the camera. Scales with airspeed — at 80 m/s we extend ~6 chunks
    // (192 m) beyond r in the flight direction.
    const overshoot = Math.min(8, Math.floor(speed / 12));

    // Unload chunks beyond viewRadius + 1 (or further if they're behind the
    // flight direction — keep them resident for a moment so the back-edge
    // doesn't strobe in the chase camera as you turn).
    for (const [k, lc] of this.loaded) {
      const [cx, cz] = k.split(',').map(Number);
      const dx = cx - ccx;
      const dz = cz - ccz;
      const ahead = dx * dirX + dz * dirZ;
      const keepRadius = ahead > 0 ? r + overshoot + 1 : r + 1;
      if (Math.abs(dx) > keepRadius || Math.abs(dz) > keepRadius) {
        this.scene.remove(lc.mesh);
        lc.mesh.geometry.dispose();
        this.loaded.delete(k);
      }
    }

    // Cancel in-flight requests well beyond the keep area.
    for (const [id, req] of this.inFlight) {
      const dx = req.cx - ccx;
      const dz = req.cz - ccz;
      const ahead = dx * dirX + dz * dirZ;
      const keepRadius = ahead > 0 ? r + overshoot + 2 : r + 2;
      if (Math.abs(dx) > keepRadius || Math.abs(dz) > keepRadius) {
        this.inFlight.delete(id);
      }
    }

    // Build candidate list of chunks we want but don't have yet. Search
    // window is r in all directions PLUS overshoot in the velocity direction.
    const candidates: { cx: number; cz: number; score: number }[] = [];
    const searchR = r + overshoot;
    for (let dz = -searchR; dz <= searchR; dz++) {
      for (let dx = -searchR; dx <= searchR; dx++) {
        // Skip chunks outside the normal radius UNLESS they're ahead of us.
        const ahead = dx * dirX + dz * dirZ;
        const inNormalRadius = Math.abs(dx) <= r && Math.abs(dz) <= r;
        if (!inNormalRadius && ahead < 1) continue;
        const cx = ccx + dx;
        const cz = ccz + dz;
        if (this.loaded.has(this.key(cx, cz))) continue;
        if (this.hasInFlight(cx, cz)) continue;
        const d2 = dx * dx + dz * dz;
        // Strong bias toward chunks ahead of velocity.
        const score = d2 - ahead * 4.0;
        candidates.push({ cx, cz, score });
      }
    }
    candidates.sort((a, b) => a.score - b.score);

    // Dispatch up to `budget` (and respect MAX_INFLIGHT).
    let dispatched = 0;
    for (const c of candidates) {
      if (this.inFlight.size >= MAX_INFLIGHT) break;
      if (dispatched >= budget) break;
      this.dispatch(c.cx, c.cz);
      dispatched++;
    }
  }

  private hasInFlight(cx: number, cz: number): boolean {
    for (const r of this.inFlight.values()) {
      if (r.cx === cx && r.cz === cz) return true;
    }
    return false;
  }

  private dispatch(cx: number, cz: number) {
    const id = this.nextId++;
    this.inFlight.set(id, { id, cx, cz, age: 0 });

    // Try the persistent cache first. On hit, skip the worker entirely; the
    // chunk's mesh arrays come straight from IndexedDB. Async — we still
    // hold the inFlight slot until cache lookup resolves.
    getCachedChunk(cx, cz).then((cached) => {
      if (!this.inFlight.has(id)) return;     // cancelled (player flew away)
      if (cached) {
        this.onChunkReady(cached);
        return;
      }
      // Cache miss → dispatch to a worker.
      const w = this.workers[this.nextWorkerIdx];
      this.nextWorkerIdx = (this.nextWorkerIdx + 1) % this.workers.length;
      w.postMessage({ id, cx, cz });
    });
  }

  private onChunkReady(arr: MeshArrays) {
    // Find request — the worker doesn't echo the id back in the typed payload,
    // so we match by (cx, cz). (We sent id but didn't include it in MeshArrays.)
    let foundId: number | null = null;
    for (const [id, r] of this.inFlight) {
      if (r.cx === arr.cx && r.cz === arr.cz) { foundId = id; break; }
    }
    if (foundId !== null) this.inFlight.delete(foundId);

    const k = this.key(arr.cx, arr.cz);
    if (this.loaded.has(k)) return; // already loaded (shouldn't happen)

    // The chunk might be out of view by the time it arrives — drop it then.
    // We don't know current viewer position here; main loop will still call
    // update() and unload it next frame, so just add it.
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(arr.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(arr.normals, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(arr.colors, 3));
    geo.setIndex(new THREE.BufferAttribute(arr.indices, 1));
    geo.computeBoundingSphere();

    const mesh = new THREE.Mesh(geo, this.mat);
    mesh.position.set(arr.cx * CHUNK_PITCH_M, 0, arr.cz * CHUNK_PITCH_M);
    this.scene.add(mesh);
    this.loaded.set(k, { mesh });
  }
}
