import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Hand-modeled building prototypes for the city.
//
// 30 distinct silhouettes split across four categories:
//   downtown — 8 towers / mid-rises (glass, concrete, brick, hotel, bank…)
//   midrise  — 10 commercial / civic (brownstones, mixed-use, church, school,
//              strip mall, gas station, parking garage, restaurant, civic, apartment)
//   house    — 8 detached single-family homes (ranch, colonial, cape,
//              split-level, mcmansion, bungalow, townhouse end, modern)
//   rural    — 4 farm / barn / mobile home archetypes
//
// Each prototype is built once into a single merged BufferGeometry with vertex
// colors. The city renderer then uses one InstancedMesh per prototype, so 30
// distinct buildings cost 30 draw calls regardless of placement count.
//
// Conventions:
//   - Origin (0, 0, 0) sits at the building's base center.
//   - +Y is up; the building extends upward from y=0.
//   - "Front" faces +Z so the placement code can rotateY to face the road.

export type BuildingCategory = 'downtown' | 'midrise' | 'house' | 'rural' | 'suburban_commercial';

export interface BuildingPrototype {
  id: string;
  category: BuildingCategory;
  width: number;       // bounding footprint X (after rotation)
  depth: number;       // bounding footprint Z
  height: number;      // bounding height for collision
  geometry: THREE.BufferGeometry;
}

// ===== Color palette =====
const C = {
  glassBlue:    0x6c8aa6,
  glassDark:    0x4a5e76,
  glassGreen:   0x6a8c8a,
  windowGlow:   0xfde58a,
  windowDay:    0xa6c8e0,
  windowDark:   0x2a3a4a,
  brickRed:     0x9c5238,
  brickDark:    0x6e3826,
  brickTan:     0xc8997a,
  concrete:     0xb6b6b8,
  concreteDark: 0x8a8a8c,
  whitePaint:   0xeeeae0,
  blueGray:     0xa0b8d0,
  yellow:       0xd8c068,
  pastelMint:   0xb6d6c0,
  pastelPeach:  0xe6cab0,
  pastelBlue:   0xb6c8e0,
  woodLight:    0xc6a878,
  woodDark:     0x6e4a30,
  roofRed:      0x6a3020,
  roofGray:     0x4a4438,
  roofBlue:     0x2a3a52,
  roofGreen:    0x3a4830,
  asphalt:      0x282828,
  black:        0x18181c,
  steel:        0x6a6e74,
  silver:       0xd4d4dc,
  gold:         0xc8a838,
  signRed:      0xc02828,
  signYellow:   0xfae840,
  signGreen:    0x3a8a4a,
  awning:       0x6a3838,
  door:         0x2a1e16,
  doorBlue:     0x2a4870,
  doorGreen:    0x2a4a32,
  silver2:      0xb4b4bc,
  barnRed:      0xa83020,
  barnRoof:     0x2a2618,
  silo:         0xc4b890,
  // Muted pastel American suburb palette — softer, washed-out variants.
  pastelSage:   0xc4d2b8,
  pastelButter: 0xeadeae,
  pastelTaupe:  0xc8b8a4,
  pastelDustyBlue: 0xb0c0c8,
  pastelClay:   0xc8a890,
  pastelSky:    0xc8d8e0,
  pastelLilac:  0xc4bbcc,
  pastelOlive:  0xb8b8a0,
  // Suburban commercial bold colors
  bigBoxBlue:   0x2e88a0,
  bigBoxRed:    0xc23a2a,
  bigBoxGreen:  0x4a8a3a,
  fastFoodRed:  0xd02828,
  fastFoodYellow: 0xfae040,
  storageDoor:  0xe0852a,
  // Building accent colors
  tudorBeam:    0x3a2818,
  tudorCream:   0xf0e6c8,
  spanishTile:  0xc04a2a,
  spanishStucco:0xeae0c0,
  midcenturyTeal: 0x4a8088,
  victorianPurple: 0xa888a8,
  victorianTrim:0xeae0d0,
  craftsmanBrown: 0x886044,
  craftsmanGreen: 0x506a4a,
  modernGray:   0x4a4a4e,
  modernWhite:  0xf2eee8,
};

// ===== Geometry helpers =====
function box(
  x: number, y: number, z: number,
  w: number, h: number, d: number,
  color: number,
): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.translate(x, y + h / 2, z);
  const c = new THREE.Color(color);
  const colors = new Float32Array(geo.attributes.position.count * 3);
  for (let i = 0; i < colors.length; i += 3) {
    colors[i] = c.r;
    colors[i + 1] = c.g;
    colors[i + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  // Drop the texture-coord attribute since it bloats the merged geometry and
  // we don't use textures.
  geo.deleteAttribute('uv');
  return geo;
}

function combine(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error('mergeGeometries returned null');
  return merged;
}

// Add vertical window stripes on all 4 faces of a tower body. Each face gets
// `cols` stripes evenly distributed.
function addWindowStripes(
  parts: THREE.BufferGeometry[],
  w: number, d: number, h: number,
  cols: number,
  bottomMargin: number,
  topMargin: number,
  stripeWidth: number,
  color: number,
) {
  const stripeH = h - bottomMargin - topMargin;
  const yBase = bottomMargin;
  for (let face = 0; face < 4; face++) {
    for (let i = 0; i < cols; i++) {
      const t = (i + 0.5) / cols;
      let x = 0, z = 0, cw = stripeWidth, cd = stripeWidth;
      if (face === 0) {
        x = (t - 0.5) * (w * 0.84); z = d / 2 + 0.05;
        cw = stripeWidth; cd = 0.18;
      } else if (face === 1) {
        x = w / 2 + 0.05; z = (t - 0.5) * (d * 0.84);
        cw = 0.18; cd = stripeWidth;
      } else if (face === 2) {
        x = (t - 0.5) * (w * 0.84); z = -d / 2 - 0.05;
        cw = stripeWidth; cd = 0.18;
      } else {
        x = -w / 2 - 0.05; z = (t - 0.5) * (d * 0.84);
        cw = 0.18; cd = stripeWidth;
      }
      parts.push(box(x, yBase, z, cw, stripeH, cd, color));
    }
  }
}

// Add a horizontal grid of small windows (for brick/concrete buildings, where
// windows are punched holes rather than continuous stripes).
function addWindowGrid(
  parts: THREE.BufferGeometry[],
  w: number, d: number, h: number,
  rows: number, cols: number,
  winColor: number,
) {
  const winW = 1.0;
  const winH = 1.2;
  const yMargin = 1.5;
  const usableH = h - yMargin * 2;
  const rowSpace = usableH / rows;
  const colSpaceW = w * 0.86 / cols;
  const colSpaceD = d * 0.86 / cols;
  for (let r = 0; r < rows; r++) {
    const y = yMargin + r * rowSpace + (rowSpace - winH) / 2;
    for (let c = 0; c < cols; c++) {
      const xT = (c + 0.5) / cols;
      const xOff = (xT - 0.5) * (w * 0.86);
      const zOff = (xT - 0.5) * (d * 0.86);
      // +Z and -Z faces
      parts.push(box(xOff, y, d / 2 + 0.05, winW, winH, 0.12, winColor));
      parts.push(box(xOff, y, -d / 2 - 0.05, winW, winH, 0.12, winColor));
      // +X and -X faces
      parts.push(box(w / 2 + 0.05, y, zOff, 0.12, winH, winW, winColor));
      parts.push(box(-w / 2 - 0.05, y, zOff, 0.12, winH, winW, winColor));
    }
  }
  void colSpaceW; void colSpaceD;
}

// Stepped peaked roof (voxel-style "stepped pyramid"). Cheaper than rotated
// slabs and reads correctly from the air. Long axis = depth.
function addPeakedRoof(
  parts: THREE.BufferGeometry[],
  baseY: number, w: number, d: number,
  color: number,
  peakHeight = 1.6,
) {
  const steps = 3;
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    const t2 = (i + 1) / steps;
    const sw = w * (1.05 - t * 0.6);
    const stepY = baseY + (peakHeight / steps) * i;
    parts.push(box(0, stepY, 0, sw, peakHeight / steps, d * 1.02, color));
    void t2;
  }
}

// Wide angular roof for civic / pre-war style — stepped four sides, peaked center.
function addPyramidRoof(
  parts: THREE.BufferGeometry[],
  baseY: number, w: number, d: number,
  color: number,
  peakHeight = 2.0,
) {
  const steps = 4;
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    const sw = w * (1.05 - t * 0.85);
    const sd = d * (1.05 - t * 0.85);
    const stepY = baseY + (peakHeight / steps) * i;
    parts.push(box(0, stepY, 0, sw, peakHeight / steps, sd, color));
  }
}

// Simple flat parapet roof.
function addFlatRoof(
  parts: THREE.BufferGeometry[],
  baseY: number, w: number, d: number,
  color: number,
) {
  parts.push(box(0, baseY, 0, w * 1.02, 0.5, d * 1.02, color));
}


// ===== Prototype builders =====

function p_glass_tower_a(): BuildingPrototype {
  const w = 22, d = 22, h = 38;
  const parts: THREE.BufferGeometry[] = [];
  parts.push(box(0, 0, 0, w, h, d, C.glassBlue));
  addWindowStripes(parts, w, d, h, 5, 2.5, 2.5, 1.6, C.windowGlow);
  addFlatRoof(parts, h, w, d, C.glassDark);
  parts.push(box(0, h + 0.5, 0, w * 0.4, 1.6, d * 0.4, C.glassDark));
  return { id: 'glass_tower_a', category: 'downtown', width: w, depth: d, height: h + 2, geometry: combine(parts) };
}

function p_glass_tower_setback(): BuildingPrototype {
  const w = 26, d = 26, h = 24;
  const tw = 18, td = 18, th = 18;
  const parts: THREE.BufferGeometry[] = [];
  parts.push(box(0, 0, 0, w, h, d, C.glassBlue));
  addWindowStripes(parts, w, d, h, 6, 2, 2, 1.6, C.windowGlow);
  parts.push(box(0, h, 0, w * 1.02, 0.4, d * 1.02, C.glassDark));
  parts.push(box(0, h + 0.4, 0, tw, th, td, C.glassBlue));
  addWindowStripes(parts, tw, td, th, 4, 1.5, 1.5, 1.4, C.windowGlow);
  parts.push(box(0, h + 0.4 + th, 0, tw * 0.4, 1.6, td * 0.4, C.glassDark));
  return { id: 'glass_tower_setback', category: 'downtown', width: w, depth: d, height: h + th + 3, geometry: combine(parts) };
}

