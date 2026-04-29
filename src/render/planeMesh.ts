import * as THREE from 'three';

// Per-plane voxel-style meshes. Each aircraft now has its own silhouette so
// they actually look different in flight:
//   - Cub: original narrow taildragger, 2-blade prop.
//   - Beaver: fatter fuselage, round radial cowl, 3-blade prop.
//   - Otter: stretched Beaver with multiple cabin windows.
//   - Caravan: long tapered turbine cowl, tricycle gear, cargo pod.
//
// Body axes (same for every plane): +X right wing, +Y up, +Z forward (nose).
//
// Materials are shared per-builder so setColors() can repaint the four
// "skin" colors (primary fuselage, secondary wing, surface, accent) on the
// active plane without rebuilding meshes.
//
// Gear visuals are aware of the per-plane gear y-depth so the wheels meet
// the ground regardless of how tall the stance is. Compression offsets each
// gear group's Y by the simulation's `gearCompression[i]` per frame.

export type PlaneVisualId = 'cub' | 'beaver' | 'otter' | 'caravan';

export interface PlaneVisualInputs {
  pitch: number;     // -1..1 (stick aft = +1)
  roll: number;      // -1..1 (stick right = +1)
  yaw: number;       // -1..1
  throttle: number;  // 0..1
  flapStage: number; // 0..3
  propAdvance: number;     // accumulated rotation (rad)
  gearCompression: [number, number, number]; // L main, R main, third (tail or nose)
}

export interface PlaneVisual {
  group: THREE.Group;
  update(inputs: PlaneVisualInputs): void;
  setColors(c: { primary: number; secondary: number; surface: number; accent: number }): void;
}

const FLAP_PER_STAGE_RAD = (12 * Math.PI) / 180;
const AILERON_MAX_RAD = (18 * Math.PI) / 180;
const ELEVATOR_MAX_RAD = (22 * Math.PI) / 180;
const RUDDER_MAX_RAD = (24 * Math.PI) / 180;

interface PlaneSilhouette {
  // Fuselage box.
  fuse: { w: number; h: number; l: number; z: number };
  // Engine/cowl style and dimensions.
  cowl: { kind: 'box' | 'radial' | 'turbine'; w: number; h: number; l: number; z: number };
  // Pilot position (z in body frame).
  pilotZ: number;
  // Cockpit window dimensions.
  cockpitWindow: { w: number; h: number; l: number; y: number; z: number };
  // Side cabin windows (small panes along side, after pilot).
  cabinWindows: number;
  cabinWindowZStart: number;
  cabinWindowSpacingZ: number;
  // Wing.
  wingY: number;
  wingZ: number;
  wingSpan: number;
  wingChordFront: number;
  wingChordSurface: number;
  wingThickness: number;
  // Strut placement.
  strutX: number;            // x-offset of struts from centerline
  // Vertical stabilizer.
  vstab: { w: number; h: number; l: number; y: number; z: number };
  rudder: { w: number; h: number; l: number; z: number };
  // Horizontal stabilizer.
  hstab: { span: number; h: number; l: number; y: number; z: number };
  elevator: { span: number; h: number; l: number; z: number };
  // Prop.
  propBlades: 2 | 3;
  propRadius: number;        // half-length of each blade (so blade box = propRadius*2)
  propZ: number;
  spinner: boolean;          // sleek pointed spinner at hub (turbines)
  // Gear layout.
  gearLayout: 'taildragger' | 'tricycle';
  mainGearY: number;         // body-frame y of main gear contact
  mainGearX: number;         // |x| (one each side)
  mainGearZ: number;         // body-frame z
  thirdGearY: number;        // tail wheel y for taildragger / nose wheel y for tricycle
  thirdGearZ: number;        // tail wheel z (negative) or nose wheel z (positive)
  // Cargo pod under belly (Caravan).
  cargoPod?: { w: number; h: number; l: number; y: number; z: number };
}

