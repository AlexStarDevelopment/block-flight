import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';

export interface Weather {
  windDirDeg: number;       // direction wind comes FROM (heading)
  windSpeedKt: number;      // base (surface) wind speed
  gustsKt: number;          // peak gust amplitude on top of base
  timeOfDay: number;        // 0..1
  windVector: THREE.Vector3; // gust-perturbed instantaneous wind vector AT THE PLANE
  autoTime: boolean;        // auto-advance timeOfDay
  timeRateRealMin: number;  // real minutes per game day
  surfaceTempC: number;     // temperature at sea level (drops 6.5°C/km with altitude)
}

const state: Weather = {
  windDirDeg: 360,         // wind from north → plane spawns facing north into wind
  windSpeedKt: 5,
  gustsKt: 0,
  timeOfDay: 0.45,
  windVector: new THREE.Vector3(),
  autoTime: true,
  timeRateRealMin: 30,     // 30 real minutes = one game day
  surfaceTempC: 15,        // ISA standard
};

// Temperature lapse with altitude — standard 6.5 K/km for the troposphere.
export function tempCAt(altitudeM: number): number {
  return state.surfaceTempC - altitudeM * 0.0065;
}

// Density altitude (m) — what altitude the air "feels like" for performance.
// Approximation: DA = altitude + 120 * (T_actual - T_isa).
export function densityAltitudeM(altitudeM: number): number {
  const tIsa = 15 - altitudeM * 0.0065;
  const tAct = tempCAt(altitudeM);
  return altitudeM + 120 * (tAct - tIsa);
}

const gustNoise = createNoise2D(() => Math.random());
const turbNoiseX = createNoise2D(() => Math.random());
const turbNoiseY = createNoise2D(() => Math.random());
const turbNoiseZ = createNoise2D(() => Math.random());
let timeAccum = 0;

// Logarithmic boundary-layer profile: wind grows with altitude.
// Surface speed at ~10m AGL; multiplier reaches ~2× by 1500m, ~3× by 5000m.
function altitudeMultiplier(aglM: number): number {
  const h = Math.max(2, aglM);
  return 1 + 0.18 * Math.log(h / 10);
}

// Mechanical turbulence near rough terrain — small random vector that wiggles
// with time. Strength scales with surface wind and inversely with altitude.
function terrainTurbulence(aglM: number, surfaceMs: number, t: number): { x: number; y: number; z: number } {
  // Only kicks in low + windy. Halved vs v1 — was overpowering parked planes.
  const factor = Math.max(0, 1 - aglM / 250) * Math.min(1.5, surfaceMs / 8);
  if (factor < 0.02) return { x: 0, y: 0, z: 0 };
  const amp = factor * 0.9;
  return {
    x: turbNoiseX(t * 0.7, 0) * amp,
    y: turbNoiseY(0, t * 0.5) * amp * 0.5,
    z: turbNoiseZ(t * 0.6, t * 0.6) * amp,
  };
}

// Recompute wind at the plane's altitude — called from main with current AGL.
export function updateWindAt(dt: number, aglM: number) {
  timeAccum += dt;
  if (state.autoTime) {
    // 1 game day per timeRateRealMin real minutes.
    state.timeOfDay = (state.timeOfDay + dt / (state.timeRateRealMin * 60)) % 1;
    if (todSlider) todSlider.value = String(state.timeOfDay);
    if (todValueLabel) todValueLabel.textContent = labelTime(state.timeOfDay);
  }
  const altMul = altitudeMultiplier(aglM);
  const baseMs = (state.windSpeedKt / 1.94384) * altMul;
  const gustMs = (state.gustsKt / 1.94384) * altMul;
  const g1 = gustNoise(timeAccum * 0.4, 0);
  const g2 = gustNoise(0, timeAccum * 0.3);
  const speed = Math.max(0, baseMs + g1 * gustMs);
  const towardDeg = (state.windDirDeg + 180) % 360;
  const towardRad = (towardDeg * Math.PI) / 180;
  const dirJitter = g2 * 0.12;
  const turb = terrainTurbulence(aglM, baseMs, timeAccum);
  state.windVector.set(
    Math.sin(towardRad + dirJitter) * speed + turb.x,
    turb.y,
    Math.cos(towardRad + dirJitter) * speed + turb.z,
  );
}