function p_concrete_office(): BuildingPrototype {
  const w = 20, d = 18, h = 22;
  const parts: THREE.BufferGeometry[] = [];
  parts.push(box(0, 0, 0, w, h, d, C.concrete));
  addWindowGrid(parts, w, d, h, 5, 4, C.windowDay);
  addFlatRoof(parts, h, w, d, C.concreteDark);
  // Concrete fins on the front for a brutalist accent.
  for (const sx of [-0.7, -0.23, 0.23, 0.7]) {
    parts.push(box(sx * w * 0.5, 0, d / 2 + 0.4, 0.7, h, 0.7, C.concreteDark));
  }
  return { id: 'concrete_office', category: 'downtown', width: w, depth: d, height: h + 1, geometry: combine(parts) };
}

function p_brick_office(): BuildingPrototype {
  const w = 18, d = 18, h = 19;
  const parts: THREE.BufferGeometry[] = [];
  parts.push(box(0, 0, 0, w, h, d, C.brickRed));
  // Stone-trim base.
  parts.push(box(0, 0, 0, w * 1.04, 1.5, d * 1.04, C.concreteDark));
  addWindowGrid(parts, w, d, h, 4, 3, C.windowDay);
  // Cornice at the top.
  parts.push(box(0, h - 0.6, 0, w * 1.06, 0.6, d * 1.06, C.concreteDark));
  addFlatRoof(parts, h, w, d, C.brickDark);
  return { id: 'brick_office', category: 'downtown', width: w, depth: d, height: h + 1, geometry: combine(parts) };
}

function p_bank_columns(): BuildingPrototype {
  const w = 22, d = 16, h = 13;
  const parts: THREE.BufferGeometry[] = [];
  parts.push(box(0, 0, 0, w, h, d, C.whitePaint));
  // Six columns across the front.
  for (let i = 0; i < 6; i++) {
    const t = (i + 0.5) / 6;
    const x = (t - 0.5) * (w * 0.85);
    parts.push(box(x, 0, d / 2 + 0.4, 1.0, h - 1.5, 1.0, C.whitePaint));
  }
  // Architrave above the columns.
  parts.push(box(0, h - 1.5, d / 2 + 0.6, w * 0.95, 1.0, 1.4, C.whitePaint));
  // Steps.
  for (let i = 0; i < 3; i++) {
    parts.push(box(0, -0.4 - i * 0.3, d / 2 + 1.4 + i * 0.6, w * 0.7, 0.3, 0.6, C.concrete));
  }
  // Pediment triangle (stepped).
  parts.push(box(0, h, 0, w * 0.7, 0.6, d * 1.05, C.whitePaint));
  parts.push(box(0, h + 0.6, 0, w * 0.4, 0.6, d * 1.05, C.whitePaint));
  parts.push(box(0, h + 1.2, 0, w * 0.2, 0.4, d * 1.05, C.whitePaint));
  // Subtle gold roof cap.
  parts.push(box(0, h + 1.6, 0, w * 0.1, 0.4, d * 0.4, C.gold));
  return { id: 'bank_columns', category: 'downtown', width: w, depth: d, height: h + 2.5, geometry: combine(parts) };
}

function p_hotel_tower(): BuildingPrototype {
  const w = 18, d = 14, h = 32;
  const parts: THREE.BufferGeometry[] = [];
  parts.push(box(0, 0, 0, w, h, d, C.brickTan));
  addWindowStripes(parts, w, d, h, 7, 3, 1.5, 1.0, C.windowGlow);
  // Sign on roof.
  parts.push(box(0, h, 0, w * 1.02, 0.5, d * 1.02, C.concreteDark));
  parts.push(box(0, h + 0.5, 0, 6, 1.4, 0.3, C.signRed));
  return { id: 'hotel_tower', category: 'downtown', width: w, depth: d, height: h + 2, geometry: combine(parts) };
}

function p_modernist_tower(): BuildingPrototype {
  const w = 16, d = 16, h = 30;
  const parts: THREE.BufferGeometry[] = [];
  parts.push(box(0, 0, 0, w, h, d, C.glassDark));
  addWindowStripes(parts, w, d, h, 4, 1.5, 1.5, 2.0, C.windowDay);
  addFlatRoof(parts, h, w, d, C.black);
  // Antenna mast on top.
  parts.push(box(0, h + 0.5, 0, 0.4, 7, 0.4, C.steel));
  parts.push(box(0, h + 7, 0, 1, 1, 1, C.signRed));
  return { id: 'modernist_tower', category: 'downtown', width: w, depth: d, height: h + 8, geometry: combine(parts) };
}

function p_apartment_tower(): BuildingPrototype {
  const w = 16, d = 20, h = 28;
  const parts: THREE.BufferGeometry[] = [];
  parts.push(box(0, 0, 0, w, h, d, C.brickTan));
  addWindowGrid(parts, w, d, h, 8, 3, C.windowDay);
  // Balcony slabs running along front and back.
  for (let lvl = 1; lvl < 8; lvl++) {
    const y = (lvl / 8) * h - 0.2;
    parts.push(box(0, y, d / 2 + 0.4, w * 0.9, 0.2, 1.0, C.concrete));
    parts.push(box(0, y, -d / 2 - 0.4, w * 0.9, 0.2, 1.0, C.concrete));
  }
  addFlatRoof(parts, h, w, d, C.brickDark);
  return { id: 'apartment_tower', category: 'downtown', width: w, depth: d, height: h + 1, geometry: combine(parts) };
}

function p_brownstone_row(): BuildingPrototype {
  const w = 24, d = 12, h = 9.5;
  const parts: THREE.BufferGeometry[] = [];
  parts.push(box(0, 0, 0, w, h, d, C.brickRed));
  // 4 stoops + doors along the front face.
  for (let i = 0; i < 4; i++) {
    const t = (i + 0.5) / 4;
    const x = (t - 0.5) * w;
    // Stoop steps
    parts.push(box(x, 0, d / 2 + 0.7, 1.4, 0.6, 1.2, C.concrete));
    parts.push(box(x, 0.6, d / 2 + 0.4, 1.4, 0.6, 0.6, C.concrete));
    // Door
    parts.push(box(x, 1.2, d / 2 + 0.05, 1.0, 2.2, 0.12, C.doorBlue));
    // Window above each door
    parts.push(box(x, 4.5, d / 2 + 0.05, 1.2, 1.2, 0.12, C.windowDay));
    parts.push(box(x, 7.0, d / 2 + 0.05, 1.2, 1.2, 0.12, C.windowDay));
  }
  // Cornice
  parts.push(box(0, h - 0.4, 0, w * 1.04, 0.4, d * 1.04, C.brickDark));
  addFlatRoof(parts, h, w, d, C.brickDark);
  return { id: 'brownstone_row', category: 'midrise', width: w, depth: d, height: h + 0.5, geometry: combine(parts) };
}

function p_mixed_use_4(): BuildingPrototype {
  const w = 16, d = 14, h = 14;
  const parts: THREE.BufferGeometry[] = [];
  parts.push(box(0, 0, 0, w, h, d, C.brickTan));
  // Glass shopfront on the bottom level (front + sides for ~3.5 m).
  parts.push(box(0, 0, d / 2 + 0.05, w * 0.92, 3.5, 0.18, C.windowDay));
  // Shop awning
  parts.push(box(0, 3.7, d / 2 + 0.7, w * 0.95, 0.25, 1.0, C.awning));
  // Apartment windows above
  addWindowGrid(parts, w, d, h, 3, 3, C.windowDay);
  addFlatRoof(parts, h, w, d, C.brickDark);
  return { id: 'mixed_use_4', category: 'midrise', width: w, depth: d, height: h + 0.5, geometry: combine(parts) };
}

function p_apartment_block(): BuildingPrototype {
  const w = 22, d = 14, h = 16;
  const parts: THREE.BufferGeometry[] = [];
  parts.push(box(0, 0, 0, w, h, d, C.concrete));
  addWindowGrid(parts, w, d, h, 5, 4, C.windowDay);
  // Rooftop A/C units.
  for (const sx of [-1, 1]) {
    parts.push(box(sx * 5, h, sx * 2, 2.5, 1.0, 2.5, C.concreteDark));
  }
  addFlatRoof(parts, h, w, d, C.concreteDark);
  return { id: 'apartment_block', category: 'midrise', width: w, depth: d, height: h + 1, geometry: combine(parts) };
}

function p_church(): BuildingPrototype {
  const w = 12, d = 22, h = 8;
  const parts: THREE.BufferGeometry[] = [];
  // Nave
  parts.push(box(0, 0, 0, w, h, d, C.whitePaint));
  // Stained-glass-ish windows along the long sides.
  for (let i = 0; i < 4; i++) {
    const z = (i / 4 - 0.375) * d;
    parts.push(box(w / 2 + 0.05, 2.5, z, 0.12, 3, 1.4, C.signRed));
    parts.push(box(-w / 2 - 0.05, 2.5, z, 0.12, 3, 1.4, C.signRed));
  }
  // Pitched roof
  addPeakedRoof(parts, h, w, d, C.roofGray, 3.0);
  // Bell tower in front
  parts.push(box(0, 0, d / 2 + 2, 4, h + 6, 4, C.whitePaint));
  parts.push(box(0, h + 6, d / 2 + 2, 4 * 1.05, 0.5, 4 * 1.05, C.whitePaint));
  // Spire
  parts.push(box(0, h + 6.5, d / 2 + 2, 3, 1.5, 3, C.roofRed));
  parts.push(box(0, h + 8, d / 2 + 2, 1.8, 1.5, 1.8, C.roofRed));
  parts.push(box(0, h + 9.5, d / 2 + 2, 0.8, 1.2, 0.8, C.roofRed));
  // Cross
  parts.push(box(0, h + 11, d / 2 + 2, 0.15, 1.4, 0.15, C.gold));
  parts.push(box(0, h + 11.7, d / 2 + 2, 0.6, 0.15, 0.15, C.gold));
  // Door
  parts.push(box(0, 0, d / 2 + 4, 1.6, 3, 0.12, C.doorGreen));
  return { id: 'church', category: 'midrise', width: w + 4, depth: d + 4, height: h + 12, geometry: combine(parts) };
}

