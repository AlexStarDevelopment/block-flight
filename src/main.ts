import * as THREE from 'three';
import './style.css';
import { AIRPORTS, snapAirportElevations } from './world/airport';
import { snapLandingSiteElevations, LANDING_SITES } from './world/landingSites';
import { snapPoiElevations } from './world/pois';
import { buildPoiMarkers } from './render/poiMarkers';
import { groundNoiseHeight, heightAt } from './world/terrain';
import { World } from './world/world';
import { initChunkCache } from './world/chunkCache';
import { DistantTerrain } from './world/lod';
import { Plane } from './sim/plane';
import { buildPlaneMesh, type PlaneVisual, type PlaneVisualId } from './render/planeMesh';
import { buildWindsock } from './render/windsock';
import { buildAirportBeacon } from './render/beacon';
import { AirportMarkers } from './render/airportMarker';
import { RunwayLights } from './render/runwayLights';
import { SkyEffects } from './render/skyEffects';
import { CloudLayer } from './render/clouds';
import { buildRunways } from './render/runway';
import { buildAirportBuildings, buildSimpleTaxiways } from './render/airportBuildings';
import { buildLandingSiteMarkers } from './render/landingSiteMarkers';
import { buildCity } from './render/cityBuildings';
import { buildCityRoads } from './render/cityRoads';
import { buildCityInfra, registerCityHazards } from './render/cityInfra';
import { buildIconicBridge } from './render/iconicBridge';
import { SurveyWaypointMarkers } from './render/surveyWaypoints';
import { buildCockpitOverlay } from './render/cockpit';
import { consumeCameraToggle, consumeReset, getControls, isKeyHeld, setFlapStage, setThrottle, updateInput } from './input';
import { renderHUD, isFpiEnabled, setFpiEnabled } from './hud';
import { mountWeatherPanel, getWeather, updateWindAt } from './weather';
import { mountGps, updateGps } from './gps';
import { MissionSystem, TIERS, destZoneCenter } from './missions';
import { buildCargoZones } from './render/cargoZones';
import { initSound, updateSound, crashSound, touchdownSound } from './sound';
import { loadSave, writeSave } from './saveState';
import { PLANES, PLANE_ORDER, TANK_GALLONS, FUEL_BURN } from './sim/planes';
import { UPGRADES, type UpgradeKind } from './fleet';
import { RANKS } from './missions';
import { SKINS, getSkin } from './skins';
import { mountCareerPanel, updateCareerPanel } from './careerPanel';
import { mountPerfHud } from './perfHud';
import { makeStressFly } from './stressFly';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const hudText = document.getElementById('hud') as HTMLDivElement;
const hudCanvas = document.getElementById('hudcanvas') as HTMLCanvasElement;
const crashEl = document.getElementById('crash') as HTMLDivElement;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); // cap dpr for perf
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
// Long-range visibility for picking out airports at distance.
// Closer fog hides the messiest LOD detail and gives a sense of atmospheric
// depth. Too close and the world feels claustrophobic — 1500 m near, 14 km far
// is the sweet spot for "you can see the next valley but not the next county."
// Fog kept long so the player can see distant terrain LOD without the world
// looking claustrophobic. Near-fog start ~3.5 km (well past voxel boundary),
// fully fogged at 24 km.
scene.fog = new THREE.Fog(0x87ceeb, 3500, 24000);

const camera = new THREE.PerspectiveCamera(
  68,
  window.innerWidth / window.innerHeight,
  0.5,
  60000,
);

const sun = new THREE.DirectionalLight(0xfff4d6, 1.15);
sun.position.set(120, 200, 80);
scene.add(sun);
const hemi = new THREE.HemisphereLight(0xb8d8ff, 0x4a3b2a, 0.55);
scene.add(hemi);

// Voxel chunks (worker-loaded). Each chunk = 32 m, so r=12 = 384 m visible
// voxel terrain around the player.
// Kick off the persistent chunk cache early — it loads asynchronously, and
// any chunks dispatched before it's ready just go through the worker like
// before. Once warm, repeat visits load instantly.
initChunkCache();
// Snap airport + landing-site elevations to local terrain BEFORE world starts
// loading chunks. Both modules must agree with the worker's snap.
snapAirportElevations(groundNoiseHeight);
snapLandingSiteElevations(groundNoiseHeight);
snapPoiElevations(groundNoiseHeight);

// Voxel detail bubble — 31 chunks across (~960 m diameter, r=15). City LOD
// + cable batching + 12 worker pool make this comfortable now.
const world = new World(scene, 15);
// Near LOD: 6 km square at 32 m cells, hole matches voxel area (15 × 32 = 480 m).
const nearLod = new DistantTerrain(6000, 32, 480);
scene.add(nearLod.group);
// Mid LOD: 18 km at 80 m cells (denser than before for smoother distant detail).
const midLod = new DistantTerrain(18000, 80, 3000);
scene.add(midLod.group);
// Far LOD: 70 km square at 400 m cells — gives 35 km visible horizon.
const farLod = new DistantTerrain(70000, 400, 9000, true);
scene.add(farLod.group);

const plane = new Plane();
const homeField = AIRPORTS[0];

// Compute the spawn body Y so the plane sits just above its rest height for
// whatever gear depth the active plane has. Cub gear y=-0.9 → +1.15; Caravan
// gear y=-1.4 → +1.65. Without this big planes spawn too low → constant
// prop strike on load.
function spawnY(surfaceY: number): number {
  const gearY = plane.gear[0].pos.y;          // negative (e.g., -0.9)
  const restLength = plane.gear[0].restLength;
  return surfaceY - gearY + restLength - 0.05;
}

function spawnAtCargoZone() {
  const spawnX = homeField.cx + homeField.apronWidth / 2 + 14;
  const spawnZ = homeField.cz;
  // Voxel-aligned surface top so the plane spawns just above the actual cube.
  const VOX = 2;
  const h = heightAt(Math.floor(spawnX), Math.floor(spawnZ));
  const surfaceY = Math.floor(h / VOX) * VOX + VOX;
  // Face west — toward the runway via the midpoint cross taxiway.
  plane.reset(new THREE.Vector3(spawnX, spawnY(surfaceY), spawnZ), -Math.PI / 2);
  plane.vel.set(0, 0, 0);
  setThrottle(0);
  setFlapStage(0);
}

spawnAtCargoZone();

if (import.meta.env.DEV) {
  (window as any).debug = {
    plane,
    getControls,
    stressFly: makeStressFly(plane, world),
    scene,
    renderer,
  };
}

const perfHud = mountPerfHud(renderer);
let lodAccumMs = 0;
let lodSamples = 0;

// Build a distinct mesh per plane and toggle visibility on swap. Cheaper at
// switch time than rebuilding (and avoids garbage-collecting THREE objects).
const planeVisuals: Record<PlaneVisualId, PlaneVisual> = {
  cub: buildPlaneMesh('cub'),
  beaver: buildPlaneMesh('beaver'),
  otter: buildPlaneMesh('otter'),
  caravan: buildPlaneMesh('caravan'),
};
for (const v of Object.values(planeVisuals)) {
  scene.add(v.group);
  v.group.visible = false;
}
let planeVisual: PlaneVisual = planeVisuals.cub;
planeVisual.group.visible = true;

// Cockpit overlay attached to camera (only visible in cockpit mode)
const cockpit = buildCockpitOverlay();
camera.add(cockpit.group);
scene.add(camera);

// Per-airport windsock + tall checkered beacon for visibility from altitude.
const windsocks: { update: (w: THREE.Vector3) => void }[] = [];
const beacons: { update: (t: number) => void }[] = [];
for (const ap of AIRPORTS) {
  const ws = buildWindsock();
  ws.group.position.set(
    ap.cx + ap.runwayWidth / 2 + 4,
    ap.elev + 1,
    ap.cz - ap.runwayLength / 2 + 25,
  );
  scene.add(ws.group);
  windsocks.push(ws);

  const beacon = buildAirportBeacon();
  beacon.group.position.set(
    ap.cx + ap.apronWidth / 2 + 6,
    ap.elev + 1,
    ap.cz,
  );
  scene.add(beacon.group);
  beacons.push(beacon);
}
const airportMarkers = new AirportMarkers();
scene.add(airportMarkers.group);
const runwayLights = new RunwayLights();
scene.add(runwayLights.group);
const skyEffects = new SkyEffects();
scene.add(skyEffects.group);
const cloudLayer = new CloudLayer();
scene.add(cloudLayer.group);

