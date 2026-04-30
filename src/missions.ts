// Mission system: random cargo deliveries between airports.
// A mission has a pickup airport and a delivery airport. The player taxis to
// the pickup zone, presses P to load, flies to destination, taxis to the
// delivery zone, presses P to deliver.

import { AIRPORTS, DIFFICULTY_PAYOUT_MUL, type Airport } from './world/airport';
import { LANDING_SITES, TIGHT_WATER_SITES, type LandingSite } from './world/landingSites';
import { Plane } from './sim/plane';
import { heightAt } from './world/terrain';
import { VOXEL_SIZE } from './world/voxel';
import type { PlaneId } from './sim/planes';

// Unified delivery destination — airports OR off-airport landing sites.
export type Destination = Airport | LandingSite;

export function isLandingSite(d: Destination): d is LandingSite {
  return !('apronWidth' in d);
}

export function destZoneCenter(d: Destination): { x: number; z: number } {
  if (!isLandingSite(d)) return { x: d.cx + d.apronWidth / 2 + 14, z: d.cz };
  // Sea bases: zone sits in open water alongside the floating dock.
  if (d.isSeaplaneBase) return { x: d.cx + 18, z: d.cz - 13 };
  // Tight water sites (Riverbar) have water right against the strip — placing
  // the zone perpendicular to the strip puts it in the river. Park it on the
  // gravel bar itself, offset along the strip axis.
  if (TIGHT_WATER_SITES.has(d.name)) return { x: d.cx, z: d.cz - d.length / 3 };
  return { x: d.cx + d.width / 2 + 8, z: d.cz };
}

export function destZoneSize(d: Destination): number {
  return isLandingSite(d) ? 15 : 22;
}

// True if the destination is a water-only seaplane base. Used to gate mission
// availability behind the floats upgrade and to apply a sea-leg pay bonus.
export function isSeaDestination(d: Destination): boolean {
  return isLandingSite(d) && d.isSeaplaneBase === true;
}

// Sea legs pay 1.5× because they need the floats upgrade and you can't divert
// to a runway if things go sideways.
const SEA_PAY_MUL = 1.5;

export type MissionTier = 'routine' | 'demanding' | 'critical';

export interface TierSpec {
  name: MissionTier;
  label: string;
  color: string;             // hex string for UI badge
  payoutMul: number;         // multiplier on base payout
  deadlineMul: number;       // multiplier on base deadline (smaller = tighter)
  landingBonusMul: number;   // multiplier on landing-score bonus paid at delivery
}

export const TIERS: Record<MissionTier, TierSpec> = {
  routine:   { name: 'routine',   label: 'ROUTINE',   color: '#8aa0b0', payoutMul: 1.0, deadlineMul: 1.0,  landingBonusMul: 1.0 },
  demanding: { name: 'demanding', label: 'DEMANDING', color: '#ffcb6b', payoutMul: 1.6, deadlineMul: 0.65, landingBonusMul: 1.5 },
  critical:  { name: 'critical',  label: 'CRITICAL',  color: '#ff7060', payoutMul: 2.6, deadlineMul: 0.45, landingBonusMul: 3.0 },
};

export type MissionType = 'cargo' | 'medevac' | 'survey' | 'passenger';

export interface SurveyWaypoint {
  x: number;
  z: number;
  targetAglM: number;         // desired height AGL when overflying (m)
  toleranceM: number;         // ±this much AGL = full bonus, outside still counts as hit
  hit: boolean;               // mutated as player passes through
  hitOnAltitude?: boolean;    // true if also within altitude tolerance — pays bonus
}

export interface Mission {
  cargoName: string;
  cargoKg: number;
  from: Destination;          // pickup point — airport for cargo, landing site for medevac
  to: Destination;            // delivery point (for survey: same as from, the home base)
  payout: number;
  deadlineSec: number;        // wall-clock seconds remaining
  tier: MissionTier;
  type: MissionType;
  waypoints?: SurveyWaypoint[];   // present only for survey missions
  waypointIdx?: number;           // current target waypoint (mutated)
}

export type MissionState =
  | { phase: 'idle' }
  | { phase: 'assigned'; mission: Mission; elapsedSec: number }
  | { phase: 'loaded';   mission: Mission; elapsedSec: number }
  | { phase: 'completed'; mission: Mission; payout: number; tookSec: number; landingScore: number }
  | { phase: 'expired';  mission: Mission };

