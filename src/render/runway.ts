import * as THREE from 'three';
import { AIRPORTS } from '../world/airport';

// Single flat-mesh runway per airport with realistic FAA-style markings:
//   - Solid white edge stripes
//   - Dashed centerline (50 m painted, 50 m gap, ICAO-ish)
//   - Threshold bar at each end
//   - Piano-key threshold stripes (8 bars, parallel to centerline)
//   - Runway designation number at each end ("36" / "18")
//   - Aiming point markers (two big rectangles ~30% along runway)

const polyOffset = { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 };
const polyOffsetMarking = {
  polygonOffset: true,
  polygonOffsetFactor: -3,
  polygonOffsetUnits: -3,
};

function makeNumberTexture(label: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 384;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 256, 384);
  ctx.fillStyle = '#fafafa';
  ctx.font = 'bold 280px Arial Black, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 128, 200);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function buildRunways(): THREE.Group {
  const group = new THREE.Group();

  const matAsphalt = new THREE.MeshLambertMaterial({ color: 0x252830, ...polyOffset });
  const matLine = new THREE.MeshLambertMaterial({ color: 0xfafafa, ...polyOffsetMarking });
  const matApron = new THREE.MeshLambertMaterial({ color: 0x466b32, ...polyOffset });

  for (const ap of AIRPORTS) {
    // Heights tuned so wheels (bottom at elev+1.03 at static rest) sit ~5mm
    // above the slab, with a slight visible "tire bulge". Markings sit at the
    // slab top via polygonOffset to win z-fighting.
    const apronY = ap.elev + 0.965;     // h=0.08 → top face elev + 1.005 (just above voxel)
    const slabY = ap.elev + 0.985;      // h=0.08 → top face elev + 1.025
    const markY = ap.elev + 1.0;        // h=0.05 → top face elev + 1.025 (coplanar with slab)
    const numY = ap.elev + 1.025;       // PlaneGeometry numbers — at slab top, polygonOffset wins
    const halfL = ap.runwayLength / 2;
    const halfW = ap.runwayWidth / 2;

    // Apron: dark grass shoulders.
    group.add(makeBox(
      ap.apronWidth, 0.08, ap.apronLength,
      ap.cx, apronY, ap.cz,
      matApron,
    ));

    // Runway slab.
    group.add(makeBox(
      ap.runwayWidth, 0.08, ap.runwayLength,
      ap.cx, slabY, ap.cz,
      matAsphalt,
    ));

    // Edge stripes (solid white) — both sides.
    for (const sign of [-1, 1]) {
      group.add(makeBox(
        0.6, 0.05, ap.runwayLength,
        ap.cx + sign * (halfW - 0.6), markY, ap.cz,
        matLine,
      ));
    }

    // Dashed centerline — 16 m painted, 16 m gap, repeated.
    const dashLen = 16;
    const dashGap = 16;
    const cycle = dashLen + dashGap;
    // Skip the first/last 30 m (room for threshold + numbers + aim point).
    const usableHalf = halfL - 30;
    let zCursor = -usableHalf;
    while (zCursor + dashLen < usableHalf) {
      group.add(makeBox(
        0.6, 0.05, dashLen,
        ap.cx, markY, ap.cz + zCursor + dashLen / 2,
        matLine,
      ));
      zCursor += cycle;
    }

    // FAA marking layout from each threshold inward:
    //   [ threshold bar @ ±halfL          ]   thin solid bar at the very edge
    //   [ piano keys  4..18 m past edge   ]   8 longitudinal stripes
    //   [ blank gap   18..28 m            ]
    //   [ designation 28..52 m past edge  ]   the "36" / "18"
    //   [ aiming point at ~30% along rwy  ]   two big solid rectangles

    const thresholdInset = 1.5;       // bar centred 1.5 m from physical edge
    const pianoStart = 4;
    const pianoLen = 14;              // longitudinal length of each piano key
    const pianoEnd = pianoStart + pianoLen;       // 18
    const numStart = pianoEnd + 10;               // 10 m gap after piano keys → 28
    const numLen = 24;
    const numCenter = numStart + numLen / 2;      // 40 m past threshold
    const aimZOff = halfL * 0.55;

    // Threshold bar at each end (3 m deep, slightly inset from edge).
    for (const sign of [-1, 1]) {
      group.add(makeBox(
        ap.runwayWidth - 2.5, 0.05, 3,
        ap.cx, markY, ap.cz + sign * (halfL - thresholdInset),
        matLine,
      ));
    }

    // Piano-key threshold stripes — 8 longitudinal bars at each end.
    const bars = 8;
    const barWidth = (ap.runwayWidth - 6) / (bars * 2 - 1);   // bar+gap pattern
    for (const sign of [-1, 1]) {
      const zCenter = ap.cz + sign * (halfL - (pianoStart + pianoLen / 2));
      for (let i = 0; i < bars; i++) {
        const xCenter = ap.cx
          + (i - (bars - 1) / 2) * (barWidth * 2);
        group.add(makeBox(barWidth, 0.05, pianoLen, xCenter, markY, zCenter, matLine));
      }
    }

    // Designation numbers ("36" at south end, "18" at north end).
    // Placed past the piano keys, with a clear gap.
    const numSize = Math.min(ap.runwayWidth - 8, numLen);
    const matNum36 = new THREE.MeshBasicMaterial({
      map: makeNumberTexture('36'),
      transparent: true,
      depthWrite: false,
      ...polyOffsetMarking,
    });
    const matNum18 = new THREE.MeshBasicMaterial({
      map: makeNumberTexture('18'),
      transparent: true,
      depthWrite: false,
      ...polyOffsetMarking,
    });
    // South end: "36" — read facing north (takeoff direction).
    const num36 = new THREE.Mesh(
      new THREE.PlaneGeometry(numSize * 0.7, numSize),
      matNum36,
    );
    num36.rotation.x = -Math.PI / 2;
    num36.rotation.z = Math.PI;
    num36.position.set(ap.cx, numY, ap.cz - halfL + numCenter);
    group.add(num36);

    // North end: "18".
    const num18 = new THREE.Mesh(
      new THREE.PlaneGeometry(numSize * 0.7, numSize),
      matNum18,
    );
    num18.rotation.x = -Math.PI / 2;
    num18.position.set(ap.cx, numY, ap.cz + halfL - numCenter);
    group.add(num18);

    // Aiming point markers — two large solid rectangles at ~55% from center.
    const aimW = Math.min(6, ap.runwayWidth * 0.18);
    const aimL = 22;
    for (const sign of [-1, 1]) {
      for (const xs of [-1, 1]) {
        group.add(makeBox(
          aimW, 0.05, aimL,
          ap.cx + xs * (halfW * 0.40), markY, ap.cz + sign * aimZOff,
          matLine,
        ));
      }
    }
  }

  return group;
}

function makeBox(
  w: number, h: number, d: number,
  x: number, y: number, z: number,
  mat: THREE.Material,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}