// Single flat-mesh runway per airport (rendered separately from the voxel chunks).
const runways = buildRunways();
scene.add(runways);
const buildings = buildAirportBuildings();
scene.add(buildings);
scene.add(buildSimpleTaxiways());
const cargoZones = buildCargoZones();
scene.add(cargoZones);
const landingSiteVisuals = buildLandingSiteMarkers();
scene.add(landingSiteVisuals.group);
// Procedural city around Origin Field — buildings, roads, antennas, powerlines.
// MUST be created AFTER airports/landing sites have been snapped so terrain
// height samples include the city flatten + airport flatten.
const cityBuildings = buildCity();
scene.add(cityBuildings.group);
const cityRoads = buildCityRoads();
scene.add(cityRoads);
const cityInfra = buildCityInfra();
scene.add(cityInfra.group);
// Iconic suspension bridge spanning the carved water gap south of the city.
const iconicBridge = buildIconicBridge();
scene.add(iconicBridge.group);
registerCityHazards(iconicBridge.hazards);
scene.add(buildPoiMarkers());
const surveyWaypoints = new SurveyWaypointMarkers();
scene.add(surveyWaypoints.group);
let lastSurveyMission: import('./missions').Mission | null = null;

const missions = new MissionSystem();
const fleet = loadSave(missions);
// Apply the active fleet plane to the live Plane object — params, fuel cap,
// burn rates, and current fuel state.
function applyActivePlane() {
  const params = fleet.effectiveParams();
  const cap = fleet.effectiveTankGallons();
  const id = fleet.active().id;
  const burn = FUEL_BURN[id];
  plane.swapTo(params, cap, burn.idle, burn.full, fleet.active().fuelGallons);
  // Swap which mesh is visible — every plane has its own silhouette.
  const next = planeVisuals[id as PlaneVisualId];
  if (next !== planeVisual) {
    planeVisual.group.visible = false;
    planeVisual = next;
    planeVisual.group.visible = true;
  }
  planeVisual.setColors(getSkin(fleet.activeSkinId()));
  // Mission system needs to know plane capacity so it caps passenger jobs.
  missions.activePlaneId = id;
  missions.activePlaneSeats = PLANES[id].passengerSeats;
}
applyActivePlane();
let missionMessage = '';
let missionMessageTimer = 0;
let saveAccum = 0;
let lastDeliveriesSaved = missions.totalDeliveries;
window.addEventListener('beforeunload', () => {
  fleet.active().fuelGallons = plane.fuelGallons;
  writeSave(missions, fleet);
});
let hangarOpen = false;
let helpOpen = false;

// Help overlay element — built once, toggled with ? key.
const helpPanel = document.createElement('div');
helpPanel.id = 'helpPanel';
helpPanel.innerHTML =
  `<h3>BLOCK FLIGHT — CONTROLS</h3>` +
  `<h4>Flight</h4>` +
  `<div class="row"><span class="keys"><kbd>W</kbd><kbd>S</kbd></span><span class="desc">Pitch (W=nose down, S=nose up)</span></div>` +
  `<div class="row"><span class="keys"><kbd>A</kbd><kbd>D</kbd></span><span class="desc">Roll (A=left, D=right)</span></div>` +
  `<div class="row"><span class="keys"><kbd>Q</kbd><kbd>E</kbd></span><span class="desc">Rudder (yaw)</span></div>` +
  `<div class="row"><span class="keys"><kbd>Shift</kbd><kbd>Ctrl</kbd></span><span class="desc">Throttle up / down</span></div>` +
  `<div class="row"><span class="keys"><kbd>F</kbd><kbd>V</kbd></span><span class="desc">Flaps stage up / down</span></div>` +
  `<div class="row"><span class="keys"><kbd>PgDn</kbd><kbd>PgUp</kbd></span><span class="desc">Trim down / up (hold for continuous adjustment)</span></div>` +
  `<div class="row"><span class="keys"><kbd>Home</kbd></span><span class="desc">Recenter trim to neutral</span></div>` +
  `<div class="row"><span class="keys"><kbd>B</kbd> or <kbd>Space</kbd></span><span class="desc">Brakes (hold)</span></div>` +
  `<div class="row"><span class="keys"><kbd>M</kbd></span><span class="desc">Toggle mouse stick (pointer-lock)</span></div>` +
  `<h4>Camera & view</h4>` +
  `<div class="row"><span class="keys"><kbd>C</kbd></span><span class="desc">Cycle chase → cockpit → free cam</span></div>` +
  `<div class="row"><span class="keys">free: <kbd>WASD</kbd> <kbd>Q</kbd><kbd>E</kbd></span><span class="desc">Move (Q down, E up). Hold <kbd>Shift</kbd> = faster. Click+drag = look.</span></div>` +
  `<div class="row"><span class="keys"><kbd>R</kbd></span><span class="desc">Reset / respawn at home</span></div>` +
  `<h4>Hangar &amp; missions</h4>` +
  `<div class="row"><span class="keys"><kbd>H</kbd></span><span class="desc">Open hangar (auto-opens mission board)</span></div>` +
  `<div class="row"><span class="keys"><kbd>P</kbd></span><span class="desc">Quick-open mission board only</span></div>` +
  `<div class="row"><span class="keys"><kbd>1</kbd>-<kbd>5</kbd></span><span class="desc">Pick a mission from the board</span></div>` +
  `<div class="row"><span class="keys"><kbd>1</kbd>-<kbd>4</kbd></span><span class="desc">In hangar: select / buy plane</span></div>` +
  `<div class="row"><span class="keys"><kbd>I</kbd> <kbd>O</kbd> <kbd>L</kbd> <kbd>T</kbd></span><span class="desc">In hangar: engine / cruise prop / climb prop / aux tank</span></div>` +
  `<div class="row"><span class="keys"><kbd>;</kbd> <kbd>'</kbd></span><span class="desc">In hangar: vortex generators / alpine tires</span></div>` +
  `<div class="row"><span class="keys">Hold <kbd>U</kbd></span><span class="desc">In hangar: pump fuel (free at home, $5/gal elsewhere)</span></div>` +
  `<div class="row"><span class="keys">Hold <kbd>Y</kbd></span><span class="desc">In hangar: drain fuel</span></div>` +
  `<h4>Navigation</h4>` +
  `<div class="row"><span class="keys"><kbd>G</kbd></span><span class="desc">GPS off / small / big</span></div>` +
  `<div class="row"><span class="keys"><kbd>N</kbd> <kbd>J</kbd></span><span class="desc">Cycle GPS destination</span></div>` +
  `<div class="row"><span class="keys"><kbd>[</kbd> <kbd>]</kbd></span><span class="desc">Zoom GPS (when big)</span></div>` +
  `<h4>Display</h4>` +
  `<div class="row"><span class="keys"><kbd>K</kbd></span><span class="desc">Toggle text HUD (verbose readouts)</span></div>` +
  `<div class="row"><span class="keys"><kbd>I</kbd></span><span class="desc">Toggle flight path indicator (where you'll land if attitude held)</span></div>` +
  `<div class="row"><span class="keys"><kbd>X</kbd></span><span class="desc">Toggle weather panel</span></div>` +
  `<div class="row"><span class="keys"><kbd>Z</kbd> or dbl-click</span><span class="desc">Fullscreen (blocks Ctrl+W / Ctrl+T)</span></div>` +
  `<div class="row"><span class="keys"><kbd>?</kbd> or <kbd>Esc</kbd></span><span class="desc">Close this help</span></div>`;
