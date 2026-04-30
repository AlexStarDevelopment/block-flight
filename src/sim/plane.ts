import * as THREE from 'three';
import { computeAero, SUPER_CUB, type AircraftParams, type ControlInput, type AeroResult } from './aero';
import { biomeAt, heightAt, SEA_LEVEL } from '../world/terrain';
import { VOXEL_SIZE } from '../world/voxel';

// SEA_LEVEL=28 is the world-Y of the TOP water VOXEL; the visible top face of
// that voxel sits one voxel higher (water surface Y = 30 with VOXEL_SIZE=2).
// All physics that interacts with the visible water surface must use this.
const WATER_SURFACE_Y = SEA_LEVEL + VOXEL_SIZE;
import { isIcySurfaceAt } from '../world/landingSites';
import { tempCAt } from '../weather';
import { getCityHazards } from '../render/cityInfra';
import { getCityBuildingBoxes } from '../render/cityBuildings';

// True if the column at (x, z) is icy — snow biome at altitude, frozen ocean,
// or a snow landing site. Brake/slip friction get scaled WAY down here.
function isIcyAt(x: number, z: number): boolean {
  if (isIcySurfaceAt(x, z)) return true;
  const h = heightAt(x, z);
  if (h > 130) return true;
  const b = biomeAt(x, z);
  if (b === 'snowy_tundra') return true;
  if (b === 'frozen_ocean') return true;
  if (b === 'tundra' && h > 75) return true;
  if (b === 'taiga' && h > 90) return true;
  return false;
}

// World Y of the top face of the voxel that contains the ground at (x, z).
// With 2 m blocks, terrain steps in 2 m increments; gear/crash checks need the
// actual top face, not the underlying continuous height.
//
// For frozen-ocean tiles we return the top of the ICE cap voxel (sits on
// SEA_LEVEL) instead of the seabed, so the gear physics has a solid surface
// to land on.
function surfaceTopY(x: number, z: number): number {
  const h = heightAt(x, z);
  const top = Math.floor(h / VOXEL_SIZE) * VOXEL_SIZE + VOXEL_SIZE;
  if (top <= SEA_LEVEL && biomeAt(x, z) === 'frozen_ocean') {
    // ICE_PACK voxel sits at the SEA_LEVEL voxel — its top is +2 m above SEA.
    return SEA_LEVEL + VOXEL_SIZE;
  }
  return top;
}

// City obstacle collision. Antennas = vertical cylinders; cables = line
// segments; buildings = AABBs. Plane CG is the test point; we use a bounding
// sphere of ~6 m (rough wing half-span) so wing strikes count too.
const PLANE_HAZARD_R = 6.0;
const PLANE_BUILDING_R = 5.5;
function checkCityBuildings(planePos: THREE.Vector3): string | null {
  const boxes = getCityBuildingBoxes();
  if (boxes.length === 0) return null;
  // Quick spherical-vs-AABB: closest-point on box to plane center, then dist²
  // vs sphere radius². Cheap enough for ~1500 boxes per frame.
  const r2 = PLANE_BUILDING_R * PLANE_BUILDING_R;
  const px = planePos.x, py = planePos.y, pz = planePos.z;
  for (const b of boxes) {
    if (px > b.maxX + PLANE_BUILDING_R || px < b.minX - PLANE_BUILDING_R) continue;
    if (pz > b.maxZ + PLANE_BUILDING_R || pz < b.minZ - PLANE_BUILDING_R) continue;
    if (py > b.maxY + PLANE_BUILDING_R || py < b.minY - PLANE_BUILDING_R) continue;
    const cx = Math.max(b.minX, Math.min(px, b.maxX));
    const cy = Math.max(b.minY, Math.min(py, b.maxY));
    const cz = Math.max(b.minZ, Math.min(pz, b.maxZ));
    const dx = px - cx, dy = py - cy, dz = pz - cz;
    if (dx * dx + dy * dy + dz * dz < r2) {
      return `Building strike — ${b.zone}`;
    }
  }
  return null;
}