const CARGO_TYPES = [
  { name: 'Mail bag', kg: 30,  payRate: 30 },
  { name: 'Groceries', kg: 80, payRate: 22 },
  { name: 'Tool crate', kg: 120, payRate: 24 },
  { name: 'Medical supplies', kg: 60, payRate: 42 },
  { name: 'Fuel drum', kg: 200, payRate: 34 },
  { name: 'Fishing nets', kg: 40, payRate: 22 },
  { name: 'Building lumber', kg: 180, payRate: 28 },
  { name: 'Hunting party gear', kg: 90, payRate: 34 },
];

// Career rank thresholds — based on lifetime earned cash AND deliveries so the
// player can't grind one trivial route to instantly out-rank the content.
export interface RankInfo {
  name: string;
  minEarned: number;
  minDeliveries: number;
}
export const RANKS: RankInfo[] = [
  { name: 'Trainee',     minEarned: 0,      minDeliveries: 0 },
  { name: 'Apprentice',  minEarned: 500,    minDeliveries: 3 },
  { name: 'Pilot',       minEarned: 2500,   minDeliveries: 10 },
  { name: 'Bush Pilot',  minEarned: 7500,   minDeliveries: 25 },
  { name: 'Veteran',     minEarned: 20000,  minDeliveries: 60 },
  { name: 'Legend',      minEarned: 60000,  minDeliveries: 150 },
];

export class MissionSystem {
  state: MissionState = { phase: 'idle' };
  cash = 1000000;         // testing: $1M starter so all planes/upgrades are reachable
  totalDeliveries = 200;  // testing: top-rank thresholds met
  bestLandingScore = 0;
  // Career stats — survive across plane crashes and respawns.
  careerEarned = 100000;  // testing: top-rank earnings
  careerHours = 0;        // wall-clock seconds spent in flight (sum of dt while in_air)
  milesFlown = 0;         // total horizontal distance, statute miles
  repairsTotal = 0;       // total cash spent on repairs/crashes
  // Active plane's passenger capacity — used to cap passenger missions so a
  // Cub player never gets offered a 6-pax flight. Updated by main.ts on swap.
  activePlaneSeats: number = 1;
  activePlaneId: PlaneId = 'cub';
  // True when the active plane has the floats upgrade. Used to gate sea-base
  // missions and apply a sea-leg pay multiplier.
  activePlaneHasFloats = false;
  // Achievements — set of unlocked ids. Persists in saveState.
  unlockedAchievements: Set<string> = new Set();
  // Mission board: list of jobs the player can accept while at a cargo zone.
  // Open when boardOpen=true, populated with up to 5 missions.
  boardOpen = false;
  availableMissions: Mission[] = [];
  boardAirport: Airport | null = null;
  // Pickup/delivery zone: 18m × 18m square next to the apron, easy to taxi into.
  // Same world coords for both pickup and delivery; zone is identified by airport.
  zoneSize = 22;

  rank(): RankInfo {
    let best = RANKS[0];
    for (const r of RANKS) {
      if (this.careerEarned >= r.minEarned && this.totalDeliveries >= r.minDeliveries) {
        best = r;
      }
    }
    return best;
  }

  // Returns the next rank above the current one, or null if at top.
  nextRank(): RankInfo | null {
    const cur = this.rank();
    const idx = RANKS.indexOf(cur);
    return idx >= 0 && idx < RANKS.length - 1 ? RANKS[idx + 1] : null;
  }

  // Record money spent on repairs (called from main when crash/hard-landing/prop-strike fires).
  recordRepair(amount: number) {
    this.repairsTotal += amount;
  }

  // Generate a fresh batch of jobs at this airport.
  openBoard(at: Airport) {
    this.boardAirport = at;
    this.availableMissions = [];
    const seen = new Set<string>();
    let safety = 0;
    while (this.availableMissions.length < 5 && safety++ < 30) {
      const m = this.newMission(at, this.rollTier());
      // Avoid duplicate cargo+destination combos within the same board.
      const sig = `${m.cargoName}|${m.to.name}|${m.tier}`;
      if (seen.has(sig)) continue;
      seen.add(sig);
      this.availableMissions.push(m);
    }
    this.boardOpen = true;
  }

