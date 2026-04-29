import * as THREE from 'three';
import { LANDING_SITES, TIGHT_WATER_SITES, type LandingSite } from '../world/landingSites';
import { buildWindsock } from './windsock';

// Visual markers for off-airport landing sites: small windsock at one end,
// stone cairns at the four strip corners, and tinted ground patch matching
// the surface (sand/gravel/grass/snow). Cargo zone next to the strip.

const SURFACE_COLOR: Record<string, number> = {
  sand:   0xc8b282,
  gravel: 0x8a8479,
  grass:  0x6a8a4a,
  snow:   0xeef2f5,
};

export function buildLandingSiteMarkers(): {
  group: THREE.Group;
  updateWindsocks: (wind: THREE.Vector3) => void;
} {
  const group = new THREE.Group();
  const matCairn = new THREE.MeshLambertMaterial({ color: 0x5a534a });
  const matZone = new THREE.MeshBasicMaterial({
    color: 0xffd24a, transparent: true, opacity: 0.85,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  });
  const matZoneFill = new THREE.MeshBasicMaterial({
    color: 0xffd24a, transparent: true, opacity: 0.18, depthWrite: false,
  });
  const cairnGeo = new THREE.BoxGeometry(0.6, 0.8, 0.6);
  const windsockUpdaters: { update: (w: THREE.Vector3) => void }[] = [];

  for (const s of LANDING_SITES) {
    const halfL = s.length / 2;
    const halfW = s.width / 2;

    // Tinted ground patch sitting just above voxel surface (which is forced
    // flat to s.elev by landingSiteSampleAt). Matches surface type.
    const patchMat = new THREE.MeshLambertMaterial({
      color: SURFACE_COLOR[s.surface] ?? 0x999999,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    const patch = new THREE.Mesh(
      new THREE.BoxGeometry(s.width, 0.08, s.length),
      patchMat,
    );
    patch.position.set(s.cx, s.elev + 0.99, s.cz);
    group.add(patch);

    // Stone cairns at the four strip corners — visible from low altitude.
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const c = new THREE.Mesh(cairnGeo, matCairn);
      c.position.set(s.cx + sx * (halfW + 0.6), s.elev + 1.4, s.cz + sz * halfL);
      group.add(c);
    }

    // Tall identification pole at the south end — visible from a few km away.
    const matPoleBody = new THREE.MeshLambertMaterial({ color: 0xfafafa });
    const matPoleFlag = new THREE.MeshBasicMaterial({ color: 0xff5050 });
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.4, 14, 0.4), matPoleBody);
    pole.position.set(s.cx + halfW + 4, s.elev + 1 + 7, s.cz - halfL - 2);
    group.add(pole);
    const flag = new THREE.Mesh(new THREE.BoxGeometry(2.5, 1.6, 0.1), matPoleFlag);
    flag.position.set(s.cx + halfW + 4 + 1.4, s.elev + 1 + 13, s.cz - halfL - 2);
    group.add(flag);

    // Themed landmark per name — make each site look like its name implies.
    addThemedLandmark(group, s);

    // Windsock at south end, on the east side. Only on medium-difficulty
    // sites — harder strips have no wind aid (you read the trees / smoke).
    if (s.difficulty === 'medium') {
      const ws = buildWindsock();
      ws.group.position.set(s.cx + halfW + 3, s.elev + 1, s.cz - halfL - 4);
      group.add(ws.group);
      windsockUpdaters.push(ws);
    }

    // Cargo zone alongside the strip on the east side. Smaller than airport
    // zones (15m square) since these are tight bush spots.
    const zoneCenter = landingSiteCargoZone(s);
    const zoneSize = 15;
    const t = 0.4;
    const h = 0.02;
    // Border bars
    for (const [dx, dz, sw, sd] of [
      [0, -zoneSize / 2, zoneSize, t],
      [0, zoneSize / 2, zoneSize, t],
      [-zoneSize / 2, 0, t, zoneSize],
      [zoneSize / 2, 0, t, zoneSize],
    ] as const) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sw, h, sd), matZone);
      m.position.set(zoneCenter.x + dx, s.elev + 0.99, zoneCenter.z + dz);
      group.add(m);
    }
    // Diagonal X
    for (const ang of [Math.PI / 4, -Math.PI / 4]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(zoneSize * 1.2, h, t), matZone);
      m.position.set(zoneCenter.x, s.elev + 0.99, zoneCenter.z);
      m.rotation.y = ang;
      group.add(m);
    }
    // Light fill
    const fill = new THREE.Mesh(
      new THREE.BoxGeometry(zoneSize, 0.012, zoneSize),
      matZoneFill,
    );
    fill.position.set(zoneCenter.x, s.elev + 0.985, zoneCenter.z);
    group.add(fill);
  }

  return {
    group,
    updateWindsocks(wind: THREE.Vector3) {
      for (const ws of windsockUpdaters) ws.update(wind);
    },
  };
}