const CUB_SILHOUETTE: PlaneSilhouette = {
  fuse: { w: 1.0, h: 1.1, l: 6.5, z: -0.2 },
  cowl: { kind: 'box', w: 1.1, h: 1.0, l: 1.0, z: 3.3 },
  pilotZ: 0.55,
  cockpitWindow: { w: 0.95, h: 0.7, l: 1.4, y: 0.65, z: 0.6 },
  cabinWindows: 0,
  cabinWindowZStart: 0,
  cabinWindowSpacingZ: 0,
  wingY: 1.0,
  wingZ: 0.4,
  wingSpan: 10.7,
  wingChordFront: 1.1,
  wingChordSurface: 0.5,
  wingThickness: 0.18,
  strutX: 2.2,
  vstab: { w: 0.15, h: 1.4, l: 1.0, y: 0.7, z: -3.2 },
  rudder: { w: 0.12, h: 1.3, l: 0.6, z: -3.7 },
  hstab: { span: 3.4, h: 0.12, l: 0.7, y: 0.05, z: -3.25 },
  elevator: { span: 3.3, h: 0.1, l: 0.45, z: -3.6 },
  propBlades: 2,
  propRadius: 1.1,
  propZ: 3.85,
  spinner: false,
  gearLayout: 'taildragger',
  mainGearY: -0.9,
  mainGearX: 1.4,
  mainGearZ: 0.6,
  thirdGearY: -0.5,
  thirdGearZ: -3.2,
};

const BEAVER_SILHOUETTE: PlaneSilhouette = {
  fuse: { w: 1.5, h: 1.4, l: 7.6, z: -0.3 },
  cowl: { kind: 'radial', w: 1.7, h: 1.6, l: 0.95, z: 3.95 },
  pilotZ: 0.7,
  cockpitWindow: { w: 1.4, h: 0.9, l: 1.7, y: 0.85, z: 0.7 },
  cabinWindows: 1,
  cabinWindowZStart: -0.6,
  cabinWindowSpacingZ: 1.0,
  wingY: 1.25,
  wingZ: 0.5,
  wingSpan: 14.6,
  wingChordFront: 1.4,
  wingChordSurface: 0.6,
  wingThickness: 0.22,
  strutX: 2.8,
  vstab: { w: 0.2, h: 1.7, l: 1.2, y: 0.85, z: -3.7 },
  rudder: { w: 0.16, h: 1.55, l: 0.7, z: -4.3 },
  hstab: { span: 4.4, h: 0.14, l: 0.85, y: 0.1, z: -3.8 },
  elevator: { span: 4.3, h: 0.12, l: 0.55, z: -4.225 },
  propBlades: 3,
  propRadius: 1.3,
  propZ: 4.5,
  spinner: false,
  gearLayout: 'taildragger',
  mainGearY: -1.05,
  mainGearX: 1.6,
  mainGearZ: 0.6,
  thirdGearY: -0.55,
  thirdGearZ: -3.7,
};

const OTTER_SILHOUETTE: PlaneSilhouette = {
  fuse: { w: 1.65, h: 1.55, l: 9.6, z: -0.5 },
  cowl: { kind: 'radial', w: 1.85, h: 1.75, l: 1.0, z: 5.05 },
  pilotZ: 1.0,
  cockpitWindow: { w: 1.55, h: 0.95, l: 1.7, y: 0.95, z: 1.0 },
  cabinWindows: 4,
  cabinWindowZStart: -0.5,
  cabinWindowSpacingZ: 1.0,
  wingY: 1.4,
  wingZ: 0.5,
  wingSpan: 17.7,
  wingChordFront: 1.5,
  wingChordSurface: 0.7,
  wingThickness: 0.24,
  strutX: 3.3,
  vstab: { w: 0.22, h: 1.95, l: 1.4, y: 0.95, z: -4.5 },
  rudder: { w: 0.18, h: 1.8, l: 0.85, z: -5.2 },
  hstab: { span: 5.0, h: 0.14, l: 0.9, y: 0.1, z: -4.6 },
  elevator: { span: 4.9, h: 0.12, l: 0.65, z: -5.05 },
  propBlades: 3,
  propRadius: 1.5,
  propZ: 5.55,
  spinner: false,
  gearLayout: 'taildragger',
  mainGearY: -1.1,
  mainGearX: 1.95,
  mainGearZ: 0.7,
  thirdGearY: -0.6,
  thirdGearZ: -4.5,
};

