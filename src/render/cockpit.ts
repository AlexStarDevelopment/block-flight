import * as THREE from 'three';

// Cockpit interior overlay attached to the camera.
// Renders dashboard, glareshield, window frame, struts, and instrument panel
// (analog gauges drawn to a Canvas, used as a texture).

export interface CockpitOverlay {
  group: THREE.Group;
  update(s: {
    ias: number;
    altFt: number;
    vsi: number;
    hdg: number;
    pitch: number;
    roll: number;
    throttle: number;
    rpm: number;
  }): void;
}

const PANEL_W = 1280;
const PANEL_H = 320;

export function buildCockpitOverlay(): CockpitOverlay {
  const root = new THREE.Group();

  const matFrame = new THREE.MeshBasicMaterial({ color: 0x141519 });
  const matPanelBase = new THREE.MeshBasicMaterial({ color: 0x1a1c22 });
  const matStrut = new THREE.MeshBasicMaterial({ color: 0xc9a14a });

  // Panel canvas + texture
  const panelCanvas = document.createElement('canvas');
  panelCanvas.width = PANEL_W;
  panelCanvas.height = PANEL_H;
  const panelTex = new THREE.CanvasTexture(panelCanvas);
  panelTex.colorSpace = THREE.SRGBColorSpace;
  const matPanel = new THREE.MeshBasicMaterial({ map: panelTex, transparent: true });

  // The cockpit overlay sits at z = -0.5 in camera local space. With FOV 68°
  // that gives visible ±0.34 vertical, ±0.34*aspect horizontal at that depth.
  const ZP = -0.5;
  const PANEL_HALF_W = 0.55;
  const PANEL_HALF_H = 0.40;

  // Dashboard / instrument panel — pushed lower + slimmer so the forward
  // view above the panel is clearer. Was 0.22 tall at -0.20 → now 0.18 at -0.26.
  const panelMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(PANEL_HALF_W * 2, 0.18),
    matPanel,
  );
  panelMesh.position.set(0, -0.26, ZP);
  panelMesh.renderOrder = 50;
  root.add(panelMesh);

  // Solid base behind/below panel so transparency doesn't bleed
  const panelBase = new THREE.Mesh(
    new THREE.PlaneGeometry(PANEL_HALF_W * 2.2, 0.6),
    matPanelBase,
  );
  panelBase.position.set(0, -0.50, ZP - 0.001);
  panelBase.renderOrder = 49;
  root.add(panelBase);

  // Glareshield — thin lip above the panel.
  const glare = new THREE.Mesh(
    new THREE.BoxGeometry(PANEL_HALF_W * 2.1, 0.020, 0.04),
    matFrame,
  );
  glare.position.set(0, -0.155, ZP);
  glare.renderOrder = 48;
  root.add(glare);

  // Window frame: top (slim), left, right. The center strip between two
  // windshield panes was removed — single-piece bubble feels cleaner and
  // leaves the forward view unobstructed.
  const top = new THREE.Mesh(new THREE.PlaneGeometry(PANEL_HALF_W * 2.4, 0.07), matFrame);
  top.position.set(0, PANEL_HALF_H + 0.06, ZP);
  root.add(top);

  const left = new THREE.Mesh(new THREE.PlaneGeometry(0.10, PANEL_HALF_H * 2.2), matFrame);
  left.position.set(-PANEL_HALF_W - 0.02, 0.05, ZP);
  root.add(left);

  const right = new THREE.Mesh(new THREE.PlaneGeometry(0.10, PANEL_HALF_H * 2.2), matFrame);
  right.position.set(PANEL_HALF_W + 0.02, 0.05, ZP);
  root.add(right);

  // Wing struts — yellow diagonals from windshield corners up & out
  const strutGeo = new THREE.PlaneGeometry(0.028, 1.0);
  const strutL = new THREE.Mesh(strutGeo, matStrut);
  strutL.position.set(-0.55, 0.32, ZP);
  strutL.rotation.z = 0.55;
  root.add(strutL);
  const strutR = new THREE.Mesh(strutGeo, matStrut);
  strutR.position.set(0.55, 0.32, ZP);
  strutR.rotation.z = -0.55;
  root.add(strutR);

  // Yoke / control column
  const yoke = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.035, 0.02),
    matFrame,
  );
  yoke.position.set(0, -0.32, ZP + 0.002);
  root.add(yoke);
  const yokeStem = new THREE.Mesh(
    new THREE.BoxGeometry(0.025, 0.09, 0.02),
    matFrame,
  );
  yokeStem.position.set(0, -0.38, ZP + 0.002);
  root.add(yokeStem);

  return {
    group: root,
    update(s) {
      drawPanel(panelCanvas, s);
      panelTex.needsUpdate = true;
    },
  };
}

