import * as THREE from 'three';
import type { CityHazard } from './cityInfra';

// Signature suspension bridge across the canyon — Royal Gorge style. The
// canyon is a real chasm in terrain.ts (carved up to 70 m deep, runs SW→NE
// from (-2500,-3000) to (1500,3500)). We pick a point ~2.8 km from Origin
// (outside the city flatten zone, so the canyon is still at full depth) and
// span across it perpendicular to the canyon axis.
//
// Returns: scene group + a list of CityHazards (cables + tower cylinders)
// for plane.ts wire-strike detection.

// Canyon axis from terrain.ts.
const CANYON_A = { x: -2500, z: -3000 };
const CANYON_B = { x:  1500, z:  3500 };

// Pick a point along the canyon line, far enough from origin that city
// flatten doesn't fight the canyon depth.
const T_ALONG_CANYON = 0.18;        // 0..1 along the canyon line
function canyonPoint(t: number): { x: number; z: number } {
  return {
    x: CANYON_A.x + t * (CANYON_B.x - CANYON_A.x),
    z: CANYON_A.z + t * (CANYON_B.z - CANYON_A.z),
  };
}
function canyonDir(): { x: number; z: number; nx: number; nz: number } {
  const dx = CANYON_B.x - CANYON_A.x;
  const dz = CANYON_B.z - CANYON_A.z;
  const len = Math.hypot(dx, dz);
  return {
    x: dx / len, z: dz / len,            // along canyon
    nx: -dz / len, nz: dx / len,         // perpendicular
  };
}

const SPAN = 280;                   // tower-to-tower length (m)
const BACKSPAN = 70;                // anchor distance past each tower
const TOWER_TOP_Y = 130;            // m above sea level
const DECK_Y = 70;                  // m above sea level — well above canyon floor
const TOWER_BASE_Y = 36;            // sits on canyon rim
const TOWER_HALF_W = 4.5;
const TOWER_HEAD_HALF_W = 3;
const DECK_HALF_W = 8;
const CABLE_SAG = 38;

export interface IconicBridge {
  group: THREE.Group;
  hazards: CityHazard[];
}

export function buildIconicBridge(): IconicBridge {
  const root = new THREE.Group();
  const hazards: CityHazard[] = [];

  const matRed = new THREE.MeshLambertMaterial({ color: 0xc0382a });
  const matRedDark = new THREE.MeshLambertMaterial({ color: 0x8a2418 });
  const matDeck = new THREE.MeshLambertMaterial({ color: 0x4a4045 });
  const matRail = new THREE.MeshLambertMaterial({ color: 0xb02818 });
  const matCable = new THREE.LineBasicMaterial({ color: 0x8a2418 });
  const matSuspender = new THREE.LineBasicMaterial({ color: 0xa83020 });

  const dir = canyonDir();
  const center = canyonPoint(T_ALONG_CANYON);

  // Tower positions — perpendicular to canyon axis, half-span on each side
  // of the canyon centerline.
  const towerN = {
    x: center.x + dir.nx * (SPAN / 2),
    z: center.z + dir.nz * (SPAN / 2),
  };
  const towerS = {
    x: center.x - dir.nx * (SPAN / 2),
    z: center.z - dir.nz * (SPAN / 2),
  };
  // Anchor positions — back-spans onto solid rim.
  const anchorN = {
    x: towerN.x + dir.nx * BACKSPAN,
    z: towerN.z + dir.nz * BACKSPAN,
  };
  const anchorS = {
    x: towerS.x - dir.nx * BACKSPAN,
    z: towerS.z - dir.nz * BACKSPAN,
  };

  buildTower(root, matRed, matRedDark, towerN.x, towerN.z, hazards, 'Bridge tower N', dir);
  buildTower(root, matRed, matRedDark, towerS.x, towerS.z, hazards, 'Bridge tower S', dir);

  buildDeck(root, matDeck, matRail, anchorN, towerN, towerS, anchorS, dir);

  // Two main cables — left and right of deck centerline.
  for (const sx of [-1, 1]) {
    addMainCable(root, matCable, hazards, anchorN, towerN, towerS, anchorS, dir, sx);
  }

  // Vertical suspender cables.
  addSuspenders(root, matSuspender, towerN, towerS, dir);

  return { group: root, hazards };
}

