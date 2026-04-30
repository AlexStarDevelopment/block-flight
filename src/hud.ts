import * as THREE from 'three';
import type { Plane } from './sim/plane';
import { AIRPORTS } from './world/airport';
import { isMouseStickActive } from './input';
import { densityAltitudeM, tempCAt } from './weather';

// Flight path indicator — winged circle showing where the plane will go if
// you maintain current velocity. Toggle persists across sessions.
let _fpiEnabled = false;
try { _fpiEnabled = localStorage.getItem('fpiEnabled') === '1'; } catch { /* SSR / no storage */ }
export function isFpiEnabled(): boolean { return _fpiEnabled; }
export function setFpiEnabled(b: boolean) {
  _fpiEnabled = b;
  try { localStorage.setItem('fpiEnabled', b ? '1' : '0'); } catch { /* ignore */ }
}

export interface HUDElements {
  text: HTMLElement;
  canvas: HTMLCanvasElement;
  crash: HTMLElement;
}

let stallBlinkPhase = 0;
let crashShown = false;

export function renderHUD(
  el: HUDElements,
  plane: Plane,
  fps: number,
  chunks: number,
  view: string,
  wind: THREE.Vector3,
  dt: number,
  camera: THREE.Camera,
) {
  const a = plane.lastAero;
  const ias = a ? a.airspeed : 0;
  const knots = ias * 1.94384;
  const altFt = plane.pos.y * 3.28084;
  const vsi = plane.vel.y * 196.85;
  const hdg = Math.round(plane.headingDeg());
  const pitch = plane.pitchDeg();
  const roll = plane.rollDeg();
  const stallNear = a ? a.stallProximity : 0;
  const stalled = a?.stalled ?? false;
  const ge = a ? (a.groundEffect < 0.99 ? ' GE' : '') : '';
  const flap = plane.controls.flapStage;
  const trim = plane.controls.trim;
  const thr = Math.round(plane.controls.throttle * 100);
  const ground = plane.onGround ? ' GND' : '';
  const stallTxt = stalled && knots > 8 ? ' STALL' : '';

  const windSpeed = wind.length();
  const windFromDeg = windSpeed > 0.05
    ? (Math.atan2(-wind.x, -wind.z) * 180 / Math.PI + 360) % 360
    : 0;
  const windKt = windSpeed * 1.94384;

  const trimMark = trimToBar(trim);

  // Find nearest airport and bearing+distance for navigation
  let nearestName = '';
  let nearestDistKm = 0;
  let nearestBearing = 0;
  let nearestDistFt = 0;
  let bestD2 = Infinity;
  for (const ap of AIRPORTS) {
    const dx = ap.cx - plane.pos.x;
    const dz = ap.cz - plane.pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2) {
      bestD2 = d2;
      nearestName = ap.name;
      const d = Math.sqrt(d2);
      nearestDistKm = d / 1000;
      nearestDistFt = d * 3.28084;
      nearestBearing = (Math.atan2(dx, dz) * 180 / Math.PI + 360) % 360;
    }
  }
  const relBearing = ((nearestBearing - hdg + 540) % 360) - 180; // -180..+180
  const relArrow =
    Math.abs(relBearing) < 5 ? '↑' :
    relBearing > 0 ? `→ ${relBearing.toFixed(0)}°` :
    `← ${(-relBearing).toFixed(0)}°`;

  const brakePct = Math.round(plane.controls.brake * 100);
  const brakeTxt = brakePct > 0 ? `  BRK ${brakePct}%` : '';
  const fuelPct = Math.round((plane.fuelGallons / plane.fuelMaxGallons) * 100);
  const fuelLow = plane.engineDead
    ? '   <ENGINE OUT — refuel at apron>'
    : fuelPct < 25 ? ' !' : '';
  const massKg = plane.totalMass();
  const overMtow = massKg > plane.params.maxMass;
  const overTxt = overMtow
    ? `  <OVER MTOW ${(massKg - plane.params.maxMass).toFixed(0)} kg — engine inhibited>`
    : '';
  const cargoTxt = plane.cargoKg > 0 ? `  CARGO ${plane.cargoKg.toFixed(0)} kg` : '';
  // Show comfort only when actively carrying passengers — keep HUD clean otherwise.
  const comfortTxt = plane.cargoKg > 0 && plane.passengerComfort < 100 - 0.001
    ? `  COMFORT ${Math.round(plane.passengerComfort)}%`
    : '';

  const mouseLine = isMouseStickActive() ? `MOUSE STICK ON  (press M to release)\n` : '';

  const daFt = Math.round(densityAltitudeM(plane.pos.y) * 3.28084);
  const oatC = tempCAt(plane.pos.y);
  const icePct = Math.round(plane.iceAccretion * 100);
  const iceTxt = icePct > 5 ? `  ICE ${icePct}%${icePct > 30 ? ' !' : ''}` : '';

  el.text.textContent =
    `BLOCK FLIGHT  fps:${fps}  chunks:${chunks}  view:${view}\n` +
    `IAS  ${knots.toFixed(0).padStart(3)} kt   ALT ${altFt.toFixed(0).padStart(5)} ft   AGL ${(plane.altitudeAGL() * 3.28084).toFixed(0)} ft   DA ${daFt} ft${iceTxt}\n` +
    `OAT ${oatC.toFixed(0)}°C\n` +
    `VSI  ${vsi >= 0 ? '+' : ''}${vsi.toFixed(0).padStart(4)} fpm   HDG ${String(hdg).padStart(3, '0')}°\n` +
    `THR  ${thr}%   FLAP ${flap}/3   TRIM ${trimMark}${brakeTxt}${stallTxt}${ge}${ground}\n` +
    `FUEL ${plane.fuelGallons.toFixed(1)}/${plane.fuelMaxGallons} gal (${fuelPct}%)${fuelLow}   MASS ${massKg.toFixed(0)} kg${overTxt}${cargoTxt}${comfortTxt}\n` +
    `WIND ${String(Math.round(windFromDeg)).padStart(3, '0')}° @ ${windKt.toFixed(0)} kt\n` +
    `→${nearestName}: ${nearestDistKm.toFixed(1)} km (${nearestDistFt.toFixed(0)} ft)  brg ${String(Math.round(nearestBearing)).padStart(3, '0')}° ${relArrow}\n` +
    mouseLine +
    `\n` +
    `W/S pitch  A/D roll  Q/E rudder  PgUp/PgDn trim  B/Space brakes  P missions  H hangar\n` +
    `Shift/Ctrl throttle  F/V flaps  C camera  R reset  G gps  N/J dest  M mouse  (in hangar: hold U fill, Y drain)`;

  drawCanvasHUD(el.canvas, {
    pitch, roll, hdg,
    knots, altFt, vsi,
    stallNear, stalled, stallSpeed: knots,
    dt,
    relBearing,
    nearestName,
    nearestDistKm,
    fuelGal: plane.fuelGallons,
    fuelMaxGal: plane.fuelMaxGallons,
    throttle: plane.controls.throttle,
    trim: plane.controls.trim,
    plane,
    camera,
  });

  // crash overlay
  if (plane.crashed && !crashShown) {
    el.crash.classList.add('visible');
    el.crash.innerHTML =
      `<div class="big">CRASHED</div>` +
      `<div>${escapeHTML(plane.crashCause)}</div>` +
      `<div class="hint">Press R to reset</div>`;
    crashShown = true;
  } else if (!plane.crashed && crashShown) {
    el.crash.classList.remove('visible');
    crashShown = false;
  }
}

