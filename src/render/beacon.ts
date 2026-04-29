import * as THREE from 'three';

// A tall checkered pole + flashing beacon ball that marks an airport so it can
// be picked out from a few km away. Built from cheap unlit boxes.

export interface Beacon {
  group: THREE.Group;
  update(t: number): void;
}

export function buildAirportBeacon(): Beacon {
  const g = new THREE.Group();

  const matWhite = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const matRed = new THREE.MeshBasicMaterial({ color: 0xc8202a });
  const matBeacon = new THREE.MeshBasicMaterial({ color: 0xffe066 });

  // checkered pole (alternating red/white blocks) — 22 m tall total
  for (let i = 0; i < 11; i++) {
    const seg = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 2.0, 0.5),
      i % 2 === 0 ? matWhite : matRed,
    );
    seg.position.y = 1 + i * 2;
    g.add(seg);
  }

  // top platform
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.3, 1.4), matWhite);
  top.position.y = 22.2;
  g.add(top);

  // beacon ball
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(0.55, 12, 8),
    matBeacon,
  );
  ball.position.y = 22.9;
  g.add(ball);

  return {
    group: g,
    update(t) {
      // ball pulses red <-> yellow at ~1.5 Hz
      const pulse = (Math.sin(t * 9) + 1) * 0.5;
      const r = 1.0;
      const gC = 0.6 + pulse * 0.35;
      const b = 0.2 + pulse * 0.2;
      (ball.material as THREE.MeshBasicMaterial).color.setRGB(r, gC, b);
    },
  };
}