document.body.appendChild(helpPanel);

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code === 'KeyP') {
    missionMessage = missions.interact(plane);
    missionMessageTimer = 5;
  } else if (e.code === 'KeyZ') {
    // Z toggles fullscreen — in fullscreen, Ctrl+W/T/etc browser shortcuts
    // are blocked at the OS level so they can't interrupt landing.
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
  } else if (e.code === 'KeyK') {
    hudText.classList.toggle('visible');
  } else if (e.code === 'KeyX') {
    document.getElementById('weather')?.classList.toggle('visible');
  } else if (e.code === 'KeyI' && !hangarOpen) {
    // Outside the hangar, toggle the flight path indicator. Inside the
    // hangar, KeyI is the engine upgrade (handled later in this chain).
    setFpiEnabled(!isFpiEnabled());
    missionMessage = isFpiEnabled() ? 'Flight path indicator ON' : 'Flight path indicator OFF';
    missionMessageTimer = 3;
  } else if (e.code === 'Slash') {
    helpOpen = !helpOpen;
    helpPanel.classList.toggle('visible', helpOpen);
  } else if (helpOpen && e.code === 'Escape') {
    helpOpen = false;
    helpPanel.classList.remove('visible');
  } else if (e.code === 'KeyH') {
    const ap = airportAtPlane();
    const speed = Math.hypot(plane.vel.x, plane.vel.z);
    if (hangarOpen) {
      hangarOpen = false;
      if (missions.boardOpen) missions.closeBoard();
    } else if (ap && plane.onGround && speed < 3) {
      hangarOpen = true;
      // Hangar = hub, so the mission board comes up alongside it. Only when
      // not mid-mission (don't replace ASSIGNED/LOADED status).
      const phase = missions.state.phase;
      if ((phase === 'idle' || phase === 'completed' || phase === 'expired') && !missions.boardOpen) {
        missions.openBoard(ap);
      }
    } else {
      missionMessage = 'Stop on an apron to open the hangar.';
      missionMessageTimer = 3;
    }
  } else if (hangarOpen && e.code === 'Escape') {
    hangarOpen = false;
    if (missions.boardOpen) missions.closeBoard();
  } else if (missions.boardOpen && e.code.startsWith('Digit')) {
    const n = parseInt(e.code.slice(5), 10) - 1;
    if (!Number.isNaN(n)) {
      const msg = missions.selectMission(plane, n);
      if (msg) {
        missionMessage = msg;
        missionMessageTimer = 5;
      }
    }
  } else if (missions.boardOpen && e.code === 'Escape') {
    missions.closeBoard();
    missionMessage = 'Mission board closed.';
    missionMessageTimer = 3;
  } else if (hangarOpen && e.code.startsWith('Digit')) {
    const n = parseInt(e.code.slice(5), 10);
    // 1-4: select that plane if owned, otherwise buy it. (Mission board takes
    // 1-5 priority via the earlier branch when it's open.)
    if (n >= 1 && n <= PLANE_ORDER.length) {
      missionMessage = handleHangarPlanePress(n - 1);
      missionMessageTimer = 4;
    }
  } else if (hangarOpen && e.code === 'Comma') {
    missionMessage = cycleSkin(-1);
    missionMessageTimer = 4;
  } else if (hangarOpen && e.code === 'Period') {
    missionMessage = cycleSkin(+1);
    missionMessageTimer = 4;
  } else if (hangarOpen && e.code === 'KeyB') {
    missionMessage = buyDisplayedSkin();
    missionMessageTimer = 4;
  } else if (hangarOpen && (
    e.code === 'KeyI' || e.code === 'KeyO' || e.code === 'KeyL' ||
    e.code === 'KeyT' || e.code === 'Semicolon' || e.code === 'Quote'
  )) {
    const kind: UpgradeKind = e.code === 'KeyI' ? 'engine'
      : e.code === 'KeyO' ? 'prop_cruise'
      : e.code === 'KeyL' ? 'prop_climb'
      : e.code === 'KeyT' ? 'tank'
      : e.code === 'Semicolon' ? 'vortex_gen'
      : 'alpine_tires';
    missionMessage = buyUpgrade(kind);
    missionMessageTimer = 4;
  }
});

// Hangar plane select / buy. Saves fuel state on swap so the previous plane
// isn't refueled when you come back to it.
function handleHangarPlanePress(idx: number): string {
  const id = PLANE_ORDER[idx];
  const spec = PLANES[id];
  const ownedSlot = fleet.owned.findIndex(o => o.id === id);
  if (ownedSlot >= 0) {
    if (ownedSlot === fleet.activeIdx) return `${spec.name} already active.`;
    // Save current plane's fuel state, switch active.
    fleet.active().fuelGallons = plane.fuelGallons;
    fleet.setActive(ownedSlot);
    applyActivePlane();
    return `Switched to ${spec.name}.`;
  }
  // Not owned — buy.
  if (missions.rank() && RANKS.indexOf(missions.rank()) < spec.unlockRankIdx) {
    return `${spec.name} requires rank ${RANKS[spec.unlockRankIdx].name}.`;
  }
  if (missions.cash < spec.cost) {
    return `${spec.name} costs $${spec.cost} — you have $${missions.cash}.`;
  }
  missions.cash -= spec.cost;
  fleet.buyPlane(id);
  // Auto-switch to the new plane (player's intention is clearly to fly it).
  fleet.active().fuelGallons = plane.fuelGallons;
  fleet.setActive(fleet.owned.length - 1);
  applyActivePlane();
  return `Bought ${spec.name} for $${spec.cost}. Now flying it.`;
}

// Cycle through the full skin catalog. The displayed index advances each
// call regardless of which skin is active — so user can cycle past owned and
// preview unowned ones.
let displayedSkinIdx = 0;
function cycleSkin(dir: number): string {
  displayedSkinIdx = (displayedSkinIdx + dir + SKINS.length) % SKINS.length;
  const s = SKINS[displayedSkinIdx];
  if (fleet.ownedSkins.has(s.id)) {
    fleet.applySkin(s.id);
    applyActivePlane();
    return `Applied ${s.name}.`;
  }
  if (planeVisual) planeVisual.setColors(s);
  return `Preview: ${s.name} — press B to buy ($${s.cost}).`;
}
function buyDisplayedSkin(): string {
  const s = SKINS[displayedSkinIdx];
  if (fleet.ownedSkins.has(s.id)) return `${s.name} already owned.`;
  if (missions.cash < s.cost) return `${s.name} costs $${s.cost} — you have $${missions.cash}.`;
  missions.cash -= s.cost;
  fleet.buySkin(s.id);
  fleet.applySkin(s.id);
  applyActivePlane();
  return `Bought ${s.name} for $${s.cost}.`;
}

function buyUpgrade(kind: UpgradeKind): string {
  const spec = UPGRADES.find(u => u.kind === kind);
  if (!spec) return '';
  const cur = fleet.upgradeLevel(kind);
  if (cur >= spec.maxLevel) return `${spec.name} already at max level.`;
  if (kind === 'prop_cruise' && fleet.upgradeLevel('prop_climb') > 0) return 'Climb prop installed — uninstall not supported.';
  if (kind === 'prop_climb' && fleet.upgradeLevel('prop_cruise') > 0) return 'Cruise prop installed — uninstall not supported.';
  const cost = spec.costPerLevel(PLANES[fleet.active().id].cost);
  if (missions.cash < cost) return `${spec.name} costs $${cost} — you have $${missions.cash}.`;
  missions.cash -= cost;
  fleet.buyUpgrade(kind);
  applyActivePlane();
  return `Installed ${spec.name} (level ${cur + 1}). -$${cost}.`;
}

function airportAtPlane() {
  for (const ap of AIRPORTS) {
    const dx = plane.pos.x - ap.cx;
    const dz = plane.pos.z - ap.cz;
    if (Math.abs(dx) < ap.apronWidth / 2 + 30 && Math.abs(dz) < ap.apronLength / 2 + 30) {
      return ap;
    }
  }
  return null;
}

