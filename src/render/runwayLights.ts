import * as THREE from 'three';
import { AIRPORTS } from '../world/airport';

// PAPI: 4 lights to the side of runway threshold. Each light shows red when
// the viewer is below its target glideslope angle, white when above.
// Standard 3° glide:
//   light 1 (innermost): 2.50°
//   light 2:             2.83°
//   light 3:             3.17°
//   light 4 (outermost): 3.50°
// On glide = 2 red + 2 white.
//
// Edge lights line both sides of every runway. Threshold/end lights cap the
// ends in green/red. All lights have a halo sprite that fades in at night.

const PAPI_TARGETS = [2.50, 2.83, 3.17, 3.50];
const APPROACH_LIGHT_COUNT = 6;
const APPROACH_LIGHT_SPACING = 30;
const EDGE_LIGHT_SPACING = 40;        // m between edge lights along runway

interface AirportLights {
  papiLights: THREE.Mesh[];
  airport: typeof AIRPORTS[number];
}

function makeHaloTexture(color: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, color);
  grad.addColorStop(0.4, color.replace(',1)', ',0.55)'));
  grad.addColorStop(1, color.replace(',1)', ',0)'));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class RunwayLights {
  group = new THREE.Group();
  private airports: AirportLights[] = [];
  private redMat: THREE.MeshBasicMaterial;
  private whiteMat: THREE.MeshBasicMaterial;
  private haloMatWhite: THREE.SpriteMaterial;
  private haloMatYellow: THREE.SpriteMaterial;
  private haloMatRed: THREE.SpriteMaterial;
  private haloMatGreen: THREE.SpriteMaterial;
  private haloSprites: THREE.Sprite[] = [];

  constructor() {
    this.redMat = new THREE.MeshBasicMaterial({ color: 0xff2828 });
    this.whiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

    this.haloMatWhite = new THREE.SpriteMaterial({
      map: makeHaloTexture('rgba(255,255,200,1)'),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.haloMatYellow = new THREE.SpriteMaterial({
      map: makeHaloTexture('rgba(255,220,120,1)'),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.haloMatRed = new THREE.SpriteMaterial({
      map: makeHaloTexture('rgba(255,80,60,1)'),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.haloMatGreen = new THREE.SpriteMaterial({
      map: makeHaloTexture('rgba(120,255,140,1)'),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });

    const papiGeo = new THREE.BoxGeometry(1.0, 0.5, 1.0);
    const approachGeo = new THREE.BoxGeometry(0.6, 0.5, 0.6);
    const edgeGeo = new THREE.BoxGeometry(0.4, 0.4, 0.4);
    const approachMat = new THREE.MeshBasicMaterial({ color: 0xfff48a });
    const edgeMat = new THREE.MeshBasicMaterial({ color: 0xfff4d0 });
    const thrMat = new THREE.MeshBasicMaterial({ color: 0x55ff66 });
    const endMat = new THREE.MeshBasicMaterial({ color: 0xff3030 });

    for (const ap of AIRPORTS) {
      // PAPI: 4 boxes on the LEFT side of runway near south threshold
      const papiLights: THREE.Mesh[] = [];
      const papiZ = ap.cz - ap.runwayLength / 2 + 5;
      const papiX0 = ap.cx - ap.runwayWidth / 2 - 5;
      for (let i = 0; i < 4; i++) {
        const m = new THREE.Mesh(papiGeo, this.redMat);
        m.position.set(papiX0 - i * 2.0, ap.elev + 1.3, papiZ);
        this.group.add(m);
        papiLights.push(m);
        this.addHalo(m.position, this.haloMatWhite, 5);
      }

      // Approach lights: a single row of small lights extending SOUTH from threshold
      // for ~180m, with a crossbar at the far end.
      for (let i = 1; i <= APPROACH_LIGHT_COUNT; i++) {
        const m = new THREE.Mesh(approachGeo, approachMat);
        m.position.set(ap.cx, ap.elev + 1.2, ap.cz - ap.runwayLength / 2 - i * APPROACH_LIGHT_SPACING);
        this.group.add(m);
        this.addHalo(m.position, this.haloMatYellow, 4);
      }
      // Crossbar at the far end of the approach line
      for (const dx of [-3, -1.5, 1.5, 3]) {
        const cb = new THREE.Mesh(approachGeo, approachMat);
        cb.position.set(
          ap.cx + dx,
          ap.elev + 1.2,
          ap.cz - ap.runwayLength / 2 - APPROACH_LIGHT_COUNT * APPROACH_LIGHT_SPACING,
        );
        this.group.add(cb);
        this.addHalo(cb.position, this.haloMatYellow, 4);
      }

      // Edge lights along both sides of the runway, plus green threshold and
      // red end lights at each runway end.
      const halfW = ap.runwayWidth / 2;
      const halfL = ap.runwayLength / 2;
      const edgeY = ap.elev + 1.1;
      const numEdge = Math.floor(ap.runwayLength / EDGE_LIGHT_SPACING);
      for (let i = 0; i <= numEdge; i++) {
        const z = ap.cz - halfL + i * (ap.runwayLength / numEdge);
        for (const sx of [-1, 1]) {
          const m = new THREE.Mesh(edgeGeo, edgeMat);
          m.position.set(ap.cx + sx * (halfW + 1), edgeY, z);
          this.group.add(m);
          this.addHalo(m.position, this.haloMatYellow, 3);
        }
      }
      // Green threshold lights (south + north)
      for (const sign of [-1, 1]) {
        for (let xs = -halfW + 2; xs <= halfW - 2; xs += 4) {
          const m = new THREE.Mesh(edgeGeo, sign < 0 ? thrMat : endMat);
          m.position.set(ap.cx + xs, edgeY, ap.cz + sign * halfL);
          this.group.add(m);
          this.addHalo(m.position, sign < 0 ? this.haloMatGreen : this.haloMatRed, 3.5);
        }
      }

      this.airports.push({ papiLights, airport: ap });
    }
  }

  private addHalo(pos: THREE.Vector3, mat: THREE.SpriteMaterial, baseSize: number) {
    const s = new THREE.Sprite(mat.clone());     // clone so per-sprite scale/opacity can vary
    s.position.copy(pos);
    s.position.y += 0.5;
    s.scale.set(baseSize, baseSize, 1);
    s.userData.baseSize = baseSize;
    (s.material as THREE.SpriteMaterial).opacity = 0;
    this.group.add(s);
    this.haloSprites.push(s);
  }

  // nightFactor: 0 = full daylight, 1 = full night. Halos completely off in
  // daylight (was bleeding orange specks all over). Only fade in once the
  // sun is well down.
  setNightFactor(nightFactor: number) {
    const nf = Math.max(0, Math.min(1, nightFactor));
    const visibleNf = Math.max(0, (nf - 0.5) / 0.5);   // 0 until nf >= 0.5
    for (const s of this.haloSprites) {
      const base = s.userData.baseSize as number;
      const scale = base * (1 + 1.4 * visibleNf);
      s.scale.set(scale, scale, 1);
      (s.material as THREE.SpriteMaterial).opacity = 0.85 * visibleNf;
      s.visible = visibleNf > 0.01;
    }
  }

  // Update PAPI lights' colors based on viewer position relative to each airport.
  update(viewerPos: THREE.Vector3) {
    for (const al of this.airports) {
      const ap = al.airport;
      // Glideslope reference point = south threshold center.
      const tx = ap.cx;
      const tz = ap.cz - ap.runwayLength / 2;
      const ty = ap.elev + 1;
      const dx = viewerPos.x - tx;
      const dz = viewerPos.z - tz;
      const dy = viewerPos.y - ty;
      // Horizontal distance from threshold
      const horiz = Math.hypot(dx, dz);
      // Angle in degrees from threshold to viewer (only valid when SOUTH of threshold)
      const angle = Math.atan2(dy, Math.max(1, horiz)) * 180 / Math.PI;
      // Only show meaningful colors when viewer is south of threshold and within ~12 km
      const onApproachSide = dz < 0 && horiz < 12000 && horiz > 50;
      for (let i = 0; i < 4; i++) {
        const isWhite = onApproachSide ? angle > PAPI_TARGETS[i] : false;
        al.papiLights[i].material = isWhite ? this.whiteMat : this.redMat;
      }
    }
  }
}
