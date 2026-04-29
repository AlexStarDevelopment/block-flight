// Fleet — owned planes, active selection, per-plane upgrades + fuel state.
// All persisted to localStorage. Effective AircraftParams for the active plane
// = base spec + applied upgrades.

import type { AircraftParams } from './sim/aero';
import { PLANES, TANK_GALLONS, type PlaneId, type PlaneSpec } from './sim/planes';

export type UpgradeKind =
  | 'engine'
  | 'prop_cruise'
  | 'prop_climb'
  | 'tank'
  | 'vortex_gen'      // STOL: lower stall speed via +clMax + alphaStall.
  | 'alpine_tires';   // Better braking on snow / ice.

export interface Upgrade {
  kind: UpgradeKind;
  level: number;            // 0 = unowned, 1+ = owned (stack-able where it makes sense)
}

// Upgrade catalog: name, max level, cost-per-level, effect description.
export interface UpgradeSpec {
  kind: UpgradeKind;
  name: string;
  description: string;
  maxLevel: number;
  costPerLevel: (planeCost: number) => number;
  apply: (p: AircraftParams, level: number) => AircraftParams;
  applyTankGallons?: (base: number, level: number) => number;
}

export const UPGRADES: UpgradeSpec[] = [
  {
    kind: 'engine',
    name: 'Engine',
    description: '+12 % thrust per level — better climb and cruise.',
    maxLevel: 3,
    costPerLevel: (c) => Math.max(800, Math.round(c * 0.12)),
    apply: (p, lvl) => ({ ...p, maxThrust: p.maxThrust * (1 + 0.12 * lvl) }),
  },
  {
    kind: 'prop_cruise',
    name: 'Cruise prop',
    description: 'Trades climb for top speed (+8 % vMax, slower spool-up).',
    maxLevel: 1,
    costPerLevel: (c) => Math.max(500, Math.round(c * 0.08)),
    apply: (p, lvl) => lvl > 0 ? { ...p, vMax: p.vMax * 1.08, propWashSpeed: p.propWashSpeed * 0.92 } : p,
  },
  {
    kind: 'prop_climb',
    name: 'Climb prop',
    description: 'Steeper pitch for STOL (+15 % static thrust, -5 % vMax).',
    maxLevel: 1,
    costPerLevel: (c) => Math.max(500, Math.round(c * 0.08)),
    apply: (p, lvl) => lvl > 0 ? { ...p, maxThrust: p.maxThrust * 1.15, vMax: p.vMax * 0.95 } : p,
  },
  {
    kind: 'tank',
    name: 'Aux tanks',
    description: '+50 % fuel capacity (longer legs, heavier when full).',
    maxLevel: 1,
    costPerLevel: (c) => Math.max(400, Math.round(c * 0.07)),
    apply: (p) => p,            // no aero change — capacity handled separately
    applyTankGallons: (base, lvl) => lvl > 0 ? base * 1.5 : base,
  },
  {
    kind: 'vortex_gen',
    name: 'Vortex generators',
    description: 'STOL kit: +12 % clMax, +2° stall AoA — lower stall speed.',
    maxLevel: 1,
    costPerLevel: (c) => Math.max(700, Math.round(c * 0.10)),
    apply: (p, lvl) => lvl > 0
      ? { ...p, clMax: p.clMax * 1.12, alphaStall: p.alphaStall + (2 * Math.PI) / 180 }
      : p,
  },
  {
    kind: 'alpine_tires',
    name: 'Alpine tires',
    description: 'Studded snow/ice tires — much better braking on icy surfaces.',
    maxLevel: 1,
    costPerLevel: (c) => Math.max(600, Math.round(c * 0.08)),
    apply: (p, lvl) => lvl > 0
      ? { ...p, iceBrakeBonus: 2.6, iceSlipBonus: 1.8 }
      : p,
  },
];

// Note: prop_cruise and prop_climb are mutually exclusive (one or the other,
// not both). Hangar UI enforces this when offering a purchase.

export interface OwnedPlane {
  id: PlaneId;
  upgrades: Upgrade[];        // sparse: only kinds the player has bought
  fuelGallons: number;        // current fuel state — survives plane swaps
  skinId?: string;            // applied paint scheme (defaults to 'cub_yellow')
}