function escapeHTML(s: string) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

function trimToBar(trim: number): string {
  // 11-char bar, center = 0
  const cells = 11;
  const idx = Math.round((trim + 1) / 2 * (cells - 1));
  let bar = '';
  for (let i = 0; i < cells; i++) {
    if (i === idx) bar += '#';
    else if (i === Math.floor(cells / 2)) bar += '|';
    else bar += '-';
  }
  return `[${bar}] ${trim >= 0 ? '+' : ''}${trim.toFixed(2)}`;
}

interface CanvasHUDState {
  pitch: number;
  roll: number;
  hdg: number;
  knots: number;
  altFt: number;
  vsi: number;
  stallNear: number;
  stalled: boolean;
  stallSpeed: number;
  dt: number;
  relBearing: number;
  nearestName: string;
  nearestDistKm: number;
  fuelGal: number;
  fuelMaxGal: number;
  throttle: number;
  trim: number;
  plane: Plane;
  camera: THREE.Camera;
}

let lastDpr = 0;
function ensureCanvasSize(canvas: HTMLCanvasElement): { w: number; h: number; ctx: CanvasRenderingContext2D } {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr || dpr !== lastDpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    lastDpr = dpr;
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w, h, ctx };
}

function drawCanvasHUD(canvas: HTMLCanvasElement, s: CanvasHUDState) {
  const { w, h, ctx } = ensureCanvasSize(canvas);
  ctx.clearRect(0, 0, w, h);
  ctx.font = '12px ui-monospace, Menlo, monospace';

  // ===== Compass tape (top center) =====
  const tapeY = 12;
  const tapeH = 26;
  const tapeW = Math.min(540, w - 40);
  const tapeX = (w - tapeW) / 2;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(tapeX, tapeY, tapeW, tapeH);
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.strokeRect(tapeX + 0.5, tapeY + 0.5, tapeW - 1, tapeH - 1);

  // 90° span
  const degPerPx = 90 / tapeW;
  const cx = tapeX + tapeW / 2;
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let off = -50; off <= 50; off += 5) {
    const heading = ((s.hdg + off) + 360) % 360;
    const x = cx + off / degPerPx;
    if (x < tapeX + 6 || x > tapeX + tapeW - 6) continue;
    if (heading % 30 === 0) {
      ctx.beginPath();
      ctx.moveTo(x, tapeY + tapeH - 12);
      ctx.lineTo(x, tapeY + tapeH - 2);
      ctx.strokeStyle = '#fff';
      ctx.stroke();
      const label =
        heading === 0 ? 'N' :
        heading === 90 ? 'E' :
        heading === 180 ? 'S' :
        heading === 270 ? 'W' :
        String(heading / 10);
      ctx.fillText(label, x, tapeY + 8);
    } else if (heading % 10 === 0) {
      ctx.beginPath();
      ctx.moveTo(x, tapeY + tapeH - 8);
      ctx.lineTo(x, tapeY + tapeH - 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(x, tapeY + tapeH - 5);
      ctx.lineTo(x, tapeY + tapeH - 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.stroke();
    }
  }
  // center caret
  ctx.fillStyle = '#ffcb6b';
  ctx.beginPath();
  ctx.moveTo(cx, tapeY + tapeH);
  ctx.lineTo(cx - 5, tapeY + tapeH + 6);
  ctx.lineTo(cx + 5, tapeY + tapeH + 6);
  ctx.closePath();
  ctx.fill();
  // numeric heading
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.fillText(String(s.hdg).padStart(3, '0') + '°', cx, tapeY + tapeH + 18);

  // Nearest-airport pointer on the compass tape
  if (s.nearestName) {
    const off = s.relBearing;
    const arrowX = cx + Math.max(-tapeW / 2 + 8, Math.min(tapeW / 2 - 8, off / degPerPx));
    ctx.fillStyle = '#7cffb3';
    ctx.beginPath();
    ctx.moveTo(arrowX, tapeY - 4);
    ctx.lineTo(arrowX - 5, tapeY - 12);
    ctx.lineTo(arrowX + 5, tapeY - 12);
    ctx.closePath();
    ctx.fill();
    ctx.font = '11px ui-monospace, Menlo, monospace';
    ctx.fillText(`${s.nearestName} ${s.nearestDistKm.toFixed(1)}km`, arrowX, tapeY - 18);
  }

  // ===== Attitude indicator (bottom center) =====
  const aiSize = 160;
  const aiX = w / 2 - aiSize / 2;
  const aiY = h - aiSize - 24;
  drawAttitudeIndicator(ctx, aiX, aiY, aiSize, s.pitch, s.roll);

  // ===== Speed tape (left of attitude) =====
  drawValueTape(ctx, aiX - 90, aiY, 70, aiSize, 'IAS', s.knots, 'kt', 5, 10);

  // ===== Altitude tape (right of attitude) =====
  drawValueTape(ctx, aiX + aiSize + 20, aiY, 75, aiSize, 'ALT', s.altFt, 'ft', 50, 100);

  // ===== VSI bar (far right of altitude) =====
  drawVSI(ctx, aiX + aiSize + 100, aiY, 22, aiSize, s.vsi);

  // ===== Fuel gauge (right of VSI) =====
  drawFuelGauge(ctx, aiX + aiSize + 130, aiY, 22, aiSize, s.fuelGal, s.fuelMaxGal);

  // ===== Throttle gauge (right of fuel) =====
  drawThrottleGauge(ctx, aiX + aiSize + 160, aiY, 22, aiSize, s.throttle);

  // ===== Trim gauge (right of throttle) =====
  drawTrimGauge(ctx, aiX + aiSize + 190, aiY, 22, aiSize, s.trim);

  // ===== Flight path indicator =====
  if (_fpiEnabled) {
    drawFlightPathIndicator(ctx, w, h, s.plane, s.camera);
  }

  // ===== Stall warning =====
  stallBlinkPhase += s.dt * 6;
  if (s.stalled && s.stallSpeed > 8) {
    const alpha = 0.55 + 0.45 * Math.abs(Math.sin(stallBlinkPhase));
    ctx.save();
    ctx.fillStyle = `rgba(220, 30, 30, ${alpha})`;
    const wText = 220;
    const hText = 38;
    const xText = (w - wText) / 2;
    const yText = h * 0.28;
    ctx.fillRect(xText, yText, wText, hText);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 22px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('STALL', xText + wText / 2, yText + hText / 2);
    ctx.restore();
  } else if (s.stallNear > 0.4) {
    ctx.save();
    ctx.fillStyle = `rgba(220, 160, 30, ${s.stallNear * 0.7})`;
    ctx.font = 'bold 14px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('STALL WARN', w / 2, h * 0.32);
    ctx.restore();
  }
}

function drawAttitudeIndicator(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, size: number,
  pitchDeg: number, rollDeg: number,
) {
  const cx = x + size / 2;
  const cy = y + size / 2;
  const r = size / 2 - 2;

  ctx.save();
  // clip to circle
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();

  // sky/ground rotated by roll, shifted by pitch
  ctx.translate(cx, cy);
  ctx.rotate((-rollDeg * Math.PI) / 180);
  const pixPerDeg = size / 80;
  const pitchOff = pitchDeg * pixPerDeg;
  // sky
  ctx.fillStyle = '#5fa8ff';
  ctx.fillRect(-size, -size + pitchOff, size * 2, size * 2);
  // ground
  ctx.fillStyle = '#7e5a3a';
  ctx.fillRect(-size, pitchOff, size * 2, size * 2);
  // horizon line
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-size, pitchOff);
  ctx.lineTo(size, pitchOff);
  ctx.stroke();
  // pitch ladder
  ctx.lineWidth = 1;
  ctx.font = '10px ui-monospace, Menlo, monospace';
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let p = -60; p <= 60; p += 10) {
    if (p === 0) continue;
    const yL = -p * pixPerDeg + pitchOff;
    const wLine = p % 30 === 0 ? 50 : 30;
    ctx.beginPath();
    ctx.moveTo(-wLine / 2, yL);
    ctx.lineTo(wLine / 2, yL);
    ctx.stroke();
    if (p % 30 === 0) {
      ctx.fillText(`${Math.abs(p)}`, -wLine / 2 - 4, yL);
      ctx.textAlign = 'left';
      ctx.fillText(`${Math.abs(p)}`, wLine / 2 + 4, yL);
      ctx.textAlign = 'right';
    }
  }
  ctx.restore();

  // outer ring with bank arc
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  // bank tick marks (top half)
  for (const ang of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
    const a = (ang - 90) * Math.PI / 180;
    const r1 = r;
    const r2 = ang === 0 ? r - 12 : (Math.abs(ang) % 30 === 0 ? r - 8 : r - 5);
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
    ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
    ctx.stroke();
  }
  // bank pointer rotated by roll
  ctx.save();
  ctx.rotate((-rollDeg * Math.PI) / 180);
  ctx.fillStyle = '#ffcb6b';
  ctx.beginPath();
  ctx.moveTo(0, -r + 1);
  ctx.lineTo(-5, -r + 11);
  ctx.lineTo(5, -r + 11);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.restore();

  // fixed wing symbol
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = '#ffcb6b';
  ctx.fillStyle = '#ffcb6b';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-32, 0); ctx.lineTo(-8, 0);
  ctx.moveTo(8, 0); ctx.lineTo(32, 0);
  ctx.moveTo(-8, 0); ctx.lineTo(-8, 5);
  ctx.moveTo(8, 0); ctx.lineTo(8, 5);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawValueTape(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  label: string, value: number, units: string,
  minorStep: number, majorStep: number,
) {
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

  const cy = y + h / 2;
  const pixPerUnit = h / 60; // shows ±30 units
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = '#fff';
  ctx.font = '10px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const start = Math.floor((value - 30) / minorStep) * minorStep;
  const end = Math.ceil((value + 30) / minorStep) * minorStep;
  for (let v = start; v <= end; v += minorStep) {
    const yPos = cy - (v - value) * pixPerUnit;
    if (yPos < y - 4 || yPos > y + h + 4) continue;
    const isMajor = Math.round(v / majorStep) * majorStep === v;
    ctx.strokeStyle = isMajor ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.4)';
    ctx.beginPath();
    ctx.moveTo(x + w - (isMajor ? 14 : 8), yPos);
    ctx.lineTo(x + w - 2, yPos);
    ctx.stroke();
    if (isMajor) {
      ctx.fillText(String(Math.round(v)), x + w - 18, yPos);
    }
  }
  ctx.restore();

  // current value box
  ctx.fillStyle = '#000';
  ctx.fillRect(x - 1, cy - 11, w + 2, 22);
  ctx.strokeStyle = '#ffcb6b';
  ctx.strokeRect(x - 1.5, cy - 11.5, w + 3, 23);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.font = 'bold 13px ui-monospace, Menlo, monospace';
  ctx.fillText(String(Math.round(value)), x + w / 2, cy + 0.5);

  // label
  ctx.fillStyle = '#ffcb6b';
  ctx.font = '10px ui-monospace, Menlo, monospace';
  ctx.fillText(`${label} (${units})`, x + w / 2, y - 4);
}

