// Simplified aerodynamic force model for a small bush plane.

import * as THREE from 'three';

export interface AircraftParams {
  mass: number;
  maxMass: number;        // MTOW: empty + fuel + cargo must stay below this
  wingArea: number;
  wingspan: number;
  aspectRatio: number;
  e: number;
  cl0: number;
  clAlpha: number;
  clMax: number;
  alphaStall: number;
  cd0: number;
  maxThrust: number;
  vMax: number;
  pitchRate: number;
  rollRate: number;
  yawRate: number;
  pitchDamp: number;
  rollDamp: number;
  yawDamp: number;
  flapClPerStage: number;
  flapCdPerStage: number;
  flapStages: number;
  // new
  propWashSpeed: number;        // m/s of effective air over elevator at full power, static
  pFactorStrength: number;      // N·m at full power, zero airspeed
  spinAutorotGain: number;      // multiplier on yaw produced by sustained stall+yaw
  // Adverse yaw: long-wing slow planes need rudder coordination — aileron
  // input creates opposite-direction yaw torque scaled by airspeed. STOL
  // planes get the strongest values; turbines / sleeker planes less.
  adverseYawCoef?: number;      // N·m per (roll-input × q × wingArea), default 0.06
  // Optional ground-handling modifiers from upgrades (alpine tires, skis).
  iceBrakeBonus?: number;       // multiplier on ice brake friction (default 1)
  iceSlipBonus?: number;        // multiplier on ice cornering friction (default 1)
  // Gear layout: 'taildragger' (default — tail wheel) or 'tricycle' (nose wheel).
  // Caravan-class turbines use tricycle; pistons use taildragger here.
  gearLayout?: 'taildragger' | 'tricycle';
  // Per-plane gear placement so the physics matches the visual silhouette.
  // Bigger planes need wider wheelbase + lower mains so the prop has clearance.
  gearMainX?: number; gearMainY?: number; gearMainZ?: number;
  gearThirdY?: number; gearThirdZ?: number;
}

export const SUPER_CUB: AircraftParams = {
  mass: 600,
  maxMass: 900,           // ~1985 lb gross — game-tuned, real Cub is ~770 kg
  wingArea: 16.6,
  wingspan: 10.7,
  aspectRatio: 6.9,
  e: 0.8,
  cl0: 0.25,
  clAlpha: 5.7,
  clMax: 1.6,
  alphaStall: 16 * Math.PI / 180,
  cd0: 0.045,
  maxThrust: 2400,
  vMax: 60,
  pitchRate: 3500,
  rollRate: 4500,
  yawRate: 2400,
  pitchDamp: 9500,
  rollDamp: 5500,
  yawDamp: 4500,
  flapClPerStage: 0.35,
  flapCdPerStage: 0.025,
  flapStages: 3,
  propWashSpeed: 18,
  pFactorStrength: 200,
  spinAutorotGain: 1800,
};

const RHO_SL = 1.225;

export function airDensity(altitudeM: number): number {
  return RHO_SL * Math.exp(-altitudeM / 8500);
}

export interface AeroResult {
  forceWorld: THREE.Vector3;
  torqueBody: THREE.Vector3;
  airspeed: number;
  alpha: number;
  beta: number;
  stalled: boolean;
  stallProximity: number;       // 0..1, 1 = at/past stall
  liftN: number;
  dragN: number;
  thrustN: number;
  groundEffect: number;
  rho: number;
}

export interface ControlInput {
  pitch: number;
  roll: number;
  yaw: number;
  throttle: number;
  flapStage: number;
  trim: number; // -1..1, added to effective pitch input
  brake: number; // 0..1, applied to braked gear (mains only)
}

// pre-allocated work vectors
const _vWorld = new THREE.Vector3();
const _vBody = new THREE.Vector3();
const _qInv = new THREE.Quaternion();
const _qBody = new THREE.Quaternion();
const _liftDir = new THREE.Vector3();
const _dragDir = new THREE.Vector3();
const _forceBody = new THREE.Vector3();
const _thrustBody = new THREE.Vector3();
const _airBody = new THREE.Vector3();

