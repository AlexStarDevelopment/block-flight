import * as THREE from 'three';
import { heightAt } from '../world/terrain';
import { VOXEL_SIZE } from '../world/voxel';
import { getCityGraph, type RoadSeg } from '../world/cityLayout';

// Vertical infrastructure around the city — radio antennas + power-line runs.
// Both are aviation hazards: hitting an antenna or a wire crashes the plane.
// The hazard registry is exported so plane.ts can crash on contact.

export type CityHazard =
  | { kind: 'antenna'; x: number; z: number; baseY: number; topY: number; radius: number; name: string }
  | { kind: 'cable'; ax: number; az: number; ay: number; bx: number; bz: number; by: number; name: string };

const HAZARDS: CityHazard[] = [];

export function getCityHazards(): CityHazard[] {
  return HAZARDS;
}

// Shared by other render modules (iconic bridge) that want their cables /
// towers registered as wire-strike hazards.
export function registerCityHazards(extra: CityHazard[]) {
  for (const h of extra) HAZARDS.push(h);
}

const RED_LIGHT_BLINK_HZ = 1.0;        // 1 Hz blink (roughly FAA spec)

interface InfraResult {
  group: THREE.Group;
  // Update tick — animates the red anti-collision lights on antennas + balls.
  update(tSec: number): void;
}

export function buildCityInfra(): InfraResult {
  const root = new THREE.Group();
  const matSteel = new THREE.MeshLambertMaterial({ color: 0x6b6660 });
  const matSteelDark = new THREE.MeshLambertMaterial({ color: 0x3a3833 });
  const matRedOff = new THREE.MeshBasicMaterial({ color: 0x551010 });
  const matRedOn = new THREE.MeshBasicMaterial({ color: 0xff3030 });
  const matCable = new THREE.LineBasicMaterial({ color: 0x101010 });
  const matBall = new THREE.MeshLambertMaterial({ color: 0xc83030 });

  // Cable point buffer — all sagging cable segments across the city collect
  // into here, then we emit ONE THREE.LineSegments at the end. Saves
  // ~340 draw calls vs creating one Line per cable.
  const cablePoints: number[] = [];

  // Track all the red-light meshes so we can blink them.
  const antennaLights: THREE.Mesh[] = [];

  // ---- Radio antennas ----
  // 3 hand-placed at the city perimeter, well clear of the runway approach.
  // Antenna positions chosen E and W of the runway, NE and SW for variety.
  const antennaSites = [
    { x:  2200, z:   600, h: 110, name: 'Antenna East' },
    { x: -2400, z:  -800, h:  95, name: 'Antenna West' },
    { x:  -800, z:  3200, h: 120, name: 'Antenna North' },
  ];
  for (const a of antennaSites) {
    const baseY = surfaceTopY(a.x, a.z);
    addLatticeAntenna(root, matSteel, matRedOff, a.x, baseY, a.z, a.h, antennaLights);
    HAZARDS.push({
      kind: 'antenna',
      x: a.x, z: a.z,
      baseY,
      topY: baseY + a.h + 2,        // include the small spire / ball at top
      radius: 4,                    // generous bounding cylinder for the lattice
      name: a.name,
    });
  }

  // ---- Power-line runs ----
  // Powerlines follow major arterials (offset to one side of the road), the
  // way real transmission infrastructure is laid out — not radiating across
  // open country from a phantom substation.
  const graph = getCityGraph();
  const arterials = graph.segments.filter((s) => s.kind === 'arterial');
  // Pick a representative subset — cardinal arterials passing through downtown.
  // Filter to long ones (>800 m) so we don't run cables across short fragments.
  const longArterials = arterials.filter((s) =>
    Math.hypot(s.bx - s.ax, s.bz - s.az) > 800,
  );
  // Place a substation at one end of each chosen arterial.
  const chosen = longArterials.slice(0, 4);
  for (const seg of chosen) {
    const baseX = seg.ax;
    const baseZ = seg.az;
    addSubstation(root, matSteelDark, matSteel, baseX, surfaceTopY(baseX, baseZ), baseZ);
    addPowerLineAlongRoad(
      root, matSteel, matBall, cablePoints, seg,
    );
  }

  // Emit ONE THREE.LineSegments for every powerline cable in the city.
  if (cablePoints.length > 0) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(cablePoints), 3));
    root.add(new THREE.LineSegments(geo, matCable));
  }

  return {
    group: root,
    update(tSec: number) {
      const on = (Math.floor(tSec * RED_LIGHT_BLINK_HZ * 2) % 2) === 0;
      for (const m of antennaLights) {
        m.material = on ? matRedOn : matRedOff;
      }
    },
  };
}

