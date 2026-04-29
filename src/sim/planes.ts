// Plane catalog. Each entry has the base AircraftParams + meta (cost, unlock
// rank, display info). Effective params used in flight = base + upgrades.

import type { AircraftParams } from './aero';
import { SUPER_CUB } from './aero';

export type PlaneId = 'cub' | 'beaver' | 'otter' | 'caravan';

export interface PlaneSpec {
  id: PlaneId;
  name: string;
  description: string;
  cost: number;            // dollars to purchase
  unlockRankIdx: number;   // index into RANKS array (must be ≥ this rank to buy)
  passengerSeats: number;  // pax capacity (= total seats minus pilot)
  params: AircraftParams;
}

// Beaver: ~50 % more mass, 90 % more power, slightly faster, more payload.
const BEAVER: AircraftParams = {
  mass: 1310,
  maxMass: 2310,
  wingArea: 23.2,
  wingspan: 14.6,
  aspectRatio: 9.2,
  e: 0.78,
  cl0: 0.30,
  clAlpha: 5.6,
  clMax: 1.55,
  alphaStall: 15 * Math.PI / 180,
  cd0: 0.045,
  maxThrust: 4500,
  vMax: 72,
  pitchRate: 5500,
  rollRate: 4800,
  yawRate: 3000,
  pitchDamp: 14000,
  rollDamp: 7500,
  yawDamp: 6500,
  flapClPerStage: 0.32,
  flapCdPerStage: 0.025,
  flapStages: 3,
  propWashSpeed: 22,
  pFactorStrength: 320,
  spinAutorotGain: 1900,
  // Match Beaver visual silhouette gear positions.
  gearMainX: 1.6, gearMainY: -1.05, gearMainZ: 0.6,
  gearThirdY: -0.55, gearThirdZ: -3.7,
};

// Otter: bigger again, ~2x Beaver capacity, similar speed.
const OTTER: AircraftParams = {
  mass: 2010,
  maxMass: 3630,
  wingArea: 34.8,
  wingspan: 17.7,
  aspectRatio: 9.0,
  e: 0.78,
  cl0: 0.30,
  clAlpha: 5.5,
  clMax: 1.55,
  alphaStall: 15 * Math.PI / 180,
  cd0: 0.046,
  maxThrust: 6500,
  vMax: 72,
  pitchRate: 7500,
  rollRate: 6000,
  yawRate: 3800,
  pitchDamp: 18000,
  rollDamp: 9500,
  yawDamp: 8500,
  flapClPerStage: 0.30,
  flapCdPerStage: 0.025,
  flapStages: 3,
  propWashSpeed: 24,
  pFactorStrength: 400,
  spinAutorotGain: 1900,
  gearMainX: 1.95, gearMainY: -1.1, gearMainZ: 0.7,
  gearThirdY: -0.6, gearThirdZ: -4.5,
};

// Caravan: turbine, fast cruise, big cargo. Tricycle gear (nose wheel forward,
// mains under wing) — sits level on the ground, not nose-up like a taildragger.
const CARAVAN: AircraftParams = {
  mass: 1900,
  maxMass: 3970,
  wingArea: 25.9,
  wingspan: 15.9,
  aspectRatio: 9.7,
  e: 0.80,
  cl0: 0.27,
  clAlpha: 5.6,
  clMax: 1.65,
  alphaStall: 16 * Math.PI / 180,
  cd0: 0.040,
  maxThrust: 8500,
  vMax: 95,
  pitchRate: 7000,
  rollRate: 5500,
  yawRate: 3500,
  pitchDamp: 16000,
  rollDamp: 8500,
  yawDamp: 7000,
  flapClPerStage: 0.32,
  flapCdPerStage: 0.022,
  flapStages: 3,
  propWashSpeed: 28,
  pFactorStrength: 380,
  spinAutorotGain: 1800,
  gearLayout: 'tricycle',
  // Wide stance, mains slightly aft of CG, nose wheel forward — matches the
  // Caravan visual silhouette so the wheels meet the ground.
  gearMainX: 1.5, gearMainY: -1.4, gearMainZ: -0.3,
  gearThirdY: -1.4, gearThirdZ: 2.5,
};

export const PLANES: Record<PlaneId, PlaneSpec> = {
  cub: {
    id: 'cub',
    name: 'Super Cub',
    description: 'Light, slow, ridiculous STOL. The starter bush plane.',
    cost: 0,
    unlockRankIdx: 0,        // Trainee
    passengerSeats: 1,       // pilot + 1
    params: SUPER_CUB,
  },
  beaver: {
    id: 'beaver',
    name: 'DHC-2 Beaver',
    description: 'Workhorse hauler. 600 kg payload, real cargo capacity.',
    cost: 18000,
    unlockRankIdx: 2,        // Pilot
    passengerSeats: 6,       // pilot + 6
    params: BEAVER,
  },
  otter: {
    id: 'otter',
    name: 'DHC-3 Otter',
    description: 'Bigger Beaver. 1000 kg payload, longer legs.',
    cost: 55000,
    unlockRankIdx: 3,        // Bush Pilot
    passengerSeats: 9,       // pilot + 9
    params: OTTER,
  },
  caravan: {
    id: 'caravan',
    name: 'Cessna 208 Caravan',
    description: 'Turbine. Fast cruise, big payload, great for passengers.',
    cost: 140000,
    unlockRankIdx: 4,        // Veteran
    passengerSeats: 13,      // pilot + 13
    params: CARAVAN,
  },
};

// All planes in unlock order — for stable enumeration in the hangar UI.
export const PLANE_ORDER: PlaneId[] = ['cub', 'beaver', 'otter', 'caravan'];

// Tank capacity per plane (US gallons). Used for fuel state initialization.
export const TANK_GALLONS: Record<PlaneId, number> = {
  cub: 24,
  beaver: 95,
  otter: 178,
  caravan: 332,
};

// Idle / full fuel burn (US gph) per plane. Roughly 1.6x previous values so
// fuel becomes a real consideration on long flights — burn rates are now in
// the realistic ballpark (Cub ~8/20 gph, Caravan ~35/95 gph).
export const FUEL_BURN: Record<PlaneId, { idle: number; full: number }> = {
  cub:     { idle: 8,  full: 20 },
  beaver:  { idle: 19, full: 48 },
  otter:   { idle: 28, full: 67 },
  caravan: { idle: 35, full: 95 },
};
