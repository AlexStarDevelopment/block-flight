// Achievement system — unlock-once trophies for memorable flights.
//
// Each achievement has a unique id, display info, and a check function
// that returns true when its condition is met. The MissionSystem tracks
// the unlocked set and persists it via saveState. checkAchievements is
// called per frame; on a fresh unlock it pushes a notification.

import type { Plane } from './sim/plane';
import type { MissionSystem } from './missions';
import type { Fleet } from './fleet';

export interface AchievementCtx {
  plane: Plane;
  missions: MissionSystem;
  fleet: Fleet;
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;        // emoji shown next to title
  test: (ctx: AchievementCtx) => boolean;
}

export const ACHIEVEMENTS: Achievement[] = [
  {
    id: 'cub_ceiling',
    name: 'Cub Ceiling',
    description: 'Reach 22,160 ft in a Super Cub — matching the real-world Piper J-3 unofficial altitude record.',
    icon: '🏔️',
    test: ({ plane, fleet }) =>
      fleet.active().id === 'cub' && plane.pos.y * 3.28084 >= 22160,
  },
  {
    id: 'first_delivery',
    name: 'First Delivery',
    description: 'Complete your first cargo mission.',
    icon: '📦',
    test: ({ missions }) => missions.totalDeliveries >= 1,
  },
  {
    id: 'ten_deliveries',
    name: 'Bush Pilot',
    description: 'Complete 10 cargo or passenger deliveries.',
    icon: '✈️',
    test: ({ missions }) => missions.totalDeliveries >= 10,
  },
  {
    id: 'hundred_deliveries',
    name: 'Veteran',
    description: 'Complete 100 deliveries.',
    icon: '🛩️',
    test: ({ missions }) => missions.totalDeliveries >= 100,
  },
  {
    id: 'glider',
    name: 'Dead Stick Hero',
    description: 'Land safely after running out of fuel mid-flight.',
    icon: '🪂',
    test: ({ plane }) =>
      plane.fuelGallons <= 0.001 && plane.onGround && !plane.crashed
      && Math.hypot(plane.vel.x, plane.vel.z) < 5,
  },
  {
    id: 'iceman',
    name: 'Iceman',
    description: 'Survive 100% wing icing without crashing.',
    icon: '🧊',
    test: ({ plane }) => plane.iceAccretion >= 0.99 && !plane.crashed,
  },
  {
    id: 'volcano_visitor',
    name: 'Volcano Visitor',
    description: 'Fly within 1 km of the volcano in the eastern archipelago.',
    icon: '🌋',
    test: ({ plane }) =>
      Math.hypot(plane.pos.x - 7800, plane.pos.z - (-2200)) < 1000
      && plane.pos.y > 50,
  },
  {
    id: 'fly_far',
    name: 'Far Far Away',
    description: 'Fly 200 km from Origin Field.',
    icon: '🧭',
    test: ({ plane }) =>
      Math.hypot(plane.pos.x, plane.pos.z) > 200000,
  },
  {
    id: 'caravan_owner',
    name: 'Big Spender',
    description: 'Buy a Cessna 208 Caravan.',
    icon: '💸',
    test: ({ fleet }) => fleet.owned.some((o) => o.id === 'caravan'),
  },
  {
    id: 'all_planes',
    name: 'Test Pilot',
    description: 'Own every plane in the fleet.',
    icon: '🛬',
    test: ({ fleet }) => fleet.ownedIds().size >= 4,
  },
  {
    id: 'skin_collector',
    name: 'Style Points',
    description: 'Own every paint skin.',
    icon: '🎨',
    test: ({ fleet }) => fleet.ownedSkins.size >= 10,
  },
  {
    id: 'million',
    name: 'Million Dollar Pilot',
    description: 'Earn $1,000,000 in career payouts.',
    icon: '💰',
    test: ({ missions }) => missions.careerEarned >= 1000000,
  },
  {
    id: 'speed_demon',
    name: 'Speed Demon',
    description: 'Exceed 200 kt true airspeed.',
    icon: '🚀',
    test: ({ plane }) => Math.hypot(plane.vel.x, plane.vel.y, plane.vel.z) >= 200 / 1.94384,
  },
  {
    id: 'crater_lake',
    name: 'Crater Lake',
    description: 'Fly through Crater Lake (NE plains).',
    icon: '🏞️',
    test: ({ plane }) =>
      Math.hypot(plane.pos.x - 3500, plane.pos.z - 2500) < 400
      && plane.pos.y < 80 && plane.pos.y > 10,
  },
  {
    id: 'pillar_thread',
    name: 'Threader',
    description: 'Fly through the Pillar Forest at low altitude.',
    icon: '🗿',
    test: ({ plane }) =>
      Math.hypot(plane.pos.x - 4500, plane.pos.z - (-3500)) < 700
      && plane.pos.y < 130,
  },
  {
    id: 'spire_summit',
    name: 'Above the Spire',
    description: 'Fly higher than The Spire (10,000 ft AGL above NW peak).',
    icon: '⛰️',
    test: ({ plane }) =>
      Math.hypot(plane.pos.x - (-4500), plane.pos.z - 3500) < 600
      && plane.altitudeAGL() > 3050,
  },
  {
    id: 'survey_pro',
    name: 'Survey Pro',
    description: 'Complete a survey mission with all photo points hit.',
    icon: '📸',
    test: ({ missions }) =>
      missions.state.phase === 'completed'
      && missions.state.mission.type === 'survey',
  },
  {
    id: 'iconic_bridge',
    name: 'Under the Bridge',
    description: 'Fly under the deck of the iconic suspension bridge across the canyon.',
    icon: '🌉',
    test: ({ plane }) => {
      // Bridge is roughly at canyon t=0.18, perpendicular to canyon axis.
      // Center of bridge span: see iconicBridge.ts.
      const cx = -2500 + 0.18 * (1500 - (-2500));
      const cz = -3000 + 0.18 * (3500 - (-3000));
      const d = Math.hypot(plane.pos.x - cx, plane.pos.z - cz);
      return d < 200 && plane.pos.y < 70 && plane.pos.y > 30;
    },
  },
  {
    id: 'no_repairs',
    name: 'Clean Pilot',
    description: 'Reach 25 deliveries with no crashes or hard landings (zero repair spend).',
    icon: '🏆',
    test: ({ missions }) =>
      missions.totalDeliveries >= 25 && missions.repairsTotal === 0,
  },
];

export function findAchievement(id: string): Achievement | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}

// Run all checks and unlock newly-met achievements. Returns array of newly
// unlocked achievement ids (typically 0 or 1 per frame).
export function checkAchievements(
  ctx: AchievementCtx,
  unlocked: Set<string>,
): string[] {
  const justUnlocked: string[] = [];
  for (const a of ACHIEVEMENTS) {
    if (unlocked.has(a.id)) continue;
    try {
      if (a.test(ctx)) {
        unlocked.add(a.id);
        justUnlocked.push(a.id);
      }
    } catch {
      // Test threw — skip this frame.
    }
  }
  return justUnlocked;
}