function drawThrottleGauge(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  throttle: number,
) {
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

  const pct = Math.max(0, Math.min(1, throttle));
  const fillH = (h - 4) * pct;
  // Cool blue at idle → orange at full power.
  const r = Math.round(80 + 175 * pct);
  const g = Math.round(140 + 60 * (1 - pct));
  const b = Math.round(220 - 180 * pct);
  ctx.fillStyle = `rgb(${r},${g},${b})`;
  ctx.fillRect(x + 2, y + h - 2 - fillH, w - 4, fillH);

  // Tick marks at quarters
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  for (let q = 1; q < 4; q++) {
    const ty = y + h - 2 - (h - 4) * (q / 4);
    ctx.beginPath();
    ctx.moveTo(x, ty);
    ctx.lineTo(x + 5, ty);
    ctx.stroke();
  }

  // Numeric percent below
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.font = 'bold 11px ui-monospace, Menlo, monospace';
  ctx.fillText(`${Math.round(pct * 100)}%`, x + w / 2, y + h + 14);

  // Label
  ctx.fillStyle = '#ffcb6b';
  ctx.font = '10px ui-monospace, Menlo, monospace';
  ctx.fillText('THR', x + w / 2, y - 4);
}

function drawTrimGauge(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  trim: number,
) {
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

  const cy = y + h / 2;
  // Center reference line.
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.beginPath();
  ctx.moveTo(x, cy);
  ctx.lineTo(x + w, cy);
  ctx.stroke();

  // Tick marks at ±0.5.
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  const halfH = h / 2 - 4;
  for (const t of [-0.5, 0.5]) {
    const ty = cy - t * halfH;
    ctx.beginPath();
    ctx.moveTo(x, ty);
    ctx.lineTo(x + 5, ty);
    ctx.stroke();
  }

  // Bar from center, up = nose-up trim, down = nose-down trim.
  const clamped = Math.max(-1, Math.min(1, trim));
  const barY = cy - clamped * halfH;
  ctx.fillStyle = trim >= 0 ? '#ffcb6b' : '#9fd0ff';
  if (trim >= 0) {
    ctx.fillRect(x + w / 2, barY, w / 2 - 2, cy - barY);
  } else {
    ctx.fillRect(x + w / 2, cy, w / 2 - 2, barY - cy);
  }

  // Numeric below — sign + 2 decimals.
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.font = 'bold 11px ui-monospace, Menlo, monospace';
  const txt = trim >= 0 ? `+${trim.toFixed(2)}` : trim.toFixed(2);
  ctx.fillText(txt, x + w / 2, y + h + 14);

  // Label.
  ctx.fillStyle = '#ffcb6b';
  ctx.font = '10px ui-monospace, Menlo, monospace';
  ctx.fillText('TRIM', x + w / 2, y - 4);
}