function checkCityHazards(planePos: THREE.Vector3): string | null {
  const haz = getCityHazards();
  if (haz.length === 0) return null;
  for (const h of haz) {
    if (h.kind === 'antenna') {
      const dx = planePos.x - h.x;
      const dz = planePos.z - h.z;
      const horiz = Math.hypot(dx, dz);
      if (horiz < h.radius + PLANE_HAZARD_R &&
          planePos.y > h.baseY - PLANE_HAZARD_R &&
          planePos.y < h.topY + PLANE_HAZARD_R) {
        return `Antenna strike — ${h.name}`;
      }
    } else {
      // Distance from point planePos to line segment AB.
      const ax = h.ax, ay = h.ay, az = h.az;
      const bx = h.bx, by = h.by, bz = h.bz;
      const abx = bx - ax, aby = by - ay, abz = bz - az;
      const apx = planePos.x - ax, apy = planePos.y - ay, apz = planePos.z - az;
      const abLenSq = abx * abx + aby * aby + abz * abz;
      if (abLenSq < 1) continue;
      const t = Math.max(0, Math.min(1, (apx * abx + apy * aby + apz * abz) / abLenSq));
      const cx = ax + t * abx;
      const cy = ay + t * aby;
      const cz = az + t * abz;
      const distSq = (planePos.x - cx) * (planePos.x - cx)
                    + (planePos.y - cy) * (planePos.y - cy)
                    + (planePos.z - cz) * (planePos.z - cz);
      if (distSq < PLANE_HAZARD_R * PLANE_HAZARD_R) {
        return `Wire strike — power line`;
      }
    }
  }
  return null;
}

// Module-scratch vectors so plane.step doesn't allocate per call.
const _force = new THREE.Vector3();
const _totalTorqueBody = new THREE.Vector3();
const _world = new THREE.Vector3();
const _wWorld = new THREE.Vector3();
const _rWorld = new THREE.Vector3();
const _vPoint = new THREE.Vector3();
const _horizV = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _fricForce = new THREE.Vector3();
const _fVec = new THREE.Vector3();
const _torqueBody = new THREE.Vector3();
const _qInv = new THREE.Quaternion();
const _accel = new THREE.Vector3();
const _angAccel = new THREE.Vector3();
const _dq = new THREE.Quaternion();
const _qd = new THREE.Quaternion();

interface GearPoint {
  pos: THREE.Vector3;
  springK: number;
  damping: number;
  restLength: number;
  rollFriction: number;
  slipFriction: number;
  braked: boolean;       // true on main wheels (toe brakes); false on tailwheel
}

// Body box used for crash detection. Each entry is a body-frame point that
// shouldn't touch the ground. We sample the heightAt under each.
// `wingtip` flag: true for wingtips — the only probes that fire a water strike
// for float planes (since pontoons handle the nose/tail/inboard).
interface CrashProbe { p: THREE.Vector3; wingtip: boolean; }
const CRASH_PROBES: CrashProbe[] = [
  { p: new THREE.Vector3(0, 0, 3.5),      wingtip: false }, // nose
  { p: new THREE.Vector3(-5.0, 1.0, 0.4), wingtip: true  }, // left wingtip
  { p: new THREE.Vector3(5.0, 1.0, 0.4),  wingtip: true  }, // right wingtip
  { p: new THREE.Vector3(0, 0.7, -3.6),   wingtip: false }, // tail vstab
  { p: new THREE.Vector3(-1.6, 1.0, 0.4), wingtip: false }, // left wing inboard
  { p: new THREE.Vector3(1.6, 1.0, 0.4),  wingtip: false }, // right wing inboard
];

export class Plane {
  params: AircraftParams;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  quat = new THREE.Quaternion();
  angVel = new THREE.Vector3();

  controls: ControlInput = { pitch: 0, roll: 0, yaw: 0, throttle: 0, flapStage: 0, trim: 0, brake: 0 };

  gear: GearPoint[] = [
    { pos: new THREE.Vector3(-1.4, -0.9, 0.6), springK: 28000, damping: 2400, restLength: 0.3, rollFriction: 0.035, slipFriction: 0.9, braked: true },
    { pos: new THREE.Vector3(1.4, -0.9, 0.6), springK: 28000, damping: 2400, restLength: 0.3, rollFriction: 0.035, slipFriction: 0.9, braked: true },
    { pos: new THREE.Vector3(0, -0.5, -3.2), springK: 14000, damping: 1400, restLength: 0.2, rollFriction: 0.05, slipFriction: 0.7, braked: false },
  ];
  // Inertia tensor — scales with plane mass in swapTo so heavier planes feel
  // heavier (less twitchy in pitch/roll) instead of using Cub-tuned values.
  inertiaX = 1200;
  inertiaY = 1800;
  inertiaZ = 800;

