// Small fixed overlay showing pilot rank + career stats. Mounted once at
// startup; update() called each frame with the MissionSystem.

import type { MissionSystem } from './missions';

let panelEl: HTMLElement | null = null;

export function mountCareerPanel() {
  if (panelEl) return;
  panelEl = document.createElement('div');
  panelEl.id = 'careerPanel';
  Object.assign(panelEl.style, {
    position: 'fixed',
    bottom: '12px',
    left: '12px',
    background: 'rgba(12, 18, 24, 0.85)',
    color: '#e8e8ec',
    fontFamily: 'ui-monospace, Menlo, monospace',
    fontSize: '11px',
    border: '1px solid rgba(255,255,255,0.18)',
    borderRadius: '4px',
    padding: '8px 10px',
    pointerEvents: 'none',
    zIndex: '35',
    minWidth: '200px',
    lineHeight: '1.45',
  });
  document.body.appendChild(panelEl);
}

function bar(pct: number, color: string, width = 90): string {
  const fillPx = Math.round(Math.max(0, Math.min(1, pct)) * width);
  return (
    `<span style="display:inline-block;vertical-align:middle;width:${width}px;height:6px;` +
    `background:rgba(255,255,255,0.12);border-radius:2px;overflow:hidden;">` +
    `<span style="display:block;width:${fillPx}px;height:6px;background:${color};"></span>` +
    `</span>`
  );
}

export function updateCareerPanel(missions: MissionSystem) {
  if (!panelEl) return;
  const rank = missions.rank();
  const next = missions.nextRank();
  const hours = Math.floor(missions.careerHours / 3600);
  const mins = Math.floor((missions.careerHours - hours * 3600) / 60);
  const miles = missions.milesFlown.toFixed(1);

  let nextLine = '<span style="color:#7cffb3">Top rank</span>';
  if (next) {
    const cashPct = Math.min(1, missions.careerEarned / next.minEarned);
    const delivPct = Math.min(1, missions.totalDeliveries / next.minDeliveries);
    nextLine =
      `<span style="color:#9fd0ff">Next: ${next.name}</span><br>` +
      `$ ${bar(cashPct, '#7cffb3')} ${missions.careerEarned}/${next.minEarned}<br>` +
      `# ${bar(delivPct, '#ffcb6b')} ${missions.totalDeliveries}/${next.minDeliveries}`;
  }

  panelEl.innerHTML =
    `<div style="font-weight:bold;color:#ffcb6b;font-size:13px;margin-bottom:4px">` +
    `${rank.name}</div>` +
    `<div>Cash <span style="color:#7cffb3">$${missions.cash}</span></div>` +
    `<div>Earned <span style="color:#aaaab2">$${missions.careerEarned}</span> ` +
    `· Repairs <span style="color:#ff9b9b">$${missions.repairsTotal}</span></div>` +
    `<div>Deliveries ${missions.totalDeliveries} · Best Land ${missions.bestLandingScore}</div>` +
    `<div>Hrs ${hours}h ${mins}m · ${miles} mi</div>` +
    `<div style="margin-top:5px;border-top:1px solid rgba(255,255,255,0.1);padding-top:4px">` +
    nextLine + `</div>` +
    `<div style="margin-top:6px;padding-top:4px;border-top:1px solid rgba(255,255,255,0.1);color:#888;font-size:10px">` +
    `<kbd style="color:#ffcb6b">?</kbd> help · <kbd style="color:#ffcb6b">K</kbd> HUD · <kbd style="color:#ffcb6b">X</kbd> weather · <kbd style="color:#ffcb6b">Z</kbd> fullscreen</div>`;
}