function renderHangar(airportName: string): string {
  const activeSpec = fleet.activeSpec();
  const eff = fleet.effectiveParams();
  const cap = fleet.effectiveTankGallons();
  const fuelPct = Math.round((plane.fuelGallons / cap) * 100);
  const headroom = Math.floor(eff.maxMass - eff.mass - plane.fuelGallons * 2.72);
  const totalMass = plane.totalMass();
  const overMtow = totalMass > eff.maxMass;
  const playerRankIdx = RANKS.indexOf(missions.rank());

  // Stall speed: Vs = sqrt(2*W/(rho*S*clMax)). Two numbers — clean (no flaps)
  // and Vs0 (full flaps). Use total mass with current fuel + cargo so it's
  // the live stall speed for the loaded plane.
  const RHO_SL = 1.225;
  const wN = totalMass * 9.81;
  const clMaxClean = eff.clMax;
  const clMaxFlaps = eff.clMax + eff.flapStages * eff.flapClPerStage;
  const vsCleanMs = Math.sqrt((2 * wN) / (RHO_SL * eff.wingArea * clMaxClean));
  const vsFlapsMs = Math.sqrt((2 * wN) / (RHO_SL * eff.wingArea * clMaxFlaps));
  const vsKt = (vsCleanMs * 1.94384).toFixed(0);
  const vs0Kt = (vsFlapsMs * 1.94384).toFixed(0);

  // Fleet rows: 1-4 entries, owned shown bright, available shown muted with cost.
  const fleetRows = PLANE_ORDER.map((id, i) => {
    const sp = PLANES[id];
    const ownedSlot = fleet.owned.findIndex(o => o.id === id);
    const isActive = ownedSlot === fleet.activeIdx;
    const owned = ownedSlot >= 0;
    const rankOk = playerRankIdx >= sp.unlockRankIdx;
    const baseColor = isActive ? '#ffcb6b' : owned ? '#fafafa' : (rankOk ? '#9fd0ff' : '#666');
    const action = owned
      ? (isActive ? '<span style="color:#7cffb3">ACTIVE</span>' : '<span style="color:#9fd0ff">switch</span>')
      : !rankOk
        ? `<span style="color:#888">requires ${RANKS[sp.unlockRankIdx].name}</span>`
        : `<span style="color:${missions.cash >= sp.cost ? '#7cffb3' : '#ff7060'}">$${sp.cost}</span>`;
    // Empty-mass stall (full-flap) for browsing — quick STOL comparison.
    const wEmpty = sp.params.mass * 9.81;
    const clMaxFull = sp.params.clMax + sp.params.flapStages * sp.params.flapClPerStage;
    const vsRowKt = Math.sqrt((2 * wEmpty) / (1.225 * sp.params.wingArea * clMaxFull)) * 1.94384;
    return (
      `<tr style="color:${baseColor}">` +
      `<td style="padding:2px 8px"><b>${i + 1}</b></td>` +
      `<td style="padding:2px 8px">${sp.name}</td>` +
      `<td style="padding:2px 8px;color:#888;font-size:11px">${sp.params.mass}/${sp.params.maxMass} kg · ${TANK_GALLONS[id]} gal · vMax ${Math.round(sp.params.vMax * 1.94384)} kt · Vs0 ${Math.round(vsRowKt)} kt · ${sp.passengerSeats} pax</td>` +
      `<td style="padding:2px 8px">${action}</td>` +
      `</tr>`
    );
  }).join('');

  // Upgrade rows for the ACTIVE plane.
  const upgradeRows = UPGRADES.map(u => {
    const cur = fleet.upgradeLevel(u.kind);
    const cost = u.costPerLevel(activeSpec.cost);
    const blocked =
      (u.kind === 'prop_cruise' && fleet.upgradeLevel('prop_climb') > 0) ||
      (u.kind === 'prop_climb' && fleet.upgradeLevel('prop_cruise') > 0);
    const key = u.kind === 'engine' ? 'I'
      : u.kind === 'prop_cruise' ? 'O'
      : u.kind === 'prop_climb' ? 'L'
      : u.kind === 'tank' ? 'T'
      : u.kind === 'vortex_gen' ? ';'
      : u.kind === 'alpine_tires' ? "'"
      : '?';
    const status = cur >= u.maxLevel
      ? '<span style="color:#7cffb3">MAX</span>'
      : blocked
      ? '<span style="color:#888">blocked</span>'
      : `<span style="color:${missions.cash >= cost ? '#7cffb3' : '#ff7060'}">$${cost}</span>`;
    return (
      `<tr>` +
      `<td style="padding:2px 8px;color:#ffcb6b"><b>${key}</b></td>` +
      `<td style="padding:2px 8px">${u.name} <span style="color:#666;font-size:11px">${u.description}</span></td>` +
      `<td style="padding:2px 8px;color:#888">Lvl ${cur}/${u.maxLevel}</td>` +
      `<td style="padding:2px 8px">${status}</td>` +
      `</tr>`
    );
  }).join('');

  return (
    `<div style="text-align:center;color:#9fd0ff;font-weight:bold;margin-bottom:10px">` +
    `HANGAR — ${airportName}</div>` +
    `<div style="color:#888;font-size:11px;margin-bottom:6px">FLEET (1-4 to switch / buy)</div>` +
    `<table style="border-collapse:collapse;width:100%;margin-bottom:10px">${fleetRows}</table>` +
    `<div style="color:#888;font-size:11px;margin-bottom:6px">ACTIVE — ${activeSpec.name}</div>` +
    `<table style="border-collapse:collapse;width:100%">` +
    `<tr><td style="color:#888;padding-right:14px">Fuel</td>` +
    `<td>${plane.fuelGallons.toFixed(1)} / ${cap} gal (${fuelPct}%)</td></tr>` +
    `<tr><td style="color:#888">Pump</td>` +
    `<td><span style="color:#7cffb3">Hold U to fill</span> · <span style="color:#ffcb6b">Hold Y to drain</span> ` +
    `<span style="color:#666;font-size:11px">(${FUEL_RATE_GAL_PER_SEC} gal/s, ${airportName === homeField.name ? 'free at home' : `$${FUEL_PRICE_PER_GAL}/gal`})</span></td></tr>` +
    `<tr><td style="color:#888">Total mass</td><td>${overMtow ? `<span style="color:#ff7060">${totalMass.toFixed(0)} kg OVER MTOW</span>` : `${totalMass.toFixed(0)}`} / ${eff.maxMass} MTOW</td></tr>` +
    `<tr><td style="color:#888">Payload available</td><td><span style="color:#7cffb3">${headroom} kg</span></td></tr>` +
    `<tr><td style="color:#888">Thrust</td><td>${Math.round(eff.maxThrust)} N</td></tr>` +
    `<tr><td style="color:#888">vMax</td><td>${Math.round(eff.vMax * 1.94384)} kt</td></tr>` +
    `<tr><td style="color:#888">Stall</td><td>Vs ${vsKt} kt · Vs0 ${vs0Kt} kt <span style="color:#666;font-size:11px">(at current weight)</span></td></tr>` +
    `<tr><td style="color:#888">Seats</td><td>${activeSpec.passengerSeats} pax + 1 pilot</td></tr>` +
    `</table>` +
    (plane.crashed ? `<div style="color:#ff7060;margin-top:6px">WRECKED — press R to respawn at home</div>` : '') +
    `<div style="margin-top:10px;color:#888;font-size:11px">UPGRADES (key to buy)</div>` +
    `<table style="border-collapse:collapse;width:100%">${upgradeRows}</table>` +
    renderSkinSection() +
    `<div style="text-align:center;color:#5aa080;font-size:11px;margin-top:10px">` +
    `1-4 plane · I engine · O cruise prop · L climb prop · T tank · ; vortex gen · ' alpine tires<br>` +
    `,/. skins · B buy skin · Hold U fill · Hold Y drain · Esc/H close</div>`
  );
}