// Cargo zone for a landing site: 8m east of the strip edge, centered along
// it — except for tight water sites (Riverbar) where east is in the river.
// Those get their zone placed on the strip itself, offset along the axis.
// MUST stay in sync with destZoneCenter in missions.ts.
export function landingSiteCargoZone(s: LandingSite): { x: number; z: number } {
  if (TIGHT_WATER_SITES.has(s.name)) return { x: s.cx, z: s.cz - s.length / 3 };
  return { x: s.cx + s.width / 2 + 8, z: s.cz };
}

// Per-name landmarks — match the strip's identity. Cabins get cabins, piers
// get piers, glacier sites get an ice spire, etc.
function addThemedLandmark(group: THREE.Group, s: LandingSite) {
  const matWood = new THREE.MeshLambertMaterial({ color: 0x6a4a2a });
  const matPier = new THREE.MeshLambertMaterial({ color: 0x5a4530 });
  const matIce  = new THREE.MeshLambertMaterial({ color: 0xc8e0e8 });
  const matRock = new THREE.MeshLambertMaterial({ color: 0x6a5240 });
  const matLeaf = new THREE.MeshLambertMaterial({ color: 0x2a4220 });
  const matTrunk = new THREE.MeshLambertMaterial({ color: 0x3a2818 });

  const halfW = s.width / 2;
  // Anchor point west of the strip — where landmarks live. (East side has the
  // cargo zone, so we put landmarks on the west side instead.)
  const ax = s.cx - halfW - 6;
  const az = s.cz;
  const baseY = s.elev + 1;

  switch (s.name) {
    case 'Ranger Cabin': {
      // Proper log cabin: stacked-log walls (visible horizontal striations),
      // gabled roof from two tilted slabs, stone chimney, dark door + window.
      const matLog1 = new THREE.MeshLambertMaterial({ color: 0x6e4d2c });
      const matLog2 = new THREE.MeshLambertMaterial({ color: 0x5a3d22 });
      const matDoor = new THREE.MeshLambertMaterial({ color: 0x2e1e10 });
      const matWindow = new THREE.MeshLambertMaterial({ color: 0x3a4a52 });
      const matStone = new THREE.MeshLambertMaterial({ color: 0x68625a });

      const W = 8, D = 6, wallH = 3.4;
      // Stacked log courses — alternate two shades for visible log lines.
      const courseH = 0.5;
      const courses = Math.floor(wallH / courseH);
      for (let i = 0; i < courses; i++) {
        const m = i % 2 === 0 ? matLog1 : matLog2;
        const course = new THREE.Mesh(new THREE.BoxGeometry(W, courseH, D), m);
        course.position.set(ax, baseY + courseH / 2 + i * courseH, az);
        group.add(course);
      }

      // Gabled roof — two tilted slabs that meet at the ridge.
      const roofPitchRad = 0.55;
      const roofSlabW = D / 2 / Math.cos(roofPitchRad) + 0.8;
      const matRoof2 = new THREE.MeshLambertMaterial({ color: 0x3a2818 });
      for (const sign of [-1, 1]) {
        const slab = new THREE.Mesh(new THREE.BoxGeometry(W + 0.8, 0.35, roofSlabW), matRoof2);
        slab.position.set(ax, baseY + wallH + (D / 4) * Math.tan(roofPitchRad), az + sign * D / 4);
        slab.rotation.x = sign * roofPitchRad;
        group.add(slab);
      }

      // Triangular gable end caps (front + back).
      for (const sign of [-1, 1]) {
        const gableTri = new THREE.Mesh(new THREE.BoxGeometry(W, 1.4, 0.3), matLog1);
        gableTri.position.set(ax, baseY + wallH + 0.7, az + sign * D / 2);
        group.add(gableTri);
      }

      // Stone chimney up one wall.
      const chimBase = new THREE.Mesh(new THREE.BoxGeometry(1.0, 4.5, 1.0), matStone);
      chimBase.position.set(ax + W / 2 - 0.6, baseY + 2.25, az + 1.5);
      group.add(chimBase);
      const chimCap = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.4, 1.2), matStone);
      chimCap.position.set(ax + W / 2 - 0.6, baseY + 4.7, az + 1.5);
      group.add(chimCap);

      // Door on the front face.
      const door = new THREE.Mesh(new THREE.BoxGeometry(1.0, 2.0, 0.1), matDoor);
      door.position.set(ax - 0.8, baseY + 1.0, az - D / 2 - 0.05);
      group.add(door);

      // Two windows on each long side.
      for (const wz of [-1.6, 1.6]) {
        const win = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.1), matWindow);
        win.position.set(ax + 1.4, baseY + 2.1, az + wz);
        win.rotation.y = 0;
        group.add(win);
      }
      // Window on the front beside the door.
      const winFront = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.1), matWindow);
      winFront.position.set(ax + 1.6, baseY + 2.1, az - D / 2 - 0.05);
      group.add(winFront);

      // Covered porch with two posts.
      const porchFloor = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.18, 1.8), matLog1);
      porchFloor.position.set(ax - 0.5, baseY + 0.09, az - D / 2 - 0.9);
      group.add(porchFloor);
      const porchRoof = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.18, 2), matRoof2);
      porchRoof.position.set(ax - 0.5, baseY + 2.5, az - D / 2 - 1);
      group.add(porchRoof);
      for (const px of [-2, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.3, 0.18), matLog1);
        post.position.set(ax + px, baseY + 1.25, az - D / 2 - 1.7);
        group.add(post);
      }
      break;
    }
    case 'Pine Ridge':
    case 'Cedar Bluff': {
      // A small cluster of pine/cedar trees.
      for (let i = 0; i < 5; i++) {
        const ox = ax + (Math.random() - 0.5) * 14;
        const oz = az + (Math.random() - 0.5) * 30;
        const trunk = new THREE.Mesh(new THREE.BoxGeometry(0.6, 6, 0.6), matTrunk);
        trunk.position.set(ox, baseY + 3, oz);
        group.add(trunk);
        // Stacked leaf cones.
        for (let lyr = 0; lyr < 3; lyr++) {
          const w = 3 - lyr * 0.7;
          const leaf = new THREE.Mesh(new THREE.BoxGeometry(w, 1.4, w), matLeaf);
          leaf.position.set(ox, baseY + 5 + lyr * 1.3, oz);
          group.add(leaf);
        }
      }
      break;
    }
    case 'Hidden Cove':
    case 'Sandy Point': {
      // Wooden dock extending from the strip into the water.
      const platform = new THREE.Mesh(new THREE.BoxGeometry(8, 0.3, 2), matPier);
      platform.position.set(ax - 3, baseY + 0.15, az);
      group.add(platform);
      for (const ox of [-6, -3, 0]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2, 0.3), matPier);
        post.position.set(ax + ox, baseY - 1, az);
        group.add(post);
      }
      // Small boat tied to the dock
      const boat = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.6, 1), matWood);
      boat.position.set(ax - 7, baseY - 0.3, az + 1.2);
      group.add(boat);
      break;
    }
    case 'Marsh Strip': {
      // Cattail / reed clumps.
      for (let i = 0; i < 12; i++) {
        const ox = ax + (Math.random() - 0.5) * 12;
        const oz = az + (Math.random() - 0.5) * 30;
        const reed = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.6, 0.18), matLeaf);
        reed.position.set(ox, baseY + 0.8, oz);
        group.add(reed);
      }
      break;
    }
    case 'Glacier Pad':
    case 'Frostlake':
    case 'Ice Fields': {
      // Ice spires / blue ice blocks scattered nearby.
      const spire = new THREE.Mesh(new THREE.BoxGeometry(2.5, 5, 2.5), matIce);
      spire.position.set(ax - 2, baseY + 2.5, az - 4);
      group.add(spire);
      const spire2 = new THREE.Mesh(new THREE.BoxGeometry(1.6, 3, 1.6), matIce);
      spire2.position.set(ax + 1, baseY + 1.5, az + 4);
      group.add(spire2);
      const block = new THREE.Mesh(new THREE.BoxGeometry(3, 1, 3), matIce);
      block.position.set(ax - 5, baseY + 0.5, az + 8);
      group.add(block);
      break;
    }
    case 'Mesa North':
    case 'Mesa South': {
      // Large red-rock boulder beside the strip.
      const rock = new THREE.Mesh(new THREE.BoxGeometry(4, 5, 4), matRock);
      rock.position.set(ax, baseY + 2.5, az);
      group.add(rock);
      const rock2 = new THREE.Mesh(new THREE.BoxGeometry(2.5, 3, 2.5), matRock);
      rock2.position.set(ax - 4, baseY + 1.5, az + 6);
      group.add(rock2);
      break;
    }
    case 'Riverbar': {
      // A broken canoe washed up on the bar.
      const canoe = new THREE.Mesh(new THREE.BoxGeometry(4, 0.5, 1), matWood);
      canoe.position.set(ax, baseY + 0.25, az);
      canoe.rotation.y = 0.3;
      group.add(canoe);
      // A driftwood log
      const log = new THREE.Mesh(new THREE.BoxGeometry(3, 0.5, 0.5), matTrunk);
      log.position.set(ax - 3, baseY + 0.25, az - 5);
      group.add(log);
      break;
    }
    case 'Wolf Meadow': {
      // Tall lone tree marking the meadow.
      const trunk = new THREE.Mesh(new THREE.BoxGeometry(0.7, 9, 0.7), matTrunk);
      trunk.position.set(ax, baseY + 4.5, az);
      group.add(trunk);
      const leaves = new THREE.Mesh(new THREE.BoxGeometry(5, 5, 5), matLeaf);
      leaves.position.set(ax, baseY + 10, az);
      group.add(leaves);
      break;
    }
    case 'Kettle Pond': {
      // Small fishing dock on the pond edge.
      const platform = new THREE.Mesh(new THREE.BoxGeometry(4, 0.2, 1.5), matPier);
      platform.position.set(ax - 1, baseY + 0.1, az);
      group.add(platform);
      for (const ox of [-2.5, 0]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.25, 1.5, 0.25), matPier);
        post.position.set(ax + ox, baseY - 0.5, az);
        group.add(post);
      }
      break;
    }
  }
}
