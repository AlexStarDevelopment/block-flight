import * as THREE from 'three';
import type { Mission } from '../missions';
import type { Plane } from '../sim/plane';
import { heightAt } from '../world/terrain';
import { VOXEL_SIZE } from '../world/voxel';

function surfaceTopY(x: number, z: number): number {
  return Math.floor(heightAt(x, z) / VOXEL_SIZE) * VOXEL_SIZE + VOXEL_SIZE;
}

// Survey waypoint visualization. Each waypoint = vertical hoop floating at
// the target AGL above local ground. Current target waypoint pulses; hit
// waypoints turn green and shrink. Unvisited future waypoints are dim.

const RING_RADIUS = 180;      // m — easier to see + matches the new 350m hit tolerance
const RING_TUBE = 10;         // m (thicker tube reads from a distance)

export class SurveyWaypointMarkers {
  group = new THREE.Group();
  private rings: THREE.Mesh[] = [];
  private currentMission: Mission | null = null;
  private pulse = 0;

  // Material per state — created once and reused. Active ring switches
  // between in-band (green) and out-of-band (orange/red) based on the
  // player's current altitude over the waypoint.
  private matInBand: THREE.MeshBasicMaterial;
  private matOutOfBand: THREE.MeshBasicMaterial;
  private matNext: THREE.MeshBasicMaterial;
  private matHit: THREE.MeshBasicMaterial;

  constructor() {
    this.matInBand = new THREE.MeshBasicMaterial({
      color: 0x4ce28b, transparent: true, opacity: 0.95, depthWrite: false,
    });
    this.matOutOfBand = new THREE.MeshBasicMaterial({
      color: 0xff7060, transparent: true, opacity: 0.7, depthWrite: false,
    });
    this.matNext = new THREE.MeshBasicMaterial({
      color: 0x9fd0ff, transparent: true, opacity: 0.45, depthWrite: false,
    });
    this.matHit = new THREE.MeshBasicMaterial({
      color: 0x4ce28b, transparent: true, opacity: 0.35, depthWrite: false,
    });
  }

  // Set the active mission. Pass null to hide all rings.
  setMission(m: Mission | null, groundAt: (x: number, z: number) => number) {
    // Clear previous rings.
    for (const r of this.rings) {
      r.geometry.dispose();
      this.group.remove(r);
    }
    this.rings = [];
    this.currentMission = null;
    if (!m || m.type !== 'survey' || !m.waypoints) return;
    this.currentMission = m;
    for (const wp of m.waypoints) {
      const g = new THREE.TorusGeometry(RING_RADIUS, RING_TUBE, 12, 32);
      const ring = new THREE.Mesh(g, this.matNext);
      ring.rotation.x = Math.PI / 2;          // standing vertical (axis = Y)
      const groundTop = surfaceTopY(Math.floor(wp.x), Math.floor(wp.z));
      void groundAt;       // groundAt arg kept for API compatibility, unused now
      ring.position.set(wp.x, groundTop + wp.targetAglM, wp.z);
      this.group.add(ring);
      this.rings.push(ring);
    }
  }

  update(dt: number, plane?: Plane) {
    if (!this.currentMission || this.currentMission.type !== 'survey' || !this.currentMission.waypoints) return;
    this.pulse += dt;
    const idx = this.currentMission.waypointIdx ?? 0;
    for (let i = 0; i < this.rings.length; i++) {
      const ring = this.rings[i];
      const wp = this.currentMission.waypoints[i];
      if (wp.hit) {
        ring.material = this.matHit;
        ring.scale.setScalar(0.5);
      } else if (i === idx) {
        // Live altitude check: green when in band, red when not.
        let inBand = false;
        if (plane) {
          const groundAtWp = surfaceTopY(Math.floor(wp.x), Math.floor(wp.z));
          const aglAtWp = plane.pos.y - groundAtWp;
          inBand = Math.abs(aglAtWp - wp.targetAglM) <= wp.toleranceM;
        }
        ring.material = inBand ? this.matInBand : this.matOutOfBand;
        const speed = inBand ? 8 : 3;
        const s = 1 + 0.10 * Math.sin(this.pulse * speed);
        ring.scale.setScalar(s);
      } else {
        ring.material = this.matNext;
        ring.scale.setScalar(1);
      }
    }
  }
}
