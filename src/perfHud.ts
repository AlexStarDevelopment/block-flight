// Optional perf overlay shown when ?stats=1 in URL.
// Reads renderer.info each frame plus a chunk-queue probe.

import type * as THREE from 'three';

export interface PerfHud {
  enabled: boolean;
  update(stats: {
    fps: number;
    calls: number;
    tris: number;
    chunks: number;
    queue: number;
    lodMs: number;
    frameMs: number;
  }): void;
}

export function mountPerfHud(renderer: THREE.WebGLRenderer): PerfHud {
  const enabled = new URLSearchParams(location.search).get('stats') === '1';
  if (!enabled) return { enabled, update: () => {} };

  const el = document.createElement('div');
  el.id = 'perfhud';
  Object.assign(el.style, {
    position: 'fixed',
    bottom: '12px',
    left: '12px',
    padding: '6px 10px',
    background: 'rgba(0,0,0,0.66)',
    color: '#9fffb3',
    fontFamily: 'ui-monospace, Menlo, monospace',
    fontSize: '12px',
    border: '1px solid rgba(159,255,179,0.4)',
    pointerEvents: 'none',
    whiteSpace: 'pre',
    zIndex: '50',
  });
  document.body.appendChild(el);

  void renderer; // we read info via passed-in stats below

  return {
    enabled,
    update(s) {
      el.textContent =
        `fps   ${s.fps.toString().padStart(3)}\n` +
        `frame ${s.frameMs.toFixed(1).padStart(5)} ms\n` +
        `calls ${s.calls.toString().padStart(4)}\n` +
        `tris  ${formatNum(s.tris)}\n` +
        `chnk  ${s.chunks}  (q ${s.queue})\n` +
        `lod   ${s.lodMs.toFixed(1).padStart(5)} ms`;
    },
  };
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}
