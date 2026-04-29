// Long-range airport marker.
// Renders as a billboard that's visible from tens of km away, drawn over fog
// so the pilot can pick out airports for approach planning.

import * as THREE from 'three';
import { AIRPORTS } from '../world/airport';

interface MarkerEntry {
  sprite: THREE.Sprite;
  beam: THREE.Mesh;
  airport: typeof AIRPORTS[number];
}

export class AirportMarkers {
  group = new THREE.Group();
  private entries: MarkerEntry[] = [];

  constructor() {
    const tex = makeMarkerTexture();

    for (const ap of AIRPORTS) {
      const mat = new THREE.SpriteMaterial({
        map: tex,
        color: 0xffd24a,
        transparent: true,
        depthTest: false,    // always visible, no terrain occlusion
        sizeAttenuation: false,
        fog: false,          // no fog blending — pilots need to see it
      });
      const sprite = new THREE.Sprite(mat);
      sprite.scale.set(0.04, 0.04, 1);  // pixel-ish size with sizeAttenuation off
      sprite.position.set(ap.cx, ap.elev + 60, ap.cz);
      sprite.renderOrder = 1000;
      this.group.add(sprite);

      // tall vertical beam: a thin transparent box rising from the airport.
      // Fog-aware so it gradually fades into the sky.
      const beamMat = new THREE.MeshBasicMaterial({
        color: 0xffe066,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
      });
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(2, 2, 240, 6),
        beamMat,
      );
      beam.position.set(ap.cx, ap.elev + 120, ap.cz);
      beam.renderOrder = 5;
      this.group.add(beam);

      this.entries.push({ sprite, beam, airport: ap });
    }
  }

  update(viewerPos: THREE.Vector3, t: number) {
    const flash = (Math.sin(t * 4) + 1) * 0.5;
    for (const e of this.entries) {
      const dx = e.airport.cx - viewerPos.x;
      const dz = e.airport.cz - viewerPos.z;
      const dist = Math.hypot(dx, dz);
      // Sprite: pulse, hide when very close (replaced by visible runway/beacon).
      const closeFade = THREE.MathUtils.clamp((dist - 800) / 1200, 0, 1);
      (e.sprite.material as THREE.SpriteMaterial).opacity = 0.35 + 0.55 * flash;
      e.sprite.visible = closeFade > 0.05;
      // Beam: scale taller with distance so it stays visible at the horizon
      const scale = 1 + Math.min(15, dist / 2000);
      e.beam.scale.y = scale;
      (e.beam.material as THREE.MeshBasicMaterial).opacity =
        0.18 + 0.30 * Math.min(1, dist / 4000);
    }
  }
}

// Crisp circle/cross marker drawn to a canvas → SpriteMaterial map.
function makeMarkerTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 128, 128);
  // outer ring
  ctx.strokeStyle = '#ffd24a';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(64, 64, 48, 0, Math.PI * 2);
  ctx.stroke();
  // inner dot
  ctx.fillStyle = '#ffea90';
  ctx.beginPath();
  ctx.arc(64, 64, 14, 0, Math.PI * 2);
  ctx.fill();
  // cross
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(20, 64); ctx.lineTo(108, 64);
  ctx.moveTo(64, 20); ctx.lineTo(64, 108);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}