const CARAVAN_SILHOUETTE: PlaneSilhouette = {
  fuse: { w: 1.55, h: 1.55, l: 10.5, z: -0.6 },
  cowl: { kind: 'turbine', w: 1.4, h: 1.3, l: 1.6, z: 5.5 },
  pilotZ: 1.0,
  cockpitWindow: { w: 1.45, h: 0.9, l: 1.7, y: 0.95, z: 1.0 },
  cabinWindows: 5,
  cabinWindowZStart: -0.4,
  cabinWindowSpacingZ: 1.05,
  wingY: 1.5,
  wingZ: 0.4,
  wingSpan: 15.9,
  wingChordFront: 1.4,
  wingChordSurface: 0.7,
  wingThickness: 0.22,
  strutX: 2.7,
  vstab: { w: 0.2, h: 2.0, l: 1.5, y: 0.95, z: -4.7 },
  rudder: { w: 0.16, h: 1.85, l: 0.9, z: -5.5 },
  hstab: { span: 5.0, h: 0.14, l: 1.0, y: 0.1, z: -4.85 },
  elevator: { span: 4.9, h: 0.12, l: 0.7, z: -5.35 },
  propBlades: 3,
  propRadius: 1.35,
  propZ: 6.4,
  spinner: true,
  gearLayout: 'tricycle',
  mainGearY: -1.4,
  mainGearX: 1.5,
  mainGearZ: -0.3,
  thirdGearY: -1.4,
  thirdGearZ: 2.5,
  cargoPod: { w: 0.85, h: 0.7, l: 4.6, y: -0.95, z: -0.3 },
};

const SILHOUETTES: Record<PlaneVisualId, PlaneSilhouette> = {
  cub: CUB_SILHOUETTE,
  beaver: BEAVER_SILHOUETTE,
  otter: OTTER_SILHOUETTE,
  caravan: CARAVAN_SILHOUETTE,
};

export function buildPlaneMesh(id: PlaneVisualId = 'cub'): PlaneVisual {
  return buildVisual(SILHOUETTES[id]);
}

// ===== Helpers =====

// Wheel cylinder — cylinder axis runs along Z by default; rotated to lay flat.
const WHEEL_RADIUS_MAIN = 0.32;
const WHEEL_RADIUS_TAIL = 0.15;
const WHEEL_RADIUS_NOSE = 0.26;

function makeMainGear(
  x: number,
  gearY: number,
  gearZ: number,
  matAccent: THREE.Material,
  matWheel: THREE.Material,
): THREE.Group {
  const grp = new THREE.Group();
  grp.position.set(x, 0, gearZ);

  // Strut from body (y=0) down to just above wheel center.
  const wheelCenterLocalY = gearY + 0.05;     // wheel sits at gear contact + small offset
  const strutLength = -wheelCenterLocalY;
  const strut = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, strutLength, 0.1),
    matAccent,
  );
  strut.position.set((x > 0 ? -1 : 1) * 0.18, wheelCenterLocalY / 2, 0);
  grp.add(strut);

  const wheel = new THREE.Mesh(
    new THREE.CylinderGeometry(WHEEL_RADIUS_MAIN, WHEEL_RADIUS_MAIN, 0.18, 12),
    matWheel,
  );
  wheel.rotation.z = Math.PI / 2;
  wheel.position.set(0, wheelCenterLocalY, 0);
  grp.add(wheel);
  return grp;
}

function makeTailGear(
  gearY: number,
  gearZ: number,
  matAccent: THREE.Material,
  matWheel: THREE.Material,
): THREE.Group {
  const grp = new THREE.Group();
  grp.position.set(0, 0, gearZ);
  const wheelCenterLocalY = gearY + 0.04;
  const strutLength = -wheelCenterLocalY;
  const strut = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, strutLength, 0.06),
    matAccent,
  );
  strut.position.set(0, wheelCenterLocalY / 2, 0);
  grp.add(strut);
  const wheel = new THREE.Mesh(
    new THREE.CylinderGeometry(WHEEL_RADIUS_TAIL, WHEEL_RADIUS_TAIL, 0.1, 8),
    matWheel,
  );
  wheel.rotation.z = Math.PI / 2;
  wheel.position.set(0, wheelCenterLocalY, 0);
  grp.add(wheel);
  return grp;
}