function drawFuelGauge(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  gal: number, maxGal: number,
) {
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

  const pct = Math.max(0, Math.min(1, gal / maxGal));
  // Fill from bottom up; color goes red → yellow → green with fraction.
  const fillH = (h - 4) * pct;
  // Pick color based on level
  const colorR = pct < 0.20 ? '#ff4540' : pct < 0.45 ? '#ffb441' : '#4ce28b';
  ctx.fillStyle = colorR;
  ctx.fillRect(x + 2, y + h - 2 - fillH, w - 4, fillH);

  // Tick marks at quarters
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  for (let q = 1; q < 4; q++) {
    const ty = y + h - 2 - (h - 4) * (q / 4);
    ctx.beginPath();
    ctx.moveTo(x, ty);
    ctx.lineTo(x + 5, ty);
    ctx.stroke();
  }

  // Low-fuel pulsing border
  if (pct < 0.20) {
    const a = 0.5 + 0.5 * Math.sin(performance.now() / 200);
    ctx.strokeStyle = `rgba(255,80,60,${a})`;
    ctx.lineWidth = 2;
    ctx.strokeRect(x - 1, y - 1, w + 2, h + 2);
    ctx.lineWidth = 1;
  }

  // Numeric readout below
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.font = 'bold 11px ui-monospace, Menlo, monospace';
  ctx.fillText(`${Math.round(gal)}g`, x + w / 2, y + h + 14);

  // Label
  ctx.fillStyle = '#ffcb6b';
  ctx.font = '10px ui-monospace, Menlo, monospace';
  ctx.fillText('FUEL', x + w / 2, y - 4);
}

