import * as THREE from 'three';

// Sun disc + halo that follow the directional sun light, plus a subtle screen
// -space lens flare when the sun is in view. All additive sprites — no bloom,
// no post-process pass, cheap to render.

const SUN_DISTANCE = 8000;          // far enough to sit beyond all terrain LODs
const FLARE_DOT_COUNT = 5;

function makeDiscTexture(opts: { core: number; falloff: number; tint: string }): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, `rgba(255,255,255,1)`);
  grad.addColorStop(opts.core, `rgba(255,250,235,1)`);
  grad.addColorStop(opts.falloff, opts.tint);
  grad.addColorStop(1, 'rgba(255,210,150,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class SkyEffects {
  group = new THREE.Group();
  private disc: THREE.Sprite;
  private halo: THREE.Sprite;
  private flareDots: THREE.Sprite[] = [];
  // Reused vectors so per-frame update doesn't allocate.
  private _sunDir = new THREE.Vector3();
  private _sunWorldPos = new THREE.Vector3();
  private _sunNDC = new THREE.Vector3();
  private _viewDir = new THREE.Vector3();

  constructor() {
    // Bright pinpoint disc — always rendered first, no depth write so the sky
    // shows behind it correctly.
    this.disc = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeDiscTexture({ core: 0.18, falloff: 0.55, tint: 'rgba(255,230,180,0.55)' }),
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    }));
    this.disc.renderOrder = 100;
    this.group.add(this.disc);

    // Soft warm halo behind the disc — wider and dimmer.
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeDiscTexture({ core: 0.05, falloff: 0.35, tint: 'rgba(255,180,120,0.20)' }),
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      opacity: 0.55,
    }));
    this.halo.renderOrder = 99;
    this.group.add(this.halo);

    // Lens flare — a string of small additive dots laid along the screen line
    // from sun to center. Colors stagger between warm and cool for variety.
    const flareTints = [
      'rgba(255,200,120,0.6)',
      'rgba(180,220,255,0.4)',
      'rgba(255,160,100,0.55)',
      'rgba(140,200,255,0.35)',
      'rgba(255,220,180,0.5)',
    ];
    const flareSizes = [70, 120, 50, 90, 60];
    for (let i = 0; i < FLARE_DOT_COUNT; i++) {
      const dot = new THREE.Sprite(new THREE.SpriteMaterial({
        map: makeDiscTexture({ core: 0.1, falloff: 0.5, tint: flareTints[i] }),
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        opacity: 0,
      }));
      dot.renderOrder = 98;
      dot.userData.size = flareSizes[i];
      // Spread along sun→screen-center axis: -0.4 (sun side) to 1.6 (past center)
      dot.userData.t = (i / (FLARE_DOT_COUNT - 1)) * 2 - 0.4;
      this.flareDots.push(dot);
      this.group.add(dot);
    }
  }

  // Call after sun.position is set this frame. Camera is needed to position
  // the disc relative to the camera and to compute the lens-flare screen line.
  update(sun: THREE.DirectionalLight, camera: THREE.Camera, sunIntensity: number) {
    // Direction TOWARD the sun in world space (sun is a directional light, so
    // its `position` is the direction the light comes FROM relative to origin).
    this._sunDir.copy(sun.position).normalize();

    // Sun is sub-horizon (or barely so) — hide everything.
    const aboveHorizon = this._sunDir.y > -0.05;
    const visible = aboveHorizon && sunIntensity > 0.05;
    this.disc.visible = visible;
    this.halo.visible = visible;
    if (!visible) {
      for (const d of this.flareDots) d.visible = false;
      return;
    }

    // Place disc + halo far from the camera along the sun direction.
    this._sunWorldPos.copy(camera.position).addScaledVector(this._sunDir, SUN_DISTANCE);
    this.disc.position.copy(this._sunWorldPos);
    this.halo.position.copy(this._sunWorldPos);

    // Disc grows slightly and dims as the sun gets low (atmospheric reddening).
    const horizonFactor = Math.max(0, Math.min(1, (this._sunDir.y - 0.05) / 0.4));
    const discScale = 250 + (1 - horizonFactor) * 180;
    const haloScale = 700 + (1 - horizonFactor) * 600;
    this.disc.scale.set(discScale, discScale, 1);
    this.halo.scale.set(haloScale, haloScale, 1);
    (this.disc.material as THREE.SpriteMaterial).opacity = 0.7 + 0.3 * horizonFactor;
    (this.halo.material as THREE.SpriteMaterial).opacity = 0.45 + 0.25 * (1 - horizonFactor);

    // ===== Lens flare: only when sun is on or near screen =====
    this._sunNDC.copy(this._sunWorldPos).project(camera);
    // Forward-facing? z in NDC means "ahead" if -1..1, but project gives w-divided
    // so we also check that the sun is in front of the camera plane:
    camera.getWorldDirection(this._viewDir);
    const sunRelative = this._sunWorldPos.clone().sub(camera.position).normalize();
    const facing = sunRelative.dot(this._viewDir);
    const sunOnScreen =
      facing > 0.2 &&
      this._sunNDC.x > -1.4 && this._sunNDC.x < 1.4 &&
      this._sunNDC.y > -1.4 && this._sunNDC.y < 1.4;

    if (!sunOnScreen) {
      for (const d of this.flareDots) d.visible = false;
      return;
    }

    // Fade flare in as sun approaches screen center.
    const distFromCenter = Math.hypot(this._sunNDC.x, this._sunNDC.y);
    const flareFade = Math.max(0, 1 - distFromCenter / 1.2) * Math.min(1, (facing - 0.2) / 0.3);

    // Distance from camera to disc — flare dots sit on the line from sun to
    // screen center, but we project them slightly closer so they read clearly.
    const flareDistance = SUN_DISTANCE * 0.95;
    const ndcCenter = new THREE.Vector3(0, 0, this._sunNDC.z);
    for (const d of this.flareDots) {
      const t = d.userData.t as number;
      // NDC position along the sun → center line.
      const nx = this._sunNDC.x * (1 - t) + ndcCenter.x * t;
      const ny = this._sunNDC.y * (1 - t) + ndcCenter.y * t;
      const ndc = new THREE.Vector3(nx, ny, this._sunNDC.z);
      ndc.unproject(camera);
      // Move the unprojected world point to a fixed distance from the camera
      // so the flare has a stable size on screen.
      const dir = ndc.sub(camera.position).normalize();
      d.position.copy(camera.position).addScaledVector(dir, flareDistance);
      const baseSize = d.userData.size as number;
      d.scale.set(baseSize, baseSize, 1);
      (d.material as THREE.SpriteMaterial).opacity = flareFade * 0.9;
      d.visible = flareFade > 0.02;
    }
  }
}