function renderSkinSection(): string {
  const cur = fleet.activeSkinId();
  // Show a strip of color swatches with the active one highlighted.
  const swatches = SKINS.map(s => {
    const isActive = s.id === cur;
    const isOwned = fleet.ownedSkins.has(s.id);
    const border = isActive ? '#7cffb3' : isOwned ? 'rgba(255,255,255,0.25)' : 'rgba(255,80,80,0.5)';
    const hex = '#' + s.primary.toString(16).padStart(6, '0');
    return (
      `<span style="display:inline-block;width:22px;height:22px;background:${hex};` +
      `border:2px solid ${border};margin:2px;vertical-align:middle" title="${s.name}${isOwned ? '' : ` ($${s.cost})`}"></span>`
    );
  }).join('');
  const displayed = SKINS[displayedSkinIdx];
  const status = fleet.ownedSkins.has(displayed.id)
    ? '<span style="color:#7cffb3">owned</span>'
    : `<span style="color:${missions.cash >= displayed.cost ? '#ffcb6b' : '#ff7060'}">$${displayed.cost} — press B to buy</span>`;
  return (
    `<div style="margin-top:10px;color:#888;font-size:11px">SKINS (,/. to cycle, B to buy)</div>` +
    `<div>${swatches}</div>` +
    `<div style="font-size:11px;color:#aaa">Displayed: <span style="color:#fff">${displayed.name}</span> — ${status}</div>`
  );
}

// Hold-to-fuel: while the hangar is open and the player holds U or Y, fill
// or drain the tank at a fixed rate. Filling charges per fractional gallon
// (free at home base). Releasing the key stops immediately.
const FUEL_RATE_GAL_PER_SEC = 12;
const FUEL_PRICE_PER_GAL = 5;
function tickFuelHold(dt: number) {
  if (!hangarOpen) return;
  const ap = airportAtPlane();
  if (!ap || !plane.onGround) return;
  const speed = Math.hypot(plane.vel.x, plane.vel.z);
  if (speed > 3 || plane.crashed) return;

  if (isKeyHeld('KeyU')) {
    const room = plane.fuelMaxGallons - plane.fuelGallons;
    if (room > 0.001) {
      const add = Math.min(FUEL_RATE_GAL_PER_SEC * dt, room);
      const isHome = ap === homeField;
      const cost = isHome ? 0 : add * FUEL_PRICE_PER_GAL;
      if (missions.cash >= cost) {
        missions.cash -= cost;
        plane.fuelGallons += add;
      }
    }
  }
  if (isKeyHeld('KeyY') && plane.fuelGallons > 0.001) {
    plane.fuelGallons = Math.max(0, plane.fuelGallons - FUEL_RATE_GAL_PER_SEC * dt);
  }
}

const missionPanel = document.createElement('div');
missionPanel.id = 'missionPanel';
Object.assign(missionPanel.style, {
  position: 'fixed',
  top: '12px',
  left: '50%',
  transform: 'translateX(-50%)',
  background: 'rgba(20, 22, 28, 0.85)',
  color: '#fafafa',
  padding: '8px 14px',
  fontFamily: 'ui-monospace, Menlo, monospace',
  fontSize: '12px',
  border: '1px solid rgba(255,255,255,0.18)',
  borderRadius: '4px',
  pointerEvents: 'none',
  textAlign: 'center',
  whiteSpace: 'pre',
  minWidth: '320px',
  zIndex: '30',
});
document.body.appendChild(missionPanel);

const boardPanel = document.createElement('div');
boardPanel.id = 'boardPanel';
Object.assign(boardPanel.style, {
  position: 'fixed',
  top: '50%',
  background: 'rgba(14, 20, 28, 0.95)',
  color: '#fafafa',
  padding: '14px 18px',
  fontFamily: 'ui-monospace, Menlo, monospace',
  fontSize: '13px',
  border: '2px solid #ffcb6b',
  borderRadius: '6px',
  pointerEvents: 'none',
  zIndex: '50',
  display: 'none',
  minWidth: '560px',
  maxHeight: '80vh',
  overflow: 'auto',
  lineHeight: '1.55',
});
document.body.appendChild(boardPanel);

const hangarPanel = document.createElement('div');
hangarPanel.id = 'hangarPanel';
Object.assign(hangarPanel.style, {
  position: 'fixed',
  top: '50%',
  background: 'rgba(14, 20, 28, 0.95)',
  color: '#fafafa',
  padding: '16px 22px',
  fontFamily: 'ui-monospace, Menlo, monospace',
  fontSize: '13px',
  border: '2px solid #9fd0ff',
  borderRadius: '6px',
  pointerEvents: 'none',
  zIndex: '50',
  display: 'none',
  minWidth: '480px',
  maxHeight: '80vh',
  overflow: 'auto',
  lineHeight: '1.6',
});
document.body.appendChild(hangarPanel);

// Position the hangar + board side-by-side when both are open; centered when alone.
function positionOverlays() {
  const both = hangarOpen && missions.boardOpen;
  if (both) {
    hangarPanel.style.left = '4%';
    hangarPanel.style.right = '';
    hangarPanel.style.transform = 'translateY(-50%)';
    boardPanel.style.left = '';
    boardPanel.style.right = '4%';
    boardPanel.style.transform = 'translateY(-50%)';
  } else {
    hangarPanel.style.left = '50%';
    hangarPanel.style.right = '';
    hangarPanel.style.transform = 'translate(-50%, -50%)';
    boardPanel.style.left = '50%';
    boardPanel.style.right = '';
    boardPanel.style.transform = 'translate(-50%, -50%)';
  }
}

// Trigger initial chunk requests so the worker pool is busy from the start.
// At r=15 there are 961 chunks total in the bubble — load aggressively so
// most are queued before the player starts flying.
for (let i = 0; i < 160; i++) world.update(plane.pos.x, plane.pos.z, 0, 0, 32);

// Teleport panel — quick way to jump between any airport or landing site.
const teleportPanel = document.createElement('div');
teleportPanel.id = 'teleportPanel';
const teleportSelect = document.createElement('select');
teleportSelect.innerHTML =
  `<option value="">— Teleport to —</option>` +
  `<optgroup label="Airports">` +
  AIRPORTS.map((a, i) => `<option value="ap:${i}">${a.name}</option>`).join('') +
  `</optgroup>` +
  `<optgroup label="Landing sites">` +
  LANDING_SITES.map((s, i) => `<option value="ls:${i}">${s.name}</option>`).join('') +
  `</optgroup>`;
teleportPanel.innerHTML = `<h4>TELEPORT</h4>`;
teleportPanel.appendChild(teleportSelect);
document.body.appendChild(teleportPanel);
teleportSelect.addEventListener('change', () => {
  const v = teleportSelect.value;
  if (!v) return;
  const [kind, idxStr] = v.split(':');
  const idx = parseInt(idxStr, 10);
  if (kind === 'ap') {
    const a = AIRPORTS[idx];
    const sx = a.cx + a.apronWidth / 2 + 14;
    const sz = a.cz;
    const h = heightAt(Math.floor(sx), Math.floor(sz));
    const surfaceY = Math.floor(h / 2) * 2 + 2;
    plane.reset(new THREE.Vector3(sx, spawnY(surfaceY), sz), -Math.PI / 2);
  } else if (kind === 'ls') {
    const s = LANDING_SITES[idx];
    // Use destZoneCenter so tight-water sites (Riverbar) spawn ON the strip
    // instead of in the river east of it.
    const z = destZoneCenter(s);
    const sx = z.x;
    const sz = z.z;
    const h = heightAt(Math.floor(sx), Math.floor(sz));
    const surfaceY = Math.floor(h / 2) * 2 + 2;
    plane.reset(new THREE.Vector3(sx, spawnY(surfaceY), sz), -Math.PI / 2);
  }
  plane.vel.set(0, 0, 0);
  setThrottle(0);
  setFlapStage(0);
  teleportSelect.value = '';
  // Drop focus from the select so subsequent flight keys (W/A/S/D) don't
  // trigger the dropdown's type-ahead and re-teleport to "Wolf Meadow" etc.
  teleportSelect.blur();
});