function p_school(): BuildingPrototype {
  const w = 30, d = 14, h = 8;
  const parts: THREE.BufferGeometry[] = [];
  // Long main wing
  parts.push(box(0, 0, 0, w, h, d, C.brickRed));
  addWindowGrid(parts, w, d, h, 2, 8, C.windowDay);
  // Perpendicular gymnasium wing
  parts.push(box(-w / 2 + 4, 0, -d / 2 - 5, 12, h + 2, 14, C.brickRed));
  // Front entry portico
  parts.push(box(0, 0, d / 2 + 2, 6, 4, 2, C.whitePaint));
  parts.push(box(0, 4, d / 2 + 2, 6, 0.4, 2, C.brickDark));
  parts.push(box(0, 0, d / 2 + 2.5, 1.6, 3, 0.12, C.doorBlue));
  addFlatRoof(parts, h, w, d, C.brickDark);
  // Flagpole
  parts.push(box(w / 2 + 3, 0, d / 2 + 2, 0.2, 12, 0.2, C.silver));
  parts.push(box(w / 2 + 3, 11, d / 2 + 2.4, 0.2, 1.4, 0.7, C.signRed));
  return { id: 'school', category: 'midrise', width: w, depth: d + 14, height: h + 2, geometry: combine(parts) };
}

function p_strip_mall(): BuildingPrototype {
  const w = 32, d = 14, h = 5;
  const parts: THREE.BufferGeometry[] = [];
  parts.push(box(0, 0, 0, w, h, d, C.brickTan));
  // Continuous glass shopfront on the long side.
  parts.push(box(0, 0.4, d / 2 + 0.05, w * 0.94, 3, 0.18, C.windowDay));
  // Sign band above the shopfront.
  parts.push(box(0, 3.6, d / 2 + 0.4, w * 0.94, 1.4, 0.4, C.signRed));
  // Frame splits into shop slots
  for (let i = 1; i < 5; i++) {
    const x = (i - 2.5) * (w / 5);
    parts.push(box(x, 0, d / 2 + 0.06, 0.25, h, 0.2, C.brickDark));
  }
  // Awning
  parts.push(box(0, 4.0, d / 2 + 1.4, w * 0.94, 0.2, 1.4, C.awning));
  addFlatRoof(parts, h, w, d, C.concreteDark);
  return { id: 'strip_mall', category: 'midrise', width: w, depth: d, height: h + 0.5, geometry: combine(parts) };
}

function p_gas_station(): BuildingPrototype {
  const w = 14, d = 10, h = 4;
  const parts: THREE.BufferGeometry[] = [];
  // Convenience-store box
  parts.push(box(0, 0, -2, w, h, d, C.whitePaint));
  parts.push(box(0, 0.5, -2 + d / 2 + 0.05, w * 0.85, 2.6, 0.18, C.windowDay));
  // Sign above store
  parts.push(box(0, h, -2, w * 0.95, 1.0, d * 0.95, C.signRed));
  // Pump canopy
  parts.push(box(0, 4.6, 6, 14, 0.6, 8, C.whitePaint));
  for (const sx of [-1, 1]) for (const sz of [0, 1]) {
    parts.push(box(sx * 6, 0, 4 + sz * 4, 0.4, 4.6, 0.4, C.steel));
  }
  // Pumps
  for (const sx of [-2, 2]) {
    parts.push(box(sx, 0, 6, 1.0, 1.8, 0.6, C.signRed));
  }
  // Big pole sign on the corner.
  parts.push(box(w / 2 + 3, 0, 5, 0.6, 8, 0.6, C.steel));
  parts.push(box(w / 2 + 3, 8, 5, 2.5, 2.5, 0.4, C.signYellow));
  return { id: 'gas_station', category: 'midrise', width: w + 6, depth: d + 12, height: 11, geometry: combine(parts) };
}

function p_parking_garage(): BuildingPrototype {
  const w = 22, d = 18, h = 18;
  const parts: THREE.BufferGeometry[] = [];
  // Concrete frame — open levels, just slabs and columns.
  for (let i = 0; i < 6; i++) {
    const y = i * 3;
    parts.push(box(0, y, 0, w, 0.4, d, C.concrete));
  }
  // Corner columns
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    parts.push(box(sx * (w / 2 - 0.5), 0, sz * (d / 2 - 0.5), 0.8, h, 0.8, C.concrete));
  }
  // Side rails (low concrete walls suggesting parked cars on each level)
  for (let i = 0; i < 6; i++) {
    const y = i * 3;
    for (const sz of [-1, 1]) {
      parts.push(box(0, y + 0.4, sz * d / 2, w, 0.6, 0.3, C.concrete));
    }
  }
  // Top deck
  parts.push(box(0, h, 0, w * 1.02, 0.6, d * 1.02, C.concreteDark));
  return { id: 'parking_garage', category: 'midrise', width: w, depth: d, height: h + 1, geometry: combine(parts) };
}

function p_restaurant(): BuildingPrototype {
  const w = 12, d = 12, h = 5;
  const parts: THREE.BufferGeometry[] = [];
  parts.push(box(0, 0, 0, w, h, d, C.whitePaint));
  // Glass front
  parts.push(box(0, 0.4, d / 2 + 0.05, w * 0.85, 2.8, 0.18, C.windowDay));
  // Awning
  parts.push(box(0, 3.4, d / 2 + 0.7, w * 0.9, 0.2, 1.2, C.signRed));
  // Sign on roof
  parts.push(box(0, h, 0, 6, 1.2, 0.4, C.signYellow));
  addFlatRoof(parts, h, w, d, C.concreteDark);
  return { id: 'restaurant', category: 'midrise', width: w, depth: d, height: h + 1.4, geometry: combine(parts) };
}

function p_civic_columns(): BuildingPrototype {
  const w = 24, d = 16, h = 12;
  const parts: THREE.BufferGeometry[] = [];
  parts.push(box(0, 0, 0, w, h, d, C.concrete));
  // Front portico with 8 columns
  parts.push(box(0, 0, d / 2 + 0.6, w * 0.94, 0.6, 1.2, C.concrete));
  for (let i = 0; i < 8; i++) {
    const t = (i + 0.5) / 8;
    const x = (t - 0.5) * w * 0.85;
    parts.push(box(x, 0.6, d / 2 + 0.6, 0.7, h - 2.2, 0.7, C.whitePaint));
  }
  parts.push(box(0, h - 1.6, d / 2 + 0.6, w * 0.95, 1.0, 1.2, C.concrete));
  // Stepped pediment
  parts.push(box(0, h - 0.6, d / 2 + 0.6, w * 0.95, 0.6, 1.2, C.whitePaint));
  parts.push(box(0, h, d / 2 + 0.6, w * 0.6, 0.6, 1.2, C.whitePaint));
  // Dome above main building
  addPyramidRoof(parts, h, w * 0.4, d * 0.6, C.gold, 3.5);
  return { id: 'civic_columns', category: 'midrise', width: w, depth: d + 2, height: h + 4, geometry: combine(parts) };
}

function p_warehouse(): BuildingPrototype {
  const w = 26, d = 18, h = 8;
  const parts: THREE.BufferGeometry[] = [];
  parts.push(box(0, 0, 0, w, h, d, C.concreteDark));
  // Roll-up door on the front
  parts.push(box(-3, 0, d / 2 + 0.05, 4, 4, 0.18, C.concrete));
  parts.push(box(3, 0, d / 2 + 0.05, 4, 4, 0.18, C.concrete));
  // Loading dock platform
  parts.push(box(0, 0, d / 2 + 1.5, w * 0.5, 1.2, 1.4, C.concreteDark));
  // Small windows up high
  for (let i = 0; i < 5; i++) {
    const x = (i / 5 - 0.4) * w;
    parts.push(box(x, h - 1.5, d / 2 + 0.05, 1.4, 0.8, 0.12, C.windowDay));
  }
  // Sawtooth roof simulation
  for (let i = 0; i < 4; i++) {
    const x = (i - 1.5) * (w / 4);
    parts.push(box(x, h, 0, w / 4 - 0.4, 0.8, d, C.concreteDark));
  }
  return { id: 'warehouse', category: 'midrise', width: w, depth: d, height: h + 1, geometry: combine(parts) };
}

// ===== Houses (suburb) =====

function houseBody(
  parts: THREE.BufferGeometry[],
  w: number, d: number, h: number,
  body: number,
) {
  parts.push(box(0, 0, 0, w, h, d, body));
  // Foundation strip
  parts.push(box(0, 0, 0, w * 1.04, 0.5, d * 1.04, C.concrete));
}

function houseWindows(
  parts: THREE.BufferGeometry[],
  w: number, d: number,
  yMid: number,
  count: number,
) {
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    const x = (t - 0.5) * w * 0.78;
    parts.push(box(x, yMid, d / 2 + 0.05, 1.0, 1.0, 0.12, C.windowDay));
    parts.push(box(x, yMid, -d / 2 - 0.05, 1.0, 1.0, 0.12, C.windowDay));
  }
  for (let i = 0; i < Math.max(1, Math.floor(count / 2)); i++) {
    const t = (i + 0.5) / Math.max(1, Math.floor(count / 2));
    const z = (t - 0.5) * d * 0.78;
    parts.push(box(w / 2 + 0.05, yMid, z, 0.12, 1.0, 1.0, C.windowDay));
    parts.push(box(-w / 2 - 0.05, yMid, z, 0.12, 1.0, 1.0, C.windowDay));
  }
}

function p_ranch(): BuildingPrototype {
  const w = 14, d = 9, h = 3.2;
  const parts: THREE.BufferGeometry[] = [];
  houseBody(parts, w, d, h, C.pastelMint);
  houseWindows(parts, w, d, 1.6, 3);
  // Door
  parts.push(box(-2, 0, d / 2 + 0.05, 1.0, 2.0, 0.12, C.door));
  // Attached garage
  parts.push(box(w / 2 + 3, 0, 0, 6, h - 0.2, d * 0.85, C.pastelMint));
  parts.push(box(w / 2 + 3, 0, d / 2 * 0.85 + 0.05, 4, 2.2, 0.15, C.concreteDark));
  // Driveway
  parts.push(box(w / 2 + 3, 0, d / 2 + 1.5, 5, 0.05, 3, C.asphalt));
  // Roof — low pitch peaked, ridge along width
  addLowRidgeRoof(parts, h, w, d, C.roofGray, 1.3);
  // Garage roof
  addLowRidgeRoof(parts, h - 0.2, 6, d * 0.85, C.roofGray, 1.0, w / 2 + 3, 0);
  return { id: 'house_ranch', category: 'house', width: w + 6, depth: d, height: h + 1.5, geometry: combine(parts) };
}

// Long ridge along the width axis (slope drops toward +Z and -Z).
function addLowRidgeRoof(
  parts: THREE.BufferGeometry[],
  baseY: number, w: number, d: number,
  color: number,
  peakHeight = 1.3,
  cx = 0, cz = 0,
) {
  const steps = 3;
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    const sd = d * (1.05 - t * 0.8);
    parts.push(box(cx, baseY + (peakHeight / steps) * i, cz, w * 1.04, peakHeight / steps, sd, color));
  }
}