  lastAero: AeroResult | null = null;
  onGround = false;
  onWater = false;        // float plane is in water contact (any gear)
  gearCompression: [number, number, number] = [0, 0, 0];
  propAdvance = 0;

  // Mass / payload state — fuel capacity + burn vary per plane.
  fuelGallons = 24;
  fuelMaxGallons = 24;
  idleGph = 5;
  fullGph = 13;
  cargoKg = 0;
  // True once fuel has run out. Stays true until refueling; while set,
  // throttle is forced to 0 in step() so the engine produces no thrust even
  // if the player keeps the throttle key held.
  engineDead = false;
  static GAL_TO_KG = 2.72;   // ~6 lb/gal avgas — same fuel for all planes

  totalMass(): number {
    return this.params.mass + this.fuelGallons * Plane.GAL_TO_KG + this.cargoKg;
  }

  // Swap to a different aircraft type. Used when the player buys/switches
  // planes in the hangar. Resets cargo and crash state; preserves position.
  swapTo(params: AircraftParams, capacityGal: number, idleGph: number, fullGph: number, fuelGal: number) {
    this.params = params;
    this.fuelMaxGallons = capacityGal;
    this.idleGph = idleGph;
    this.fullGph = fullGph;
    this.fuelGallons = Math.min(fuelGal, capacityGal);
    this.engineDead = this.fuelGallons <= 0;
    this.cargoKg = 0;
    this.crashed = false;
    this.crashCause = '';
    this.iceAccretion = 0;
    this.passengerComfort = 100;

    // Scale gear stiffness/damping AND inertia by mass ratio so heavier planes
    // don't bottom-out the Cub-spec gear (which puts the body so low the prop
    // probe sits below ground = constant prop strike). Inertia scales linearly
    // with mass so angular acceleration ≈ same as Cub at full input.
    const massRatio = params.mass / SUPER_CUB.mass;
    this.gear[0].springK = 28000 * massRatio;
    this.gear[0].damping = 2400 * massRatio;
    this.gear[1].springK = 28000 * massRatio;
    this.gear[1].damping = 2400 * massRatio;
    this.inertiaX = 1200 * massRatio;
    this.inertiaY = 1800 * massRatio;
    this.inertiaZ = 800 * massRatio;

    // Gear layout: taildragger (default) or tricycle. Each plane provides its
    // own gear placement so the visual mesh's wheels actually meet the ground.
    // Defaults match the Cub silhouette / Caravan turbine stance.
    const tricycle = params.gearLayout === 'tricycle';
    const gx0 = params.gearMainX ?? (tricycle ? 1.5 : 1.4);
    const gy0 = params.gearMainY ?? (tricycle ? -1.4 : -0.9);
    const gz0 = params.gearMainZ ?? (tricycle ? -0.3 : 0.6);
    const tgy0 = params.gearThirdY ?? (tricycle ? -1.4 : -0.5);
    const tgz0 = params.gearThirdZ ?? (tricycle ? 2.5 : -3.2);
    // Float plane: gear contact moves DOWN to the pontoon bottom (the wheel
    // is inside the pontoon and touches ground at the pontoon-bottom plane).
    // Also widen the stance — pontoons sit further apart than the wheels.
    // This places the pontoon visual cleanly below the fuselage with a gap
    // for visible struts, the way real float planes look.
    const onFloats = params.hasFloats === true;
    const gx = onFloats ? gx0 + 0.3 : gx0;
    const gy = onFloats ? gy0 - 0.6 : gy0;
    const gz = gz0;
    const tgy = onFloats ? tgy0 - 0.6 : tgy0;
    const tgz = tgz0;
    this.gear[0].pos.set(-gx, gy, gz);
    this.gear[1].pos.set(gx, gy, gz);
    this.gear[2].pos.set(0, tgy, tgz);
    // Tricycle nose wheel needs to be near-as-stiff as the mains so it can
    // resist pitch transfer under hard braking — otherwise the body rotates
    // forward faster than the nose strut can compress and the prop hits.
    // Tail wheel can stay lighter (carries 5-10% of weight, never braked).
    if (tricycle) {
      this.gear[2].springK = 24000 * massRatio;
      this.gear[2].damping = 2200 * massRatio;
    } else {
      this.gear[2].springK = 14000 * massRatio;
      this.gear[2].damping = 1400 * massRatio;
    }
    this.gear[2].rollFriction = 0.05;
    this.gear[2].slipFriction = 0.7;
    this.gear[2].braked = false;
    this.tricycle = tricycle;
  }
  // Layout flag — used by the brake torque coupling so tricycle planes don't
  // pitch as aggressively as taildraggers under braking.
  private tricycle = false;

