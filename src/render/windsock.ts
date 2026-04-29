import * as THREE from 'three';

export interface Windsock {
  group: THREE.Group;
  update(windWorld: THREE.Vector3): void;
}

const POLE_H = 8;     // m
const SOCK_LEN = 4.2; // m
const SOCK_SEGMENTS = 6;

export function buildWindsock(): Windsock {
  const group = new THREE.Group();

  const matPole = new THREE.MeshLambertMaterial({ color: 0x4a4d57 });
  const matBright = new THREE.MeshLambertMaterial({ color: 0xff7a14 });
  const matStripe = new THREE.MeshLambertMaterial({ color: 0xfafafa });
  const matBase = new THREE.MeshLambertMaterial({ color: 0x808890 });

  // concrete pad
  const pad = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.25, 2.0), matBase);
  pad.position.y = 0.12;
  group.add(pad);

  // pole
  const pole = new THREE.Mesh(new THREE.BoxGeometry(0.22, POLE_H, 0.22), matPole);
  pole.position.y = POLE_H / 2 + 0.25;
  group.add(pole);

  // crossarm with hoop
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.12, 0.12), matPole);
  arm.position.set(0.45, POLE_H + 0.25, 0);
  group.add(arm);
  const hoop = new THREE.Mesh(
    new THREE.TorusGeometry(0.45, 0.05, 8, 16),
    matPole,
  );
  hoop.rotation.y = Math.PI / 2;
  hoop.position.set(0.85, POLE_H + 0.25, 0);
  group.add(hoop);

  // sock pivots about Y at the hoop position
  const sockYaw = new THREE.Group();
  sockYaw.position.set(0.85, POLE_H + 0.25, 0);
  group.add(sockYaw);

  // taper from 0.85 m (mouth) down to 0.18 m (tail).
  const segLen = SOCK_LEN / SOCK_SEGMENTS;
  for (let i = 0; i < SOCK_SEGMENTS; i++) {
    const w = 0.85 - i * (0.65 / SOCK_SEGMENTS);
    const seg = new THREE.Mesh(
      new THREE.BoxGeometry(segLen, w, w),
      i % 2 === 0 ? matBright : matStripe,
    );
    seg.position.x = segLen * 0.5 + i * segLen;
    sockYaw.add(seg);
  }

  return {
    group,
    update(windWorld: THREE.Vector3) {
      const speed = windWorld.length();
      if (speed < 0.05) {
        sockYaw.rotation.y = 0;
        sockYaw.rotation.z = -Math.PI / 2 + 0.05;
        return;
      }
      // wind vector points the way the wind is going.
      // Sock rests along sockYaw's local +X. Rotate sockYaw about Y so
      // local +X aligns with the world wind direction.
      sockYaw.rotation.y = Math.atan2(windWorld.x, windWorld.z) - Math.PI / 2;
      // Lift: full horizontal at ~10 m/s; hangs straight down at 0.
      const droop = Math.max(-0.12, Math.PI / 2 - speed * 0.22);
      sockYaw.rotation.z = -droop;
    },
  };
}