  closeBoard() {
    this.boardOpen = false;
    this.availableMissions = [];
    this.boardAirport = null;
  }

  // Player-initiated abort. Drops cargo, returns to idle so a new mission can
  // be picked. No payout, but no penalty either.
  cancelMission(plane: Plane): string {
    if (this.state.phase !== 'assigned' && this.state.phase !== 'loaded') {
      return 'No mission to cancel.';
    }
    const m = this.state.mission;
    plane.cargoKg = 0;
    this.state = { phase: 'idle' };
    return `Cancelled: ${m.cargoName} → ${m.to.name}.`;
  }

  // Player picks job index n (0-based). For cargo: loads immediately. For
  // medevac: state goes to 'assigned' (fly out empty to the rescue site first).
  selectMission(plane: Plane, n: number): string {
    if (!this.boardOpen) return '';
    if (n < 0 || n >= this.availableMissions.length) return `No job #${n + 1}.`;
    const m = this.availableMissions[n];
    // MTOW projection — accept the mission either way, but warn the player so
    // they know they'll need to burn fuel or unload before the plane will fly.
    const fuelKg = plane.fuelGallons * Plane.GAL_TO_KG;
    const projected = plane.params.mass + fuelKg + m.cargoKg;
    let overweightWarning = '';
    if (projected > plane.params.maxMass) {
      const over = Math.ceil(projected - plane.params.maxMass);
      overweightWarning = ` WARNING: ${over} kg over MTOW — engine will not run until you burn fuel or shed cargo.`;
    }
    if (m.type === 'medevac') {
      this.state = { phase: 'assigned', mission: m, elapsedSec: 0 };
      this.closeBoard();
      return `MEDEVAC accepted. Fly to ${m.from.name} to pick up the patient, then to ${m.to.name}.${overweightWarning}`;
    }
    if (m.type === 'survey') {
      // No cargo; player flies through waypoints and the mission auto-completes
      // on the last hit. State is 'loaded' to reuse the in-flight progress path.
      this.state = { phase: 'loaded', mission: m, elapsedSec: 0 };
      this.closeBoard();
      const wpc = m.waypoints?.length ?? 0;
      return `SURVEY accepted. Fly through ${wpc} photo points at ~${m.waypoints?.[0].targetAglM} m AGL.${overweightWarning}`;
    }
    plane.cargoKg = m.cargoKg;
    if (m.type === 'passenger') plane.resetComfort();
    this.state = { phase: 'loaded', mission: m, elapsedSec: 0 };
    this.closeBoard();
    return `Accepted: ${m.cargoName} (${m.cargoKg} kg) → ${m.to.name} for $${m.payout}. Cargo loaded.${overweightWarning}`;
  }