function p_colonial(): BuildingPrototype {
  const w = 12, d = 10, h = 6.5;
  const parts: THREE.BufferGeometry[] = [];
  houseBody(parts, w, d, h, C.whitePaint);
  // Symmetric windows two floors
  for (const y of [1.6, 4.4]) {
    houseWindows(parts, w, d, y, 4);
  }
  parts.push(box(0, 0, d / 2 + 0.05, 1.2, 2.4, 0.12, C.doorBlue));
  // Two black shutters per window (decorative)
  for (const y of [1.6, 4.4]) {
    for (let i = 0; i < 4; i++) {
      const t = (i + 0.5) / 4;
      const x = (t - 0.5) * w * 0.78;
      parts.push(box(x - 0.65, y, d / 2 + 0.06, 0.25, 1.1, 0.04, C.black));
      parts.push(box(x + 0.65, y, d / 2 + 0.06, 0.25, 1.1, 0.04, C.black));
    }
  }
  // Steep peaked roof, ridge along width
  addLowRidgeRoof(parts, h, w, d, C.roofGray, 2.4);
  // Brick chimney
  parts.push(box(w / 2 - 1, h + 1, -d / 2 + 1.5, 0.8, 3, 0.8, C.brickRed));
  return { id: 'house_colonial', category: 'house', width: w, depth: d, height: h + 2.5, geometry: combine(parts) };
}

function p_cape_cod(): BuildingPrototype {
  const w = 11, d = 9, h = 3.5;
  const parts: THREE.BufferGeometry[] = [];
  houseBody(parts, w, d, h, C.whitePaint);
  houseWindows(parts, w, d, 1.6, 3);
  parts.push(box(0, 0, d / 2 + 0.05, 1.0, 2.0, 0.12, C.door));
  // Steep roof
  addLowRidgeRoof(parts, h, w, d, C.roofRed, 3.0);
  // Two dormers on the front
  for (const sx of [-1, 1]) {
    parts.push(box(sx * 2.8, h + 1.0, d / 2 - 0.5, 1.6, 1.6, 1.6, C.whitePaint));
    parts.push(box(sx * 2.8, h + 1.6, d / 2 - 0.5, 2.0, 0.6, 2.0, C.roofRed));
    parts.push(box(sx * 2.8, h + 1.4, d / 2 + 0.3, 0.8, 0.8, 0.05, C.windowDay));
  }
  return { id: 'house_cape', category: 'house', width: w, depth: d, height: h + 3.5, geometry: combine(parts) };
}

function p_split_level(): BuildingPrototype {
  const wL = 8, dL = 8, hL = 3.0;
  const wH = 8, dH = 8, hH = 5.5;
  const parts: THREE.BufferGeometry[] = [];
  // Lower wing
  parts.push(box(-5, 0, 0, wL, hL, dL, C.pastelPeach));
  houseWindows(parts, wL * 0.8, dL, 1.4, 1);
  // Higher wing
  parts.push(box(5, 0, 0, wH, hH, dH, C.pastelPeach));
  parts.push(box(5, 0, dH / 2 + 0.05, 1.0, 2.0, 0.12, C.door));
  parts.push(box(5, 1.6, dH / 2 + 0.05, 1.2, 1.2, 0.12, C.windowDay));
  parts.push(box(5, 4.0, dH / 2 + 0.05, 1.2, 1.2, 0.12, C.windowDay));
  // Roofs
  addLowRidgeRoof(parts, hL, wL, dL, C.roofRed, 1.4, -5, 0);
  addLowRidgeRoof(parts, hH, wH, dH, C.roofRed, 2.0, 5, 0);
  return { id: 'house_split', category: 'house', width: wL + wH + 2, depth: dH, height: hH + 2.5, geometry: combine(parts) };
}

function p_two_story(): BuildingPrototype {
  const w = 12, d = 10, h = 6.0;
  const parts: THREE.BufferGeometry[] = [];
  houseBody(parts, w, d, h, C.pastelBlue);
  for (const y of [1.5, 4.2]) {
    houseWindows(parts, w, d, y, 3);
  }
  parts.push(box(-2, 0, d / 2 + 0.05, 1.0, 2.0, 0.12, C.door));
  // 2-car garage attached
  parts.push(box(w / 2 + 3.5, 0, 0, 7, 3.0, d * 0.85, C.pastelBlue));
  parts.push(box(w / 2 + 1.6, 0, d / 2 * 0.85 + 0.05, 2.2, 2.4, 0.15, C.concreteDark));
  parts.push(box(w / 2 + 5.4, 0, d / 2 * 0.85 + 0.05, 2.2, 2.4, 0.15, C.concreteDark));
  // Driveway
  parts.push(box(w / 2 + 3.5, 0, d / 2 + 2, 6, 0.05, 4, C.asphalt));
  addLowRidgeRoof(parts, h, w, d, C.roofGray, 2.0);
  addLowRidgeRoof(parts, 3.0, 7, d * 0.85, C.roofGray, 1.2, w / 2 + 3.5, 0);
  return { id: 'house_two_story', category: 'house', width: w + 7, depth: d, height: h + 2.5, geometry: combine(parts) };
}

function p_mcmansion(): BuildingPrototype {
  const w = 16, d = 14, h = 6.5;
  const parts: THREE.BufferGeometry[] = [];
  houseBody(parts, w, d, h, C.pastelPeach);
  // Front wing — protruding entrance
  parts.push(box(0, 0, d / 2 + 1.5, 7, h, 3, C.pastelPeach));
  // Big front door + entry portico
  parts.push(box(0, 0, d / 2 + 3.0, 1.4, 3.0, 0.12, C.doorGreen));
  for (const sx of [-1, 1]) {
    parts.push(box(sx * 1.8, 0, d / 2 + 3.0, 0.4, 3.4, 0.4, C.whitePaint));
  }
  parts.push(box(0, 3.4, d / 2 + 3.0, 4, 0.6, 1.0, C.whitePaint));
  // Lots of windows
  for (const y of [1.5, 4.5]) {
    houseWindows(parts, w, d, y, 4);
  }
  // Multi-pitch roof — main + front gable
  addLowRidgeRoof(parts, h, w, d, C.roofRed, 2.8);
  addLowRidgeRoof(parts, h, 7, 3, C.roofRed, 2.4, 0, d / 2 + 1.5);
  // 3-car garage on the side
  parts.push(box(w / 2 + 4, 0, -2, 8, 3.2, 8, C.pastelPeach));
  parts.push(box(w / 2 + 4, 0, 2.05, 7.5, 2.6, 0.15, C.concreteDark));
  addLowRidgeRoof(parts, 3.2, 8, 8, C.roofRed, 1.2, w / 2 + 4, -2);
  return { id: 'house_mcmansion', category: 'house', width: w + 8, depth: d + 4, height: h + 3, geometry: combine(parts) };
}

function p_bungalow(): BuildingPrototype {
  const w = 9, d = 8, h = 3.0;
  const parts: THREE.BufferGeometry[] = [];
  houseBody(parts, w, d, h, C.yellow);
  houseWindows(parts, w, d, 1.4, 2);
  // Covered porch
  parts.push(box(0, 0, d / 2 + 1.0, w * 0.85, 0.2, 2.0, C.woodLight));
  for (const sx of [-1, 1]) {
    parts.push(box(sx * (w * 0.4), 0, d / 2 + 1.8, 0.3, 2.8, 0.3, C.whitePaint));
  }
  parts.push(box(0, 2.8, d / 2 + 1.4, w * 0.9, 0.2, 1.6, C.roofRed));
  // Door
  parts.push(box(0, 0, d / 2 + 0.05, 1.0, 2.0, 0.12, C.doorGreen));
  addLowRidgeRoof(parts, h, w, d, C.roofRed, 1.5);
  return { id: 'house_bungalow', category: 'house', width: w, depth: d + 4, height: h + 2, geometry: combine(parts) };
}

function p_townhouse_end(): BuildingPrototype {
  const w = 7, d = 12, h = 7.5;
  const parts: THREE.BufferGeometry[] = [];
  houseBody(parts, w, d, h, C.brickRed);
  // 3 floors of window stacks
  for (const y of [1.5, 3.8, 6.0]) {
    parts.push(box(0, y, d / 2 + 0.05, 1.4, 1.2, 0.12, C.windowDay));
    parts.push(box(0, y, -d / 2 - 0.05, 1.4, 1.2, 0.12, C.windowDay));
  }
  // Door
  parts.push(box(0, 0, d / 2 + 0.05, 1.0, 2.2, 0.12, C.doorBlue));
  // Stoop
  parts.push(box(0, 0, d / 2 + 1.0, 1.6, 0.5, 1.4, C.concrete));
  addFlatRoof(parts, h, w, d, C.brickDark);
  // Cornice
  parts.push(box(0, h - 0.3, 0, w * 1.06, 0.3, d * 1.06, C.concreteDark));
  return { id: 'townhouse_end', category: 'house', width: w, depth: d, height: h + 0.5, geometry: combine(parts) };
}

// ===== Rural =====

function p_farmhouse(): BuildingPrototype {
  const w = 11, d = 9, h = 5.5;
  const parts: THREE.BufferGeometry[] = [];
  houseBody(parts, w, d, h, C.whitePaint);
  for (const y of [1.5, 4.0]) {
    houseWindows(parts, w, d, y, 3);
  }
  parts.push(box(0, 0, d / 2 + 0.05, 1.2, 2.4, 0.12, C.doorGreen));
  // Wraparound porch posts
  for (const sx of [-1, 0, 1]) {
    parts.push(box(sx * (w * 0.4), 0, d / 2 + 1.5, 0.25, 2.6, 0.25, C.whitePaint));
  }
  parts.push(box(0, 2.6, d / 2 + 1.5, w, 0.2, 1.4, C.whitePaint));
  // Steep roof
  addLowRidgeRoof(parts, h, w, d, C.roofRed, 2.5);
  // Brick chimney
  parts.push(box(w / 2 - 0.8, h + 1.3, 0, 0.7, 3.0, 0.7, C.brickRed));
  // Silo next to the farmhouse
  parts.push(box(w / 2 + 4, 0, 0, 4, 0.6, 4, C.concrete));     // pad
  for (let yLvl = 0; yLvl < 5; yLvl++) {
    parts.push(box(w / 2 + 4, 0.6 + yLvl * 2.4, 0, 3.5, 2.4, 3.5, C.silo));
  }
  parts.push(box(w / 2 + 4, 12.6, 0, 3.0, 1.0, 3.0, C.steel));
  parts.push(box(w / 2 + 4, 13.6, 0, 1.4, 1.0, 1.4, C.steel));
  return { id: 'rural_farmhouse', category: 'rural', width: w + 8, depth: d + 4, height: 14.6, geometry: combine(parts) };
}

