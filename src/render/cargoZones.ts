import * as THREE from 'three';
import { AIRPORTS, type Airport } from '../world/airport';

// Yellow ground markings showing pickup/delivery zones at each airport.
// Coordinates must match MissionSystem.zoneCenter().

export function buildCargoZones(): THREE.Group {
  const group = new THREE.Group();
  const matZone = new THREE.MeshBasicMaterial({
    color: 0xffd24a,
    transparent: true,
    opacity: 0.85,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const matZoneFill = new THREE.MeshBasicMaterial({
    color: 0xffd24a,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
  });
  const matCorner = new THREE.MeshBasicMaterial({ color: 0x2a2a30 });

  for (const ap of AIRPORTS) {
    const c = zoneCenter(ap);
    // Markings sit AT the voxel surface (top = elev + 1.0) and use polygonOffset
    // so they render on top of the ground. Wheels (bottom at elev + 1.03 at rest)
    // pass cleanly above without clipping the painted markings.
    const y = ap.elev + 0.99;     // h=0.02 → top face elev + 1.00 (coplanar with voxel)
    const size = 22;
    const w = size, t = 0.5, h = 0.02;
    // 4 yellow border bars
    for (const [dx, dz, sw, sd] of [
      [0, -size / 2, w, t],
      [0, size / 2, w, t],
      [-size / 2, 0, t, w],
      [size / 2, 0, t, w],
    ] as const) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sw, h, sd), matZone);
      m.position.set(c.x + dx, y, c.z + dz);
      group.add(m);
    }
    // Diagonal cross inside zone (X mark)
    for (const ang of [Math.PI / 4, -Math.PI / 4]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(size * 1.2, h, t), matZone);
      m.position.set(c.x, y, c.z);
      m.rotation.y = ang;
      group.add(m);
    }
    // Light fill — slightly lower so it doesn't z-fight with the bars on top.
    const fill = new THREE.Mesh(new THREE.BoxGeometry(size, 0.012, size), matZoneFill);
    fill.position.set(c.x, y - 0.005, c.z);
    group.add(fill);
    // Corner posts so the zone is visible from low altitude. Sit on the ground
    // (bottom at voxel surface) and stand 1.5m tall.
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.5, 0.4), matCorner);
      post.position.set(c.x + sx * size / 2, ap.elev + 1 + 0.75, c.z + sz * size / 2);
      group.add(post);
    }
  }
  return group;
}

function zoneCenter(a: Airport): { x: number; z: number } {
  return {
    x: a.cx + a.apronWidth / 2 + 14,
    z: a.cz,
  };
}