// DOM refs so auto-time updates the slider live.
let todSlider: HTMLInputElement | null = null;
let todValueLabel: Element | null = null;

export function getWeather(): Weather {
  return state;
}

let mounted = false;
export function mountWeatherPanel() {
  if (mounted) return;
  mounted = true;
  const panel = document.createElement('div');
  panel.id = 'weather';
  panel.innerHTML = `
    <h4>WEATHER</h4>
    <label class="row"><span>Wind from</span><span class="val" id="w-dir-v">${state.windDirDeg}°</span></label>
    <input type="range" id="w-dir" min="0" max="359" step="5" value="${state.windDirDeg}">
    <label class="row"><span>Wind speed</span><span class="val" id="w-spd-v">${state.windSpeedKt} kt</span></label>
    <input type="range" id="w-spd" min="0" max="40" step="1" value="${state.windSpeedKt}">
    <label class="row"><span>Gusts</span><span class="val" id="w-gst-v">${state.gustsKt} kt</span></label>
    <input type="range" id="w-gst" min="0" max="20" step="1" value="${state.gustsKt}">
    <label class="row"><span>Surface temp</span><span class="val" id="w-tmp-v">${state.surfaceTempC}°C</span></label>
    <input type="range" id="w-tmp" min="-25" max="35" step="1" value="${state.surfaceTempC}">
    <label class="row"><span>Time of day</span><span class="val" id="w-tod-v">${labelTime(state.timeOfDay)}</span></label>
    <input type="range" id="w-tod" min="0" max="1" step="0.01" value="${state.timeOfDay}">
    <button id="w-preset-calm">Calm</button>
    <button id="w-preset-bush">Bush wind</button>
    <button id="w-preset-storm">Stormy</button>
  `;
  document.body.appendChild(panel);

  const dir = panel.querySelector<HTMLInputElement>('#w-dir')!;
  const spd = panel.querySelector<HTMLInputElement>('#w-spd')!;
  const gst = panel.querySelector<HTMLInputElement>('#w-gst')!;
  const tmp = panel.querySelector<HTMLInputElement>('#w-tmp')!;
  const tod = panel.querySelector<HTMLInputElement>('#w-tod')!;
  const dirV = panel.querySelector('#w-dir-v')!;
  const spdV = panel.querySelector('#w-spd-v')!;
  const gstV = panel.querySelector('#w-gst-v')!;
  const tmpV = panel.querySelector('#w-tmp-v')!;
  const todV = panel.querySelector('#w-tod-v')!;
  todSlider = tod;
  todValueLabel = todV;

  function sync() {
    state.windDirDeg = +dir.value;
    state.windSpeedKt = +spd.value;
    state.gustsKt = +gst.value;
    state.surfaceTempC = +tmp.value;
    state.timeOfDay = +tod.value;
    dirV.textContent = `${state.windDirDeg.toFixed(0)}°`;
    spdV.textContent = `${state.windSpeedKt.toFixed(0)} kt`;
    gstV.textContent = `${state.gustsKt.toFixed(0)} kt`;
    tmpV.textContent = `${state.surfaceTempC.toFixed(0)}°C`;
    todV.textContent = labelTime(state.timeOfDay);
  }
  dir.oninput = spd.oninput = gst.oninput = tmp.oninput = sync;
  // When user grabs the time slider, disable auto-advance until they let go.
  tod.oninput = () => { state.autoTime = false; sync(); };

  function preset(d: number, s: number, g: number, t: number, temp: number) {
    dir.value = String(d); spd.value = String(s); gst.value = String(g); tod.value = String(t); tmp.value = String(temp);
    sync();
  }
  panel.querySelector<HTMLButtonElement>('#w-preset-calm')!.onclick = () => preset(270, 2, 0, 0.5, 18);
  panel.querySelector<HTMLButtonElement>('#w-preset-bush')!.onclick = () => preset(290, 12, 6, 0.42, 8);
  panel.querySelector<HTMLButtonElement>('#w-preset-storm')!.onclick = () => preset(220, 24, 14, 0.62, -2);
  // Wind is driven from main.ts now (needs current AGL). No frame loop here.
}

function labelTime(t: number): string {
  const h = Math.floor(t * 24);
  const m = Math.floor((t * 24 - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
