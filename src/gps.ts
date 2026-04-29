// GPS moving-map panel. Garmin-style top-down view centered on the plane,
// shows nearby airports + landing sites, course line to selected destination,
// distance, ETE.
//
// Controls:
//   G — toggle off / small / big
//   N — cycle to next destination (airport or landing site)
//   J — previous destination
//   [ + ] when GPS is "big" — zoom in/out

import * as THREE from 'three';
import { AIRPORTS, type Airport } from './world/airport';
import { LANDING_SITES, type LandingSite } from './world/landingSites';
import { POIS } from './world/pois';
import type { Plane } from './sim/plane';
import type { Mission } from './missions';

type Mode = 'off' | 'small' | 'big';
type GpsDest = Airport | LandingSite;

const ZOOM_LEVELS_M = [800, 2000, 5000, 12000, 30000];   // meters across map

let mode: Mode = 'small';
let destIdx = 0;
let zoomIdx = 2;

// All destinations selectable via N/J — airports first, landing sites after.
function allDests(): GpsDest[] {
  return [...AIRPORTS, ...LANDING_SITES];
}

function isAirport(d: GpsDest): d is Airport {
  return 'apronWidth' in d;
}

// keyboard handler — registered once
let registered = false;
function ensureKeys() {
  if (registered) return;
  registered = true;
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.code === 'KeyG') {
      mode = mode === 'off' ? 'small' : (mode === 'small' ? 'big' : 'off');
      const el = document.getElementById('gpsPanel');
      if (el) el.style.display = mode === 'off' ? 'none' : 'block';
    } else if (e.code === 'KeyN') {
      const n = allDests().length;
      destIdx = (destIdx + 1) % n;
    } else if (e.code === 'KeyJ') {
      const n = allDests().length;
      destIdx = (destIdx - 1 + n) % n;
    } else if (e.code === 'BracketRight' && mode === 'big') {
      zoomIdx = Math.min(ZOOM_LEVELS_M.length - 1, zoomIdx + 1);
    } else if (e.code === 'BracketLeft' && mode === 'big') {
      zoomIdx = Math.max(0, zoomIdx - 1);
    }
  });
}

let panelEl: HTMLElement | null = null;
let canvas: HTMLCanvasElement | null = null;

export function mountGps() {
  ensureKeys();
  if (panelEl) return;
  panelEl = document.createElement('div');
  panelEl.id = 'gpsPanel';
  Object.assign(panelEl.style, {
    position: 'fixed',
    bottom: '12px',
    right: '12px',
    background: 'rgba(8,16,12,0.92)',
    border: '2px solid #2c4a36',
    borderRadius: '6px',
    padding: '6px',
    pointerEvents: 'none',
    fontFamily: 'ui-monospace, Menlo, monospace',
    color: '#7cffb3',
    zIndex: '40',
  });
  panelEl.innerHTML = `<canvas id="gpsCanvas"></canvas><div id="gpsLabel" style="font-size:11px; padding-top:4px; text-align:center;"></div>`;
  document.body.appendChild(panelEl);
  canvas = panelEl.querySelector('#gpsCanvas') as HTMLCanvasElement;
}

export interface GpsState {
  destinationName: string;
  destination: GpsDest;
  distanceM: number;
  bearingDeg: number;
  eteMin: number;
  zoomM: number;
}