function p_big_barn(): BuildingPrototype {
  const w = 14, d = 22, h = 7;
  const parts: THREE.BufferGeometry[] = [];
  parts.push(box(0, 0, 0, w, h, d, C.barnRed));
  // Big sliding doors on the front
  parts.push(box(0, 0, d / 2 + 0.05, 5, 5, 0.18, C.barnRoof));
  parts.push(box(0, 0, d / 2 + 0.07, 0.15, 5, 0.05, C.whitePaint));
  // Decorative cross-bracing
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    parts.push(box(sx * (w * 0.45), 3, sz * (d * 0.45), 0.18, 4, 0.18, C.whitePaint));
  }
  // Gambrel roof — voxel approximation: 2-step roof
  parts.push(box(0, h, 0, w * 1.04, 1.6, d * 1.02, C.barnRoof));
  parts.push(box(0, h + 1.6, 0, w * 0.7, 1.6, d * 1.02, C.barnRoof));
  parts.push(box(0, h + 3.2, 0, w * 0.35, 1.4, d * 1.02, C.barnRoof));
  // Cupola on the ridge
  parts.push(box(0, h + 4.6, d / 4, 1.6, 1.4, 1.6, C.whitePaint));
  parts.push(box(0, h + 6.0, d / 4, 1.0, 0.8, 1.0, C.barnRoof));
  // Tall weather vane
  parts.push(box(0, h + 6.8, d / 4, 0.1, 1.6, 0.1, C.steel));
  parts.push(box(0, h + 8.2, d / 4, 1.4, 0.1, 0.1, C.steel));
  return { id: 'rural_big_barn', category: 'rural', width: w, depth: d, height: h + 8.5, geometry: combine(parts) };
}

function p_small_barn(): BuildingPrototype {
  const w = 8, d = 12, h = 4;
  const parts: THREE.BufferGeometry[] = [];
  parts.push(box(0, 0, 0, w, h, d, C.barnRed));
  parts.push(box(0, 0, d / 2 + 0.05, 3, 3, 0.18, C.barnRoof));
  // Steep peaked roof
  addLowRidgeRoof(parts, h, w, d, C.barnRoof, 2.0);
  return { id: 'rural_small_barn', category: 'rural', width: w, depth: d, height: h + 2.5, geometry: combine(parts) };
}

function p_mobile_home(): BuildingPrototype {
  const w = 4, d = 14, h = 3;
  const parts: THREE.BufferGeometry[] = [];
  parts.push(box(0, 0.5, 0, w, h, d, C.silver2));
  // Skirting
  parts.push(box(0, 0, 0, w * 1.02, 0.5, d * 1.02, C.concreteDark));
  // Windows
  for (let i = 0; i < 3; i++) {
    const t = (i + 0.5) / 3;
    const z = (t - 0.5) * d * 0.78;
    parts.push(box(w / 2 + 0.05, 1.7, z, 0.12, 0.8, 1.2, C.windowDay));
    parts.push(box(-w / 2 - 0.05, 1.7, z, 0.12, 0.8, 1.2, C.windowDay));
  }
  // Door + steps
  parts.push(box(0, 0.5, d / 2 + 0.05, 1.0, 1.8, 0.12, C.door));
  parts.push(box(0, 0.2, d / 2 + 0.7, 1.4, 0.4, 1.0, C.concrete));
  // Flat roof
  parts.push(box(0, h + 0.5, 0, w * 1.04, 0.2, d * 1.04, C.silver));
  return { id: 'rural_mobile_home', category: 'rural', width: w, depth: d, height: h + 1, geometry: combine(parts) };
}

// ===== Suburban houses (12 new, muted-pastel American palette) =====

function p_tudor_revival(): BuildingPrototype {
  const w = 12, d = 10, h = 5.5;
  const parts: THREE.BufferGeometry[] = [];
  // Lower floor stucco
  parts.push(box(0, 0, 0, w, 3.0, d, C.tudorCream));
  parts.push(box(0, 0, 0, w * 1.04, 0.5, d * 1.04, C.concrete));
  // Upper floor with half-timbering: cream wall + dark vertical beams
  parts.push(box(0, 3.0, 0, w, 2.5, d, C.tudorCream));
  for (let i = 0; i < 6; i++) {
    const t = (i + 0.5) / 6;
    const x = (t - 0.5) * w * 0.85;
    parts.push(box(x, 3.0, d / 2 + 0.06, 0.18, 2.5, 0.05, C.tudorBeam));
    parts.push(box(x, 3.0, -d / 2 - 0.06, 0.18, 2.5, 0.05, C.tudorBeam));
  }
  // Horizontal beams
  parts.push(box(0, 3.0, d / 2 + 0.06, w * 0.88, 0.2, 0.05, C.tudorBeam));
  parts.push(box(0, 5.3, d / 2 + 0.06, w * 0.88, 0.2, 0.05, C.tudorBeam));
  // Steep gable roof — aggressive pyramid
  for (let i = 0; i < 4; i++) {
    const t = i / 4;
    const sw = w * (1.05 - t * 0.85);
    const sd = d * (1.05 - t * 0.6);
    parts.push(box(0, h + i * 0.7, 0, sw, 0.7, sd, C.roofRed));
  }
  // Windows
  for (const y of [1.4, 4.0]) {
    for (const x of [-3, 3]) {
      parts.push(box(x, y, d / 2 + 0.05, 1.2, 1.2, 0.12, C.windowDay));
    }
  }
  // Tall narrow door
  parts.push(box(0, 0, d / 2 + 0.05, 1.0, 2.4, 0.12, C.doorGreen));
  // Brick chimney
  parts.push(box(w / 2 - 0.6, h + 1, 0, 0.7, 4, 0.7, C.brickRed));
  return { id: 'house_tudor', category: 'house', width: w, depth: d, height: h + 3, geometry: combine(parts) };
}

function p_mediterranean(): BuildingPrototype {
  const w = 13, d = 11, h = 4.5;
  const parts: THREE.BufferGeometry[] = [];
  // Stucco walls
  parts.push(box(0, 0, 0, w, h, d, C.spanishStucco));
  parts.push(box(0, 0, 0, w * 1.04, 0.5, d * 1.04, C.concrete));
  // Arched front entry recess
  parts.push(box(0, 0, d / 2 - 0.6, 3, 3.0, 1.2, C.spanishStucco));
  parts.push(box(0, 0, d / 2 + 0.05, 1.2, 2.4, 0.12, C.doorGreen));
  // Red tile stepped roof — distinctive
  parts.push(box(0, h, 0, w * 1.10, 0.6, d * 1.06, C.spanishTile));
  parts.push(box(0, h + 0.6, 0, w * 0.9, 0.6, d * 0.7, C.spanishTile));
  parts.push(box(0, h + 1.2, 0, w * 0.6, 0.5, d * 0.5, C.spanishTile));
  // Arched windows on front
  for (const x of [-3.5, 3.5]) {
    parts.push(box(x, 1.4, d / 2 + 0.05, 1.4, 1.4, 0.12, C.windowDay));
    // Decorative wrought iron grill suggestion
    parts.push(box(x, 1.4, d / 2 + 0.08, 0.08, 1.0, 0.04, C.tudorBeam));
  }
  // Side window
  parts.push(box(w / 2 + 0.05, 2.0, 0, 0.12, 1.2, 1.2, C.windowDay));
  // Courtyard wall with red tile cap
  parts.push(box(w / 2 + 3, 0, d / 2 - 1, 0.4, 1.8, 4, C.spanishStucco));
  parts.push(box(w / 2 + 3, 1.8, d / 2 - 1, 0.5, 0.2, 4.1, C.spanishTile));
  return { id: 'house_mediterranean', category: 'house', width: w + 3, depth: d, height: h + 2, geometry: combine(parts) };
}

function p_midcentury_modern(): BuildingPrototype {
  const w = 14, d = 9, h = 3.0;
  const parts: THREE.BufferGeometry[] = [];
  parts.push(box(0, 0, 0, w, h, d, C.midcenturyTeal));
  parts.push(box(0, 0, 0, w * 1.04, 0.5, d * 1.04, C.concrete));
  // Big horizontal picture windows
  parts.push(box(0, 1.0, d / 2 + 0.05, w * 0.7, 1.6, 0.18, C.windowDay));
  parts.push(box(0, 1.0, -d / 2 - 0.05, w * 0.7, 1.6, 0.18, C.windowDay));
  // Wood accent panels
  parts.push(box(-w / 2 + 1.5, 0, d / 2 + 0.06, 2, h, 0.05, C.woodLight));
  parts.push(box(w / 2 - 1.5, 0, d / 2 + 0.06, 2, h, 0.05, C.woodLight));
  // Door
  parts.push(box(2, 0, d / 2 + 0.05, 1.0, 2.2, 0.12, C.doorGreen));
  // Flat overhanging roof with deep eaves
  parts.push(box(0, h, 0, w * 1.20, 0.4, d * 1.30, C.roofGray));
  // Carport extension
  parts.push(box(w / 2 + 4, h, 0, 8, 0.3, d * 1.1, C.roofGray));
  for (const sz of [-1, 1]) {
    parts.push(box(w / 2 + 7, 0, sz * d * 0.4, 0.25, h - 0.1, 0.25, C.modernGray));
  }
  return { id: 'house_midcentury', category: 'house', width: w + 8, depth: d, height: h + 1, geometry: combine(parts) };
}

function p_victorian(): BuildingPrototype {
  const w = 11, d = 10, h = 7.5;
  const parts: THREE.BufferGeometry[] = [];
  parts.push(box(0, 0, 0, w, h, d, C.victorianPurple));
  parts.push(box(0, 0, 0, w * 1.04, 0.5, d * 1.04, C.concrete));
  // Trim band between floors
  parts.push(box(0, 3.5, 0, w * 1.05, 0.3, d * 1.05, C.victorianTrim));
  // Many small windows
  for (const y of [1.4, 4.5]) {
    for (let i = 0; i < 3; i++) {
      const t = (i + 0.5) / 3;
      const x = (t - 0.5) * w * 0.78;
      parts.push(box(x, y, d / 2 + 0.05, 0.9, 1.3, 0.12, C.windowDay));
      parts.push(box(x, y, -d / 2 - 0.05, 0.9, 1.3, 0.12, C.windowDay));
    }
  }
  // Octagonal-ish turret on the front-right corner
  parts.push(box(w / 2 - 1.5, 0, d / 2 - 1.5, 4, h + 2, 4, C.victorianPurple));
  parts.push(box(w / 2 - 1.5, 1.4, d / 2 + 0.05, 0.9, 1.3, 0.12, C.windowDay));
  parts.push(box(w / 2 - 1.5, 4.5, d / 2 + 0.05, 0.9, 1.3, 0.12, C.windowDay));
  parts.push(box(w / 2 - 1.5, h + 2, d / 2 - 1.5, 3, 1.5, 3, C.roofRed));
  parts.push(box(w / 2 - 1.5, h + 3.5, d / 2 - 1.5, 1.2, 1.2, 1.2, C.roofRed));
  // Steep peaked roof on main body
  for (let i = 0; i < 4; i++) {
    const t = i / 4;
    const sw = w * (1.05 - t * 0.85);
    parts.push(box(0, h + i * 0.7, 0, sw, 0.7, d * (1.04 - t * 0.5), C.roofRed));
  }
  // Wraparound porch
  parts.push(box(0, 0, d / 2 + 1.0, w * 0.9, 0.2, 2.0, C.victorianTrim));
  for (const sx of [-1, 0, 1]) {
    parts.push(box(sx * (w * 0.4), 0, d / 2 + 1.8, 0.25, 2.6, 0.25, C.victorianTrim));
  }
  parts.push(box(0, 2.8, d / 2 + 1.4, w * 0.95, 0.2, 1.8, C.roofRed));
  parts.push(box(0, 0, d / 2 + 0.05, 1.0, 2.4, 0.12, C.doorGreen));
  return { id: 'house_victorian', category: 'house', width: w, depth: d + 4, height: h + 5, geometry: combine(parts) };
}