export class Fleet {
  owned: OwnedPlane[] = [{ id: 'cub', upgrades: [], fuelGallons: TANK_GALLONS.cub, skinId: 'cub_yellow' }];
  activeIdx = 0;
  // Set of skin IDs the player owns. The default skin is always owned.
  ownedSkins: Set<string> = new Set(['cub_yellow']);

  active(): OwnedPlane { return this.owned[this.activeIdx]; }
  activeSpec(): PlaneSpec { return PLANES[this.active().id]; }

  effectiveParams(): AircraftParams {
    const op = this.active();
    let p: AircraftParams = { ...this.activeSpec().params };
    for (const up of op.upgrades) {
      const spec = UPGRADES.find(u => u.kind === up.kind);
      if (spec) p = spec.apply(p, up.level);
    }
    return p;
  }

  effectiveTankGallons(): number {
    const op = this.active();
    const base = TANK_GALLONS[op.id];
    let cap = base;
    for (const up of op.upgrades) {
      const spec = UPGRADES.find(u => u.kind === up.kind);
      if (spec?.applyTankGallons) cap = spec.applyTankGallons(cap, up.level);
    }
    return cap;
  }

  ownedIds(): Set<PlaneId> {
    return new Set(this.owned.map(o => o.id));
  }

  // Buy a plane. Returns true on success. Caller deducts cost from cash.
  buyPlane(id: PlaneId): boolean {
    if (this.ownedIds().has(id)) return false;
    this.owned.push({ id, upgrades: [], fuelGallons: TANK_GALLONS[id], skinId: 'cub_yellow' });
    return true;
  }

  buySkin(id: string): boolean {
    if (this.ownedSkins.has(id)) return false;
    this.ownedSkins.add(id);
    return true;
  }
  applySkin(id: string): boolean {
    if (!this.ownedSkins.has(id)) return false;
    this.active().skinId = id;
    return true;
  }
  activeSkinId(): string {
    return this.active().skinId ?? 'cub_yellow';
  }

  // Switch active plane by index in this.owned.
  setActive(idx: number) {
    if (idx < 0 || idx >= this.owned.length) return;
    this.activeIdx = idx;
  }

  upgradeLevel(kind: UpgradeKind): number {
    const u = this.active().upgrades.find(x => x.kind === kind);
    return u ? u.level : 0;
  }

  // Buy ONE level of an upgrade for the active plane. Returns the cost on
  // success, or null if not applicable.
  buyUpgrade(kind: UpgradeKind): number | null {
    const spec = UPGRADES.find(u => u.kind === kind);
    if (!spec) return null;
    const cur = this.upgradeLevel(kind);
    if (cur >= spec.maxLevel) return null;
    // Mutual exclusion: cruise vs climb prop.
    if (kind === 'prop_cruise' && this.upgradeLevel('prop_climb') > 0) return null;
    if (kind === 'prop_climb' && this.upgradeLevel('prop_cruise') > 0) return null;
    const cost = spec.costPerLevel(PLANES[this.active().id].cost);
    const existing = this.active().upgrades.find(x => x.kind === kind);
    if (existing) existing.level += 1;
    else this.active().upgrades.push({ kind, level: 1 });
    return cost;
  }

  serialize(): SerializedFleet {
    return {
      owned: this.owned.map(o => ({ ...o, upgrades: o.upgrades.slice() })),
      activeIdx: this.activeIdx,
      ownedSkins: Array.from(this.ownedSkins),
    };
  }
  static fromSerialized(s: SerializedFleet | undefined): Fleet {
    const f = new Fleet();
    if (!s) return f;
    if (Array.isArray(s.owned) && s.owned.length > 0) {
      f.owned = s.owned.map(o => ({
        id: o.id,
        upgrades: o.upgrades ?? [],
        fuelGallons: o.fuelGallons ?? TANK_GALLONS[o.id],
        skinId: o.skinId ?? 'cub_yellow',
      }));
      f.activeIdx = Math.max(0, Math.min(f.owned.length - 1, s.activeIdx ?? 0));
    }
    if (Array.isArray(s.ownedSkins)) {
      f.ownedSkins = new Set(s.ownedSkins);
    }
    f.ownedSkins.add('cub_yellow');     // default always owned
    return f;
  }
}

export interface SerializedFleet {
  owned: { id: PlaneId; upgrades: Upgrade[]; fuelGallons: number; skinId?: string }[];
  activeIdx: number;
  ownedSkins?: string[];
}