// Lattice-style antenna: 4 corner posts + cross-bracing, narrows toward the
// top, with a red ball at the apex and at the midpoint.
function addLatticeAntenna(
  root: THREE.Group,
  matSteel: THREE.Material,
  matRed: THREE.Material,
  cx: number, baseY: number, cz: number,
  height: number,
  redLightOut: THREE.Mesh[],
) {
  const baseHalfW = 4;
  const topHalfW = 1.4;
  const segments = Math.floor(height / 8);     // ~8 m vertical segments
  for (let i = 0; i < segments; i++) {
    const t0 = i / segments;
    const t1 = (i + 1) / segments;
    const y0 = baseY + t0 * height;
    const y1 = baseY + t1 * height;
    const w0 = baseHalfW + (topHalfW - baseHalfW) * t0;
    const w1 = baseHalfW + (topHalfW - baseHalfW) * t1;
    // Four corner posts (one per corner) — short angled boxes connecting
    // adjacent segments. Approximated as a short vertical strut at average w.
    const wMid = (w0 + w1) / 2;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const post = new THREE.Mesh(
        new THREE.BoxGeometry(0.25, y1 - y0 + 0.2, 0.25),
        matSteel,
      );
      post.position.set(cx + sx * wMid, (y0 + y1) / 2, cz + sz * wMid);
      root.add(post);
    }
    // Cross brace — diagonal-ish horizontal at top of segment.
    const brace = new THREE.Mesh(
      new THREE.BoxGeometry(wMid * 2, 0.12, 0.12),
      matSteel,
    );
    brace.position.set(cx, y1, cz);
    root.add(brace);
    const brace2 = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.12, wMid * 2),
      matSteel,
    );
    brace2.position.set(cx, y1, cz);
    root.add(brace2);
  }
  // Spire: thin pole above the lattice with a red ball at the very top.
  const spire = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 2.2, 0.18),
    matSteel,
  );
  spire.position.set(cx, baseY + height + 1.1, cz);
  root.add(spire);
  // Red ball lights — apex + midpoint.
  for (const ay of [baseY + height + 2.0, baseY + height * 0.5]) {
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(1.0, 12, 8),
      matRed,
    );
    ball.position.set(cx, ay, cz);
    root.add(ball);
    redLightOut.push(ball);
  }
}

// "Substation" — a small fenced compound box with transformer-looking blocks.
function addSubstation(
  root: THREE.Group,
  matFence: THREE.Material,
  matBox: THREE.Material,
  cx: number, baseY: number, cz: number,
) {
  const yard = new THREE.Mesh(
    new THREE.BoxGeometry(28, 0.2, 22),
    matFence,
  );
  yard.position.set(cx, baseY + 0.1, cz);
  root.add(yard);
  for (let i = 0; i < 4; i++) {
    const t = new THREE.Mesh(
      new THREE.BoxGeometry(3, 4, 3),
      matBox,
    );
    t.position.set(cx + (i - 1.5) * 5, baseY + 2, cz);
    root.add(t);
  }
  // Tall starting pylon at the substation edge.
  addPylon(root, matBox, cx + 12, baseY, cz, 18);
}

// H-frame pylon: two vertical posts joined by a crossbar.
function addPylon(
  root: THREE.Group,
  matSteel: THREE.Material,
  cx: number, baseY: number, cz: number,
  height: number,
): { topY: number; left: THREE.Vector3; mid: THREE.Vector3; right: THREE.Vector3 } {
  const halfW = 3;
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, height, 0.4),
      matSteel,
    );
    post.position.set(cx + sx * halfW, baseY + height / 2, cz);
    root.add(post);
  }
  const cross = new THREE.Mesh(
    new THREE.BoxGeometry(halfW * 2 + 0.4, 0.4, 0.4),
    matSteel,
  );
  cross.position.set(cx, baseY + height - 0.5, cz);
  root.add(cross);
  // Insulators — small dark blocks hanging below the crossbar at the cable
  // attach points (left, mid, right of the bar).
  const insulY = baseY + height - 1.4;
  for (const sx of [-halfW, 0, halfW]) {
    const ins = new THREE.Mesh(
      new THREE.BoxGeometry(0.25, 0.6, 0.25),
      matSteel,
    );
    ins.position.set(cx + sx, insulY, cz);
    root.add(ins);
  }
  return {
    topY: insulY,
    left: new THREE.Vector3(cx - halfW, insulY, cz),
    mid: new THREE.Vector3(cx, insulY, cz),
    right: new THREE.Vector3(cx + halfW, insulY, cz),
  };
}