function buildTower(
  root: THREE.Group,
  matRed: THREE.Material,
  matDark: THREE.Material,
  cx: number, cz: number,
  hazards: CityHazard[],
  name: string,
  dir: ReturnType<typeof canyonDir>,
) {
  // Two pillars 9 m apart along the bridge axis (perpendicular to canyon).
  // We rotate via per-axis offsets — every box gets its rotation matrix set.
  const PILLAR_OFFSET = 4.5;
  const PILLAR_THICK = 2.4;
  // Rotation angle so X axis aligns with canyon-perpendicular (bridge dir).
  const rotY = Math.atan2(dir.nx, dir.nz);

  for (const sx of [-1, 1]) {
    // Tapered tower: stacked segments, narrower at top.
    const segments = 6;
    for (let i = 0; i < segments; i++) {
      const t = i / segments;
      const t2 = (i + 1) / segments;
      const y0 = TOWER_BASE_Y + t * (TOWER_TOP_Y - TOWER_BASE_Y);
      const y1 = TOWER_BASE_Y + t2 * (TOWER_TOP_Y - TOWER_BASE_Y);
      const wMid = TOWER_HALF_W + (TOWER_HEAD_HALF_W - TOWER_HALF_W) * (t + t2) / 2;
      const seg = new THREE.Mesh(
        new THREE.BoxGeometry(wMid * 2, y1 - y0 + 0.1, PILLAR_THICK),
        i % 2 === 0 ? matRed : matDark,
      );
      const offX = sx * PILLAR_OFFSET * dir.x;
      const offZ = sx * PILLAR_OFFSET * dir.z;
      seg.position.set(cx + offX, (y0 + y1) / 2, cz + offZ);
      seg.rotation.y = rotY;
      root.add(seg);
    }
  }
  // Crossbeams between pillars at three heights.
  for (const yFrac of [0.32, 0.62, 0.95]) {
    const y = TOWER_BASE_Y + yFrac * (TOWER_TOP_Y - TOWER_BASE_Y);
    const wMid = TOWER_HALF_W + (TOWER_HEAD_HALF_W - TOWER_HALF_W) * yFrac;
    const beam = new THREE.Mesh(
      new THREE.BoxGeometry(wMid * 2, 1.2, PILLAR_OFFSET * 2 + 1.0),
      matRed,
    );
    beam.position.set(cx, y, cz);
    beam.rotation.y = rotY;
    root.add(beam);
  }

  hazards.push({
    kind: 'antenna',
    x: cx, z: cz,
    baseY: TOWER_BASE_Y,
    topY: TOWER_TOP_Y + 2,
    radius: TOWER_HALF_W + 2,
    name,
  });
}

function buildDeck(
  root: THREE.Group,
  matDeck: THREE.Material,
  matRail: THREE.Material,
  anchorN: { x: number; z: number },
  towerN: { x: number; z: number },
  towerS: { x: number; z: number },
  anchorS: { x: number; z: number },
  dir: ReturnType<typeof canyonDir>,
) {
  const totalLen = SPAN + 2 * BACKSPAN;
  const center = {
    x: (anchorN.x + anchorS.x) / 2,
    z: (anchorN.z + anchorS.z) / 2,
  };
  void towerN; void towerS;
  const rotY = Math.atan2(dir.nx, dir.nz);

  // Roadway slab.
  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(DECK_HALF_W * 2, 1.2, totalLen),
    matDeck,
  );
  deck.position.set(center.x, DECK_Y, center.z);
  deck.rotation.y = rotY;
  root.add(deck);
  // Outer rails on both sides.
  for (const sx of [-1, 1]) {
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(0.25, 1.4, totalLen),
      matRail,
    );
    rail.position.set(
      center.x + sx * DECK_HALF_W * dir.x,
      DECK_Y + 1.6,
      center.z + sx * DECK_HALF_W * dir.z,
    );
    rail.rotation.y = rotY;
    root.add(rail);
  }
}

