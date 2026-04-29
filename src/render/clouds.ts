import * as THREE from 'three';

// Minecraft-style clouds: a single flat plane at high altitude, painted with
// crisp pixelated white blocks. NearestFilter keeps the pixel edges sharp so
// they read as deliberate blocks, not blurry sprites. The whole plane is
// world-fixed; texture UV slowly offsets to give the wind-drift look.

const CLOUD_BASE = 1800;        // m AGL — high cumulus base
const PLANE_SIZE = 16000;       // m² — fills the visible sky from cruise
const TEX_REPEAT = 6;           // tiling factor; each tile covers ~2.7 km

function makeMinecraftCloudTexture(): THREE.CanvasTexture {
  const SIZE = 256;
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const ctx = c.getContext('2d')!;

  // Transparent background.
  ctx.clearRect(0, 0, SIZE, SIZE);

  // Place blocky cloud blobs. Each cloud is a base rectangle plus a couple
  // of stepped extensions to get the chunky pixel-blob silhouette.
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  const blobCount = 22;
  for (let i = 0; i < blobCount; i++) {
    const cellW = 12 + Math.floor(Math.random() * 28);
    const cellH = 6 + Math.floor(Math.random() * 18);
    const cx = Math.floor(Math.random() * SIZE);
    const cy = Math.floor(Math.random() * SIZE);
    // Snap to multiples of 4 for that "voxel cells" look.
    const x = Math.floor(cx / 4) * 4;
    const y = Math.floor(cy / 4) * 4;
    const w = Math.floor(cellW / 4) * 4;
    const h = Math.floor(cellH / 4) * 4;
    ctx.fillRect(x, y, w, h);
    // Stepped bumps top/bottom for irregular silhouette.
    if (Math.random() > 0.3) ctx.fillRect(x + 4, y - 4, w - 8, 4);
    if (Math.random() > 0.3) ctx.fillRect(x + 4, y + h, w - 8, 4);
    if (Math.random() > 0.5) ctx.fillRect(x - 4, y + 4, 4, h - 8);
    if (Math.random() > 0.5) ctx.fillRect(x + w, y + 4, 4, h - 8);
  }

  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(TEX_REPEAT, TEX_REPEAT);
  // Crisp pixel edges, no smoothing — this is the whole point.
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class CloudLayer {
  group = new THREE.Group();
  private mesh: THREE.Mesh;
  private mat: THREE.MeshBasicMaterial;

  constructor() {
    this.mat = new THREE.MeshBasicMaterial({
      map: makeMinecraftCloudTexture(),
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const geo = new THREE.PlaneGeometry(PLANE_SIZE, PLANE_SIZE);
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.rotation.x = -Math.PI / 2;       // horizontal
    this.mesh.renderOrder = -5;
    this.group.add(this.mesh);
  }

  // Mesh follows the player horizontally so the field appears infinite.
  // Texture UV scrolls in the wind direction = clouds drift.
  update(viewerPos: THREE.Vector3, t: number, windX = 0, windZ = 0) {
    void t;
    this.mesh.position.set(viewerPos.x, CLOUD_BASE, viewerPos.z);
    // Convert wind speed (m/s) to UV offset units. PLANE_SIZE / TEX_REPEAT m
    // per tile. windX m/s × dt-ish factor makes the drift look natural.
    const map = this.mat.map!;
    const tileMeters = PLANE_SIZE / TEX_REPEAT;
    map.offset.x -= (windX / tileMeters) * 0.016;     // ~per-frame approximation
    map.offset.y -= (windZ / tileMeters) * 0.016;
    // Fade out when the player is right at the layer altitude so they aren't
    // staring at a wall of opaque white.
    const dy = Math.abs(viewerPos.y - CLOUD_BASE);
    const close = Math.max(0, 1 - dy / 80);
    this.mat.opacity = 1 - close * 0.9;
  }
}