export function updateGps(plane: Plane, wind: THREE.Vector3, activeMission: Mission | null = null): GpsState | null {
  if (mode === 'off' || !canvas || !panelEl) return null;

  const sizePx = mode === 'small' ? 220 : 460;
  if (canvas.width !== sizePx || canvas.height !== sizePx) {
    canvas.width = sizePx;
    canvas.height = sizePx;
    canvas.style.width = `${sizePx}px`;
    canvas.style.height = `${sizePx}px`;
  }

  const dests = allDests();
  if (destIdx >= dests.length) destIdx = 0;
  const dest = dests[destIdx];
  const dx = dest.cx - plane.pos.x;
  const dz = dest.cz - plane.pos.z;
  const distanceM = Math.hypot(dx, dz);
  const bearingDeg = (Math.atan2(dx, dz) * 180 / Math.PI + 360) % 360;
  // ETE based on ground speed projected toward destination
  const groundSpeed = Math.hypot(plane.vel.x, plane.vel.z); // m/s
  const eteMin = groundSpeed > 0.5 ? distanceM / groundSpeed / 60 : Infinity;
  // Auto-zoom for active survey: pick the smallest ZOOM_LEVELS_M that fits
  // every waypoint plus the plane. Player can still override with [/].
  let zoomM = ZOOM_LEVELS_M[zoomIdx];
  if (activeMission?.type === 'survey' && activeMission.waypoints) {
    let maxD = 0;
    for (const wp of activeMission.waypoints) {
      const d = Math.hypot(wp.x - plane.pos.x, wp.z - plane.pos.z);
      if (d > maxD) maxD = d;
    }
    const need = maxD * 2.2;     // diameter + 10 % padding each side
    for (const z of ZOOM_LEVELS_M) {
      if (z >= need) { zoomM = z; break; }
    }
  }

  drawMap(canvas, plane, dest, zoomM, sizePx, activeMission);

  const lbl = panelEl.querySelector('#gpsLabel') as HTMLElement;
  const distNm = (distanceM / 1852).toFixed(1);
  const distKm = (distanceM / 1000).toFixed(1);
  const eteStr = isFinite(eteMin) ? `${Math.floor(eteMin)}m ${Math.floor((eteMin % 1) * 60)}s` : '--';
  const windKt = (wind.length() * 1.94384).toFixed(0);
  const windFromDeg = wind.length() > 0.05
    ? (Math.atan2(-wind.x, -wind.z) * 180 / Math.PI + 360) % 360
    : 0;
  const planeHdg = Math.round(plane.headingDeg());
  const relBrg = (((bearingDeg - planeHdg) + 540) % 360) - 180;
  const arrow = Math.abs(relBrg) < 5 ? '↑' : (relBrg > 0 ? `→${relBrg.toFixed(0)}°` : `←${(-relBrg).toFixed(0)}°`);

  // Recommended runway: land into the wind. All runways are N-S, so
  //   wind from north  (270°..360° or 0°..90°)  → use RWY 36 (head north)
  //   wind from south  (90°..270°)              → use RWY 18 (head south)
  // With near-calm winds (< ~3 kt) either is fine — show "either".
  const windKtNum = wind.length() * 1.94384;
  let rwyRec: string;
  if (windKtNum < 3) {
    rwyRec = '36/18';
  } else {
    const intoWindFromNorth = windFromDeg > 270 || windFromDeg < 90;
    rwyRec = intoWindFromNorth ? '36' : '18';
  }

  // dest.elev is the voxel's block-Y; the actual ground top (where wheels
  // touch) is +1 voxel up. Display the ground-top altitude so the number
  // matches what the player sees on the altimeter when parked.
  const elevFt = Math.round((dest.elev + 1) * 3.28084);
  // Difficulty badge color — green/yellow/orange/red.
  const diffColor = isAirport(dest)
    ? (dest.difficulty === 'hard' ? '#ff8a3a' : '#7cffb3')
    : (dest.difficulty === 'medium'
        ? '#ffcb6b'
        : dest.difficulty === 'hard'
        ? '#ff8a3a'
        : '#ff5050');
  const diffTag = `<span style="color:${diffColor};font-size:10px">${dest.difficulty.toUpperCase()}</span>`;
  // Landing-site length cue + RWY only meaningful for airports.
  const aidLine = isAirport(dest)
    ? `<span style="color:#7cffb3">RWY ${rwyRec}</span>  <span style="color:#9fd0ff">${elevFt}ft</span>  ${diffTag}`
    : `<span style="color:#7cffb3">${dest.length}m ${dest.surface}</span>  <span style="color:#9fd0ff">${elevFt}ft</span>  ${diffTag}`;
  lbl.innerHTML =
    `<span style="color:#ffcb6b">${dest.name}</span>  ${aidLine}` +
    `<br>${distKm} km / ${distNm} nm  ${arrow}` +
    `<br>BRG ${String(Math.round(bearingDeg)).padStart(3, '0')}°  ETE ${eteStr}` +
    `<br>WIND ${String(Math.round(windFromDeg)).padStart(3, '0')}°@${windKt}kt` +
    `<br><span style="color:#5aa080;font-size:10px">G size · N/J dest · [/] zoom</span>`;

  return {
    destinationName: dest.name,
    destination: dest,
    distanceM, bearingDeg, eteMin, zoomM,
  };
}

