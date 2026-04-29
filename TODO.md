# Block Flight — TODO

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` deferred

---

## A. Aircraft visuals & control feedback

- [x] **A1. Flap deflection visible** — flaps hinge down on F.
- [x] **A2. Control surfaces animate** — elevator, rudder, ailerons follow stick.
- [x] **A3. Prop visualization** — 2-blade silhouette below low throttle, translucent disc above.
- [x] **A4. Gear compression visual** — strut compresses with spring deflection.
- [x] **A5. Pilot silhouette in cockpit** — head + torso visible behind window.

## B. Aircraft physics realism

- [x] **B1. Tail-dragger takeoff sequence** — prop wash gives elevator authority at low speed; tail can lift first.
- [x] **B2. Stall buffet** — random pitch/roll/yaw noise in last 5° before stall.
- [x] **B3. Wing drop on stall** — random one-shot roll torque on stall transition.
- [x] **B4. Power-on stall** — prop wash adds nose-up moment near stall at high power.
- [x] **B5. Density altitude on thrust** — engine power scales with `rho/RHO_SL`.
- [x] **B6. Pitch trim wheel** — `[` / `]` keys, displayed as bar in HUD.
- [x] **B7. P-factor** — left-yaw moment ∝ throttle * (1 - airspeed/30).
- [x] **B8. Spin model** — autorotation gain when stalled with sustained yaw.

## C. Crash physics

- [x] **C1. Crash detection** — non-gear part touching terrain or descent rate > 6.5 m/s.
- [x] **C2. Crashed state** — freeze, red CRASHED overlay with cause + reset hint.
- [!] **C3. Visual damage / debris** — deferred (would need debris physics).

## D. Cockpit view

- [x] **D1. Cockpit panel** — dashboard + glareshield as planes attached to camera.
- [x] **D2. Window frame** — top + side posts + center post.
- [x] **D3. Strut visible from inside** — yellow diagonal struts at windshield corners.
- [x] **D4. Cockpit instruments rendered on the panel** — six analog gauges to canvas texture: ASI, attitude, ALT, HDG, VSI, RPM/throttle.
- [x] **D5. Mouselook in cockpit** — drag mouse to swing view; resets on camera toggle.

## E. HUD upgrades

- [x] **E1. Stall warning** — flashing red banner + audio beep.
- [x] **E2. Artificial horizon** — canvas widget bottom-center with pitch ladder + bank arc.
- [x] **E3. Compass tape** — top-of-screen heading tape with N/E/S/W and major ticks.

## F. Weather

- [x] **F1. Weather selector UI** — sliders for wind dir/speed/gusts + time of day + 3 presets.
- [x] **F2. Wind gusts** — Perlin noise on time perturbs the base wind vector.
- [x] **F3. Time of day** — sun direction + sky/fog tint follow the time slider.

## G. World

- [x] **G1. Block trees** — sparse trees in grass biome (skips airports).
- [x] **G2. More airports** — Origin Field, Birch Lake, Stone Plateau, Valley Grass.
- [!] **G3. Mountain ridges** — deferred (current gentle hills look fine for MVP).
- [!] **G4. Floating origin** — deferred (not biting yet at current view distance).

## H. Performance — view distance

- [x] **H1. Greedy meshing** — replaced per-face mesher; 254 chunks at 25fps.
- [!] **H2. Web Worker chunk gen** — deferred (big lift, no hitches at current radius).
- [x] **H3. LOD heightmap rings** — coarse heightmap mesh out to ~3 km beyond voxel chunks.
- [x] **H4. Bump view radius + far fog** — view radius 7, fog 800–3500.

## I. Sound

- [x] **I1. Engine sound** — looped saw + sub osc, pitch/gain track throttle + airspeed.
- [x] **I2. Wind noise** — pink noise filtered, gain ∝ airspeed.
- [x] **I3. Touchdown thud** — quick square pulse on ground contact, intensity from impact speed.
- [x] **I4. Stall warning beep** — 8 Hz gated sine while stalled.

## J. Polish & code cleanup

- [x] **J1. Hide debug exposure in prod** — `window.debug` only when `import.meta.env.DEV`.
- [!] **J2. Split main.ts** — deferred (still readable at this size).
- [x] **J3. Drop unused deps** — uninstalled `zustand`, `@dimforge/rapier3d-compat`.
- [!] **J4. Constants file** — deferred (constants live near use site, not yet painful).
- [!] **J5. Settings persistence** — deferred (session-only is the spec).
- [!] **J6. Pause / settings menu** — deferred.

---

## Done in this session
A · B · C (minus debris) · D · E · F · G1+G2 · H1+H3+H4 · I · J1+J3.

## Deferred
C3 debris · G3 ridges · G4 floating origin · H2 worker · J2 split · J4 constants · J5 persistence · J6 menu.