// Loading overlay — hides the canvas until enough chunks around the player
// are loaded, so the player never sees the holes-in-the-world stage.
const loadingOverlayEl = document.getElementById('loadingOverlay');
const loadingBarEl = document.getElementById('loadingBar') as HTMLDivElement | null;
const REQUIRED_CHUNKS_AT_START = 700;    // ~73 % of the 961-chunk r=15 bubble
let loadingDismissed = false;
function updateLoadingOverlay() {
  if (loadingDismissed || !loadingOverlayEl || !loadingBarEl) return;
  const got = world.loadedCount();
  const pct = Math.min(1, got / REQUIRED_CHUNKS_AT_START);
  loadingBarEl.style.width = `${Math.round(pct * 100)}%`;
  if (got >= REQUIRED_CHUNKS_AT_START) {
    loadingOverlayEl.classList.add('fading');
    loadingDismissed = true;
    setTimeout(() => loadingOverlayEl.remove(), 600);
  }
}

// Reset time-of-day to morning on each game start so the player isn't dropped
// into a dark sunset they didn't pick. The save still persists TOD; we just
// override at boot.
{
  const w = getWeather();
  w.timeOfDay = 0.4;
}

let cameraMode: 'chase' | 'cockpit' | 'free' = 'chase';
// Free-cam state — populated when entering free mode.
const freeCamPos = new THREE.Vector3();
let freeCamYaw = 0;
let freeCamPitch = 0;
let freeCamLooking = false;
let freeCamLastX = 0;
let freeCamLastY = 0;
const FREE_CAM_SPEED = 60;        // m/s normal
const FREE_CAM_FAST = 250;        // m/s with Shift

mountWeatherPanel();
mountGps();
mountCareerPanel();
initSound();

let cockpitYaw = 0;
let cockpitPitch = 0;
let mouseLooking = false;
let mLastX = 0;
let mLastY = 0;
canvas.addEventListener('mousedown', (e) => {
  if (cameraMode === 'cockpit') {
    mouseLooking = true;
    mLastX = e.clientX;
    mLastY = e.clientY;
  } else if (cameraMode === 'free') {
    freeCamLooking = true;
    freeCamLastX = e.clientX;
    freeCamLastY = e.clientY;
  }
});
window.addEventListener('mouseup', () => { freeCamLooking = false; });
window.addEventListener('mousemove', (e) => {
  if (!freeCamLooking) return;
  freeCamYaw -= (e.clientX - freeCamLastX) * 0.005;
  freeCamPitch -= (e.clientY - freeCamLastY) * 0.005;
  freeCamPitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, freeCamPitch));
  freeCamLastX = e.clientX;
  freeCamLastY = e.clientY;
});
// Double-click the canvas to enter fullscreen (browsers require a user gesture).
// Same effect as pressing Z.
canvas.addEventListener('dblclick', () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
});
window.addEventListener('mouseup', () => (mouseLooking = false));
window.addEventListener('mousemove', (e) => {
  if (!mouseLooking) return;
  cockpitYaw -= (e.clientX - mLastX) * 0.005;
  cockpitPitch -= (e.clientY - mLastY) * 0.005;
  cockpitYaw = Math.max(-Math.PI * 0.9, Math.min(Math.PI * 0.9, cockpitYaw));
  cockpitPitch = Math.max(-0.9, Math.min(0.9, cockpitPitch));
  mLastX = e.clientX;
  mLastY = e.clientY;
});

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

const FIXED_DT = 1 / 120;
let physAccum = 0;
let lastT = performance.now();
let frames = 0;
let fpsAccum = 0;
let fps = 0;

const _camOffset = new THREE.Vector3();
const _lookAt = new THREE.Vector3();

let wasOnGround = true;
let wasCrashed = false;