function p_craftsman(): BuildingPrototype {
  const w = 12, d = 10, h = 4.0;
  const parts: THREE.BufferGeometry[] = [];
  parts.push(box(0, 0, 0, w, h, d, C.craftsmanBrown));
  parts.push(box(0, 0, 0, w * 1.04, 0.5, d * 1.04, C.concrete));
  // Stone foundation
  parts.push(box(0, 0, 0, w * 1.06, 1.2, d * 1.06, stone(C)));
  // Wide front porch with thick tapered columns
  parts.push(box(0, 0, d / 2 + 1.0, w * 0.95, 0.3, 2.4, C.craftsmanGreen));
  for (const sx of [-1, 1]) {
    parts.push(box(sx * (w * 0.35), 0, d / 2 + 2.0, 0.6, 3.2, 0.6, C.craftsmanBrown));
  }
  parts.push(box(0, 3.4, d / 2 + 1.5, w * 0.98, 0.3, 2.0, C.roofGray));
  // Low-pitched roof with deep overhangs
  parts.push(box(0, h, 0, w * 1.15, 0.4, d * 1.15, C.roofGray));
  parts.push(box(0, h + 0.4, 0, w * 0.7, 1.6, d * 0.7, C.craftsmanBrown));
  parts.push(box(0, h + 2.0, 0, w * 0.85, 0.3, d * 0.85, C.roofGray));
  // Front door + sidelights
  parts.push(box(0, 0, d / 2 + 0.05, 1.0, 2.2, 0.12, C.doorGreen));
  for (const sx of [-1, 1]) {
    parts.push(box(sx * 1.0, 0, d / 2 + 0.05, 0.3, 2.0, 0.12, C.windowDay));
  }
  // Small windows on sides
  for (const y of [1.6]) {
    for (let i = 0; i < 2; i++) {
      const x = (i - 0.5) * 4;
      parts.push(box(x, y, -d / 2 - 0.05, 1.0, 1.0, 0.12, C.windowDay));
    }
  }
  return { id: 'house_craftsman', category: 'house', width: w, depth: d + 4, height: h + 2.5, geometry: combine(parts) };
}

// Tiny helper since we removed 'stone' from C; just use concrete instead.
function stone(_c: typeof C): number { return 0x9c9c9e; }

function p_a_frame(): BuildingPrototype {
  const w = 9, d = 14, h = 8.5;
  const parts: THREE.BufferGeometry[] = [];
  // The "walls" of an A-frame are actually the roof going to the ground.
  // We build it as a stepped triangle stack.
  for (let i = 0; i < 8; i++) {
    const t = i / 8;
    const sw = w * (1.05 - t * 0.85);
    parts.push(box(0, t * h, 0, sw, h / 8, d * 1.02, C.roofRed));
  }
  // Tall front gable window
  parts.push(box(0, 1.6, d / 2 + 0.05, 2.4, 5.0, 0.12, C.windowDay));
  // Door
  parts.push(box(0, 0, d / 2 + 0.07, 1.0, 2.2, 0.12, C.doorBlue));
  // Foundation suggestion
  parts.push(box(0, 0, 0, w * 1.04, 0.4, d * 1.04, C.concrete));
  // Side small windows
  for (const sx of [-1, 1]) for (const z of [-3, 3]) {
    parts.push(box(sx * (w * 0.35), 1.5, z, 0.12, 1.0, 1.0, C.windowDay));
  }
  return { id: 'house_a_frame', category: 'house', width: w, depth: d, height: h, geometry: combine(parts) };
}

function p_modern_boxy(): BuildingPrototype {
  const w = 13, d = 12, h = 6.5;
  const parts: THREE.BufferGeometry[] = [];
  parts.push(box(0, 0, 0, w, h, d, C.modernWhite));
  parts.push(box(0, 0, 0, w * 1.04, 0.4, d * 1.04, C.modernGray));
  // Big floor-to-ceiling glass corner
  parts.push(box(w / 2 - 2, 1.0, d / 2 + 0.05, 4, 5.0, 0.18, C.windowDay));
  parts.push(box(w / 2 + 0.05, 1.0, d / 2 - 2, 0.18, 5.0, 4, C.windowDay));
  // Dark accent volume (extruded entry block)
  parts.push(box(-w / 2 + 2.5, 0, d / 2 + 1, 5, h - 0.5, 2, C.modernGray));
  parts.push(box(-w / 2 + 2.5, 0, d / 2 + 0.05, 1.0, 2.4, 0.12, C.doorGreen));
  // Flat roof with parapet
  parts.push(box(0, h, 0, w * 1.04, 0.6, d * 1.04, C.modernGray));
  // Side windows
  for (const y of [1.5, 4.0]) {
    parts.push(box(-w / 2 - 0.05, y, 0, 0.12, 1.0, 4, C.windowDay));
  }
  return { id: 'house_modern_boxy', category: 'house', width: w + 2, depth: d, height: h + 1, geometry: combine(parts) };
}

function p_duplex(): BuildingPrototype {
  const w = 18, d = 9, h = 5.5;
  const parts: THREE.BufferGeometry[] = [];
  parts.push(box(0, 0, 0, w, h, d, C.pastelButter));
  parts.push(box(0, 0, 0, w * 1.04, 0.5, d * 1.04, C.concrete));
  // Two mirrored entries
  for (const sx of [-1, 1]) {
    parts.push(box(sx * 4, 0, d / 2 + 0.05, 1.0, 2.2, 0.12, C.doorBlue));
    parts.push(box(sx * 4 - 1.5, 1.5, d / 2 + 0.05, 0.9, 1.2, 0.12, C.windowDay));
    parts.push(box(sx * 4 + 1.5, 1.5, d / 2 + 0.05, 0.9, 1.2, 0.12, C.windowDay));
    parts.push(box(sx * 4, 4.0, d / 2 + 0.05, 1.6, 1.2, 0.12, C.windowDay));
  }
  // Center wall trim suggesting two units
  parts.push(box(0, 0, d / 2 + 0.06, 0.2, h, 0.05, C.tudorBeam));
  // Low ridge roof
  for (let i = 0; i < 3; i++) {
    const t = i / 3;
    parts.push(box(0, h + t * 1.4, 0, w * 1.04, 0.5, d * (1.04 - t * 0.7), C.roofGray));
  }
  return { id: 'house_duplex', category: 'house', width: w, depth: d, height: h + 2, geometry: combine(parts) };
}

function p_townhouse_middle(): BuildingPrototype {
  const w = 6, d = 11, h = 7.5;
  const parts: THREE.BufferGeometry[] = [];
  // Brick row middle unit — narrow, 3 floors. No side windows (shared walls).
  parts.push(box(0, 0, 0, w, h, d, C.brickRed));
  parts.push(box(0, 0, 0, w * 1.05, 0.5, d * 1.05, C.concreteDark));
  for (const y of [1.5, 3.7, 5.9]) {
    parts.push(box(0, y, d / 2 + 0.05, 1.4, 1.2, 0.12, C.windowDay));
    parts.push(box(0, y, -d / 2 - 0.05, 1.4, 1.2, 0.12, C.windowDay));
  }
  parts.push(box(0, 0, d / 2 + 0.05, 1.0, 2.2, 0.12, C.doorBlue));
  parts.push(box(0, 0, d / 2 + 1.0, 1.6, 0.5, 1.4, C.concrete));
  parts.push(box(0, h - 0.3, 0, w * 1.06, 0.3, d * 1.06, C.concreteDark));
  addFlatRoof(parts, h, w, d, C.brickDark);
  return { id: 'house_townhouse_mid', category: 'house', width: w, depth: d, height: h + 0.5, geometry: combine(parts) };
}

function p_modern_farmhouse(): BuildingPrototype {
  const w = 13, d = 11, h = 6.5;
  const parts: THREE.BufferGeometry[] = [];
  // White board-and-batten body
  parts.push(box(0, 0, 0, w, h, d, C.modernWhite));
  parts.push(box(0, 0, 0, w * 1.04, 0.5, d * 1.04, C.concrete));
  // Vertical batten strips
  for (let i = 0; i < 8; i++) {
    const t = (i + 0.5) / 8;
    const x = (t - 0.5) * w * 0.92;
    parts.push(box(x, 0, d / 2 + 0.06, 0.12, h, 0.04, C.tudorCream));
    parts.push(box(x, 0, -d / 2 - 0.06, 0.12, h, 0.04, C.tudorCream));
  }
  // Black metal roof — steep pitch, 3 step
  parts.push(box(0, h, 0, w * 1.06, 0.7, d * 1.06, C.modernGray));
  parts.push(box(0, h + 0.7, 0, w * 0.7, 0.7, d * 1.04, C.modernGray));
  parts.push(box(0, h + 1.4, 0, w * 0.4, 0.6, d * 1.02, C.modernGray));
  // Big black-framed windows
  for (const y of [1.5, 4.5]) {
    for (let i = 0; i < 3; i++) {
      const t = (i + 0.5) / 3;
      const x = (t - 0.5) * w * 0.78;
      parts.push(box(x, y, d / 2 + 0.05, 1.4, 1.4, 0.12, C.windowDay));
      // Black frame
      parts.push(box(x, y, d / 2 + 0.07, 1.5, 0.1, 0.04, C.modernGray));
      parts.push(box(x, y, d / 2 + 0.07, 0.1, 1.5, 0.04, C.modernGray));
    }
  }
  // Black door
  parts.push(box(0, 0, d / 2 + 0.05, 1.2, 2.4, 0.12, C.modernGray));
  // Front porch
  parts.push(box(0, 0, d / 2 + 1.0, w * 0.9, 0.25, 2.0, C.modernWhite));
  for (const sx of [-1, 1]) {
    parts.push(box(sx * (w * 0.4), 0, d / 2 + 1.8, 0.2, 2.6, 0.2, C.modernGray));
  }
  parts.push(box(0, 2.7, d / 2 + 1.4, w * 0.94, 0.25, 1.8, C.modernGray));
  return { id: 'house_modern_farm', category: 'house', width: w, depth: d + 4, height: h + 2, geometry: combine(parts) };
}

