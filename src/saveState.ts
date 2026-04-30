// Lightweight localStorage persistence for player progress.
// Only persists durable progression (cash, totals, best landing). Per-flight
// state (current cargo, position) is intentionally not saved — start fresh
// at the home airport every load.

import type { MissionSystem } from './missions';
import { getWeather } from './weather';
import { Fleet, type SerializedFleet } from './fleet';

const KEY = 'block-flight-save-v1';

interface SaveData {
  cash: number;
  totalDeliveries: number;
  bestLandingScore: number;
  timeOfDay: number;
  careerEarned?: number;
  careerHours?: number;
  milesFlown?: number;
  repairsTotal?: number;
  fleet?: SerializedFleet;
  unlockedAchievements?: string[];
}

export function loadSave(missions: MissionSystem): Fleet {
  let fleet = new Fleet();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fleet;
    const d = JSON.parse(raw) as SaveData;
    if (typeof d.cash === 'number') missions.cash = d.cash;
    if (typeof d.totalDeliveries === 'number') missions.totalDeliveries = d.totalDeliveries;
    // Testing: floor cash + career stats so all planes and ranks are unlocked.
    if (missions.cash < 1000000) missions.cash = 1000000;
    if (missions.careerEarned < 100000) missions.careerEarned = 100000;
    if (missions.totalDeliveries < 200) missions.totalDeliveries = 200;
    if (typeof d.bestLandingScore === 'number') missions.bestLandingScore = d.bestLandingScore;
    if (typeof d.careerEarned === 'number') missions.careerEarned = d.careerEarned;
    if (typeof d.careerHours === 'number') missions.careerHours = d.careerHours;
    if (typeof d.milesFlown === 'number') missions.milesFlown = d.milesFlown;
    if (typeof d.repairsTotal === 'number') missions.repairsTotal = d.repairsTotal;
    if (typeof d.timeOfDay === 'number') {
      const w = getWeather();
      w.timeOfDay = d.timeOfDay;
    }
    if (d.fleet) fleet = Fleet.fromSerialized(d.fleet);
    if (Array.isArray(d.unlockedAchievements)) {
      missions.unlockedAchievements = new Set(d.unlockedAchievements);
    }
  } catch {
    /* ignore corrupt save */
  }
  return fleet;
}

export function writeSave(missions: MissionSystem, fleet: Fleet) {
  try {
    const w = getWeather();
    const data: SaveData = {
      cash: missions.cash,
      totalDeliveries: missions.totalDeliveries,
      bestLandingScore: missions.bestLandingScore,
      timeOfDay: w.timeOfDay,
      careerEarned: missions.careerEarned,
      careerHours: missions.careerHours,
      milesFlown: missions.milesFlown,
      repairsTotal: missions.repairsTotal,
      fleet: fleet.serialize(),
      unlockedAchievements: Array.from(missions.unlockedAchievements),
    };
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* storage may be full or disabled */
  }
}

export function clearSave() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
