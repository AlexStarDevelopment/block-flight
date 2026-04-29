// Debug helper: fly straight at a heading for some seconds, log min/max FPS,
// hitches > 30 ms, and chunk-load latency.

import type { Plane } from './sim/plane';
import type { World } from './world/world';

export function makeStressFly(plane: Plane, world: World) {
  return async function stressFly(headingDeg = 0, durationSec = 30, speed = 50) {
    plane.pos.set(plane.pos.x, 400, plane.pos.z);
    const headingRad = (headingDeg * Math.PI) / 180;
    const half = headingRad / 2;
    const sy = Math.sin(half), cy = Math.cos(half);
    plane.quat.set(0, sy, 0, cy);
    plane.vel.set(Math.sin(headingRad) * speed, 0, Math.cos(headingRad) * speed);
    plane.angVel.set(0, 0, 0);
    plane.controls.throttle = 0.75;

    const start = performance.now();
    let last = start;
    let minFps = Infinity;
    let maxFps = 0;
    let frames = 0;
    let hitches = 0;
    let worstFrameMs = 0;

    return new Promise<{
      durationSec: number;
      avgFps: number;
      minFps: number;
      maxFps: number;
      hitches30ms: number;
      worstFrameMs: number;
      finalChunks: number;
    }>((resolve) => {
      function tick() {
        const now = performance.now();
        const dt = now - last;
        last = now;
        if (dt > worstFrameMs) worstFrameMs = dt;
        if (dt > 30) hitches++;
        if (dt > 0) {
          const fps = 1000 / dt;
          if (fps > maxFps) maxFps = fps;
          if (fps < minFps) minFps = fps;
        }
        frames++;
        if (now - start < durationSec * 1000) {
          requestAnimationFrame(tick);
        } else {
          const total = (now - start) / 1000;
          resolve({
            durationSec: total,
            avgFps: frames / total,
            minFps,
            maxFps,
            hitches30ms: hitches,
            worstFrameMs,
            finalChunks: world.loadedCount(),
          });
        }
      }
      requestAnimationFrame(tick);
    });
  };
}
