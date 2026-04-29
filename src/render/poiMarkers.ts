import * as THREE from 'three';
import { POIS, type POI } from '../world/pois';

// Cheap visual builders for POIs. All shapes are box primitives — no extra
// materials per POI, just shared materials for each kind. Each POI is small
// (cabin ~3m wide, pier ~5m long, blind ~2m tall on stilts).

export function buildPoiMarkers(): THREE.Group {
  const group = new THREE.Group();
  const matWood = new THREE.MeshLambertMaterial({ color: 0x6a4a2a });
  const matRoof = new THREE.MeshLambertMaterial({ color: 0x4a3320 });
  const matStilt = new THREE.MeshLambertMaterial({ color: 0x4a3a2a });
  const matChimney = new THREE.MeshLambertMaterial({ color: 0x3a3030 });
  const matPier = new THREE.MeshLambertMaterial({ color: 0x5a4530 });

  for (const p of POIS) {
    const baseY = p.elev + 1;     // top of voxel surface
    if (p.kind === 'cabin') buildCabin(group, p, baseY, matWood, matRoof, matChimney);
    else if (p.kind === 'pier') buildPier(group, p, baseY, matPier);
    else buildBlind(group, p, baseY, matStilt, matRoof);
  }
  return group;
}

function buildCabin(g: THREE.Group, p: POI, y: number, matBody: THREE.Material, matRoof: THREE.Material, matChim: THREE.Material) {
  const body = new THREE.Mesh(new THREE.BoxGeometry(3.5, 2.4, 3.0), matBody);
  body.position.set(p.cx, y + 1.2, p.cz);
  g.add(body);
  // Pitched roof — thin tilted box.
  const roof = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.6, 3.4), matRoof);
  roof.position.set(p.cx, y + 2.7, p.cz);
  g.add(roof);
  // Chimney
  const chim = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.2, 0.45), matChim);
  chim.position.set(p.cx + 1.0, y + 3.4, p.cz + 0.6);
  g.add(chim);
}

function buildPier(g: THREE.Group, p: POI, y: number, matPier: THREE.Material) {
  // 5m long pier extending from shore — orient along +X (away from center mass)
  const platform = new THREE.Mesh(new THREE.BoxGeometry(5.0, 0.2, 1.5), matPier);
  platform.position.set(p.cx, y + 0.2, p.cz);
  g.add(platform);
  // Posts under the pier
  for (const dx of [-2, 0, 2]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.25, 1.8, 0.25), matPier);
    post.position.set(p.cx + dx, y - 0.7, p.cz);
    g.add(post);
  }
}

function buildBlind(g: THREE.Group, p: POI, y: number, matStilt: THREE.Material, matBox: THREE.Material) {
  // Box on stilts
  const box = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.5, 2.0), matBox);
  box.position.set(p.cx, y + 2.5, p.cz);
  g.add(box);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const stilt = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.0, 0.18), matStilt);
    stilt.position.set(p.cx + sx * 0.8, y + 1.0, p.cz + sz * 0.8);
    g.add(stilt);
  }
}