// Flight path indicator — projects the plane's velocity vector onto the
// camera view and draws a winged-circle marker at the projected screen
// position. Standard glass-cockpit symbology: shows where you're actually
// going (NOT where you're pointing), so you can manage energy on approach.
const _fpiVel = new THREE.Vector3();
const _fpiTarget = new THREE.Vector3();
function drawFlightPathIndicator(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  plane: Plane,
  camera: THREE.Camera,
) {
  _fpiVel.copy(plane.vel);
  const speed = _fpiVel.length();
  if (speed < 5) return;     // too slow for a meaningful direction vector

  // Project a point along the velocity vector — using a fixed lookahead so
  // the symbol stays in roughly the same spot relative to the velocity.
  const lookahead = 100;
  _fpiTarget.copy(_fpiVel).normalize().multiplyScalar(lookahead).add(plane.pos);
  _fpiTarget.project(camera);    // → NDC: x,y in [-1,1]; z>1 = behind camera

  if (_fpiTarget.z > 1 || _fpiTarget.z < -1) return;
  const x = (_fpiTarget.x + 1) / 2 * w;
  const y = (1 - _fpiTarget.y) / 2 * h;
  // Skip if too far off-screen to be useful (would just clutter edges).
  if (x < -20 || x > w + 20 || y < -20 || y > h + 20) return;

  ctx.save();
  ctx.strokeStyle = '#7cffb3';
  ctx.lineWidth = 2;
  // Center circle.
  ctx.beginPath();
  ctx.arc(x, y, 7, 0, Math.PI * 2);
  ctx.stroke();
  // Wings + tail tick (winged-dot symbology).
  ctx.beginPath();
  ctx.moveTo(x - 16, y); ctx.lineTo(x - 7, y);
  ctx.moveTo(x + 7, y);  ctx.lineTo(x + 16, y);
  ctx.moveTo(x, y - 7);  ctx.lineTo(x, y - 12);
  ctx.stroke();
  // Tiny center dot.
  ctx.fillStyle = '#7cffb3';
  ctx.beginPath();
  ctx.arc(x, y, 1.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawVSI(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  vsiFpm: number,
) {
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

  const cy = y + h / 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.beginPath();
  ctx.moveTo(x, cy);
  ctx.lineTo(x + w, cy);
  ctx.stroke();

  // tick marks at +/- 500, 1000, 2000 fpm
  ctx.font = '9px ui-monospace, Menlo, monospace';
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const fpmRange = 2000;
  const halfH = h / 2 - 4;
  for (const v of [-2000, -1000, -500, 500, 1000, 2000]) {
    const yt = cy - (v / fpmRange) * halfH;
    ctx.beginPath();
    ctx.moveTo(x, yt);
    ctx.lineTo(x + 5, yt);
    ctx.stroke();
    ctx.fillText(`${Math.abs(v) / 1000}`, x + 6, yt);
  }

  // current bar
  const clamped = Math.max(-fpmRange, Math.min(fpmRange, vsiFpm));
  const barY = cy - (clamped / fpmRange) * halfH;
  ctx.fillStyle = vsiFpm >= 0 ? '#4ce28b' : '#ff7b6b';
  if (vsiFpm >= 0) {
    ctx.fillRect(x + w / 2, barY, w / 2 - 2, cy - barY);
  } else {
    ctx.fillRect(x + w / 2, cy, w / 2 - 2, barY - cy);
  }

  // label
  ctx.fillStyle = '#ffcb6b';
  ctx.font = '10px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.fillText('VSI', x + w / 2, y - 4);
}
