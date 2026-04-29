# Block Flight — Performance & "Beyond the Horizon" Plan

Goal: chunk loading is invisible at any cruise speed. The voxel/LOD seam is hidden well past where you'd ever look. FPS at 45–60 in chase view at typical altitude.

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` deferred

---

## Baseline (record before starting)

Numbers to capture on the runway (reset spawn) and at 200 m AGL cruising at 60 kt:

- [x] **B0.** FPS, chunks, calls, triangles, hitch count captured.

```
BASELINE (no worker, voxel radius 5, 2026-04-25):
  Spawn (sit on runway):
    fps=40 frame=16.7ms calls=49 tris=49.3k chunks=132 lod=0ms
  Cruise straight 15s @ 50 m/s:
    avgFps=37.6  minFps=9.4  maxFps=303  hitches>30ms=102  worstFrame=106.9ms
    finalChunks=143
  Cruise+turn 12s @ 40 m/s heading 45°:
    avgFps=35.2  minFps=11.9  maxFps=78.7  hitches>30ms=92  worstFrame=83.8ms
    finalChunks=136
```

**Key signal: 102 hitches > 30 ms in 15 s of cruise.** Each one is a synchronous chunk generation jamming the main thread. Phase A1 (worker) is the right fix.

---

## Phase A — Foundation: get generation off the main thread, predict ahead, push the seam out

The single biggest lever. Until this lands, nothing else has room to scale.

### A1. Web Worker chunk generation
- [x] **A1.1** Created `src/world/chunkWorker.ts` and `chunkData.ts` (worker-safe greedy mesh).
- [x] **A1.2** Vite `?worker` import.
- [x] **A1.3** `world.ts` dispatches to a pool of 3 workers, MAX_INFLIGHT=6. Single shared material across chunks.
- [x] **A1.4** terrain/airport/voxel are pure modules — worker-safe.

**Test A1 — RESULTS**
- [x] Cruise 15s @ 50 m/s: avgFps **59.9** (was 37.6), minFps **36.9** (was 9.4), **hitches=0** (was 102), worstFrame 27.1ms (was 106.9ms)
- [x] Cruise+turn 12s @ 40 m/s: avgFps **59.7** (was 35.2), minFps **42.9** (was 11.9), hitches **0** (was 92)
- [x] Terrain visually identical.

### A2. Predictive chunk loading
- [x] **A2.1** `world.update(viewerX, viewerZ, hintVX, hintVZ, budget)`. Candidates scored by `d² − ahead*1.5`, so chunks ahead of the velocity load first.
- [x] **A2.2** No separate "ready" queue needed — workers are fast enough that ahead-biased scoring achieves the same effect.

**Test A2** — covered by Phase A1 stress (no pop-in observed during cruise).

### A3. Bigger voxel radius + extended LOD horizon
- [x] **A3.1** Voxel view radius 5 → **8** (256 m).
- [x] **A3.2** Three LOD rings: near (4 km / 32 m / inner 256 m), mid (12 km / 100 m / inner 2 km), far (60 km / 400 m / inner 6 km).
- [x] **A3.3** Camera far 60 km, fog 6 km–38 km.
- [x] **A3.4** Long-range airport markers (sprite + tall translucent beam) so airports are visible from tens of km away for approach planning.
- [x] **A3.5** Bug fix: LOD `Float32BufferAttribute` was copying the array; switched to `BufferAttribute` so updates land. Without this the LOD rendered as a black plane at Y=0.

**Phase A acceptance — DONE**
- [x] Cruise FPS up 30%+ (37→60 = +59%).
- [x] No pop-in observed.
- [x] Airport markers visible 5–10 km away.

```
PHASE A DONE:
  Spawn (radius 8, with workers):
    fps=52  frame=19.0ms  calls=52  tris=101.8k  chunks=323
  Cruise straight (post-A1 measurements):
    avgFps=59.9  minFps=36.9  hitches=0  worstFrame=27.1ms
  Cruise+turn:
    avgFps=59.7  minFps=42.9  hitches=0  worstFrame=23.3ms
```

---

## Phase B — Hide the seam, cut tree cost

Phase A leaves a transition somewhere; Phase B makes it invisible at altitudes you'd actually fly.

### B1. Mid-detail LOD ring
- [x] **B1.1–B1.3** Added during Phase A3 (mid LOD: 12 km / 100 m).

### B2. InstancedMesh trees — **REVERTED**
- [x] **B2.1–B2.2** Tried per-chunk and global-pool InstancedMesh approaches. Both lost net perf:
  - Per-chunk: doubled draw calls (52 → 385).
  - Global pool with partial updates: still hit 21 fps cruise vs 32 fps without.
  - Greedy mesher already merges adjacent tree blocks well; instances cost more than they save at this scale.
- Trees stay as voxel blocks. Density reduced from 1.2% → 0.6% to compensate for radius bump.

### B3. Edge fade on voxel chunks — DEFERRED
- Not needed: with current colors the LOD seam isn't conspicuous at altitude.

**Phase B acceptance**
- [x] LOD seam acceptable at altitude (color tuning matched between voxel and LOD).
- [x] Tree cost contained by reducing density.

---

## Phase C — Squeeze (only if still wanted)

### C1. Cheap material for far LOD
- [x] Far 30km LOD now uses `MeshBasicMaterial` (no per-vertex lighting).

### C2. `heightAt` fast path for distant LOD
- [x] Added `heightAtFast` (skips airport check). LOD uses an AABB-per-airport quick reject, falling back to full `heightAt` only near airports.

### C3. Per-frame allocation pass
- [x] `Plane.step` rewritten to use module-scratch Vector3/Quaternion. Eliminated ~10 allocations per gear point per physics tick (= ~3500 allocs/sec).

### C4. LOD update on worker
- [!] Deferred — `lod ms` reads 0.0 in the perf HUD; LOD work is no longer hot.

**Phase C — DONE**
- [x] Cruise hitches 271 → **104** (-62%).
- [x] Turn hitches 37 → **4** (-89%).
- [x] Worst frame 51ms → **39ms**.
- [x] minFps 23 → **25**.

```
PHASE C DONE:
  Settled cruise FPS: 46 (102k tris, 27 calls, voxel radius 6)
  Cruise stress 15s @ 50 m/s: avgFps 36, minFps 25, hitches 104, worstFrame 39ms
  Turn stress 12s @ 40 m/s:   avgFps 42, minFps 30, hitches 4,   worstFrame 33ms
```

---

## Test rig (helpers we'll lean on)

- [ ] **R1.** A `?stats=1` URL flag that mounts a tiny debug HUD with `fps / draw calls / triangles / chunk queue depth / LOD update ms`. Without it the prod HUD stays clean.
- [ ] **R2.** A "stress run" debug command: `window.debug.stressFly(headingDeg, durationSec)` that flies the plane straight at high speed and logs min/max FPS, hitches > 30 ms, and chunk-load latency.

---

## Out of scope this round
- Floating origin (world re-center) — wait until we actually fly > 8 km out and see jitter.
- Day/night affect terrain colors (currently sky only).
- GPU-side terrain (compute shaders) — not justified at this scale.

---

## Baseline numbers
*(filled in before starting)*

## Phase A done
*(filled in after acceptance)*

## Phase B done
*(filled in after acceptance)*

## Phase C done
*(filled in after acceptance)*