  // crash state
  crashed = false;
  crashCause: string = '';
  // wing drop on stall: fired once on transition into stall
  private wasStalled = false;
  // hardest gear impact this step (m/s downward) for crash threshold
  lastImpactSpeed = 0;
  // Prop strike: true for one step on the rising edge of the prop disc
  // contacting ground. Cooldown prevents repeated triggers in a single contact.
  propStrike = false;
  private propStrikeCooldown = 0;

  // Passenger comfort score (0..100). Starts full; degrades during the flight
  // on rough motions. Mission system reads this to compute the tip multiplier.
  passengerComfort = 100;
  private prevVelY = 0;
  resetComfort() { this.passengerComfort = 100; this.prevVelY = this.vel.y; }

  // Wing ice accumulation (0..1). Builds above ~3000m AGL when temp ≤ 0°C,
  // sheds below 2000m AGL or when warmer. At 1.0, max lift drops by ~30 %.
  iceAccretion = 0;

  constructor(params: AircraftParams = SUPER_CUB) {
    this.params = params;
  }

  reset(pos: THREE.Vector3, headingRad = 0) {
    this.pos.copy(pos);
    this.vel.set(0, 0, 0);
    this.quat.setFromEuler(new THREE.Euler(0, headingRad, 0, 'YXZ'));
    this.angVel.set(0, 0, 0);
    this.controls.throttle = 0;
    this.controls.flapStage = 0;
    this.controls.trim = 0;
    this.controls.brake = 0;
    this.crashed = false;
    this.crashCause = '';
    this.wasStalled = false;
    this.lastImpactSpeed = 0;
    this.propStrike = false;
    this.propStrikeCooldown = 0;
    this.fuelGallons = this.fuelMaxGallons;
    this.engineDead = false;
    this.cargoKg = 0;
    this.passengerComfort = 100;
    this.prevVelY = 0;
    this.iceAccretion = 0;
  }

  altitudeAGL(): number {
    return this.pos.y - surfaceTopY(Math.floor(this.pos.x), Math.floor(this.pos.z));
  }

