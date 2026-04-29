// Keyboard input → control axes. Smoothed so taps don't snap stick to extremes.
// Mouse-as-stick mode (toggle with KeyM) holds an analog stick position via
// pointer-lock mouse deltas — does NOT auto-center (real stick stays put).

interface AxisState {
  raw: number;
  smooth: number;
  rate: number;
  centerRate: number;
}

const PITCH: AxisState = { raw: 0, smooth: 0, rate: 3, centerRate: 2 };
const ROLL: AxisState = { raw: 0, smooth: 0, rate: 4, centerRate: 3 };
const YAW: AxisState = { raw: 0, smooth: 0, rate: 3, centerRate: 3 };
let throttle = 0;
let flapStage = 0;
let trim = 0;
let brake = 0;
let cameraToggleRequested = false;
let resetRequested = false;

// Mouse stick state.
let mouseStickActive = false;
let stickX = 0;     // -1..1, roll axis (right positive)
let stickY = 0;     // -1..1, pitch axis (down positive = pull back = nose up)
const MOUSE_STICK_SENS = 360;     // pixels for full deflection

const keys = new Set<string>();

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === 'KeyF') {
    flapStage = Math.min(3, flapStage + 1);
  } else if (e.code === 'KeyV') {
    flapStage = Math.max(0, flapStage - 1);
  } else if (e.code === 'KeyC') {
    cameraToggleRequested = true;
  } else if (e.code === 'KeyR') {
    resetRequested = true;
  } else if (e.code === 'KeyM') {
    toggleMouseStick();
  } else if (e.code === 'Home') {
    // Recenter trim instantly. Useful after a heavy nose-up trim for slow
    // approach when you want to climb out at cruise pitch.
    trim = 0;
  }
  if (
    e.code === 'Space' ||
    e.code.startsWith('Arrow') ||
    e.code === 'PageUp' ||
    e.code === 'PageDown' ||
    e.code === 'Home'
  )
    e.preventDefault();
  // Block any Ctrl/Meta combo that hits a game-relevant key. Browsers won't
  // honour this for OS-reserved combos (Ctrl+W close tab, Ctrl+T new tab,
  // Ctrl+N new window) but it stops the savable ones (Ctrl+S save page,
  // Ctrl+P print, Ctrl+R reload, Ctrl+D bookmark) from disrupting flight.
  if ((e.ctrlKey || e.metaKey) && e.code.startsWith('Key')) {
    e.preventDefault();
  }
});
window.addEventListener('keyup', (e) => {
  keys.delete(e.code);
});

function toggleMouseStick() {
  if (mouseStickActive) {
    mouseStickActive = false;
    stickX = 0;
    stickY = 0;
    if (document.pointerLockElement) document.exitPointerLock();
  } else {
    mouseStickActive = true;
    stickX = 0;
    stickY = 0;
    document.body.requestPointerLock();
  }
}

document.addEventListener('mousemove', (e) => {
  if (!mouseStickActive || !document.pointerLockElement) return;
  // Mouse acts like a stick at the player's hand: move LEFT = bank LEFT.
  stickX = Math.max(-1, Math.min(1, stickX - e.movementX / MOUSE_STICK_SENS));
  stickY = Math.max(-1, Math.min(1, stickY + e.movementY / MOUSE_STICK_SENS));
});

document.addEventListener('pointerlockchange', () => {
  // If the user breaks out of pointer lock (Esc), drop mouse-stick mode so
  // they aren't stuck with a deflected virtual stick they can't see.
  if (mouseStickActive && !document.pointerLockElement) {
    mouseStickActive = false;
    stickX = 0;
    stickY = 0;
  }
});

export function isMouseStickActive(): boolean {
  return mouseStickActive;
}

export function getMouseStick(): { x: number; y: number } {
  return { x: stickX, y: stickY };
}

// Read whether a key is currently held — for hold-to-action mechanics like
// refueling in the hangar.
export function isKeyHeld(code: string): boolean {
  return keys.has(code);
}

export function consumeReset(): boolean {
  const r = resetRequested;
  resetRequested = false;
  return r;
}

export function consumeCameraToggle(): boolean {
  const r = cameraToggleRequested;
  cameraToggleRequested = false;
  return r;
}

function updateAxis(axis: AxisState, target: number, dt: number) {
  axis.raw = target;
  if (target === 0) {
    if (axis.smooth > 0) axis.smooth = Math.max(0, axis.smooth - axis.centerRate * dt);
    else if (axis.smooth < 0) axis.smooth = Math.min(0, axis.smooth + axis.centerRate * dt);
  } else {
    const delta = target - axis.smooth;
    const step = axis.rate * dt;
    axis.smooth += Math.sign(delta) * Math.min(Math.abs(delta), step);
  }
}

export function updateInput(dt: number) {
  // Q = right rudder (yaw nose right), E = left rudder. Swapped from the
  // earlier convention by user preference.
  const yawTarget = (keys.has('KeyQ') ? 1 : 0) + (keys.has('KeyE') ? -1 : 0);
  updateAxis(YAW, yawTarget, dt);

  if (mouseStickActive) {
    // Mouse acts like an analog stick — bypass smoothing, take stick position
    // directly. Pitch/roll keys are ignored while mouse mode is active so the
    // two don't fight each other.
    PITCH.smooth = stickY;
    ROLL.smooth = stickX;
    PITCH.raw = stickY;
    ROLL.raw = stickX;
  } else {
    const pitchTarget = (keys.has('KeyS') ? 1 : 0) + (keys.has('KeyW') ? -1 : 0);
    // D = bank right, A = bank left. Sign matches the mouse-stick convention.
    const rollTarget = (keys.has('KeyA') ? 1 : 0) + (keys.has('KeyD') ? -1 : 0);
    updateAxis(PITCH, pitchTarget, dt);
    updateAxis(ROLL, rollTarget, dt);
  }

  if (keys.has('ShiftLeft') || keys.has('ShiftRight'))
    throttle = Math.min(1, throttle + dt * 0.6);
  if (keys.has('ControlLeft') || keys.has('ControlRight'))
    throttle = Math.max(0, throttle - dt * 0.6);
  if (keys.has('Equal')) throttle = 1;
  if (keys.has('Minus')) throttle = 0;

  // Trim — continuous hold-to-adjust at 0.18/sec (full range in ~5.5s,
  // matching a real Cub's trim wheel). Tap = small fine-tune, hold = sweep.
  const TRIM_RATE = 0.18;
  if (keys.has('PageUp'))   trim = Math.min(1,  trim + TRIM_RATE * dt);
  if (keys.has('PageDown')) trim = Math.max(-1, trim - TRIM_RATE * dt);

  // Brake: B key (held) or Space (held). Smoothed slightly so it isn't binary.
  const braking = keys.has('KeyB') || keys.has('Space');
  if (braking) brake = Math.min(1, brake + dt * 6);
  else brake = Math.max(0, brake - dt * 6);
}

export function setThrottle(t: number) {
  throttle = Math.max(0, Math.min(1, t));
}

export function setFlapStage(s: number) {
  flapStage = Math.max(0, Math.min(3, s));
}

export function setTrim(t: number) {
  trim = Math.max(-1, Math.min(1, t));
}

export function getTrim(): number {
  return trim;
}

export function getControls() {
  return {
    pitch: PITCH.smooth,
    roll: ROLL.smooth,
    yaw: YAW.smooth,
    throttle,
    flapStage,
    trim,
    brake,
  };
}