function makeNoseGear(
  gearY: number,
  gearZ: number,
  matAccent: THREE.Material,
  matWheel: THREE.Material,
): THREE.Group {
  const grp = new THREE.Group();
  grp.position.set(0, 0, gearZ);
  const wheelCenterLocalY = gearY + 0.05;
  const strutLength = -wheelCenterLocalY;
  const strut = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, strutLength, 0.1),
    matAccent,
  );
  strut.position.set(0, wheelCenterLocalY / 2, 0);
  grp.add(strut);
  const wheel = new THREE.Mesh(
    new THREE.CylinderGeometry(WHEEL_RADIUS_NOSE, WHEEL_RADIUS_NOSE, 0.15, 12),
    matWheel,
  );
  wheel.rotation.z = Math.PI / 2;
  wheel.position.set(0, wheelCenterLocalY, 0);
  grp.add(wheel);
  return grp;
}

function buildVisual(spec: PlaneSilhouette): PlaneVisual {
  const root = new THREE.Group();

  const matFuse = new THREE.MeshLambertMaterial({ color: 0xd9b04a });
  const matWing = new THREE.MeshLambertMaterial({ color: 0xe6c466 });
  const matSurface = new THREE.MeshLambertMaterial({ color: 0xc9a14a });
  const matAccent = new THREE.MeshLambertMaterial({ color: 0x222226 });
  const matWindow = new THREE.MeshLambertMaterial({
    color: 0x4a6680,
    transparent: true,
    opacity: 0.55,
  });
  const matWheel = new THREE.MeshLambertMaterial({ color: 0x18181b });
  const matPilot = new THREE.MeshLambertMaterial({ color: 0x2a2f3d });
  const matPilotHead = new THREE.MeshLambertMaterial({ color: 0xc8a07a });
  const matPropBlur = new THREE.MeshBasicMaterial({
    color: 0x101012,
    transparent: true,
    opacity: 0.18,
    side: THREE.DoubleSide,
  });

  // ===== Fuselage =====
  const fuse = new THREE.Mesh(
    new THREE.BoxGeometry(spec.fuse.w, spec.fuse.h, spec.fuse.l),
    matFuse,
  );
  fuse.position.set(0, 0, spec.fuse.z);
  root.add(fuse);

  // ===== Engine/cowl =====
  if (spec.cowl.kind === 'box') {
    const nose = new THREE.Mesh(
      new THREE.BoxGeometry(spec.cowl.w, spec.cowl.h, spec.cowl.l),
      matAccent,
    );
    nose.position.set(0, 0, spec.cowl.z);
    root.add(nose);
  } else if (spec.cowl.kind === 'radial') {
    // Round radial: octagonal cylinder for a chunky-voxel "round" silhouette.
    const r = spec.cowl.w / 2;
    const cyl = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, spec.cowl.l, 8),
      matAccent,
    );
    cyl.rotation.x = Math.PI / 2;
    cyl.position.set(0, 0, spec.cowl.z);
    root.add(cyl);
    // Front flange ring (slightly larger) — gives the radial its lip.
    const flange = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 1.05, r * 1.05, 0.15, 8),
      matAccent,
    );
    flange.rotation.x = Math.PI / 2;
    flange.position.set(0, 0, spec.cowl.z + spec.cowl.l / 2);
    root.add(flange);
  } else {
    // Turbine: tapered cone (PT6 style — wide at firewall, narrow at spinner).
    const r1 = spec.cowl.w / 2 * 0.35;        // narrow front
    const r2 = spec.cowl.w / 2;               // wide back
    const cone = new THREE.Mesh(
      new THREE.CylinderGeometry(r1, r2, spec.cowl.l, 8),
      matAccent,
    );
    cone.rotation.x = -Math.PI / 2;           // rotate so r2 is at -Z (back)
    cone.position.set(0, -0.05, spec.cowl.z);
    root.add(cone);
    // Hump-style intake on top behind the prop (iconic Caravan look).
    const intake = new THREE.Mesh(
      new THREE.BoxGeometry(spec.cowl.w * 0.45, spec.cowl.h * 0.32, spec.cowl.l * 0.55),
      matAccent,
    );
    intake.position.set(0, spec.cowl.h * 0.45, spec.cowl.z - spec.cowl.l * 0.18);
    root.add(intake);
    // Exhaust stack on the side.
    const exhaust = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.18, 0.5),
      matAccent,
    );
    exhaust.position.set(spec.cowl.w / 2 * 0.85, -spec.cowl.h * 0.3, spec.cowl.z - 0.2);
    root.add(exhaust);
  }

  // ===== Pilot =====
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.75, 0.55), matPilot);
  torso.position.set(0, 0.35, spec.pilotZ);
  root.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.42, 0.42), matPilotHead);
  head.position.set(0, 0.95, spec.pilotZ);
  root.add(head);

  // ===== Cockpit window =====
  const win = new THREE.Mesh(
    new THREE.BoxGeometry(spec.cockpitWindow.w, spec.cockpitWindow.h, spec.cockpitWindow.l),
    matWindow,
  );
  win.position.set(0, spec.cockpitWindow.y, spec.cockpitWindow.z);
  win.renderOrder = 1;
  root.add(win);

  // ===== Cabin side windows (Beaver/Otter/Caravan only) =====
  for (let i = 0; i < spec.cabinWindows; i++) {
    const cz = spec.cabinWindowZStart - i * spec.cabinWindowSpacingZ;
    for (const sx of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.55, 0.7), matWindow);
      w.position.set(sx * (spec.fuse.w / 2 + 0.01), 0.25, cz);
      w.renderOrder = 1;
      root.add(w);
    }
  }

  // ===== Wing — fixed front + flaps (inboard TE) + ailerons (outboard TE) =====
  const wingY = spec.wingY;
  const wingZ = spec.wingZ;
  const fixedWing = new THREE.Mesh(
    new THREE.BoxGeometry(spec.wingSpan, spec.wingThickness, spec.wingChordFront),
    matWing,
  );
  fixedWing.position.set(0, wingY, wingZ + spec.wingChordSurface / 2);
  root.add(fixedWing);

  const flapSpan = spec.wingSpan * 0.30;
  const aileronSpan = spec.wingSpan * 0.25;
  const flapInnerEdge = 0.6;
  const aileronInnerEdge = spec.wingSpan / 2 - aileronSpan;

  function makeSurface(span: number, centerX: number) {
    const geo = new THREE.BoxGeometry(span, spec.wingThickness * 0.9, spec.wingChordSurface);
    geo.translate(0, 0, -spec.wingChordSurface / 2);     // hinge at front face
    const m = new THREE.Mesh(geo, matSurface);
    const pivot = new THREE.Group();
    pivot.position.set(centerX, wingY, wingZ);
    pivot.add(m);
    return pivot;
  }

  const flapL = makeSurface(flapSpan, -(flapInnerEdge + flapSpan / 2));
  const flapR = makeSurface(flapSpan, +(flapInnerEdge + flapSpan / 2));
  const aileronL = makeSurface(aileronSpan, -(aileronInnerEdge + aileronSpan / 2));
  const aileronR = makeSurface(aileronSpan, +(aileronInnerEdge + aileronSpan / 2));
  root.add(flapL, flapR, aileronL, aileronR);

  // ===== Wing struts =====
  // Strut goes from fuselage shoulder (~y = h/2) up to the wing leading edge.
  const strutTopY = wingY - spec.wingThickness * 0.5;
  const strutBottomY = spec.fuse.h * 0.45;
  const strutLen = strutTopY - strutBottomY;
  for (const x of [-spec.strutX, spec.strutX]) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.1, strutLen, 0.12), matAccent);
    s.position.set(x * 0.55, (strutTopY + strutBottomY) / 2, wingZ + spec.wingChordFront / 2);
    root.add(s);
  }

  // ===== Tail — vstab + rudder, hstab + elevator =====
  const vstab = new THREE.Mesh(
    new THREE.BoxGeometry(spec.vstab.w, spec.vstab.h, spec.vstab.l),
    matFuse,
  );
  vstab.position.set(0, spec.vstab.y, spec.vstab.z);
  root.add(vstab);
  const rudderGeo = new THREE.BoxGeometry(spec.rudder.w, spec.rudder.h, spec.rudder.l);
  rudderGeo.translate(0, 0, -spec.rudder.l / 2);
  const rudderMesh = new THREE.Mesh(rudderGeo, matSurface);
  const rudder = new THREE.Group();
  rudder.position.set(0, spec.vstab.y, spec.rudder.z);
  rudder.add(rudderMesh);
  root.add(rudder);

  const hstab = new THREE.Mesh(
    new THREE.BoxGeometry(spec.hstab.span, spec.hstab.h, spec.hstab.l),
    matWing,
  );
  hstab.position.set(0, spec.hstab.y, spec.hstab.z);
  root.add(hstab);
  const elevGeo = new THREE.BoxGeometry(spec.elevator.span, spec.elevator.h, spec.elevator.l);
  elevGeo.translate(0, 0, -spec.elevator.l / 2);
  const elevMesh = new THREE.Mesh(elevGeo, matSurface);
  const elevator = new THREE.Group();
  elevator.position.set(0, spec.hstab.y, spec.elevator.z);
  elevator.add(elevMesh);
  root.add(elevator);

  // ===== Propeller (still + blur) =====
  const propStill = new THREE.Group();
  for (let i = 0; i < spec.propBlades; i++) {
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(spec.propRadius * 2, 0.05, 0.1),
      matAccent,
    );
    blade.rotation.z = (i / spec.propBlades) * Math.PI * 2;
    propStill.add(blade);
  }
  propStill.position.set(0, 0, spec.propZ);
  root.add(propStill);

  if (spec.spinner) {
    // Pointed spinner cap forward of the prop (turbine signature).
    const spinner = new THREE.Mesh(
      new THREE.ConeGeometry(0.22, 0.5, 8),
      matAccent,
    );
    spinner.rotation.x = -Math.PI / 2;
    spinner.position.set(0, 0, spec.propZ + 0.3);
    root.add(spinner);
  }

  const propBlur = new THREE.Mesh(
    new THREE.CircleGeometry(spec.propRadius, 24),
    matPropBlur,
  );
  propBlur.rotation.y = Math.PI / 2;
  propBlur.position.set(0, 0, spec.propZ + 0.02);
  propBlur.visible = false;
  root.add(propBlur);

  // ===== Cargo pod under belly (Caravan) =====
  if (spec.cargoPod) {
    const pod = new THREE.Mesh(
      new THREE.BoxGeometry(spec.cargoPod.w, spec.cargoPod.h, spec.cargoPod.l),
      matAccent,
    );
    pod.position.set(0, spec.cargoPod.y, spec.cargoPod.z);
    root.add(pod);
  }

  // ===== Landing gear =====
  const mainGearL = makeMainGear(-spec.mainGearX, spec.mainGearY, spec.mainGearZ, matAccent, matWheel);
  const mainGearR = makeMainGear(+spec.mainGearX, spec.mainGearY, spec.mainGearZ, matAccent, matWheel);
  root.add(mainGearL, mainGearR);

  const thirdGear = spec.gearLayout === 'tricycle'
    ? makeNoseGear(spec.thirdGearY, spec.thirdGearZ, matAccent, matWheel)
    : makeTailGear(spec.thirdGearY, spec.thirdGearZ, matAccent, matWheel);
  root.add(thirdGear);

  return {
    group: root,
    setColors(c) {
      matFuse.color.setHex(c.primary);
      matWing.color.setHex(c.secondary);
      matSurface.color.setHex(c.surface);
      matAccent.color.setHex(c.accent);
    },
    update(inp) {
      const flapAngle = Math.min(inp.flapStage, 3) * FLAP_PER_STAGE_RAD;
      flapL.rotation.x = flapAngle;
      flapR.rotation.x = flapAngle;

      aileronL.rotation.x = AILERON_MAX_RAD * inp.roll;
      aileronR.rotation.x = -AILERON_MAX_RAD * inp.roll;

      elevator.rotation.x = -ELEVATOR_MAX_RAD * inp.pitch;
      // Right rudder (yaw +1) deflects rudder TE to the right — same direction
      // as the resulting nose-right yaw, matching real-aircraft convention.
      rudder.rotation.y = -RUDDER_MAX_RAD * inp.yaw;

      const blurMix = THREE.MathUtils.clamp(
        (inp.throttle - 0.18) * 4,
        0,
        1,
      );
      propBlur.visible = blurMix > 0.05;
      (propBlur.material as THREE.MeshBasicMaterial).opacity = 0.06 + 0.32 * blurMix;
      propStill.visible = blurMix < 0.95;
      propStill.rotation.z = inp.propAdvance;

      mainGearL.position.y = inp.gearCompression[0];
      mainGearR.position.y = inp.gearCompression[1];
      thirdGear.position.y = inp.gearCompression[2];
    },
  };
}