export function computeAero(
  p: AircraftParams,
  velocityWorld: THREE.Vector3,
  orientation: THREE.Quaternion,
  angVelBody: THREE.Vector3,
  controls: ControlInput,
  altitude: number,
  heightAGL: number,
  windWorld: THREE.Vector3,
  iceAccretion = 0,
): AeroResult {
  _vWorld.copy(velocityWorld).sub(windWorld);
  const airspeed = _vWorld.length();

  _qInv.copy(orientation).invert();
  _airBody.copy(_vWorld).applyQuaternion(_qInv);
  const u = _airBody.z;
  const w = _airBody.y;
  const v = _airBody.x;
  const alpha = Math.atan2(-w, Math.max(0.1, u));
  const beta = Math.atan2(v, Math.max(0.1, u));

  const rho = airDensity(altitude);
  const q = 0.5 * rho * airspeed * airspeed;

  // CL with stall break. Ice ruins lift (clMax-style penalty) — at full ice
  // the wing produces ~30 % less lift across the polar.
  const iceLiftMul = 1 - 0.3 * iceAccretion;
  const flap = Math.min(controls.flapStage, p.flapStages);
  const cl0 = (p.cl0 + flap * p.flapClPerStage) * iceLiftMul;
  let cl: number;
  const aAbs = Math.abs(alpha);
  if (aAbs < p.alphaStall) {
    cl = cl0 + p.clAlpha * alpha;
  } else {
    const sign = Math.sign(alpha);
    const over = aAbs - p.alphaStall;
    const peak = cl0 + p.clAlpha * p.alphaStall * sign;
    const decay = Math.exp(-over * 4);
    cl = peak * decay + sign * Math.sin(2 * alpha) * 0.6 * (1 - decay);
  }
  const stalled = aAbs >= p.alphaStall;
  const stallProximity = THREE.MathUtils.clamp(
    (aAbs - (p.alphaStall - 0.09)) / 0.09,
    0,
    1,
  );

  // Ground effect:
  //   - induced drag drops to ~45% at touchdown height (well-known McCormick)
  //   - lift increases by ~12% at touchdown height (suppressed downwash → wing
  //     sees more usable AoA), tapering to zero by h/b ≈ 1
  // Together these give the classic "float" on landing flare.
  const hb = heightAGL / p.wingspan;
  const groundEffect = hb < 1.1 ? Math.max(0.45, hb / 1.1) : 1.0;
  const liftBoost = hb < 1.0 ? 1 + 0.12 * (1 - hb) * (1 - hb) : 1.0;

  const cdInduced = (cl * cl) / (Math.PI * p.aspectRatio * p.e) * groundEffect;
  const cdFlap = flap * p.flapCdPerStage;
  const cd = p.cd0 + cdInduced + cdFlap;

  const liftN = q * p.wingArea * cl * liftBoost;
  const dragN = q * p.wingArea * cd;

  // Thrust scaled by density altitude. Falls off with airspeed.
  const thrustN =
    controls.throttle *
    p.maxThrust *
    (rho / RHO_SL) *
    Math.max(0, 1 - u / p.vMax);
  _thrustBody.set(0, 0, thrustN);

  if (airspeed > 0.01) {
    _vBody.copy(_airBody).normalize();
    _liftDir.set(0, 1, 0);
    const dot = _liftDir.dot(_vBody);
    _liftDir.addScaledVector(_vBody, -dot).normalize();
    _dragDir.copy(_vBody).multiplyScalar(-1);
    _forceBody
      .copy(_liftDir).multiplyScalar(liftN)
      .addScaledVector(_dragDir, dragN)
      .add(_thrustBody);
  } else {
    _forceBody.copy(_thrustBody);
  }

  // Side-slip drag — opposes lateral motion through the air. Higher coef
  // makes cross-controlled slipping noticeably effective for energy
  // management on approach (textbook STOL technique).
  const ySideForce = -v * Math.abs(v) * rho * p.wingArea * 0.7;
  _forceBody.x += ySideForce;

  // Aero stability torques (weathercock + dihedral) require real airflow over
  // the surfaces. Fade them in over the typical taxi → takeoff range so light
  // wind doesn't yank a slow-rolling plane around.
  const aeroAuth = Math.min(1, Math.max(0, (airspeed - 5) / 12));
  const weatherCock = beta * 0.5 * q * p.wingArea * aeroAuth;
  const dihedralRoll = beta * 0.10 * q * p.wingArea * aeroAuth;

  _qBody.copy(orientation);
  const forceWorld = _forceBody.clone().applyQuaternion(_qBody);

  // PROP WASH: prop blast over the tail makes the elevator/rudder effective
  // even when the airframe is barely moving. Critical for taildragger AND
  // for slow-flight approach control. Idle prop still moves a fair amount
  // of air — keep a 20% baseline so elevator stays responsive at idle on
  // slow approach.
  const propWash = p.propWashSpeed * (0.2 + 0.8 * controls.throttle);
  const effectiveTailAirspeed = Math.max(airspeed, propWash);
  const ctrlScale = Math.min(1, effectiveTailAirspeed / 25);

  // P-FACTOR: at high power and low airspeed the descending prop blade has
  // higher AoA than the ascending blade, producing a left-yaw torque
  // (positive about +Y in my convention is nose-right, so this is NEGATIVE).
  const pFactor =
    -p.pFactorStrength * controls.throttle * Math.max(0, 1 - airspeed / 30);

  // POWER-ON STALL kick: prop wash over the tail with high alpha pitches the
  // nose UP a bit (giving the classic "stall snaps higher" feel). Only active
  // near/past stall and at high power.
  const powerOnPitchUp =
    -stallProximity * 0.6 * controls.throttle * p.pitchRate * 0.4;

  // STALL BUFFET: pseudo-random small-angular-acceleration noise on roll/pitch
  // when in the last 5° before stall AND once stalled.
  const buffet = stallProximity > 0.05 ? stallProximity : 0;
  const buffetMag = buffet * 900;
  const buffetPitch = (Math.random() - 0.5) * 2 * buffetMag;
  const buffetRoll = (Math.random() - 0.5) * 2 * buffetMag * 0.8;
  const buffetYaw = (Math.random() - 0.5) * 2 * buffetMag * 0.5;

  // SPIN AUTOROTATION: when stalled, sustained yaw rate increases (positive
  // feedback) until recovery. Capped.
  const spinForce = stalled
    ? Math.sign(angVelBody.y || 0.001) *
      Math.min(Math.abs(angVelBody.y), 3) *
      p.spinAutorotGain *
      0.3
    : 0;

  // Effective pitch input = stick + trim. Trim shifts the equilibrium; the
  // stick keeps usable authority past it (clamped to [-1.3, 1.3] so a fully
  // nose-up trimmed plane can still be pushed nose-down by the stick).
  const pitchInput = THREE.MathUtils.clamp(controls.pitch + controls.trim, -1.3, 1.3);

  // Adverse yaw — roll input creates opposite-direction yaw torque scaled by
  // airspeed (the down-going aileron has more drag than the up-going one).
  // Long-wing slow planes feel this strongly; need rudder to coordinate.
  // Boosted near stall where the aileron drag asymmetry peaks.
  const adverseYawCoef = p.adverseYawCoef ?? 0.08;
  const adverseYawAoaBoost = 1 + 2 * stallProximity;
  const adverseYaw = -controls.roll * adverseYawCoef * q * p.wingArea * aeroAuth * adverseYawAoaBoost;

  const torqueBody = new THREE.Vector3(
    -pitchInput * p.pitchRate * ctrlScale -
      angVelBody.x * p.pitchDamp +
      powerOnPitchUp +
      buffetPitch,
    controls.yaw * p.yawRate * ctrlScale -
      angVelBody.y * p.yawDamp +
      weatherCock +
      pFactor +
      adverseYaw +
      buffetYaw +
      spinForce,
    -controls.roll * p.rollRate * ctrlScale -
      angVelBody.z * p.rollDamp +
      dihedralRoll +
      buffetRoll,
  );

  return {
    forceWorld,
    torqueBody,
    airspeed,
    alpha,
    beta,
    stalled,
    stallProximity,
    liftN,
    dragN,
    thrustN,
    groundEffect,
    rho,
  };
}