function p_garrison(): BuildingPrototype {
  const w = 11, d = 9, h = 6.5;
  const parts: THREE.BufferGeometry[] = [];
  // Lower floor (slightly narrower)
  parts.push(box(0, 0, 0, w, 3.0, d, C.pastelTaupe));
  parts.push(box(0, 0, 0, w * 1.04, 0.5, d * 1.04, C.concrete));
  // Upper floor — overhangs the lower (signature garrison feature)
  parts.push(box(0, 3.0, 0, w * 1.18, 3.5, d * 1.18, C.pastelTaupe));
  // Trim under overhang
  parts.push(box(0, 3.0, 0, w * 1.20, 0.25, d * 1.20, C.tudorBeam));
  // Windows on both floors
  for (const y of [1.4]) {
    for (const x of [-3, 3]) {
      parts.push(box(x, y, d / 2 + 0.05, 1.2, 1.2, 0.12, C.windowDay));
    }
  }
  for (const y of [4.4]) {
    for (const x of [-3.5, 0, 3.5]) {
      parts.push(box(x, y, d / 2 * 1.18 + 0.05, 1.0, 1.2, 0.12, C.windowDay));
    }
  }
  // Door on lower floor
  parts.push(box(0, 0, d / 2 + 0.05, 1.0, 2.2, 0.12, C.doorBlue));
  // Steep peaked roof
  for (let i = 0; i < 3; i++) {
    const t = i / 3;
    parts.push(box(0, h + t * 1.8, 0, w * (1.18 - t * 0.6), 0.6, d * (1.18 - t * 0.4), C.roofGray));
  }
  return { id: 'house_garrison', category: 'house', width: w * 1.2, depth: d * 1.2, height: h + 3, geometry: combine(parts) };
}

function p_estate_mansion(): BuildingPrototype {
  const w = 22, d = 14, h = 7.5;
  const parts: THREE.BufferGeometry[] = [];
  parts.push(box(0, 0, 0, w, h, d, C.tudorCream));
  parts.push(box(0, 0, 0, w * 1.04, 0.5, d * 1.04, C.concrete));
  // U-shaped wings
  parts.push(box(-w / 2 - 3, 0, -d / 2 + 2, 6, h - 0.5, d - 4, C.tudorCream));
  parts.push(box(w / 2 + 3, 0, -d / 2 + 2, 6, h - 0.5, d - 4, C.tudorCream));
  // Grand columned entry
  parts.push(box(0, 0, d / 2 + 1.5, 8, h - 1, 3, C.tudorCream));
  for (let i = 0; i < 6; i++) {
    const t = (i + 0.5) / 6;
    const x = (t - 0.5) * 7;
    parts.push(box(x, 0, d / 2 + 3, 0.5, h, 0.5, C.modernWhite));
  }
  parts.push(box(0, h - 0.6, d / 2 + 3, 8, 0.6, 1.4, C.tudorCream));
  // Door — double doors
  for (const sx of [-1, 1]) {
    parts.push(box(sx * 0.6, 0, d / 2 + 0.05, 1.0, 2.8, 0.12, C.modernGray));
  }
  // Symmetric windows
  for (const y of [1.5, 4.5]) {
    for (let i = 0; i < 6; i++) {
      const t = (i + 0.5) / 6;
      const x = (t - 0.5) * w * 0.85;
      parts.push(box(x, y, d / 2 + 0.05, 1.2, 1.4, 0.12, C.windowDay));
      parts.push(box(x, y, -d / 2 - 0.05, 1.2, 1.4, 0.12, C.windowDay));
    }
  }
  // Hipped roof with central gable
  for (let i = 0; i < 4; i++) {
    const t = i / 4;
    const sw = w * (1.05 - t * 0.7);
    const sd = d * (1.05 - t * 0.5);
    parts.push(box(0, h + t * 0.6, 0, sw, 0.6, sd, C.roofGray));
  }
  // Wing roofs
  for (const sx of [-1, 1]) {
    parts.push(box(sx * (w / 2 + 3), h - 0.5, -d / 2 + 2, 6.5, 0.4, d - 3, C.roofGray));
    parts.push(box(sx * (w / 2 + 3), h, -d / 2 + 2, 4, 1.4, d - 4, C.roofGray));
  }
  // Two chimneys for grandeur
  for (const sx of [-1, 1]) {
    parts.push(box(sx * (w * 0.35), h + 1, -d / 2 + 3, 0.9, 4, 0.9, C.brickRed));
  }
  return { id: 'house_estate', category: 'house', width: w + 12, depth: d + 6, height: h + 4, geometry: combine(parts) };
}

// ===== Suburban commercial (8 new) =====

function p_big_box(): BuildingPrototype {
  const w = 40, d = 30, h = 10;
  const parts: THREE.BufferGeometry[] = [];
  // Main building: long flat box.
  parts.push(box(0, 0, 0, w, h, d, C.bigBoxBlue));
  // Big sign band
  parts.push(box(0, h - 1.5, d / 2 + 0.4, w * 0.6, 2.2, 0.5, C.modernWhite));
  // Front entrance vestibule — glass + double sliding doors
  parts.push(box(0, 0, d / 2 + 1.0, 8, 4.5, 1.6, C.windowDay));
  parts.push(box(0, 0, d / 2 + 1.8, 6, 4, 0.18, C.modernGray));
  // Cart corral row in front
  for (let i = 0; i < 4; i++) {
    const t = (i + 0.5) / 4;
    const x = (t - 0.5) * w * 0.5;
    parts.push(box(x, 0, d / 2 + 4.5, 1.0, 0.4, 1.6, C.silver));
  }
  // Loading docks at the rear
  for (let i = 0; i < 4; i++) {
    const t = (i + 0.5) / 4;
    const x = (t - 0.5) * w * 0.7;
    parts.push(box(x, 0, -d / 2 - 0.05, 4, 4, 0.18, C.bigBoxRed));
  }
  // Rooftop A/C units
  for (let i = 0; i < 6; i++) {
    const t = (i + 0.5) / 6;
    const x = (t - 0.5) * w * 0.7;
    parts.push(box(x, h, 0, 3, 1.0, 4, C.silver));
  }
  // Tall pole sign on the corner
  parts.push(box(w / 2 + 4, 0, d / 2 + 2, 0.8, 14, 0.8, C.silver));
  parts.push(box(w / 2 + 4, 14, d / 2 + 2, 4, 4, 0.5, C.bigBoxRed));
  parts.push(box(w / 2 + 4, 12, d / 2 + 2, 3, 1.5, 0.5, C.modernWhite));
  return { id: 'big_box', category: 'suburban_commercial', width: w + 6, depth: d, height: h + 2, geometry: combine(parts) };
}

function p_suburban_strip(): BuildingPrototype {
  const w = 36, d = 12, h = 5;
  const parts: THREE.BufferGeometry[] = [];
  parts.push(box(0, 0, 0, w, h, d, C.brickTan));
  // Continuous glass shopfront
  parts.push(box(0, 0.4, d / 2 + 0.05, w * 0.95, 3, 0.18, C.windowDay));
  // Anchor store on one end (bigger sign)
  parts.push(box(-w / 3, 3.6, d / 2 + 0.4, w * 0.3, 1.6, 0.5, C.bigBoxRed));
  // Smaller shop signs across the rest
  for (let i = 0; i < 5; i++) {
    const t = (i + 0.6) / 6;
    const x = (t - 0.5) * w;
    if (x < -w / 3 + 4) continue;
    const colors = [C.fastFoodYellow, C.bigBoxGreen, C.signRed, C.signGreen, C.fastFoodRed];
    parts.push(box(x, 3.6, d / 2 + 0.4, 4, 1.0, 0.3, colors[i % colors.length]));
  }
  // Continuous awning
  parts.push(box(0, 4.6, d / 2 + 1.4, w * 0.95, 0.2, 1.4, C.awning));
  // Slot dividers
  for (let i = 1; i < 6; i++) {
    const x = (i - 3) * (w / 6);
    parts.push(box(x, 0, d / 2 + 0.06, 0.25, h, 0.18, C.brickDark));
  }
  addFlatRoof(parts, h, w, d, C.concreteDark);
  // Pole sign on the corner
  parts.push(box(w / 2 + 3, 0, 4, 0.6, 12, 0.6, C.silver));
  parts.push(box(w / 2 + 3, 12, 4, 3, 3, 0.5, C.bigBoxBlue));
  return { id: 'sub_strip_mall', category: 'suburban_commercial', width: w + 4, depth: d, height: h + 2, geometry: combine(parts) };
}

function p_drive_thru(): BuildingPrototype {
  const w = 12, d = 10, h = 4;
  const parts: THREE.BufferGeometry[] = [];
  parts.push(box(0, 0, 0, w, h, d, C.fastFoodRed));
  // Big yellow sign band
  parts.push(box(0, h, 0, w * 0.6, 2, 0.4, C.fastFoodYellow));
  parts.push(box(0, h + 1, 0, w * 0.4, 1, 0.5, C.fastFoodRed));
  // Glass front
  parts.push(box(0, 0.4, d / 2 + 0.05, w * 0.7, 2.6, 0.18, C.windowDay));
  // Drive-thru window on the side
  parts.push(box(w / 2 + 0.05, 1.0, -2, 0.18, 1.6, 2.0, C.windowDay));
  // Drive-thru lane awning (small)
  parts.push(box(w / 2 + 1.5, 3.0, -2, 3, 0.2, 3.0, C.fastFoodRed));
  // Speaker / menu board post
  parts.push(box(w / 2 + 4, 0, 2, 0.4, 3, 0.4, C.modernGray));
  parts.push(box(w / 2 + 4, 2.2, 2, 1.6, 1.6, 0.2, C.fastFoodYellow));
  // Tall pole sign
  parts.push(box(w / 2 + 7, 0, 0, 0.6, 12, 0.6, C.silver));
  parts.push(box(w / 2 + 7, 12, 0, 3, 3, 0.4, C.fastFoodYellow));
  parts.push(box(w / 2 + 7, 11, 0, 2, 1.2, 0.5, C.fastFoodRed));
  addFlatRoof(parts, h, w, d, C.modernGray);
  return { id: 'drive_thru', category: 'suburban_commercial', width: w + 8, depth: d, height: h + 3, geometry: combine(parts) };
}