function drawPanel(c: HTMLCanvasElement, s: {
  ias: number; altFt: number; vsi: number; hdg: number;
  pitch: number; roll: number; throttle: number; rpm: number;
}) {
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, c.width, c.height);

  // backdrop
  ctx.fillStyle = '#1b1d24';
  ctx.fillRect(0, 0, c.width, c.height);

  // Six gauges spaced across panel
  const gauges = 6;
  const margin = 32;
  const gw = (c.width - margin * 2) / gauges;
  const cy = c.height / 2;
  const r = Math.min(gw, c.height) * 0.4;

  function gaugeAt(i: number, label: string, draw: (cx: number, cy: number, r: number) => void) {
    const cx = margin + gw * (i + 0.5);
    drawGaugeRing(ctx, cx, cy, r, label);
    draw(cx, cy, r);
  }

  gaugeAt(0, 'IAS kt', (cx, cy, r) => drawSpeedometer(ctx, cx, cy, r, s.ias));
  gaugeAt(1, 'ATTITUDE', (cx, cy, r) => drawAttitudeMini(ctx, cx, cy, r, s.pitch, s.roll));
  gaugeAt(2, 'ALT ft', (cx, cy, r) => drawAltimeter(ctx, cx, cy, r, s.altFt));
  gaugeAt(3, 'HDG', (cx, cy, r) => drawHSI(ctx, cx, cy, r, s.hdg));
  gaugeAt(4, 'VSI fpm', (cx, cy, r) => drawVSIGauge(ctx, cx, cy, r, s.vsi));
  gaugeAt(5, 'RPM/PWR', (cx, cy, r) => drawRPM(ctx, cx, cy, r, s.rpm, s.throttle));
}

function drawGaugeRing(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, label: string) {
  ctx.fillStyle = '#0d0e12';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#60656e';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#a8acb6';
  ctx.font = '13px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.fillText(label, cx, cy + r + 18);
}

function drawNeedle(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, angle: number, color = '#ffcb6b') {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, 6);
  ctx.lineTo(0, -r * 0.85);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, 0, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawSpeedometer(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, ias: number) {
  // 0-160 kt, sweep 270°
  ctx.strokeStyle = '#fff';
  ctx.fillStyle = '#fff';
  ctx.font = '11px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let v = 0; v <= 160; v += 20) {
    const a = (v / 160) * Math.PI * 1.5 - Math.PI * 0.75;
    const x1 = cx + Math.sin(a) * r * 0.78;
    const y1 = cy - Math.cos(a) * r * 0.78;
    const x2 = cx + Math.sin(a) * r * 0.92;
    const y2 = cy - Math.cos(a) * r * 0.92;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.fillText(String(v), cx + Math.sin(a) * r * 0.65, cy - Math.cos(a) * r * 0.65);
  }
  // green arc 40-110, yellow 110-130, red 130+
  drawArc(ctx, cx, cy, r * 0.95, arcAngle(40 / 160), arcAngle(110 / 160), '#3fcd5a', 4);
  drawArc(ctx, cx, cy, r * 0.95, arcAngle(110 / 160), arcAngle(130 / 160), '#f3c948', 4);
  drawArc(ctx, cx, cy, r * 0.95, arcAngle(130 / 160), arcAngle(160 / 160), '#e85a4a', 4);
  drawNeedle(ctx, cx, cy, r, (Math.min(160, ias) / 160) * Math.PI * 1.5 - Math.PI * 0.75);
}

function arcAngle(t: number) {
  return t * Math.PI * 1.5 - Math.PI * 0.75 - Math.PI / 2;
}
function drawArc(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, a0: number, a1: number, color: string, w: number) {
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.arc(cx, cy, r, a0, a1);
  ctx.stroke();
}

function drawAltimeter(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, altFt: number) {
  ctx.strokeStyle = '#fff';
  ctx.fillStyle = '#fff';
  ctx.font = '12px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const x1 = cx + Math.sin(a) * r * 0.78;
    const y1 = cy - Math.cos(a) * r * 0.78;
    const x2 = cx + Math.sin(a) * r * 0.92;
    const y2 = cy - Math.cos(a) * r * 0.92;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.fillText(String(i), cx + Math.sin(a) * r * 0.65, cy - Math.cos(a) * r * 0.65);
  }
  // big needle = thousands, small = hundreds
  const thousands = ((altFt % 10000) / 10000) * Math.PI * 2;
  const hundreds = ((altFt % 1000) / 1000) * Math.PI * 2;
  drawNeedle(ctx, cx, cy, r * 0.95, hundreds, '#fff');
  drawNeedle(ctx, cx, cy, r * 0.6, thousands, '#ffcb6b');
  // digital readout
  ctx.fillStyle = '#000';
  ctx.fillRect(cx - 30, cy + r * 0.2, 60, 20);
  ctx.strokeStyle = '#ffcb6b';
  ctx.strokeRect(cx - 30, cy + r * 0.2, 60, 20);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 12px ui-monospace, Menlo, monospace';
  ctx.fillText(String(Math.round(altFt)), cx, cy + r * 0.2 + 10);
}

