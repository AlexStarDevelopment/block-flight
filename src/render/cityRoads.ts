import * as THREE from 'three';
import { heightAt } from '../world/terrain';
import { VOXEL_SIZE } from '../world/voxel';
import { getCityGraph, type RoadSeg } from '../world/cityLayout';

// City road network — renders the road graph from cityLayout. Asphalt strips
// are batched into a single InstancedMesh so even thousands of segments cost
// 1 draw call.
//
// Bridges are spawned automatically wherever a road segment crosses below
// sea level (rivers, lakes, the canyon). Each bridge gets a deck + rails +
// piers, all individual meshes (few enough that draw call cost is fine).

const SEA_LEVEL = 28;
const ROAD_THICKNESS = 0.05;
const STEP = 16;                    // m — sample step along a segment

export function buildCityRoads(): THREE.Group {
  const root = new THREE.Group();
  const matAsphalt = new THREE.MeshBasicMaterial({
    color: 0x202024,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const matStripe = new THREE.MeshBasicMaterial({
    color: 0xfaeb78,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });
  const matGravel = new THREE.MeshBasicMaterial({
    color: 0x8a7d6a,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const matParking = new THREE.MeshBasicMaterial({
    color: 0x2a2a2e,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const matBridge = new THREE.MeshLambertMaterial({ color: 0x4a4045 });
  const matBridgePier = new THREE.MeshLambertMaterial({ color: 0x6c625a });

  const graph = getCityGraph();
  const asphaltSegs: SegmentData[] = [];
  const stripeSegs: SegmentData[] = [];
  const gravelSegs: SegmentData[] = [];
  const bridgeSpans: BridgeSpan[] = [];

  for (const seg of graph.segments) {
    walkSegment(seg, asphaltSegs, stripeSegs, gravelSegs, bridgeSpans);
  }

  buildInstanced(root, asphaltSegs, matAsphalt);
  buildInstanced(root, stripeSegs, matStripe);
  buildInstanced(root, gravelSegs, matGravel);

  // Parking lots for suburban commercial — single asphalt slab per parking lot.
  buildParkingLots(root, graph.parkingLots, matParking);

  // Bridges — separate per span (small count, doesn't need instancing).
  for (const span of bridgeSpans) addBridge(root, matBridge, matBridgePier, span);

  return root;
}

function buildParkingLots(
  root: THREE.Group,
  parkingLots: import('../world/cityLayout').ParkingLot[],
  mat: THREE.Material,
) {
  if (parkingLots.length === 0) return;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mesh = new THREE.InstancedMesh(geo, mat, parkingLots.length);
  const m = new THREE.Matrix4();
  const rot = new THREE.Matrix4();
  const scl = new THREE.Matrix4();
  const pos = new THREE.Matrix4();
  let written = 0;
  for (const p of parkingLots) {
    const surf = surfaceTopY(p.cx, p.cz);
    if (surf <= SEA_LEVEL + 1) continue;
    scl.makeScale(p.width, ROAD_THICKNESS, p.depth);
    rot.makeRotationY(p.rotY);
    pos.makeTranslation(p.cx, surf - 0.005, p.cz);
    m.multiplyMatrices(pos, rot).multiply(scl);
    mesh.setMatrixAt(written, m);
    written++;
  }
  mesh.count = written;
  mesh.instanceMatrix.needsUpdate = true;
  root.add(mesh);
}

interface SegmentData {
  x: number; y: number; z: number;
  width: number; depth: number;     // box width × depth (Y is fixed thickness)
}

interface BridgeSpan {
  ax: number; az: number;
  bx: number; bz: number;
  halfW: number;                    // road half-width
  arterial: boolean;
}

function walkSegment(
  seg: RoadSeg,
  asphalt: SegmentData[],
  stripes: SegmentData[],
  gravel: SegmentData[],
  bridges: BridgeSpan[],
) {
  const dx = seg.bx - seg.ax;
  const dz = seg.bz - seg.az;
  const len = Math.hypot(dx, dz);
  if (len < 1) return;
  const ux = dx / len, uz = dz / len;
  const halfW = seg.kind === 'arterial' ? 6 : seg.kind === 'street' ? 4 : 3;
  const arterial = seg.kind === 'arterial';
  const isGravel = seg.kind === 'gravel';
  const isNS = Math.abs(uz) > Math.abs(ux);

  // Walk along the segment, deciding at each sample whether we're on
  // asphalt-on-terrain or in a water span (→ bridge).
  let waterStart: { x: number; z: number } | null = null;
  for (let s = 0; s <= len; s += STEP) {
    const t = Math.min(1, s / len);
    const px = seg.ax + dx * t;
    const pz = seg.az + dz * t;
    const surf = surfaceTopY(px, pz);
    const overWater = surf <= SEA_LEVEL + 1;
    if (overWater) {
      if (waterStart === null) waterStart = { x: px, z: pz };
    } else {
      if (waterStart !== null) {
        // Close out the water span as a bridge — gravel roads don't get
        // bridges (just disappear into the water).
        if (!isGravel) {
          bridges.push({
            ax: waterStart.x, az: waterStart.z,
            bx: px, bz: pz,
            halfW, arterial,
          });
        }
        waterStart = null;
      }
      const slab: SegmentData = {
        x: px, y: surf - 0.005, z: pz,
        width: isNS ? halfW * 2 : STEP + 0.5,
        depth: isNS ? STEP + 0.5 : halfW * 2,
      };
      if (isGravel) gravel.push(slab);
      else asphalt.push(slab);
      if (arterial) {
        stripes.push({
          x: px, y: surf, z: pz,
          width: isNS ? 0.25 : STEP * 0.6,
          depth: isNS ? STEP * 0.6 : 0.25,
        });
      }
    }
  }
  if (waterStart !== null && !isGravel) {
    bridges.push({
      ax: waterStart.x, az: waterStart.z,
      bx: seg.bx, bz: seg.bz,
      halfW, arterial,
    });
  }
}

function buildInstanced(root: THREE.Group, segs: SegmentData[], mat: THREE.Material) {
  if (segs.length === 0) return;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mesh = new THREE.InstancedMesh(geo, mat, segs.length);
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    matrix.makeScale(s.width, ROAD_THICKNESS, s.depth);
    matrix.setPosition(s.x, s.y, s.z);
    mesh.setMatrixAt(i, matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  root.add(mesh);
}

function addBridge(
  root: THREE.Group,
  matDeck: THREE.Material,
  matPier: THREE.Material,
  span: BridgeSpan,
) {
  const dx = span.bx - span.ax;
  const dz = span.bz - span.az;
  const len = Math.hypot(dx, dz);
  if (len < 12) return;
  const ux = dx / len, uz = dz / len;
  const isNS = Math.abs(uz) > Math.abs(ux);

  // Deck centered between endpoints, sitting at SEA_LEVEL + clearance.
  const deckY = SEA_LEVEL + 8;
  const cx = (span.ax + span.bx) / 2;
  const cz = (span.az + span.bz) / 2;
  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(
      isNS ? span.halfW * 2 : len,
      1.4,
      isNS ? len : span.halfW * 2,
    ),
    matDeck,
  );
  deck.position.set(cx, deckY, cz);
  root.add(deck);

  // Side rails on both sides.
  for (const sx of [-1, 1]) {
    const offX = sx * span.halfW * uz;        // perpendicular
    const offZ = sx * span.halfW * (-ux);
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(
        isNS ? 0.2 : len,
        1.2,
        isNS ? len : 0.2,
      ),
      matDeck,
    );
    rail.position.set(cx + offX, deckY + 0.7, cz + offZ);
    root.add(rail);
  }

  // Piers every 30 m.
  const PIER_SPACING = 30;
  for (let s = PIER_SPACING; s < len; s += PIER_SPACING) {
    const t = s / len;
    const px = span.ax + dx * t;
    const pz = span.az + dz * t;
    for (const sx of [-1, 1]) {
      const offX = sx * (span.halfW - 1.0) * uz;
      const offZ = sx * (span.halfW - 1.0) * (-ux);
      const pier = new THREE.Mesh(
        new THREE.BoxGeometry(1.4, deckY - 1, 1.4),
        matPier,
      );
      pier.position.set(px + offX, (deckY - 1) / 2, pz + offZ);
      root.add(pier);
    }
  }
}

function surfaceTopY(x: number, z: number): number {
  const h = heightAt(Math.floor(x), Math.floor(z));
  return Math.floor(h / VOXEL_SIZE) * VOXEL_SIZE + VOXEL_SIZE;
}