function tick() {
  const now = performance.now();
  const realDt = (now - lastT) / 1000;
  const dt = Math.min(0.05, realDt);
  lastT = now;
  fpsAccum += realDt;
  frames++;
  if (fpsAccum >= 0.5) {
    fps = Math.round(frames / fpsAccum);
    frames = 0;
    fpsAccum = 0;
  }

  if (consumeReset()) {
    spawnAtCargoZone();
  }
  if (consumeCameraToggle()) {
    // Cycle chase → cockpit → free → chase.
    cameraMode = cameraMode === 'chase' ? 'cockpit'
      : cameraMode === 'cockpit' ? 'free'
      : 'chase';
    if (cameraMode === 'chase') {
      cockpitYaw = 0;
      cockpitPitch = 0;
    } else if (cameraMode === 'free') {
      // Snapshot the current camera state as the free-cam starting point.
      freeCamPos.copy(camera.position);
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      freeCamYaw = Math.atan2(dir.x, dir.z);
      freeCamPitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
    }
    camera.fov = cameraMode === 'cockpit' ? 115 : 68;
    camera.updateProjectionMatrix();
  }

  updateInput(dt);
  Object.assign(plane.controls, getControls());
  // In free cam, WASD/QE drive the camera, so they shouldn't also drive the plane.
  if (cameraMode === 'free') {
    plane.controls.pitch = 0;
    plane.controls.roll = 0;
    plane.controls.yaw = 0;
  }

  // weather — recompute wind at the plane's current altitude (boundary-layer
  // gradient + gust noise + terrain turbulence near low rough ground).
  updateWindAt(dt, Math.max(0, plane.altitudeAGL()));
  const weather = getWeather();
  applyWeatherToScene(weather);

  // fixed-timestep physics
  physAccum += dt;
  let steps = 0;
  while (physAccum >= FIXED_DT && steps < 6) {
    plane.step(FIXED_DT, weather.windVector);
    physAccum -= FIXED_DT;
    steps++;
  }

  // sound + financial-consequence triggers
  if (plane.crashed && !wasCrashed) {
    crashSound();
    // Crash repair: 30% of current cash, clamped to a sensible band.
    const repairCost = Math.max(200, Math.min(2500, Math.round(missions.cash * 0.30)));
    missions.cash = Math.max(0, missions.cash - repairCost);
    missions.recordRepair(repairCost);
    missionMessage = `${plane.crashCause}. Crash repair: -$${repairCost}.`;
    missionMessageTimer = 8;
  }
  if (plane.onGround && !wasOnGround && plane.lastImpactSpeed > 1.5) {
    touchdownSound(Math.min(1, plane.lastImpactSpeed / 5));
    // Hard-but-survivable landing: graduated repair cost. Crash threshold is
    // 6.5 m/s; below 3 m/s is "OK".
    const v = plane.lastImpactSpeed;
    if (!plane.crashed && v > 3.0 && v < 6.5) {
      const fee = Math.round(40 + (v - 3) * 90);
      missions.cash = Math.max(0, missions.cash - fee);
      missions.recordRepair(fee);
      missionMessage = `Hard landing (${v.toFixed(1)} m/s) — gear repair: -$${fee}.`;
      missionMessageTimer = 4;
    }
  }
  if (plane.propStrike) {
    const fee = 350;
    missions.cash = Math.max(0, missions.cash - fee);
    missions.recordRepair(fee);
    missionMessage = `Prop strike! New blade tips: -$${fee}.`;
    missionMessageTimer = 5;
  }

  // Career stats — tick per frame.
  if (!plane.crashed && !plane.onGround) missions.careerHours += dt;
  if (!plane.crashed) {
    const ds = Math.hypot(plane.vel.x, plane.vel.z) * dt;     // m
    missions.milesFlown += ds * 0.000621371;                   // m → statute miles
  }

  wasOnGround = plane.onGround;
  wasCrashed = plane.crashed;

  // Per-frame chunk gen budget — high enough to keep the leading edge ahead
  // when flying fast, low enough that main-thread mesh upload stays smooth.
  world.update(plane.pos.x, plane.pos.z, plane.vel.x, plane.vel.z, 14);
  const lodT0 = performance.now();
  nearLod.update(plane.pos.x, plane.pos.z);
  midLod.update(plane.pos.x, plane.pos.z);
  farLod.update(plane.pos.x, plane.pos.z);
  lodAccumMs += performance.now() - lodT0;
  lodSamples++;

  planeVisual.group.position.copy(plane.pos);
  planeVisual.group.quaternion.copy(plane.quat);
  planeVisual.update({
    pitch: plane.controls.pitch,
    roll: plane.controls.roll,
    yaw: plane.controls.yaw,
    throttle: plane.controls.throttle,
    flapStage: plane.controls.flapStage,
    propAdvance: plane.propAdvance,
    gearCompression: plane.gearCompression,
  });

  for (const ws of windsocks) ws.update(weather.windVector);
  landingSiteVisuals.updateWindsocks(weather.windVector);
  cityInfra.update(performance.now() / 1000);
  cityBuildings.update(camera.position);
  // Survey rings: rebuild only when active mission changes.
  const activeMission = (missions.state.phase === 'loaded' || missions.state.phase === 'assigned')
    ? missions.state.mission
    : null;
  const wantSurvey = activeMission && activeMission.type === 'survey' ? activeMission : null;
  if (wantSurvey !== lastSurveyMission) {
    surveyWaypoints.setMission(wantSurvey, (x, z) => heightAt(x, z));
    lastSurveyMission = wantSurvey;
  }
  surveyWaypoints.update(dt, plane);
  const tNow = performance.now() / 1000;
  for (const bc of beacons) bc.update(tNow);
  airportMarkers.update(plane.pos, tNow);
  runwayLights.update(plane.pos);
  // Halos brighten as the sun goes down — full effect by deep dusk.
  const nightFactor = 1 - Math.min(1, Math.max(0, (sun.intensity - 0.05) / 0.5));
  runwayLights.setNightFactor(nightFactor);
  skyEffects.update(sun, camera, sun.intensity);
  cloudLayer.update(camera.position, performance.now() / 1000, weather.windVector.x, weather.windVector.z);

  // camera
  if (cameraMode === 'free') {
    // Free fly the camera, plane keeps cruising on its last controls.
    const speed = (isKeyHeld('ShiftLeft') || isKeyHeld('ShiftRight')) ? FREE_CAM_FAST : FREE_CAM_SPEED;
    const fwd = new THREE.Vector3(
      Math.sin(freeCamYaw) * Math.cos(freeCamPitch),
      Math.sin(freeCamPitch),
      Math.cos(freeCamYaw) * Math.cos(freeCamPitch),
    );
    const right = new THREE.Vector3(Math.cos(freeCamYaw), 0, -Math.sin(freeCamYaw));
    const upV = new THREE.Vector3(0, 1, 0);
    if (isKeyHeld('KeyW')) freeCamPos.addScaledVector(fwd, speed * dt);
    if (isKeyHeld('KeyS')) freeCamPos.addScaledVector(fwd, -speed * dt);
    if (isKeyHeld('KeyD')) freeCamPos.addScaledVector(right, speed * dt);
    if (isKeyHeld('KeyA')) freeCamPos.addScaledVector(right, -speed * dt);
    if (isKeyHeld('KeyE')) freeCamPos.addScaledVector(upV, speed * dt);
    if (isKeyHeld('KeyQ')) freeCamPos.addScaledVector(upV, -speed * dt);
    camera.position.copy(freeCamPos);
    _lookAt.copy(freeCamPos).add(fwd);
    camera.up.set(0, 1, 0);
    camera.lookAt(_lookAt);
    planeVisual.group.visible = true;
    cockpit.group.visible = false;
    hudCanvas.classList.remove('cockpit');
  } else if (cameraMode === 'chase') {
    _camOffset.set(0, 3.5, -12).applyQuaternion(plane.quat);
    camera.position.copy(plane.pos).add(_camOffset);
    _lookAt.set(0, 0, 8).applyQuaternion(plane.quat).add(plane.pos);
    camera.lookAt(_lookAt);
    camera.up.set(0, 1, 0);
    planeVisual.group.visible = true;
    cockpit.group.visible = false;
    hudCanvas.classList.remove('cockpit');
  } else {
    // pilot eye position in body frame
    _camOffset.set(0, 0.85, 0.25).applyQuaternion(plane.quat);
    camera.position.copy(plane.pos).add(_camOffset);
    // forward direction including mouselook offsets, applied in body frame
    const dir = new THREE.Vector3(
      Math.sin(cockpitYaw) * Math.cos(cockpitPitch),
      Math.sin(cockpitPitch),
      Math.cos(cockpitYaw) * Math.cos(cockpitPitch),
    );
    dir.applyQuaternion(plane.quat);
    _lookAt.copy(camera.position).add(dir);
    camera.up.set(0, 1, 0).applyQuaternion(plane.quat);
    camera.lookAt(_lookAt);
    planeVisual.group.visible = true;
    cockpit.group.visible = true;
    hudCanvas.classList.add('cockpit');
    cockpit.update({
      ias: (plane.lastAero?.airspeed ?? 0) * 1.94384,
      altFt: plane.pos.y * 3.28084,
      vsi: plane.vel.y * 196.85,
      hdg: plane.headingDeg(),
      pitch: plane.pitchDeg(),
      roll: plane.rollDeg(),
      throttle: plane.controls.throttle,
      rpm: 600 + plane.controls.throttle * 1800,
    });
  }

  updateSound(plane);

  renderer.render(scene, camera);
  renderHUD(
    { text: hudText, canvas: hudCanvas, crash: crashEl },
    plane,
    fps,
    world.loadedCount(),
    cameraMode,
    weather.windVector,
    dt,
    camera,
  );
  const activeForGps = (missions.state.phase === 'loaded' || missions.state.phase === 'assigned')
    ? missions.state.mission
    : null;
  updateGps(plane, weather.windVector, activeForGps);

  missions.step(dt, plane);
  tickFuelHold(dt);
  // Persist progress on each delivery + on a 30 s tick.
  saveAccum += dt;
  if (missions.totalDeliveries !== lastDeliveriesSaved) {
    fleet.active().fuelGallons = plane.fuelGallons;
    writeSave(missions, fleet);
    lastDeliveriesSaved = missions.totalDeliveries;
    saveAccum = 0;
  } else if (saveAccum > 30) {
    fleet.active().fuelGallons = plane.fuelGallons;
    writeSave(missions, fleet);
    saveAccum = 0;
  }
  if (missionMessageTimer > 0) missionMessageTimer -= dt;
  let missionTxt = '';
  if (missions.state.phase === 'idle') {
    missionTxt = `CASH $${missions.cash}   DELIVERIES ${missions.totalDeliveries}   BEST LANDING ${missions.bestLandingScore}\n` +
                 `Taxi to a yellow zone and press P for a mission.   U at apron to refuel.`;
  } else if (missions.state.phase === 'assigned') {
    const m = missions.state.mission;
    const left = Math.max(0, m.deadlineSec - missions.state.elapsedSec);
    const label = m.type === 'medevac' ? 'MEDEVAC ENROUTE' : 'ASSIGNED';
    missionTxt = `${label}  ${m.cargoName} ${m.cargoKg}kg  pickup at ${m.from.name} → ${m.to.name}  $${m.payout}\n` +
                 `Land at ${m.from.name} and press P to load.   ${formatTime(left)} left`;
  } else if (missions.state.phase === 'loaded') {
    const m = missions.state.mission;
    const left = Math.max(0, m.deadlineSec - missions.state.elapsedSec);
    if (m.type === 'survey') {
      const wpc = m.waypoints?.length ?? 0;
      const idx = m.waypointIdx ?? 0;
      const next = m.waypoints?.[idx];
      let nextLine = 'All points hit — payout coming!';
      if (next) {
        const dx = next.x - plane.pos.x;
        const dz = next.z - plane.pos.z;
        const dKm = Math.hypot(dx, dz) / 1000;
        const brg = (Math.atan2(dx, dz) * 180 / Math.PI + 360) % 360;
        const planeHdg = plane.headingDeg();
        const rel = (((brg - planeHdg) + 540) % 360) - 180;
        const arrow = Math.abs(rel) < 5 ? '↑' : (rel > 0 ? `→${rel.toFixed(0)}°` : `←${(-rel).toFixed(0)}°`);
        const hRaw = heightAt(Math.floor(next.x), Math.floor(next.z));
        const VOX = 2;
        const groundAtWp = Math.floor(hRaw / VOX) * VOX + VOX;
        const aglAtWp = Math.round(plane.pos.y - groundAtWp);
        const aglDelta = aglAtWp - next.targetAglM;
        const altCue = Math.abs(aglDelta) <= next.toleranceM
          ? 'IN BAND ✓'
          : aglDelta > 0 ? `↓ DESCEND ${aglDelta}m` : `↑ CLIMB ${-aglDelta}m`;
        nextLine = `Next #${idx + 1}/${wpc}: ${dKm.toFixed(2)} km  brg ${String(Math.round(brg)).padStart(3, '0')}° ${arrow}\n` +
                   `  Target ${next.targetAglM}m AGL (you ${aglAtWp}m) — ${altCue}.  Ring turns GREEN when in band.`;
      }
      missionTxt = `SURVEY  ${idx}/${wpc} hit  $${m.payout}\n${nextLine}   ${formatTime(left)} left`;
    } else {
      missionTxt = `IN TRANSIT  ${m.cargoName} ${m.cargoKg}kg → ${m.to.name}  $${m.payout}\n` +
                   `Land at ${m.to.name} and taxi to its yellow zone, then press P.   ${formatTime(left)} left`;
    }
  } else if (missions.state.phase === 'completed') {
    missionTxt = `DELIVERED  +$${missions.state.payout}  (landing ${missions.state.landingScore}/100)\n` +
                 `CASH $${missions.cash}.  Press P for the next mission.`;
  } else if (missions.state.phase === 'expired') {
    missionTxt = `EXPIRED  ${missions.state.mission.cargoName} timed out.\n` +
                 `Press P at a zone for a new mission.`;
  }
  if (missionMessage && missionMessageTimer > 0) {
    missionTxt += '\n' + missionMessage;
  }
  missionPanel.textContent = missionTxt;

  // Position hangar/board side-by-side or centered, depending on which are open.
  positionOverlays();

  // Hangar overlay
  if (hangarOpen) {
    const ap = airportAtPlane();
    if (!ap || !plane.onGround) {
      hangarOpen = false;
    } else {
      hangarPanel.style.display = 'block';
      hangarPanel.innerHTML = renderHangar(ap.name);
    }
  } else {
    hangarPanel.style.display = 'none';
  }

  // Mission board overlay (auto-opens with the hangar — see KeyH handler)
  if (missions.boardOpen) {
    boardPanel.style.display = 'block';
    const ap = missions.boardAirport;
    const fuelKg = plane.fuelGallons * 2.72;
    const headroom = plane.params.maxMass - plane.params.mass - fuelKg;
    const rows = missions.availableMissions.map((m, i) => {
      const distKm = Math.hypot(m.to.cx - m.from.cx, m.to.cz - m.from.cz) / 1000;
      const dlMin = Math.floor(m.deadlineSec / 60);
      const dlSec = Math.floor(m.deadlineSec - dlMin * 60);
      const tier = TIERS[m.tier];
      const overweight = m.cargoKg > headroom;
      const wtColor = overweight ? '#ff7060' : '#aaa';
      const wtSuffix = overweight ? ' ✕' : '';
      const tierLabel = m.type === 'medevac'
        ? `<span style="color:#ff5050;font-weight:bold">MEDEVAC</span>`
        : m.type === 'survey'
        ? `<span style="color:#9fd0ff;font-weight:bold">SURVEY</span>`
        : m.type === 'passenger'
        ? `<span style="color:#c4a8ff;font-weight:bold">PAX</span>`
        : `<span style="color:${tier.color};font-size:10px;font-weight:bold">${tier.label}</span>`;
      const route = m.type === 'medevac'
        ? `<span style="color:#ff8a8a">${m.from.name}</span> → <span style="color:#9fd0ff">${m.to.name}</span>`
        : m.type === 'survey'
        ? `${m.waypoints?.length ?? 0} pts ~${m.waypoints?.[0].targetAglM ?? 0}m AGL`
        : `→ ${m.to.name}`;
      return (
        `<tr>` +
        `<td style="color:#ffcb6b;padding-right:10px"><b>${i + 1}</b></td>` +
        `<td style="padding-right:10px">${tierLabel}</td>` +
        `<td style="padding-right:14px">${m.cargoName}</td>` +
        `<td style="padding-right:14px;color:${wtColor}">${m.cargoKg} kg${wtSuffix}</td>` +
        `<td style="padding-right:14px;color:#9fd0ff">${route}</td>` +
        `<td style="padding-right:14px;color:#aaa">${distKm.toFixed(1)} km</td>` +
        `<td style="padding-right:14px">$${m.payout}</td>` +
        `<td style="color:#aaa">${dlMin}:${String(dlSec).padStart(2, '0')}</td>` +
        `</tr>`
      );
    }).join('');
    boardPanel.innerHTML =
      `<div style="text-align:center;color:#ffcb6b;font-weight:bold;margin-bottom:8px">` +
      `MISSION BOARD — ${ap?.name ?? ''}</div>` +
      `<table style="border-collapse:collapse">` +
      `<thead><tr style="color:#888;font-size:11px">` +
      `<th></th><th align="left">TIER</th><th align="left">CARGO</th><th align="left">WT</th>` +
      `<th align="left">DEST</th><th align="left">DIST</th><th align="left">PAY</th>` +
      `<th align="left">TIME</th></tr></thead>` +
      `<tbody>${rows}</tbody>` +
      `</table>` +
      `<div style="text-align:center;color:#5aa080;font-size:11px;margin-top:8px">` +
      `Press 1-${missions.availableMissions.length} to accept · Esc/P to close</div>`;
  } else {
    boardPanel.style.display = 'none';
  }

  updateCareerPanel(missions);
  updateLoadingOverlay();

  if (perfHud.enabled) {
    const info = renderer.info.render;
    const lodAvg = lodSamples > 0 ? lodAccumMs / lodSamples : 0;
    perfHud.update({
      fps,
      calls: info.calls,
      tris: info.triangles,
      chunks: world.loadedCount(),
      queue: world.pendingCount(),
      lodMs: lodAvg,
      frameMs: dt * 1000,
    });
    if (lodSamples >= 30) { lodAccumMs = 0; lodSamples = 0; }
  }

  requestAnimationFrame(tick);
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec - m * 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

requestAnimationFrame(tick);

function applyWeatherToScene(w: ReturnType<typeof getWeather>) {
  const tod = w.timeOfDay;
  // 0=midnight, 0.25=sunrise, 0.5=noon, 0.75=sunset, 1=midnight
  const sunAngle = (tod - 0.25) * Math.PI * 2; // 0 at sunrise, π at sunset
  sun.position.set(
    Math.cos(sunAngle) * 200,
    Math.max(-30, Math.sin(sunAngle) * 200),
    60,
  );
  // sky color: blend night/day/sunrise tints
  const dayBlue = new THREE.Color(0x87ceeb);
  const nightBlue = new THREE.Color(0x0a1226);
  const sunset = new THREE.Color(0xff8a4a);
  let bg = dayBlue.clone();
  if (tod < 0.22 || tod > 0.78) {
    bg = nightBlue.clone();
  } else if (tod < 0.30) {
    const t = (tod - 0.22) / 0.08;
    bg = nightBlue.clone().lerp(sunset, t);
  } else if (tod < 0.36) {
    const t = (tod - 0.30) / 0.06;
    bg = sunset.clone().lerp(dayBlue, t);
  } else if (tod > 0.70) {
    const t = (0.78 - tod) / 0.08;
    bg = nightBlue.clone().lerp(sunset, t);
  } else if (tod > 0.64) {
    const t = (0.70 - tod) / 0.06;
    bg = sunset.clone().lerp(dayBlue, t);
  }
  scene.background = bg;
  if (scene.fog instanceof THREE.Fog) {
    scene.fog.color.copy(bg);
  }
  sun.intensity = Math.max(0.05, Math.sin(sunAngle));
  hemi.intensity = 0.25 + 0.4 * Math.max(0, Math.sin(sunAngle));
}
