// POIs: small visual landmarks scattered around the world. Cabins, piers,
// hunting blinds. Pure decoration for now (visible from low altitude, marked
// on GPS) — they make the wilderness feel populated and give navigation cues
// beyond the airports.

export type PoiKind = 'cabin' | 'pier' | 'blind';

export interface POI {
  name: string;
  cx: number;
  cz: number;
  elev: number;     // snapped at startup
  kind: PoiKind;
}

export const POIS: POI[] = [
  // Lakeside / waterfront
  { name: 'Lakehouse',     cx:  -600, cz:  -600, elev: 35, kind: 'cabin' },
  { name: 'Eastside Pier', cx:  2700, cz:   500, elev: 33, kind: 'pier' },
  { name: 'Bay Cabin',     cx:  -800, cz:  2200, elev: 38, kind: 'cabin' },
  { name: 'River Pier',    cx: -1900, cz: -1100, elev: 33, kind: 'pier' },
  { name: 'Shoreline',     cx:  2200, cz: -3300, elev: 34, kind: 'pier' },
  // Inland cabins / blinds
  { name: 'Trapper Hut',   cx: -2700, cz:   900, elev: 75, kind: 'cabin' },
  { name: 'Hunting Blind', cx:  1100, cz:  2400, elev: 60, kind: 'blind' },
  { name: 'Old Cabin',     cx:  -300, cz: -2900, elev: 65, kind: 'cabin' },
  { name: 'Spotter Blind', cx:  3000, cz:  1300, elev: 80, kind: 'blind' },
  { name: 'Forester Camp', cx: -1500, cz:  3000, elev: 80, kind: 'cabin' },
  { name: 'Ridge Blind',   cx:  2500, cz: -1800, elev: 85, kind: 'blind' },
];

let elevSnapped = false;
export function snapPoiElevations(groundFn: (x: number, z: number) => number) {
  if (elevSnapped) return;
  elevSnapped = true;
  for (const p of POIS) {
    // Sample a small footprint and take the median for stability.
    const samples: number[] = [];
    for (let dx = -2; dx <= 2; dx += 2) {
      for (let dz = -2; dz <= 2; dz += 2) {
        samples.push(groundFn(p.cx + dx, p.cz + dz));
      }
    }
    samples.sort((a, b) => a - b);
    const median = samples[samples.length >> 1];
    const VOX = 2;
    const raw = Math.max(33, median);
    p.elev = Math.floor(raw / VOX) * VOX + (VOX - 1);
  }
}