function drawAttitudeMini(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, pitchDeg: number, rollDeg: number) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.85, 0, Math.PI * 2);
  ctx.clip();
  ctx.translate(cx, cy);
  ctx.rotate(-rollDeg * Math.PI / 180);
  const off = pitchDeg * 1.5;
  ctx.fillStyle = '#5fa8ff';
  ctx.fillRect(-r, -r * 2 + off, r * 2, r * 2);
  ctx.fillStyle = '#7e5a3a';
  ctx.fillRect(-r, off, r * 2, r * 2);
  ctx.strokeStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(-r, off);
  ctx.lineTo(r, off);
  ctx.stroke();
  ctx.restore();
  // wing symbol
  ctx.strokeStyle = '#ffcb6b';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.6, cy);
  ctx.lineTo(cx - 6, cy);
  ctx.moveTo(cx + 6, cy);
  ctx.lineTo(cx + r * 0.6, cy);
  ctx.stroke();
}

function drawHSI(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, hdg: number) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-hdg * Math.PI / 180);
  ctx.strokeStyle = '#fff';
  ctx.fillStyle = '#fff';
  ctx.font = '12px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let h = 0; h < 360; h += 30) {
    const a = h * Math.PI / 180;
    const x1 = Math.sin(a) * r * 0.78;
    const y1 = -Math.cos(a) * r * 0.78;
    const x2 = Math.sin(a) * r * 0.92;
    const y2 = -Math.cos(a) * r * 0.92;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    const label = h === 0 ? 'N' : h === 90 ? 'E' : h === 180 ? 'S' : h === 270 ? 'W' : String(h / 10);
    ctx.fillText(label, Math.sin(a) * r * 0.62, -Math.cos(a) * r * 0.62);
  }
  ctx.restore();
  // top index
  ctx.fillStyle = '#ffcb6b';
  ctx.beginPath();
  ctx.moveTo(cx, cy - r * 0.95);
  ctx.lineTo(cx - 6, cy - r * 0.78);
  ctx.lineTo(cx + 6, cy - r * 0.78);
  ctx.closePath();
  ctx.fill();
}

function drawVSIGauge(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, vsi: number) {
  // ±2000 fpm sweep over 270°
  ctx.strokeStyle = '#fff';
  ctx.fillStyle = '#fff';
  ctx.font = '11px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const labels = [-2000, -1000, 0, 1000, 2000];
  for (const v of labels) {
    const t = (v + 2000) / 4000;
    const a = t * Math.PI * 1.5 - Math.PI * 0.75;
    const x1 = cx + Math.sin(a) * r * 0.78;
    const y1 = cy - Math.cos(a) * r * 0.78;
    const x2 = cx + Math.sin(a) * r * 0.92;
    const y2 = cy - Math.cos(a) * r * 0.92;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.fillText(String(v / 1000), cx + Math.sin(a) * r * 0.62, cy - Math.cos(a) * r * 0.62);
  }
  const t = (Math.max(-2000, Math.min(2000, vsi)) + 2000) / 4000;
  drawNeedle(ctx, cx, cy, r * 0.95, t * Math.PI * 1.5 - Math.PI * 0.75, vsi >= 0 ? '#4ce28b' : '#ff7b6b');
}

function drawRPM(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, rpm: number, throttle: number) {
  ctx.strokeStyle = '#fff';
  ctx.fillStyle = '#fff';
  ctx.font = '11px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let v = 0; v <= 3000; v += 500) {
    const a = (v / 3000) * Math.PI * 1.5 - Math.PI * 0.75;
    const x1 = cx + Math.sin(a) * r * 0.78;
    const y1 = cy - Math.cos(a) * r * 0.78;
    const x2 = cx + Math.sin(a) * r * 0.92;
    const y2 = cy - Math.cos(a) * r * 0.92;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.fillText(String(v / 100), cx + Math.sin(a) * r * 0.62, cy - Math.cos(a) * r * 0.62);
  }
  drawArc(ctx, cx, cy, r * 0.95, arcAngle(2400 / 3000), arcAngle(3000 / 3000), '#e85a4a', 4);
  drawNeedle(ctx, cx, cy, r * 0.95, (Math.min(3000, rpm) / 3000) * Math.PI * 1.5 - Math.PI * 0.75);
  // throttle bar at bottom
  ctx.fillStyle = '#222';
  ctx.fillRect(cx - r * 0.7, cy + r * 0.55, r * 1.4, 8);
  ctx.fillStyle = '#ffcb6b';
  ctx.fillRect(cx - r * 0.7, cy + r * 0.55, r * 1.4 * throttle, 8);
}