function drawMap(c: HTMLCanvasElement, plane: Plane, dest: GpsDest, zoomM: number, sizePx: number, activeMission: Mission | null) {
  const ctx = c.getContext('2d')!;
  const cx = sizePx / 2;
  const cy = sizePx / 2;
  // 1 px = (zoomM / sizePx) meters
  const mPerPx = zoomM / sizePx;

  // background
  ctx.fillStyle = '#08130b';
  ctx.fillRect(0, 0, sizePx, sizePx);

  // grid
  ctx.strokeStyle = 'rgba(124,255,179,0.12)';
  ctx.lineWidth = 1;
  const gridM = niceGridStep(zoomM);
  const gridPx = gridM / mPerPx;
  // offset so grid feels stable as plane moves
  const offX = ((-plane.pos.x % gridM) + gridM) % gridM / mPerPx;
  const offZ = ((-plane.pos.z % gridM) + gridM) % gridM / mPerPx;
  for (let x = -offX; x < sizePx; x += gridPx) {
    ctx.beginPath();
    ctx.moveTo(x, 0); ctx.lineTo(x, sizePx);
    ctx.stroke();
  }
  for (let y = -offZ; y < sizePx; y += gridPx) {
    ctx.beginPath();
    ctx.moveTo(0, y); ctx.lineTo(sizePx, y);
    ctx.stroke();
  }

  // scale label
  ctx.fillStyle = 'rgba(124,255,179,0.55)';
  ctx.font = '10px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'left';
  ctx.fillText(`${gridM >= 1000 ? (gridM / 1000) + 'km' : gridM + 'm'} / sq`, 4, sizePx - 4);

  // North marker
  ctx.fillStyle = '#7cffb3';
  ctx.beginPath();
  ctx.moveTo(sizePx - 12, 12); ctx.lineTo(sizePx - 6, 24); ctx.lineTo(sizePx - 18, 24); ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#08130b';
  ctx.font = 'bold 9px ui-monospace';
  ctx.textAlign = 'center';
  ctx.fillText('N', sizePx - 12, 22);

  // course line to destination
  const ddx = (dest.cx - plane.pos.x) / mPerPx;
  const ddz = (dest.cz - plane.pos.z) / mPerPx;
  ctx.strokeStyle = '#ff63d6';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + ddx, cy - ddz);   // negative dz because canvas Y is inverted
  ctx.stroke();

  // Extended runway centerline through the destination — helps visualize the
  // final approach axis (all runways are N-S so the line is vertical).
  const dax = (dest.cx - plane.pos.x) / mPerPx;
  const daz = (dest.cz - plane.pos.z) / mPerPx;
  const dx_ = cx + dax;
  const dy_ = cy - daz;
  ctx.strokeStyle = 'rgba(255,99,214,0.45)';
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(dx_, dy_ - sizePx);
  ctx.lineTo(dx_, dy_ + sizePx);
  ctx.stroke();
  ctx.setLineDash([]);

  // airport markers — oriented runway rectangles (all N-S in this world)
  ctx.font = '10px ui-monospace';
  for (const ap of AIRPORTS) {
    const ax = (ap.cx - plane.pos.x) / mPerPx;
    const az = (ap.cz - plane.pos.z) / mPerPx;
    const x = cx + ax, y = cy - az;
    if (x < -50 || y < -50 || x > sizePx + 50 || y > sizePx + 50) continue;
    const isDest = ap === dest;
    const color = isDest ? '#ff63d6' : '#ffcb6b';
    const rwyLenPx = ap.runwayLength / mPerPx;
    const rwyWPx = Math.max(2, ap.runwayWidth / mPerPx);

    if (rwyLenPx < 10) {
      // too small to draw oriented; fall back to a marker dot
      ctx.fillStyle = color;
      ctx.fillRect(x - 3, y - 3, 6, 6);
    } else {
      // Runway rectangle
      ctx.fillStyle = color;
      ctx.fillRect(x - rwyWPx / 2, y - rwyLenPx / 2, rwyWPx, rwyLenPx);
      // Centerline (black dashes inside the rectangle)
      if (rwyLenPx > 30) {
        ctx.strokeStyle = '#08130b';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(x, y - rwyLenPx / 2 + 2);
        ctx.lineTo(x, y + rwyLenPx / 2 - 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // Runway numbers at the ends
      if (rwyLenPx > 40) {
        ctx.font = 'bold 9px ui-monospace';
        ctx.fillStyle = isDest ? '#ff63d6' : '#fafafa';
        ctx.textAlign = 'center';
        ctx.fillText('36', x, y - rwyLenPx / 2 - 2);    // north end faces 360°
        ctx.fillText('18', x, y + rwyLenPx / 2 + 9);    // south end faces 180°
      }
    }

    // label (offset so it doesn't overlap the runway). Show field elev so
    // the player knows what altitude to fly the pattern at.
    ctx.font = '10px ui-monospace';
    ctx.fillStyle = isDest ? '#ff63d6' : '#fafafa';
    ctx.textAlign = 'left';
    const labelX = x + Math.max(rwyWPx / 2 + 4, 8);
    ctx.fillText(ap.name, labelX, y + 3);
    if (mPerPx < 30) {
      ctx.fillStyle = '#9fd0ff';
      ctx.font = '9px ui-monospace';
      ctx.fillText(`${Math.round((ap.elev + 1) * 3.28084)}ft`, labelX, y + 13);
    }
  }

  // Survey waypoints — numbered chain with current ring highlighted in magenta.
  if (activeMission?.type === 'survey' && activeMission.waypoints) {
    const wps = activeMission.waypoints;
    const idx = activeMission.waypointIdx ?? 0;
    // Connect line through unvisited waypoints in order, starting from plane.
    ctx.strokeStyle = 'rgba(255,210,80,0.7)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    for (let i = idx; i < wps.length; i++) {
      const wp = wps[i];
      const wx = (wp.x - plane.pos.x) / mPerPx + cx;
      const wy = cy - (wp.z - plane.pos.z) / mPerPx;
      ctx.lineTo(wx, wy);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    // Each waypoint — bigger dots so they read at any zoom.
    for (let i = 0; i < wps.length; i++) {
      const wp = wps[i];
      const wx = (wp.x - plane.pos.x) / mPerPx + cx;
      const wy = cy - (wp.z - plane.pos.z) / mPerPx;
      const isCurrent = i === idx;
      const isHit = wp.hit;
      const r = isCurrent ? 8 : 6;
      const color = isHit ? '#4ce28b' : isCurrent ? '#ff63d6' : '#ffd24a';
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(wx, wy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#08130b';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#08130b';
      ctx.font = 'bold 10px ui-monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), wx, wy + 0.5);
    }
  }

  // POIs — tiny pale dots, only visible at close zoom (otherwise clutter).
  if (mPerPx < 35) {
    for (const p of POIS) {
      const ax = (p.cx - plane.pos.x) / mPerPx;
      const az = (p.cz - plane.pos.z) / mPerPx;
      const x = cx + ax, y = cy - az;
      if (x < -10 || y < -10 || x > sizePx + 10 || y > sizePx + 10) continue;
      ctx.fillStyle = p.kind === 'cabin' ? '#c89060' : p.kind === 'pier' ? '#90a8c8' : '#a08060';
      ctx.beginPath();
      ctx.arc(x, y, 2.2, 0, Math.PI * 2);
      ctx.fill();
      if (mPerPx < 14) {
        ctx.font = '8px ui-monospace';
        ctx.fillStyle = '#999';
        ctx.textAlign = 'left';
        ctx.fillText(p.name, x + 4, y + 3);
      }
    }
  }

  // Off-airport landing sites — small filled circles with surface-tinted
  // color. Selected destination drawn larger + magenta to match airports.
  for (const s of LANDING_SITES) {
    const ax = (s.cx - plane.pos.x) / mPerPx;
    const az = (s.cz - plane.pos.z) / mPerPx;
    const x = cx + ax, y = cy - az;
    if (x < -20 || y < -20 || x > sizePx + 20 || y > sizePx + 20) continue;
    const isDest = s === dest;
    const tint = isDest ? '#ff63d6' :
      s.surface === 'sand' ? '#d4b478' :
      s.surface === 'gravel' ? '#9b958a' :
      s.surface === 'snow' ? '#f0f3f6' :
      '#7ea15f';
    ctx.fillStyle = tint;
    ctx.beginPath();
    ctx.arc(x, y, isDest ? 5 : 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#08130b';
    ctx.lineWidth = 1;
    ctx.stroke();
    if (mPerPx < 50) {       // only label at closer zooms
      ctx.font = '9px ui-monospace';
      ctx.fillStyle = isDest ? '#ff63d6' : '#aab2a6';
      ctx.textAlign = 'left';
      ctx.fillText(s.name, x + 6, y + 3);
      ctx.fillStyle = '#9fd0ff';
      ctx.fillText(`${Math.round((s.elev + 1) * 3.28084)}ft`, x + 6, y + 13);
    }
  }

  // plane chevron (centered, rotated to plane's heading)
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(plane.headingDeg() * Math.PI / 180);
  ctx.fillStyle = '#7cffb3';
  ctx.beginPath();
  ctx.moveTo(0, -10);
  ctx.lineTo(7, 8);
  ctx.lineTo(0, 4);
  ctx.lineTo(-7, 8);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#08130b';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

function niceGridStep(zoomM: number): number {
  // Aim for ~5 squares across the map.
  const target = zoomM / 5;
  const candidates = [50, 100, 200, 500, 1000, 2000, 5000, 10000, 25000];
  let best = candidates[0];
  for (const c of candidates) if (Math.abs(c - target) < Math.abs(best - target)) best = c;
  return best;
}
