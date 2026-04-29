import type { Plane } from './sim/plane';

let ctx: AudioContext | null = null;
let engineGain: GainNode | null = null;
let engineOsc: OscillatorNode | null = null;
let engineSub: OscillatorNode | null = null;
let windGain: GainNode | null = null;
let stallGain: GainNode | null = null;
let brakeGain: GainNode | null = null;
let brakeFilter: BiquadFilterNode | null = null;
let initialized = false;

function ensureContext() {
  if (initialized) return;
  initialized = true;
  // Browsers require a user gesture to start audio. We try lazily; if it fails,
  // the first click on the canvas will call ensureContext via the listener.
  try {
    ctx = new AudioContext();
  } catch {
    return;
  }

  const c = ctx;

  // Engine: two saw oscillators slightly detuned through a low-pass
  const eng = c.createGain();
  eng.gain.value = 0;
  eng.connect(c.destination);
  engineGain = eng;

  const eq = c.createBiquadFilter();
  eq.type = 'lowpass';
  eq.frequency.value = 1200;
  eq.Q.value = 0.7;
  eq.connect(eng);

  const o1 = c.createOscillator();
  o1.type = 'sawtooth';
  o1.frequency.value = 70;
  o1.connect(eq);
  o1.start();
  engineOsc = o1;

  const o2 = c.createOscillator();
  o2.type = 'square';
  o2.frequency.value = 35;
  const gSub = c.createGain();
  gSub.gain.value = 0.5;
  o2.connect(gSub).connect(eq);
  o2.start();
  engineSub = o2;

  // Wind: pink noise filtered, gain rises with airspeed
  const buf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.4;
  const src = c.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const wf = c.createBiquadFilter();
  wf.type = 'lowpass';
  wf.frequency.value = 600;
  const wg = c.createGain();
  wg.gain.value = 0;
  src.connect(wf).connect(wg).connect(c.destination);
  src.start();
  windGain = wg;

  // Stall warning: short beep oscillator (gated off by default)
  const sg = c.createGain();
  sg.gain.value = 0;
  sg.connect(c.destination);
  const so = c.createOscillator();
  so.type = 'sine';
  so.frequency.value = 880;
  so.connect(sg);
  so.start();
  stallGain = sg;

  // Brake squeal: bandpass-filtered sawtooth, gated by brake + ground speed.
  const bg = c.createGain();
  bg.gain.value = 0;
  bg.connect(c.destination);
  const bf = c.createBiquadFilter();
  bf.type = 'bandpass';
  bf.frequency.value = 2400;
  bf.Q.value = 6;
  bf.connect(bg);
  const bo = c.createOscillator();
  bo.type = 'sawtooth';
  bo.frequency.value = 220;
  bo.connect(bf);
  bo.start();
  brakeGain = bg;
  brakeFilter = bf;
}

export function initSound() {
  // attempt now; if blocked, attach a one-time listener
  try {
    ensureContext();
    if (ctx && ctx.state === 'suspended') {
      const resume = () => {
        ctx!.resume();
        window.removeEventListener('mousedown', resume);
        window.removeEventListener('keydown', resume);
      };
      window.addEventListener('mousedown', resume);
      window.addEventListener('keydown', resume);
    }
  } catch {
    /* ignore */
  }
}

let stallBeepPhase = 0;
export function updateSound(plane: Plane) {
  if (!ctx) return;
  const a = plane.lastAero;
  const ias = a?.airspeed ?? 0;
  const thr = plane.controls.throttle;

  // engine pitch — idle has a noticeable lower note than cruise.
  const baseHz = 60 + thr * 100 + ias * 0.6;
  if (engineOsc) engineOsc.frequency.setTargetAtTime(baseHz, ctx.currentTime, 0.05);
  if (engineSub) engineSub.frequency.setTargetAtTime(baseHz * 0.5, ctx.currentTime, 0.05);
  if (engineGain)
    engineGain.gain.setTargetAtTime(0.05 + thr * 0.18, ctx.currentTime, 0.1);

  // wind volume
  if (windGain)
    windGain.gain.setTargetAtTime(Math.min(0.3, ias / 80), ctx.currentTime, 0.15);

  // stall beep: gate at 4 Hz when stalled
  const stalled = a?.stalled && ias > 8;
  if (stallGain && ctx) {
    if (stalled) {
      stallBeepPhase += 0.016 * 8;
      const open = (stallBeepPhase % 1) < 0.5 ? 0.13 : 0;
      stallGain.gain.setTargetAtTime(open, ctx.currentTime, 0.005);
    } else {
      stallGain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
    }
  }

  // brake squeal: brake held + rolling. Filter frequency tracks ground speed
  // so the squeal pitches down as the plane slows.
  if (brakeGain && brakeFilter) {
    const groundSpeed = Math.hypot(plane.vel.x, plane.vel.z);
    const squeal = plane.onGround && plane.controls.brake > 0.35 && groundSpeed > 2
      ? Math.min(0.08, plane.controls.brake * 0.11 * (groundSpeed / 12))
      : 0;
    brakeGain.gain.setTargetAtTime(squeal, ctx.currentTime, 0.04);
    brakeFilter.frequency.setTargetAtTime(1500 + groundSpeed * 60, ctx.currentTime, 0.08);
  }
}

export function touchdownSound(intensity: number) {
  if (!ctx) return;
  const c = ctx;
  const o = c.createOscillator();
  o.type = 'square';
  o.frequency.value = 80 + 50 * intensity;
  const g = c.createGain();
  g.gain.value = Math.min(0.4, 0.18 + intensity * 0.4);
  g.gain.setTargetAtTime(0, c.currentTime + 0.01, 0.06);
  o.connect(g).connect(c.destination);
  o.start();
  o.stop(c.currentTime + 0.25);
}

export function crashSound() {
  if (!ctx) return;
  const c = ctx;
  // burst of noise
  const buf = c.createBuffer(1, c.sampleRate * 0.45, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    const env = Math.exp(-i / (data.length * 0.5));
    data[i] = (Math.random() * 2 - 1) * env;
  }
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 800;
  const g = c.createGain();
  g.gain.value = 0.6;
  src.connect(f).connect(g).connect(c.destination);
  src.start();
}