function addMainCable(
  root: THREE.Group,
  mat: THREE.Material,
  hazards: CityHazard[],
  anchorN: { x: number; z: number },
  towerN: { x: number; z: number },
  towerS: { x: number; z: number },
  anchorS: { x: number; z: number },
  dir: ReturnType<typeof canyonDir>,
  sx: number,
) {
  // Cable lateral offset (per side of deck) using perpendicular-to-bridge axis,
  // which is the canyon direction.
  const off = sx * (DECK_HALF_W - 0.5);
  const a = new THREE.Vector3(
    anchorN.x + off * dir.x, DECK_Y + 1.4, anchorN.z + off * dir.z,
  );
  const tn = new THREE.Vector3(
    towerN.x + off * dir.x, TOWER_TOP_Y + 1, towerN.z + off * dir.z,
  );
  const ts = new THREE.Vector3(
    towerS.x + off * dir.x, TOWER_TOP_Y + 1, towerS.z + off * dir.z,
  );
  const b = new THREE.Vector3(
    anchorS.x + off * dir.x, DECK_Y + 1.4, anchorS.z + off * dir.z,
  );

  const arc1 = catenaryPoints(a, tn, 8, 6);
  const arc2 = catenaryPoints(tn, ts, CABLE_SAG, 24);
  const arc3 = catenaryPoints(ts, b, 8, 6);
  const points = [...arc1, ...arc2, ...arc3];
  const geo = new THREE.BufferGeometry().setFromPoints(points);
  root.add(new THREE.Line(geo, mat));

  const seg = (p: THREE.Vector3, q: THREE.Vector3, name: string) => {
    hazards.push({
      kind: 'cable',
      ax: p.x, az: p.z, ay: p.y - 4,
      bx: q.x, bz: q.z, by: q.y - 4,
      name,
    });
  };
  seg(a, tn, `Bridge cable (${sx > 0 ? 'E' : 'W'} N-anchor)`);
  seg(tn, ts, `Bridge main cable (${sx > 0 ? 'E' : 'W'})`);
  seg(ts, b, `Bridge cable (${sx > 0 ? 'E' : 'W'} S-anchor)`);
}

function catenaryPoints(
  a: THREE.Vector3,
  b: THREE.Vector3,
  sag: number,
  n: number,
): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    const yLine = a.y + (b.y - a.y) * t;
    const y = yLine - 4 * sag * t * (1 - t);
    pts.push(new THREE.Vector3(x, y, z));
  }
  return pts;
}

function addSuspenders(
  root: THREE.Group,
  matSuspender: THREE.Material,
  towerN: { x: number; z: number },
  towerS: { x: number; z: number },
  dir: ReturnType<typeof canyonDir>,
) {
  const SUSPENDER_SPACING = 14;
  // Walk from tower N to tower S in steps along bridge axis.
  for (let s = SUSPENDER_SPACING; s < SPAN; s += SUSPENDER_SPACING) {
    const t = s / SPAN;            // 0..1 from N tower to S tower
    const cx = towerN.x + (towerS.x - towerN.x) * t;
    const cz = towerN.z + (towerS.z - towerN.z) * t;
    // Main cable y at parameter t (parabolic between tower tops).
    const cableY = TOWER_TOP_Y + 1 - 4 * CABLE_SAG * t * (1 - t);
    for (const sx of [-1, 1]) {
      const off = sx * (DECK_HALF_W - 0.5);
      const top = new THREE.Vector3(
        cx + off * dir.x, cableY, cz + off * dir.z,
      );
      const bot = new THREE.Vector3(
        cx + off * dir.x, DECK_Y + 1.4, cz + off * dir.z,
      );
      const geo = new THREE.BufferGeometry().setFromPoints([top, bot]);
      root.add(new THREE.Line(geo, matSuspender));
    }
  }
}