  step(dt: number, windWorld: THREE.Vector3) {
    if (this.crashed) {
      // freeze visual; let it sit
      this.gearCompression = [0, 0, 0];
      return;
    }

    const altitude = this.pos.y;
    const agl = this.altitudeAGL();

    // Engine starvation: zero throttle BEFORE aero so no thrust is produced
    // this frame. Stays dead until refueling clears the flag. Overweight
    // operation — over MTOW — also forces throttle to 0; the engine simply
    // can't produce useful power for an over-grossed airframe in this sim, so
    // the player has to burn fuel or shed cargo before it'll fly.
    if (this.engineDead || this.fuelGallons <= 0 || this.totalMass() > this.params.maxMass) {
      this.controls.throttle = 0;
    }

    const aero = computeAero(
      this.params,
      this.vel,
      this.quat,
      this.angVel,
      this.controls,
      altitude,
      Math.max(0, agl),
      windWorld,
      this.iceAccretion,
    );
    this.lastAero = aero;

    // Fuel burn (gph → gal/sec). Engine quits when dry and stays dead until
    // refueling — engineDead is what main.ts checks to mute the throttle.
    if (!this.engineDead) {
      const gph = this.idleGph + this.controls.throttle * (this.fullGph - this.idleGph);
      this.fuelGallons -= gph / 3600 * dt;
    }
    if (this.fuelGallons <= 0) {
      this.fuelGallons = 0;
      this.engineDead = true;
      this.controls.throttle = 0;
    }

    // Use TOTAL mass for force integration so fuel + cargo affect performance.
    const mass = this.totalMass();

    _force.copy(aero.forceWorld);
    _force.y -= 9.81 * mass;

    _totalTorqueBody.copy(aero.torqueBody);
    if (aero.stalled && !this.wasStalled) {
      // Wing-drop on stall transition. STOL planes (Cub/Beaver/Otter/Caravan)
      // have very mild stall breaks in real life — gentle g-roll with no
      // sharp wing drop unless cross-controlled. 700 N·m gives a noticeable
      // wing-low tendency that's easy to recover.
      const sign = Math.random() < 0.5 ? -1 : 1;
      _totalTorqueBody.z += sign * 700;
    }
    this.wasStalled = aero.stalled;

    let touched = 0;
    let touchedWater = 0;
    let maxImpact = 0;
    let gearIdx = 0;
    this.gearCompression = [0, 0, 0];
    _qInv.copy(this.quat).invert();
    // Icy surfaces under the plane → reduce brake authority + slip friction.
    // Alpine-tires / skis upgrade boosts both via iceBrakeBonus / iceSlipBonus.
    const icy = isIcyAt(this.pos.x, this.pos.z);
    const iceBrakeBonus = this.params.iceBrakeBonus ?? 1;
    const iceSlipBonus = this.params.iceSlipBonus ?? 1;
    const brakeFrictionMul = icy ? Math.min(1, 0.25 * iceBrakeBonus) : 1.0;
    const slipFrictionMul = icy ? Math.min(1, 0.4 * iceSlipBonus) : 1.0;
    const hasFloats = this.params.hasFloats === true;
    for (const g of this.gear) {
      _world.copy(g.pos).applyQuaternion(this.quat).add(this.pos);
      const px = Math.floor(_world.x);
      const pz = Math.floor(_world.z);
      const terrainTop = surfaceTopY(px, pz);
      // Float planes: water VISIBLE SURFACE acts as the gear floor.
      // WATER_SURFACE_Y = SEA_LEVEL + VOXEL_SIZE = 30, the top face of the
      // highest water voxel. Earlier code used SEA_LEVEL=28 directly, which
      // put the equilibrium 2 m below the actual water mesh — visually the
      // plane was submerged.
      let groundY = terrainTop;
      let onWater = false;
      if (hasFloats && terrainTop <= SEA_LEVEL) {
        groundY = WATER_SURFACE_Y;
        onWater = true;
      }
      const compression = (groundY + g.restLength) - _world.y;
      if (compression > 0) {
        touched++;
        if (onWater) touchedWater++;
        this.gearCompression[gearIdx] = Math.min(compression, g.restLength);
        _wWorld.copy(this.angVel).applyQuaternion(this.quat);
        _rWorld.copy(_world).sub(this.pos);
        _vPoint.copy(_wWorld).cross(_rWorld).add(this.vel);
        const vY = _vPoint.y;
        if (-vY > maxImpact) maxImpact = -vY;
        const springK = onWater ? g.springK * 1.2 : g.springK;
        const damping = onWater ? g.damping * 2.0 : g.damping;
        // Cap spring compression so a deep-underwater spawn doesn't generate
        // millions of newtons. The buoyancy backstop handles the bulk of
        // the lift below sea level — the spring just cushions normal touchdown.
        const cappedCompression = Math.min(compression, g.restLength * 1.5);
        const fSpring = springK * cappedCompression;
        const fDamp = -damping * vY;
        const fUp = Math.max(0, fSpring + fDamp);
        _force.y += fUp;
        _horizV.set(_vPoint.x, 0, _vPoint.z);
        _fwd.set(0, 0, 1).applyQuaternion(this.quat);
        _fwd.y = 0;
        if (_fwd.lengthSq() > 1e-6) _fwd.normalize();
        _right.set(-_fwd.z, 0, _fwd.x);
        const vForward = _horizV.dot(_fwd);
        const vSide = _horizV.dot(_right);
        _fricForce.set(0, 0, 0);
        if (onWater) {
          // Water drag, per gear contact (3 contacts → divide by 3 to get
          // total). Models the four real seaplane regimes:
          //
          //   Displacement (0-5 m/s)  — gentle drag, plane plowing slowly.
          //   Hump rise (5-11 m/s)    — bow wave grows; drag climbs sharply.
          //   Peak hump (~11 m/s)     — drag ≈ 27 % of weight; thrust margin
          //                              is razor-thin, so heavily loaded
          //                              planes really struggle to break free.
          //   Breaking onto step      — drag falls as float climbs out of
          //   (11-16 m/s)              its bow wave.
          //   Planing (>16 m/s)       — float on top of water, low drag,
          //                              accelerates freely to liftoff at
          //                              ~20 m/s (40 kt).
          //
          // At idle the same drag curve acts as effective brakes — a Cub on
          // step decelerates back through the hump within ~10 s without power.
          // Tuned so a Cub on EDO floats hits ~25-35 s and ~250-350 m water
          // run at full throttle, matching real PA-18 on EDO 2000 numbers.
          const speed = Math.hypot(vForward, vSide);
          let totalCoef: number;
          if (speed < 5) {
            totalCoef = 0.07;
          } else if (speed < 11) {
            const t = (speed - 5) / 6;
            totalCoef = 0.07 + 0.13 * t;        // ramp up to hump peak (0.20)
          } else if (speed < 16) {
            const t = (speed - 11) / 5;
            totalCoef = 0.20 - 0.16 * t;        // breaking onto step
          } else {
            totalCoef = 0.035;                  // planing
          }
          const dragCoefPerGear = totalCoef * mass / 3;
          if (Math.abs(vForward) > 0.01) {
            _fricForce.addScaledVector(_fwd, -Math.sign(vForward) * dragCoefPerGear * Math.abs(vForward));
          }
          // Lateral water drag — pontoons resist sideslip strongly but not
          // so hard you can't kick a turn with rudder.
          if (Math.abs(vSide) > 0.01) {
            _fricForce.addScaledVector(_right, -Math.sign(vSide) * mass * 1.2 * Math.abs(vSide));
          }
        } else {
          // Land: rolling/brake friction (existing behavior).
          // Brake amplifier — 12× gives µ~0.42 at full brake on dry asphalt.
          const brakeMul = g.braked ? 1 + this.controls.brake * 12 * brakeFrictionMul : 1;
          const effectiveRoll = g.rollFriction * brakeMul;
          if (Math.abs(vForward) > 0.01) {
            const mag = Math.min(effectiveRoll * fUp, mass * 8);
            _fricForce.addScaledVector(_fwd, -Math.sign(vForward) * mag);
          }
          if (Math.abs(vSide) > 0.01) {
            const mag = Math.min(g.slipFriction * fUp * slipFrictionMul, mass * 4);
            _fricForce.addScaledVector(_right, -Math.sign(vSide) * mag);
          }
        }
        _force.add(_fricForce);

        _fVec.set(0, fUp, 0).add(_fricForce);
        _torqueBody.copy(_rWorld).cross(_fVec).applyQuaternion(_qInv);
        // Smooth ramp from low coupling at idle (avoids "nose over on throttle
        // up" from rolling-friction torque dominating) to strong coupling on
        // hard braking (so braking actually pitches the nose down for taildraggers).
        // Tricycle planes use a much weaker coupling — the nose wheel constrains
        // the front, real tricycles barely pitch under brakes.
        // On water, suppress brake coupling — there's nothing to brake against.
        const brakeCouple = onWater ? 0 : (this.tricycle ? 0.18 : 0.80);
        const couple = 0.05 + this.controls.brake * brakeCouple;
        _totalTorqueBody.addScaledVector(_torqueBody, couple);
      }
      gearIdx++;
    }
    this.onGround = touched > 0;
    this.onWater = touchedWater > 0;
    this.lastImpactSpeed = maxImpact;

    // Float plane buoyancy backstop — the gear spring catches MOST water
    // contacts, but a fast or steep dive can punch the plane through before
    // the spring builds up. Add a strong upward force whenever the plane's
    // CG is at-or-below sea level over water. Sufficient to cap descent
    // rate immediately and float the plane back to surface.
    if (hasFloats) {
      const groundCenter = surfaceTopY(Math.floor(this.pos.x), Math.floor(this.pos.z));
      if (groundCenter <= SEA_LEVEL && this.pos.y < WATER_SURFACE_Y + 0.5) {
        const rawSub = Math.max(0, WATER_SURFACE_Y + 0.5 - this.pos.y);
        const submersion = Math.min(1.0, rawSub);
        const buoyancyForce = mass * 14 * submersion;
        const dampForce = -this.vel.y * mass * 3;
        _force.y += Math.max(0, buoyancyForce + dampForce);
        this.onWater = true;
        this.onGround = true;
      }
    }
    // HARD WATER FLOOR: float plane CANNOT pass below the visible waterline.
    const FLOAT_WATERLINE = WATER_SURFACE_Y - 0.2;
    if (hasFloats) {
      const gc = surfaceTopY(Math.floor(this.pos.x), Math.floor(this.pos.z));
      if (gc <= SEA_LEVEL && this.pos.y < FLOAT_WATERLINE) {
        this.pos.y = FLOAT_WATERLINE;
        if (this.vel.y < 0) this.vel.y = 0;
        this.onWater = true;
        this.onGround = true;
      }
    }

    // Tailwheel steering: when on the ground, rudder input gives a direct
    // yaw torque so you can taxi at zero airspeed. Fades out as you accelerate
    // (above ~25 kt the aerodynamic rudder takes over).
    if (this.onGround) {
      const groundSpeed = Math.hypot(this.vel.x, this.vel.z);
      const fade = Math.max(0, 1 - groundSpeed / 13);    // ~25 kt cutoff
      // Steady-state max yaw rate ~20°/s with these gains — brisk taxi.
      _totalTorqueBody.y += this.controls.yaw * 2800 * fade;
      _totalTorqueBody.y -= this.angVel.y * 6500 * fade;
    }

    // CRASH DETECTION
    // (a) Hard impact via gear (descent rate at touchdown over threshold).
    // Water absorbs much more energy than packed dirt — a real float plane
    // can splash down at 10–15 m/s without damage, so the threshold is
    // lifted significantly when the contact is on water.
    const hardLandingThreshold = touchedWater > 0 ? 15.0 : 6.5;
    if (touched > 0 && maxImpact > hardLandingThreshold) {
      this.crashed = true;
      this.crashCause = `Hard landing — ${maxImpact.toFixed(1)} m/s descent`;
    }
    // (b) Non-gear part hits ground / water (wingtip strike, nose into
    // terrain, dipped into water, etc.). For frozen-ocean tiles surfaceTopY
    // already returns the top of the ICE_PACK voxel — landing on ice works
    // through the normal gear path. Float planes don't crash on water — the
    // pontoons handle it (their gear path catches the plane buoyantly).
    if (!this.crashed) {
      for (const probe of CRASH_PROBES) {
        _world.copy(probe.p).applyQuaternion(this.quat).add(this.pos);
        const px = Math.floor(_world.x);
        const pz = Math.floor(_world.z);
        const groundY = surfaceTopY(px, pz);
        const overWater = groundY <= SEA_LEVEL;
        // Float planes skip non-wingtip water probes (pontoons handle nose/
        // tail/inboard). Wingtips DO fire a water strike — banking far
        // enough to dip a wing into the water is a crash.
        if (overWater && hasFloats && !probe.wingtip) continue;
        const floor = overWater ? WATER_SURFACE_Y : groundY;
        const cause = overWater ? 'Water strike' : 'Terrain strike';
        if (_world.y < floor) {
          this.crashed = true;
          this.crashCause = cause;
          break;
        }
      }
    }
    // (b2) Non-float planes: also crash if the plane's CG drops below sea
    // level over water. The probe check above catches it via the nose probe,
    // but the CG check is a belt-and-braces backup so the plane never just
    // sinks visually through the surface without firing the crash.
    if (!this.crashed && !hasFloats) {
      const groundCenter = surfaceTopY(Math.floor(this.pos.x), Math.floor(this.pos.z));
      if (groundCenter <= SEA_LEVEL && this.pos.y < WATER_SURFACE_Y) {
        this.crashed = true;
        this.crashCause = 'Water strike';
      }
    }
    // (c) Antenna / wire strike — city infrastructure hazards.
    if (!this.crashed) {
      const hit = checkCityHazards(this.pos);
      if (hit) {
        this.crashed = true;
        this.crashCause = hit;
      }
    }
    // (d) Building strike — fly into a building, you crash.
    if (!this.crashed) {
      const hit = checkCityBuildings(this.pos);
      if (hit) {
        this.crashed = true;
        this.crashCause = hit;
      }
    }

    // PROP STRIKE: prop disc bottom point ~1.1 m below the spinner. Rising edge
    // only — cooldown prevents repeat triggers while still in contact.
    this.propStrike = false;
    if (this.propStrikeCooldown > 0) this.propStrikeCooldown -= dt;
    if (!this.crashed) {
      _world.set(0, -1.1, 3.85).applyQuaternion(this.quat).add(this.pos);
      const groundY = surfaceTopY(Math.floor(_world.x), Math.floor(_world.z));
      if (_world.y < groundY && this.propStrikeCooldown <= 0) {
        this.propStrike = true;
        this.propStrikeCooldown = 1.5;
      }
    }

    // prop angular advance
    const rpm = 600 + this.controls.throttle * 1800;
    this.propAdvance += (rpm / 60) * 2 * Math.PI * dt;

    if (this.crashed) {
      // dump velocity, leave plane oriented as it crashed
      this.vel.multiplyScalar(0);
      this.angVel.multiplyScalar(0);
      this.passengerComfort = Math.max(0, this.passengerComfort - 100);   // crash = no comfort
      // Water crashes: pin the wreck visually at-or-just-above water surface
      // so the player actually SEES the splashed plane instead of it sinking
      // straight through the surface to the seabed below.
      if (this.crashCause === 'Water strike') {
        const gc = surfaceTopY(Math.floor(this.pos.x), Math.floor(this.pos.z));
        if (gc <= SEA_LEVEL && this.pos.y < WATER_SURFACE_Y) {
          this.pos.y = WATER_SURFACE_Y + 0.2;
        }
      }
      return;
    }

    // Passenger comfort decay: punish steep bank, high angular rates, vertical
    // jolts (bumps). Recovers slowly during smooth, level flight.
    if (!this.onGround) {
      const bankDeg = Math.abs(this.rollDeg());
      const angRate = this.angVel.length();
      const bumpG = Math.abs(this.vel.y - this.prevVelY) / Math.max(0.001, dt) / 9.81;
      let penalty = 0;
      if (bankDeg > 45) penalty += (bankDeg - 45) * 0.04 * dt;
      if (angRate > 1.5) penalty += (angRate - 1.5) * 1.2 * dt;
      if (bumpG > 0.6) penalty += (bumpG - 0.6) * 6 * dt;
      // Slow heal in calm flight (no penalty above + low rates).
      if (penalty === 0 && angRate < 0.4 && bankDeg < 15) {
        this.passengerComfort = Math.min(100, this.passengerComfort + 0.4 * dt);
      } else {
        this.passengerComfort = Math.max(0, this.passengerComfort - penalty);
      }
    }
    this.prevVelY = this.vel.y;

    // Icing: accumulate above 3000 m AGL in cold air; shed when below 2000 m
    // AGL or warmer than +5°C.
    const tempC = tempCAt(this.pos.y);
    if (agl > 3000 && tempC <= 0) {
      this.iceAccretion = Math.min(1, this.iceAccretion + dt * 0.012);
    } else if (agl < 2000 || tempC > 5) {
      this.iceAccretion = Math.max(0, this.iceAccretion - dt * 0.007);
    }

    _accel.copy(_force).multiplyScalar(1 / mass);
    this.vel.addScaledVector(_accel, dt);
    this.pos.addScaledVector(this.vel, dt);

    _angAccel.set(
      _totalTorqueBody.x / this.inertiaX,
      _totalTorqueBody.y / this.inertiaY,
      _totalTorqueBody.z / this.inertiaZ,
    );
    this.angVel.addScaledVector(_angAccel, dt);

    const w = this.angVel;
    _dq.set(w.x * 0.5 * dt, w.y * 0.5 * dt, w.z * 0.5 * dt, 0);
    _qd.multiplyQuaternions(this.quat, _dq);
    this.quat.x += _qd.x;
    this.quat.y += _qd.y;
    this.quat.z += _qd.z;
    this.quat.w += _qd.w;
    this.quat.normalize();
  }

  headingDeg(): number {
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this.quat);
    let h = Math.atan2(fwd.x, fwd.z) * 180 / Math.PI;
    if (h < 0) h += 360;
    return h;
  }

  pitchDeg(): number {
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this.quat);
    return Math.asin(fwd.y) * 180 / Math.PI;
  }

  rollDeg(): number {
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.quat);
    return -Math.asin(right.y) * 180 / Math.PI;
  }
}