  newMission(currentAirport: Airport, tier: MissionTier = 'routine'): Mission {
    const spec = TIERS[tier];

    // Survey/photo run: a chain of 4 waypoints over interesting terrain.
    // Always returns to the originating airport. Tier scales waypoint count
    // and altitude tolerance.
    const surveyChance = tier === 'demanding' ? 0.20 : tier === 'critical' ? 0.15 : 0.10;
    if (Math.random() < surveyChance) {
      const wpCount = tier === 'critical' ? 5 : 4;
      const tol = tier === 'critical' ? 50 : tier === 'demanding' ? 70 : 100;
      const targetAgl = 250 + Math.floor(Math.random() * 250);    // 250-500m AGL
      const waypoints: SurveyWaypoint[] = [];
      // Loop in a rough circle around the airport, ~5-10km out.
      const baseR = 5000 + Math.random() * 5000;
      const angleStart = Math.random() * Math.PI * 2;
      for (let i = 0; i < wpCount; i++) {
        const ang = angleStart + (i / wpCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
        const r = baseR * (0.7 + Math.random() * 0.6);
        waypoints.push({
          x: currentAirport.cx + Math.cos(ang) * r,
          z: currentAirport.cz + Math.sin(ang) * r,
          targetAglM: targetAgl,
          toleranceM: tol,
          hit: false,
        });
      }
      const totalLegKm = waypoints.reduce((sum, wp, i) => {
        const prev = i === 0
          ? { x: currentAirport.cx, z: currentAirport.cz }
          : waypoints[i - 1];
        return sum + Math.hypot(wp.x - prev.x, wp.z - prev.z) / 1000;
      }, 0) + Math.hypot(currentAirport.cx - waypoints[wpCount - 1].x, currentAirport.cz - waypoints[wpCount - 1].z) / 1000;
      // 25 $/km base — routine 45km loop ≈ $1125, critical ≈ $2925.
      const payout = Math.round(25 * totalLegKm * spec.payoutMul);
      const deadlineSec = (totalLegKm * 90) * spec.deadlineMul + 240;
      return {
        cargoName: 'Aerial photos',
        cargoKg: 0,
        from: currentAirport,
        to: currentAirport,
        payout,
        deadlineSec,
        tier,
        type: 'survey',
        waypoints,
        waypointIdx: 0,
      };
    }

    // Pool of landing sites the player can actually reach with their current
    // setup — float-only sea bases drop out unless they own the upgrade.
    const reachableSites = this.activePlaneHasFloats
      ? LANDING_SITES
      : LANDING_SITES.filter(s => !s.isSeaplaneBase);

    // Med evac: pickup is at a landing site (patient stranded in the bush),
    // delivery is at any airport (hospital). Always critical-tier-grade
    // urgency regardless of the rolled tier, and a much bigger landing bonus.
    // We only roll med evac at higher tiers where the player has the chops.
    const medEvacChance = tier === 'critical' ? 0.4 : tier === 'demanding' ? 0.15 : 0;
    if (Math.random() < medEvacChance && reachableSites.length > 0) {
      const from = reachableSites[Math.floor(Math.random() * reachableSites.length)];
      const hospitals = AIRPORTS;       // any airport counts as a hospital
      const to = hospitals[Math.floor(Math.random() * hospitals.length)];
      const distKm = Math.hypot(to.cx - from.cx, to.cz - from.cz) / 1000;
      const totalDistKm =
        Math.hypot(from.cx - currentAirport.cx, from.cz - currentAirport.cz) / 1000 + distKm;
      // Patient is light; the value is in keeping them alive. Pickup site
      // difficulty (most medevac sites are remote) scales the payout.
      const fromDiff = DIFFICULTY_PAYOUT_MUL[from.difficulty];
      const seaMul = isSeaDestination(from) ? SEA_PAY_MUL : 1;
      const payout = Math.round((400 + totalDistKm * 220) * fromDiff * seaMul);
      // Tight: roughly 4 minutes per km of TOTAL flight (out + back).
      const deadlineSec = 240 + totalDistKm * 240;
      return {
        cargoName: 'Patient',
        cargoKg: 80,
        from,
        to,
        payout,
        deadlineSec,
        tier: 'critical',
        type: 'medevac',
      };
    }

    // Passenger flight: airport → airport, payout depends on ride quality
    // (steep bank / high G / sudden bumps cost the tip).
    const paxChance = tier === 'demanding' ? 0.20 : tier === 'critical' ? 0.10 : 0.15;
    if (Math.random() < paxChance) {
      const pool = AIRPORTS.filter(a => a !== currentAirport);
      const to = pool[Math.floor(Math.random() * pool.length)];
      const dx = to.cx - currentAirport.cx;
      const dz = to.cz - currentAirport.cz;
      const distKm = Math.hypot(dx, dz) / 1000;
      // Cap passenger count by the active plane's seats — a Cub player never
      // gets offered a 6-pax flight; a Caravan can fill its 13 seats.
      const maxPax = Math.max(1, this.activePlaneSeats);
      const numPax = 1 + Math.floor(Math.random() * maxPax);
      const cargoKg = numPax * 80;
      const basePayout = 60 * distKm * numPax;
      const diffMul = DIFFICULTY_PAYOUT_MUL[to.difficulty];
      const payout = Math.round(basePayout * spec.payoutMul * diffMul);
      const deadlineSec = (300 + distKm * 200) * spec.deadlineMul;
      return {
        cargoName: numPax === 1 ? 'Passenger' : `${numPax} passengers`,
        cargoKg,
        from: currentAirport,
        to,
        payout,
        deadlineSec,
        tier,
        type: 'passenger',
      };
    }

    // Standard cargo: pickup here, deliver to another airport or landing site.
    const otherAirports: Destination[] = AIRPORTS.filter(a => a !== currentAirport);
    const sites: Destination[] = reachableSites.slice();
    const lsBias = tier === 'critical' ? 0.65 : tier === 'demanding' ? 0.45 : 0.25;
    const useLandingSite = Math.random() < lsBias && sites.length > 0;
    const pool = useLandingSite ? sites : otherAirports;
    const to = pool[Math.floor(Math.random() * pool.length)];
    const cargo = CARGO_TYPES[Math.floor(Math.random() * CARGO_TYPES.length)];
    const dx = to.cx - currentAirport.cx;
    const dz = to.cz - currentAirport.cz;
    const distKm = Math.hypot(dx, dz) / 1000;
    const basePayout = cargo.payRate * distKm * (cargo.kg / 50);
    // Pay scales with destination difficulty: easy → impossible = 1.0 → 3.0x.
    const diffMul = DIFFICULTY_PAYOUT_MUL[to.difficulty];
    const seaMul = isSeaDestination(to) ? SEA_PAY_MUL : 1;
    const payout = Math.round(basePayout * spec.payoutMul * diffMul * seaMul);
    const deadlineSec = (360 + distKm * 180) * spec.deadlineMul;
    return {
      cargoName: cargo.name,
      cargoKg: cargo.kg,
      from: currentAirport,
      to,
      payout,
      deadlineSec,
      tier,
      type: 'cargo',
    };
  }

  // Roll a mix of tiers appropriate for the player's current rank. Higher-rank
  // players see more demanding/critical jobs; lower-rank players mostly routine.
  private rollTier(): MissionTier {
    const rankIdx = RANKS.indexOf(this.rank());
    // Probability table indexed by rank tier (0=Trainee → 5=Legend).
    //                       routine demanding critical
    const table: number[][] = [
      [1.00, 0.00, 0.00],   // Trainee
      [0.80, 0.20, 0.00],   // Apprentice
      [0.55, 0.40, 0.05],   // Pilot
      [0.30, 0.50, 0.20],   // Bush Pilot
      [0.15, 0.45, 0.40],   // Veteran
      [0.05, 0.35, 0.60],   // Legend
    ];
    const probs = table[Math.max(0, Math.min(table.length - 1, rankIdx))];
    const r = Math.random();
    if (r < probs[0]) return 'routine';
    if (r < probs[0] + probs[1]) return 'demanding';
    return 'critical';
  }

  // Returns the airport whose pickup zone the plane is INSIDE and (mostly)
  // STOPPED at. Threshold is lenient — wind gusts can nudge a parked plane.
  // Pickups are airport-only (cargo always originates at an airport).
  airportAtZone(plane: Plane): Airport | null {
    const speed = Math.hypot(plane.vel.x, plane.vel.z);
    if (!plane.onGround || speed > 3.0) return null;
    for (const a of AIRPORTS) {
      const zone = this.zoneCenter(a);
      if (Math.abs(plane.pos.x - zone.x) < this.zoneSize / 2 &&
          Math.abs(plane.pos.z - zone.z) < this.zoneSize / 2) {
        return a;
      }
    }
    return null;
  }

  // Generic check: are we stopped at the cargo zone of this specific destination
  // (airport OR landing site)?
  isAtDestinationZone(plane: Plane, dest: Destination): boolean {
    const speed = Math.hypot(plane.vel.x, plane.vel.z);
    if (!plane.onGround || speed > 3.0) return false;
    const z = destZoneCenter(dest);
    const half = destZoneSize(dest) / 2;
    return Math.abs(plane.pos.x - z.x) < half && Math.abs(plane.pos.z - z.z) < half;
  }

  // East side of the apron, centred along the runway so it lines up with the
  // taxiway that crosses from the runway centreline to the buildings.
  zoneCenter(a: Airport): { x: number; z: number } {
    return {
      x: a.cx + a.apronWidth / 2 + 14,
      z: a.cz,
    };
  }

  // Step time-driven state (deadline countdown + survey waypoint progress).
  step(dt: number, plane?: Plane) {
    if (this.state.phase === 'assigned' || this.state.phase === 'loaded') {
      this.state.elapsedSec += dt;
      if (this.state.elapsedSec > this.state.mission.deadlineSec) {
        this.state = { phase: 'expired', mission: this.state.mission };
        return;
      }
    }
    // Survey waypoint check: when in 'loaded' on a survey mission, mark the
    // current waypoint hit if the player overflies it at the right AGL.
    if (this.state.phase === 'loaded' && this.state.mission.type === 'survey' && plane) {
      this.checkSurveyProgress(plane);
    }
  }

  private checkSurveyProgress(plane: Plane) {
    if (this.state.phase !== 'loaded') return;
    const m = this.state.mission;
    if (m.type !== 'survey' || !m.waypoints) return;
    const idx = m.waypointIdx ?? 0;
    if (idx >= m.waypoints.length) return;
    const wp = m.waypoints[idx];
    // Must be within horizontal AND altitude tolerance simultaneously.
    const HORIZ_TOL = 350;
    const dx = plane.pos.x - wp.x;
    const dz = plane.pos.z - wp.z;
    if (Math.hypot(dx, dz) > HORIZ_TOL) return;
    const hRaw = heightAt(Math.floor(wp.x), Math.floor(wp.z));
    const groundAtWp = Math.floor(hRaw / VOXEL_SIZE) * VOXEL_SIZE + VOXEL_SIZE;
    const aglAtWp = plane.pos.y - groundAtWp;
    if (Math.abs(aglAtWp - wp.targetAglM) > wp.toleranceM) return;
    wp.hit = true;
    wp.hitOnAltitude = true;
    m.waypointIdx = idx + 1;
    if ((m.waypointIdx ?? 0) >= m.waypoints.length) {
      this.completeSurvey(plane);
    }
  }

  private completeSurvey(plane: Plane) {
    if (this.state.phase !== 'loaded') return;
    const m = this.state.mission;
    if (m.type !== 'survey') return;
    const tookSec = this.state.elapsedSec;
    const speedBonus = Math.max(0, Math.round(m.payout * (m.deadlineSec - tookSec) / m.deadlineSec * 0.5));
    const totalPayout = m.payout + speedBonus;
    this.cash += totalPayout;
    this.careerEarned += totalPayout;
    this.totalDeliveries++;
    plane.cargoKg = 0;
    this.state = { phase: 'completed', mission: m, payout: totalPayout, tookSec, landingScore: 0 };
  }

  // Player pressed P. Decide what to do based on current state and location.
  interact(plane: Plane): string {
    // Loaded → check delivery first, since the destination may be a landing
    // site (not an airport) so airportAtZone won't find it.
    if (this.state.phase === 'loaded') {
      const m = this.state.mission;
      if (m.type === 'survey') {
        const wpc = m.waypoints?.length ?? 0;
        const idx = m.waypointIdx ?? 0;
        return `SURVEY: ${idx}/${wpc} photo points hit. Auto-completes on the last one.`;
      }
      if (this.isAtDestinationZone(plane, m.to)) {
        return this.completeDelivery(plane);
      }
      const speed = Math.hypot(plane.vel.x, plane.vel.z);
      if (!plane.onGround) return `In transit to ${m.to.name}.`;
      if (speed > 3.0) return `Stop the plane (still rolling at ${speed.toFixed(1)} m/s).`;
      const z = destZoneCenter(m.to);
      const d = Math.hypot(plane.pos.x - z.x, plane.pos.z - z.z);
      return `${d.toFixed(0)} m from ${m.to.name}'s zone.`;
    }

    // Assigned (medevac waiting for pickup) → check mission.from zone, which
    // is a landing site so airportAtZone won't find it.
    if (this.state.phase === 'assigned' && this.state.mission.type === 'medevac') {
      if (this.isAtDestinationZone(plane, this.state.mission.from)) {
        plane.cargoKg = this.state.mission.cargoKg;
        this.state = { phase: 'loaded', mission: this.state.mission, elapsedSec: this.state.elapsedSec };
        return `Patient on board. Fly to ${this.state.mission.to.name} — fast and gentle.`;
      }
      const speed = Math.hypot(plane.vel.x, plane.vel.z);
      if (!plane.onGround) return `Flying to pickup at ${this.state.mission.from.name}.`;
      if (speed > 3.0) return `Stop the plane (rolling at ${speed.toFixed(1)} m/s).`;
      const z = destZoneCenter(this.state.mission.from);
      const d = Math.hypot(plane.pos.x - z.x, plane.pos.z - z.z);
      return `${d.toFixed(0)} m from ${this.state.mission.from.name}'s pickup zone.`;
    }

    const ap = this.airportAtZone(plane);
    if (!ap) {
      // More helpful diagnostic: tell the player WHY they're not in a zone.
      const speed = Math.hypot(plane.vel.x, plane.vel.z);
      if (!plane.onGround) return 'Land first — not on the ground.';
      if (speed > 3.0) return `Stop the plane (still rolling at ${speed.toFixed(1)} m/s — hold B/Space).`;
      // Find nearest zone for guidance
      let nearest: Airport | null = null;
      let nearestD = Infinity;
      for (const a of AIRPORTS) {
        const z = this.zoneCenter(a);
        const d = Math.hypot(plane.pos.x - z.x, plane.pos.z - z.z);
        if (d < nearestD) { nearestD = d; nearest = a; }
      }
      if (nearest && nearestD < 200) {
        return `Stopped, but ${nearestD.toFixed(0)} m from ${nearest.name}'s yellow zone. Taxi closer.`;
      }
      return 'Not in a cargo zone — taxi to the yellow square next to the hangars.';
    }

    if (this.state.phase === 'idle' || this.state.phase === 'completed' || this.state.phase === 'expired') {
      // P toggles the mission board. Player picks 1-5 to accept (selectMission).
      if (this.boardOpen && this.boardAirport === ap) {
        this.closeBoard();
        return 'Mission board closed.';
      }
      this.openBoard(ap);
      return `Mission board open at ${ap.name}. Press 1-${this.availableMissions.length} to accept.`;
    }

    // 'assigned' shouldn't normally happen with the streamlined flow, but
    // handle it defensively for any saved state from older builds.
    if (this.state.phase === 'assigned') {
      if (ap !== this.state.mission.from) {
        return `Wrong airport — pick up at ${this.state.mission.from.name}.`;
      }
      plane.cargoKg = this.state.mission.cargoKg;
      this.state = { phase: 'loaded', mission: this.state.mission, elapsedSec: this.state.elapsedSec };
      return `Loaded ${this.state.mission.cargoKg} kg of ${this.state.mission.cargoName}. Fly to ${this.state.mission.to.name}.`;
    }

    return '';
  }

  // Run the actual delivery — split out so the loaded-phase branch at the top
  // of interact() can call it without going through the airport-zone gate.
  private completeDelivery(plane: Plane): string {
    if (this.state.phase !== 'loaded') return '';
    const m = this.state.mission;
    const tookSec = this.state.elapsedSec;
    // Landing score = inverse of last-impact-speed (gentler = higher)
    const landingScore = Math.max(0, Math.min(100, Math.round(100 - plane.lastImpactSpeed * 12)));
    const speedBonus = Math.max(0, Math.round(m.payout * (m.deadlineSec - tookSec) / m.deadlineSec * 0.5));
    const tierMul = TIERS[m.tier].landingBonusMul;
    const landingPay = Math.round(landingScore * tierMul);
    // Passenger missions: comfort score scales the BASE payout (not bonuses).
    // 100 comfort = full pay, 0 = half pay (passengers still got there).
    const comfortMul = m.type === 'passenger' ? (0.5 + 0.5 * plane.passengerComfort / 100) : 1;
    const adjustedBase = Math.round(m.payout * comfortMul);
    const totalPayout = adjustedBase + speedBonus + landingPay;
    this.cash += totalPayout;
    this.careerEarned += totalPayout;
    this.totalDeliveries++;
    if (landingScore > this.bestLandingScore) this.bestLandingScore = landingScore;
    plane.cargoKg = 0;
    this.state = { phase: 'completed', mission: m, payout: totalPayout, tookSec, landingScore };
    if (m.type === 'passenger') {
      return `Delivered! +$${totalPayout} (base $${adjustedBase} @ ${Math.round(plane.passengerComfort)}% comfort + speed $${speedBonus} + landing $${landingPay}).`;
    }
    return `Delivered ${TIERS[m.tier].label}! +$${totalPayout} (cargo $${m.payout} + speed $${speedBonus} + landing $${landingPay}).`;
  }
}