// Power lines run along an arterial road, offset to one side (a real city's
// transmission lines parallel the road, not radiating into open country).
// Pylons every ~120 m along the segment; cables sag in catenary between them.
// Cable segments are pushed into the shared cablePoints buffer so they all
// end up in a single LineSegments draw call.
function addPowerLineAlongRoad(
  root: THREE.Group,
  matSteel: THREE.Material,
  matBall: THREE.Material,
  cablePoints: number[],
  seg: RoadSeg,
) {
  const dx = seg.bx - seg.ax;
  const dz = seg.bz - seg.az;
  const len = Math.hypot(dx, dz);
  if (len < 200) return;
  const ux = dx / len, uz = dz / len;
  const SIDE_OFFSET = 12;             // m off the road centerline
  const SPAN = 120;
  // Side: perpendicular right-hand vector, fixed sign so all pylons sit on
  // the same side of the road.
  const nx = -uz, nz = ux;

  const pylons: ReturnType<typeof addPylon>[] = [];
  const numSpans = Math.floor(len / SPAN);
  for (let i = 0; i <= numSpans; i++) {
    const t = i / numSpans;
    const px = seg.ax + dx * t + nx * SIDE_OFFSET;
    const pz = seg.az + dz * t + nz * SIDE_OFFSET;
    const baseY = surfaceTopY(px, pz);
    pylons.push(addPylon(root, matSteel, px, baseY, pz, 22));
  }
  for (let i = 0; i < pylons.length - 1; i++) {
    const a = pylons[i];
    const b = pylons[i + 1];
    for (const which of ['left', 'mid', 'right'] as const) {
      const p0 = a[which];
      const p1 = b[which];
      addSaggingCableSegments(cablePoints, p0, p1, 5);
      HAZARDS.push({
        kind: 'cable',
        ax: p0.x, az: p0.z, ay: p0.y - 3,
        bx: p1.x, bz: p1.z, by: p1.y - 3,
        name: `Power line`,
      });
    }
    // Marker ball on every other span keeps cluster density manageable.
    if (i % 2 === 0) {
      const midA = a.mid; const midB = b.mid;
      const ballPos = new THREE.Vector3()
        .addVectors(midA, midB).multiplyScalar(0.5);
      ballPos.y -= 5;
      const ball = new THREE.Mesh(new THREE.SphereGeometry(1.2, 10, 6), matBall);
      ball.position.copy(ballPos);
      root.add(ball);
    }
  }
}

// Catenary-ish cable as 12 line segments — pushed into the shared cablePoints
// buffer (xyz triplet pairs) so all cables across the city pack into one
// THREE.LineSegments draw call.
function addSaggingCableSegments(
  cablePoints: number[],
  p0: THREE.Vector3,
  p1: THREE.Vector3,
  sagM: number,
) {
  const segs = 12;
  let prevX = p0.x, prevY = p0.y, prevZ = p0.z;
  for (let i = 1; i <= segs; i++) {
    const t = i / segs;
    const x = p0.x + (p1.x - p0.x) * t;
    const z = p0.z + (p1.z - p0.z) * t;
    const yLine = p0.y + (p1.y - p0.y) * t;
    const y = yLine - 4 * sagM * t * (1 - t);
    cablePoints.push(prevX, prevY, prevZ, x, y, z);
    prevX = x; prevY = y; prevZ = z;
  }
}

function surfaceTopY(x: number, z: number): number {
  const h = heightAt(Math.floor(x), Math.floor(z));
  return Math.floor(h / VOXEL_SIZE) * VOXEL_SIZE + VOXEL_SIZE;
}
