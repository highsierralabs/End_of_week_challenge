// The detector: a 1 cm^3 crystal inside a graded-Z lead castle (30 mm walls,
// 40 mm lid), drawn to scale at the origin, plus a beacon so it can be found
// from kilometres away.
import * as THREE from 'three/webgpu';
import { float, mix, positionLocal, uniform, vec3, vec4, smoothstep, abs, sin, time } from 'three/tsl';

export class Detector {
  readonly object = new THREE.Group();
  readonly uBeacon = uniform(1);

  constructor() {
    this.object.name = 'detector';
    const lead = new THREE.MeshStandardNodeMaterial({ color: 0x3a3d44, roughness: 0.55, metalness: 0.35 });
    const leadDark = new THREE.MeshStandardNodeMaterial({ color: 0x2c2f35, roughness: 0.7, metalness: 0.3 });
    // Castle: inner cavity 10 cm, walls 3 cm, lid 4 cm. Built from "bricks".
    const brick = new THREE.BoxGeometry(1, 1, 1);
    const inner = 0.1;
    const wall = 0.03;
    const lid = 0.04;
    const outer = inner + 2 * wall;
    const height = inner + wall;
    const add = (sx: number, sy: number, sz: number, x: number, y: number, z: number, m: THREE.Material): void => {
      const b = new THREE.Mesh(brick, m);
      b.scale.set(sx, sy, sz);
      b.position.set(x, y, z);
      this.object.add(b);
    };
    // floor
    add(outer, wall, outer, 0, wall / 2 + 0.75, 0, leadDark);
    // walls (two courses each, staggered look)
    for (let c = 0; c < 2; c++) {
      const h = inner / 2;
      const y = 0.75 + wall + h * (c + 0.5);
      const m = c % 2 ? lead : leadDark;
      add(outer, h, wall, 0, y, (inner + wall) / 2, m);
      add(outer, h, wall, 0, y, -(inner + wall) / 2, m);
      add(wall, h, inner, (inner + wall) / 2, y, 0, c % 2 ? leadDark : lead);
      add(wall, h, inner, -(inner + wall) / 2, y, 0, c % 2 ? leadDark : lead);
    }
    // lid, slightly overhanging, with the cable notch hinted by a small gap
    add(outer + 0.01, lid, outer + 0.01, 0, 0.75 + height + wall + lid / 2 - wall, 0, lead);
    // The crystal itself (hidden inside; visible in the cut-away when the lid is hidden).
    const crystal = new THREE.Mesh(
      new THREE.BoxGeometry(0.01, 0.01, 0.01),
      new THREE.MeshBasicNodeMaterial({ color: 0x9be7ff }),
    );
    crystal.position.set(0, 0.75 + wall + 0.02, 0);
    this.object.add(crystal);
    // A simple bench under the castle.
    const wood = new THREE.MeshStandardNodeMaterial({ color: 0x4a3a2a, roughness: 0.9 });
    add(0.6, 0.04, 0.45, 0, 0.73, 0, wood);
    for (const [x, z] of [[-0.27, -0.19], [0.27, -0.19], [-0.27, 0.19], [0.27, 0.19]] as const) add(0.04, 0.71, 0.04, x, 0.355, z, wood);
    // Little lamps so the castle reads at night.
    const lamp = new THREE.PointLight(0xffd2a0, 2.5, 6, 2);
    lamp.position.set(0.8, 1.6, 0.6);
    this.object.add(lamp);
    const fill = new THREE.PointLight(0x8fb4ff, 1.2, 6, 2);
    fill.position.set(-0.9, 1.2, -0.7);
    this.object.add(fill);

    // Beacon: a faint vertical shaft and a ground ring, additive, scaled with distance by the caller.
    const shaftMat = new THREE.MeshBasicNodeMaterial();
    shaftMat.transparent = true;
    shaftMat.depthWrite = false;
    shaftMat.blending = THREE.AdditiveBlending;
    const yN = positionLocal.y.add(0.5);
    const edge = float(1).sub(abs(positionLocal.x).mul(2));
    const pulse = sin(time.mul(2)).mul(0.15).add(0.85);
    shaftMat.colorNode = vec4(vec3(0.55, 0.75, 1).mul(mix(float(0.9), float(0), smoothstep(0, 1, yN))).mul(edge).mul(pulse).mul(this.uBeacon).mul(0.22), 1);
    const shaft = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), shaftMat);
    shaft.name = 'beacon';
    shaft.scale.set(4, 400, 1);
    shaft.position.y = 200;
    this.beacon = shaft;
    this.object.add(shaft);
    const ringMat = new THREE.MeshBasicNodeMaterial({ color: 0x8fb4ff, transparent: true, opacity: 0.55, depthWrite: false });
    ringMat.blending = THREE.AdditiveBlending;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 64), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    ring.scale.setScalar(8);
    this.ring = ring;
    this.object.add(ring);
  }

  readonly beacon: THREE.Mesh;
  readonly ring: THREE.Mesh;

  /** Keep the beacon visible at any range: face the camera and scale with distance. */
  update(camera: THREE.Camera): void {
    const d = camera.position.length();
    const s = THREE.MathUtils.clamp(d / 300, 0.02, 60);
    this.beacon.scale.set(1.6 * s, 400 * s, 1);
    this.beacon.position.y = 200 * s;
    this.beacon.rotation.y = Math.atan2(camera.position.x, camera.position.z);
    this.ring.scale.setScalar(THREE.MathUtils.clamp(d / 60, 0.4, 400));
    this.uBeacon.value = THREE.MathUtils.smoothstep(d, 3, 40);
  }
}