function p_office_park(): BuildingPrototype {
  const w = 22, d = 18, h = 12;
  const parts: THREE.BufferGeometry[] = [];
  parts.push(box(0, 0, 0, w, h, d, C.glassGreen));
  // Glass curtain wall — continuous strips per floor
  for (let lvl = 1; lvl < 4; lvl++) {
    const y = lvl * 4 - 1.6;
    parts.push(box(0, y, d / 2 + 0.05, w * 0.92, 2.0, 0.2, C.windowDay));
    parts.push(box(0, y, -d / 2 - 0.05, w * 0.92, 2.0, 0.2, C.windowDay));
    parts.push(box(w / 2 + 0.05, y, 0, 0.2, 2.0, d * 0.92, C.windowDay));
    parts.push(box(-w / 2 - 0.05, y, 0, 0.2, 2.0, d * 0.92, C.windowDay));
  }
  // Lobby — glass entrance
  parts.push(box(0, 0, d / 2 + 0.5, 6, 4, 1, C.windowDay));
  // Modern flat roof + parapet
  addFlatRoof(parts, h, w, d, C.modernGray);
  // Sign monument near entry
  parts.push(box(0, 0, d / 2 + 4.5, 4, 1.6, 1, C.modernWhite));
  parts.push(box(0, 1.6, d / 2 + 4.5, 3.5, 0.4, 1, C.modernGray));
  return { id: 'office_park', category: 'suburban_commercial', width: w, depth: d, height: h + 1, geometry: combine(parts) };
}

function p_medical_clinic(): BuildingPrototype {
  const w = 18, d = 14, h = 5;
  const parts: THREE.BufferGeometry[] = [];
  parts.push(box(0, 0, 0, w, h, d, C.modernWhite));
  parts.push(box(0, 0, 0, w * 1.04, 0.4, d * 1.04, C.concrete));
  // Window strip
  parts.push(box(0, 1.5, d / 2 + 0.05, w * 0.85, 1.8, 0.18, C.windowDay));
  parts.push(box(0, 1.5, -d / 2 - 0.05, w * 0.85, 1.8, 0.18, C.windowDay));
  // Entry portico
  parts.push(box(0, 0, d / 2 + 1.5, 5, 4, 1.5, C.modernWhite));
  parts.push(box(0, 4, d / 2 + 1.5, 5.4, 0.3, 1.6, C.modernGray));
  parts.push(box(0, 0, d / 2 + 0.05, 1.2, 2.4, 0.12, C.windowDay));
  // Red cross sign on front
  parts.push(box(0, 4.5, d / 2 + 1.5, 1.2, 0.3, 0.4, C.signRed));
  parts.push(box(0, 4.5, d / 2 + 1.5, 0.3, 1.2, 0.4, C.signRed));
  // Flat roof, sign band
  addFlatRoof(parts, h, w, d, C.modernGray);
  return { id: 'medical_clinic', category: 'suburban_commercial', width: w, depth: d + 3, height: h + 1, geometry: combine(parts) };
}

function p_self_storage(): BuildingPrototype {
  const w = 36, d = 8, h = 3;
  const parts: THREE.BufferGeometry[] = [];
  // Main building
  parts.push(box(0, 0, 0, w, h, d, C.concreteDark));
  // Row of orange roll-up doors on the front
  for (let i = 0; i < 10; i++) {
    const t = (i + 0.5) / 10;
    const x = (t - 0.5) * w * 0.94;
    parts.push(box(x, 0, d / 2 + 0.05, 2.6, 2.4, 0.15, C.storageDoor));
  }
  // Flat roof
  parts.push(box(0, h, 0, w * 1.02, 0.3, d * 1.02, C.modernGray));
  // Office at one end
  parts.push(box(-w / 2 - 3, 0, 0, 6, h, d, C.modernWhite));
  parts.push(box(-w / 2 - 3, 1.0, d / 2 + 0.05, 4, 1.4, 0.18, C.windowDay));
  parts.push(box(-w / 2 - 4, 0, d / 2 + 0.05, 1.0, 2.0, 0.12, C.doorBlue));
  parts.push(box(-w / 2 - 3, h, 0, 6.2, 0.3, d * 1.02, C.modernGray));
  // Sign at office
  parts.push(box(-w / 2 - 3, h + 0.3, 0, 5, 1.0, 0.3, C.signYellow));
  // Fence line along back
  for (let i = 0; i < 8; i++) {
    const t = (i + 0.5) / 8;
    const x = (t - 0.5) * w;
    parts.push(box(x, 0, -d / 2 - 0.5, 0.15, 2.5, 0.15, C.silver));
  }
  return { id: 'self_storage', category: 'suburban_commercial', width: w + 6, depth: d + 2, height: h + 1, geometry: combine(parts) };
}

function p_garden_apartments(): BuildingPrototype {
  const w = 28, d = 26, h = 9;
  const parts: THREE.BufferGeometry[] = [];
  // Three buildings around a central pool/courtyard.
  // North wing
  parts.push(box(0, 0, -d / 2 + 4, w, h, 8, C.pastelButter));
  // East wing
  parts.push(box(w / 2 - 4, 0, 0, 8, h, d, C.pastelButter));
  // West wing
  parts.push(box(-w / 2 + 4, 0, 0, 8, h, d, C.pastelButter));
  // Central courtyard pool
  parts.push(box(0, 0, 4, w * 0.5, 0.3, 8, C.windowDay));
  parts.push(box(0, 0, 4, w * 0.55, 0.4, 9, C.concrete));
  parts.push(box(0, 0, 4, w * 0.5, 0.31, 8, C.windowDay));
  // Windows / balconies on each wing
  for (let lvl = 0; lvl < 3; lvl++) {
    const y = lvl * 3 + 1.4;
    // North wing front windows
    for (let i = 0; i < 7; i++) {
      const t = (i + 0.5) / 7;
      const x = (t - 0.5) * w * 0.92;
      parts.push(box(x, y, -d / 2 + 4 - 4 - 0.05, 1.4, 1.2, 0.12, C.windowDay));
    }
    // East wing inside windows (facing courtyard)
    for (let i = 0; i < 5; i++) {
      const t = (i + 0.5) / 5;
      const z = (t - 0.5) * d * 0.85;
      parts.push(box(w / 2 - 4 - 4 - 0.05, y, z, 0.12, 1.2, 1.4, C.windowDay));
      parts.push(box(-w / 2 + 4 + 4 + 0.05, y, z, 0.12, 1.2, 1.4, C.windowDay));
    }
  }
  // Roofs
  addFlatRoof(parts, h, w, 8, C.roofGray);
  for (const sx of [-1, 1]) {
    parts.push(box(sx * (w / 2 - 4), h, 0, 8.3, 0.5, d * 1.02, C.roofGray));
  }
  return { id: 'garden_apts', category: 'suburban_commercial', width: w, depth: d, height: h + 1, geometry: combine(parts) };
}

function p_megachurch(): BuildingPrototype {
  const w = 30, d = 26, h = 10;
  const parts: THREE.BufferGeometry[] = [];
  // Main worship hall (long box)
  parts.push(box(0, 0, 0, w, h, d, C.brickTan));
  // Massive A-frame roof over the hall
  for (let i = 0; i < 5; i++) {
    const t = i / 5;
    const sw = w * (1.06 - t * 0.85);
    parts.push(box(0, h + t * 1.6, 0, sw, 1.6, d * 1.06, C.roofRed));
  }
  // Glass entry — full height triangle
  parts.push(box(0, 0, d / 2 + 0.5, 6, 8, 1.5, C.windowDay));
  parts.push(box(0, 0, d / 2 + 0.05, 2.4, 3, 0.15, C.modernGray));
  // Cross above the entrance
  parts.push(box(0, h + 6, d / 2 + 1, 0.4, 6, 0.4, C.modernWhite));
  parts.push(box(0, h + 8, d / 2 + 1, 2.4, 0.4, 0.4, C.modernWhite));
  // Side wings (smaller offices)
  for (const sx of [-1, 1]) {
    parts.push(box(sx * (w / 2 + 4), 0, -d / 4, 8, 6, d / 2, C.brickTan));
    parts.push(box(sx * (w / 2 + 4), 6, -d / 4, 8.2, 0.3, d / 2 + 0.2, C.roofGray));
  }
  // Long ribbon windows along the sides of the main hall
  for (const sz of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const t = (i + 0.5) / 5;
      const x = (t - 0.5) * w * 0.85;
      parts.push(box(x, 4.5, sz * (d / 2 + 0.05), 1.6, 3.2, 0.12, C.windowDay));
    }
  }
  return { id: 'megachurch', category: 'suburban_commercial', width: w + 16, depth: d, height: h + 8, geometry: combine(parts) };
}

// ===== Catalog =====

let _prototypes: BuildingPrototype[] | null = null;

export function getBuildingPrototypes(): BuildingPrototype[] {
  if (_prototypes) return _prototypes;
  _prototypes = [
    p_glass_tower_a(),
    p_glass_tower_setback(),
    p_concrete_office(),
    p_brick_office(),
    p_bank_columns(),
    p_hotel_tower(),
    p_modernist_tower(),
    p_apartment_tower(),
    p_brownstone_row(),
    p_mixed_use_4(),
    p_apartment_block(),
    p_church(),
    p_school(),
    p_strip_mall(),
    p_gas_station(),
    p_parking_garage(),
    p_restaurant(),
    p_civic_columns(),
    p_warehouse(),
    p_ranch(),
    p_colonial(),
    p_cape_cod(),
    p_split_level(),
    p_two_story(),
    p_mcmansion(),
    p_bungalow(),
    p_townhouse_end(),
    p_farmhouse(),
    p_big_barn(),
    p_small_barn(),
    p_mobile_home(),
    // 12 new suburban houses
    p_tudor_revival(),
    p_mediterranean(),
    p_midcentury_modern(),
    p_victorian(),
    p_craftsman(),
    p_a_frame(),
    p_modern_boxy(),
    p_duplex(),
    p_townhouse_middle(),
    p_modern_farmhouse(),
    p_garrison(),
    p_estate_mansion(),
    // 8 new suburban commercial
    p_big_box(),
    p_suburban_strip(),
    p_drive_thru(),
    p_office_park(),
    p_medical_clinic(),
    p_self_storage(),
    p_garden_apartments(),
    p_megachurch(),
  ];
  return _prototypes;
}
