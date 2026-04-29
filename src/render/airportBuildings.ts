import * as THREE from 'three';
import { AIRPORTS } from '../world/airport';

// Control tower + hangars at the spawn airport. Built from cheap boxes; no
// shaders. Placed off the runway on the east side of the apron.

export function buildAirportBuildings(): THREE.Group {
  const group = new THREE.Group();

  const home = AIRPORTS[0];
  const baseY = home.elev + 1;       // top of voxel surface

  // East side of apron, just outside the apron edge.
  const eastX = home.cx + home.apronWidth / 2 + 14;
  const buildingsZ = home.cz;        // centered along runway

  // === Control tower ===
  // Square concrete base, narrow stem, wide glass cab on top.
  const matConcrete = new THREE.MeshLambertMaterial({ color: 0xc7c2b6 });
  const matStem = new THREE.MeshLambertMaterial({ color: 0xb8b3a7 });
  const matGlass = new THREE.MeshLambertMaterial({ color: 0x4a82b0, transparent: true, opacity: 0.85 });
  const matRoof = new THREE.MeshLambertMaterial({ color: 0x2a2e36 });

  const towerX = eastX;
  const towerZ = buildingsZ - home.runwayLength / 2 + 30;     // near south threshold

  const base = new THREE.Mesh(new THREE.BoxGeometry(8, 6, 8), matConcrete);
  base.position.set(towerX, baseY + 3, towerZ);
  group.add(base);

  const stem = new THREE.Mesh(new THREE.BoxGeometry(3.5, 14, 3.5), matStem);
  stem.position.set(towerX, baseY + 13, towerZ);
  group.add(stem);

  // glass cab
  const cab = new THREE.Mesh(new THREE.BoxGeometry(7, 3.2, 7), matGlass);
  cab.position.set(towerX, baseY + 21, towerZ);
  group.add(cab);

  // cab roof
  const cabRoof = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.6, 7.6), matRoof);
  cabRoof.position.set(towerX, baseY + 22.9, towerZ);
  group.add(cabRoof);

  // antenna mast
  const ant = new THREE.Mesh(new THREE.BoxGeometry(0.2, 4, 0.2), matRoof);
  ant.position.set(towerX, baseY + 25, towerZ);
  group.add(ant);

  // red beacon on antenna tip (visible day/night)
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xff2828 }),
  );
  beacon.position.set(towerX, baseY + 27.2, towerZ);
  group.add(beacon);

  // === Hangars ===
  // Three hangars in a row along the east side of the apron.
  const matHangarSide = new THREE.MeshLambertMaterial({ color: 0x9aa1a8 });
  const matHangarRoof = new THREE.MeshLambertMaterial({ color: 0x5a626c });
  const matHangarDoor = new THREE.MeshLambertMaterial({ color: 0x6a6a6a });

  const hangarSpec = [
    { z: buildingsZ + 50, w: 22, l: 16, h: 9 },
    { z: buildingsZ + 18, w: 18, l: 14, h: 8 },
    { z: buildingsZ - 14, w: 24, l: 18, h: 10 },
  ];

  for (const h of hangarSpec) {
    const hx = eastX + 4;            // offset east of tower line

    // box body
    const body = new THREE.Mesh(new THREE.BoxGeometry(h.w, h.h, h.l), matHangarSide);
    body.position.set(hx, baseY + h.h / 2, h.z);
    group.add(body);

    // pitched roof: a thin tilted box on top
    const roofW = h.w + 0.5;
    const roofD = h.l + 0.5;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(roofW, 0.6, roofD), matHangarRoof);
    roof.position.set(hx, baseY + h.h + 0.4, h.z);
    group.add(roof);

    // gable triangles (front + back) — approximate with a thin wedge
    for (const sign of [-1, 1]) {
      const gable = new THREE.Mesh(
        new THREE.BoxGeometry(h.w, 1.5, 0.5),
        matHangarSide,
      );
      gable.position.set(hx, baseY + h.h + 0.5, h.z + sign * h.l / 2);
      group.add(gable);
    }

    // big sliding door facing the apron (west side)
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, h.h * 0.85, h.l * 0.8),
      matHangarDoor,
    );
    door.position.set(hx - h.w / 2 - 0.2, baseY + h.h * 0.425, h.z);
    group.add(door);
  }

  // === Taxiways ===
  // Heights MUST match the runway mesh: slab top at elev + 1.025 so wheels
  // (bottom at elev + 1.03 at static rest) sit ~5mm above the surface.
  // Centreline marking sits at the slab top via polygonOffset.
  addTaxiwayNetwork(group, home, baseY);

  return group;
}

const TAXI_W_MAIN = 14;
const TAXI_W_ALPHA = 12;

function makeTaxiMaterials(): { taxi: THREE.MeshLambertMaterial; line: THREE.MeshLambertMaterial } {
  return {
    taxi: new THREE.MeshLambertMaterial({
      color: 0x252830,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
    line: new THREE.MeshLambertMaterial({
      color: 0xffd24a,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    }),
  };
}

function addTaxiwayNetwork(group: THREE.Group, ap: typeof AIRPORTS[number], baseY: number) {
  const mats = makeTaxiMaterials();
  const eastX = ap.cx + ap.apronWidth / 2 + 14;
  const halfRwy = ap.runwayLength / 2;
  // baseY = ap.elev + 1 (voxel surface top). Slab top at elev + 1.025 to match
  // the runway slab and sit 5mm under the wheel bottom (elev + 1.03 at rest).
  const slabY = baseY - 0.005;         // h=0.06 → top = elev + 1.025
  const lineY = baseY + 0.005;         // h=0.04 → top = elev + 1.025 (coplanar; polygonOffset wins)
  const crossLen = eastX + TAXI_W_MAIN / 2 - (ap.cx - ap.runwayWidth / 2);

  // Three CROSS taxiways: south threshold, midpoint, north threshold.
  for (const z of [ap.cz - halfRwy + 8, ap.cz, ap.cz + halfRwy - 8]) {
    const cx = (ap.cx - ap.runwayWidth / 2) + crossLen / 2;
    const cross = new THREE.Mesh(
      new THREE.BoxGeometry(crossLen, 0.06, TAXI_W_MAIN),
      mats.taxi,
    );
    cross.position.set(cx, slabY, z);
    group.add(cross);
    const line = new THREE.Mesh(
      new THREE.BoxGeometry(crossLen - 2, 0.04, 0.5),
      mats.line,
    );
    line.position.set(cx, lineY, z);
    group.add(line);
  }

  // Parallel ALPHA taxiway along east edge — full runway length + a bit.
  const alphaX = ap.cx + ap.runwayWidth / 2 + 14;
  const alphaLen = ap.runwayLength + 8;
  const alpha = new THREE.Mesh(
    new THREE.BoxGeometry(TAXI_W_ALPHA, 0.06, alphaLen),
    mats.taxi,
  );
  alpha.position.set(alphaX, slabY, ap.cz);
  group.add(alpha);
  const alphaLine = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.04, alphaLen - 2),
    mats.line,
  );
  alphaLine.position.set(alphaX, lineY, ap.cz);
  group.add(alphaLine);
}

// Same taxiway network for non-home airports (cross at threshold ends + middle,
// plus parallel alpha taxiway).
export function buildSimpleTaxiways(): THREE.Group {
  const group = new THREE.Group();
  for (let i = 1; i < AIRPORTS.length; i++) {
    const ap = AIRPORTS[i];
    addTaxiwayNetwork(group, ap, ap.elev + 1);
  }
  return group;
}
