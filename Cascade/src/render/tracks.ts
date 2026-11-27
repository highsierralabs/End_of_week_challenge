// Time-resolved replay of a simulated shower: every track segment is a
// screen-space ribbon whose head advances along the segment as the replay
// clock passes, then fades to a faint persistent trail. Ground arrivals light
// up as small glowing splashes. All TSL, so it runs on WebGPU and WebGL2.
import * as THREE from 'three/webgpu';
import {
  Fn, attribute, uniform, uniformArray, varying, vec2, vec3, vec4, float, int, clamp, mix, max, min, exp, step,
  smoothstep, positionGeometry, modelViewMatrix, cameraProjectionMatrix, screenSize, log, abs,
} from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';
import { GND, GND_STRIDE, RCLASS_COUNT, SEG_STRIDE, type ShowerResult } from '../physics/types';
import { GROUND_ALT_M } from './frame';

export interface TrackStyle {
  /** Ribbon width in CSS pixels. */
  width: number;
  /** e-folding fade of a finished segment, ns. */
  fadeNs: number;
  /** Brightness floor of old trails (0 = vanish). */
  persist: number;
  intensity: number;
}

const quad = (): THREE.InstancedBufferGeometry => {
  const g = new THREE.InstancedBufferGeometry();
  // x = side (-1, 1), y = end (0 = start, 1 = head)
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0], 3));
  g.setIndex([0, 1, 2, 2, 1, 3]);
  return g;
};

export class ShowerLayer {
  readonly object = new THREE.Group();
  readonly uTime = uniform(0);
  readonly uWidth = uniform(1.6);
  readonly uFade = uniform(4000);
  readonly uPersist = uniform(0.07);
  readonly uIntensity = uniform(1);
  readonly uSplash = uniform(1);
  readonly uDpr = uniform(1);
  readonly uDensity = uniform(1);
  /** Per-class brightness (photons are numerous; keep them a soft glow). */
  readonly classGain = uniformArray([0.14, 0.62, 0.62, 0.85, 1.8], 'float');
  private density = 1;
  readonly mask = uniformArray(new Array<number>(RCLASS_COUNT).fill(1), 'float');
  readonly palette: ReturnType<typeof uniformArray>;
  private tracks: THREE.Mesh | null = null;
  private splashes: THREE.Mesh | null = null;
  private trackMat: THREE.MeshBasicNodeMaterial;
  private splashMat: THREE.MeshBasicNodeMaterial;

  constructor(colors: readonly number[]) {
    this.palette = uniformArray(colors.map((c) => new THREE.Color(c)), 'color');
    this.trackMat = this.makeTrackMaterial();
    this.splashMat = this.makeSplashMaterial();
    this.object.name = 'shower';
  }

  setClassVisible(c: number, on: boolean): void {
    (this.mask.array as number[])[c] = on ? 1 : 0;
  }

  setStyle(s: Partial<TrackStyle>): void {
    if (s.width !== undefined) this.uWidth.value = s.width;
    if (s.fadeNs !== undefined) this.uFade.value = s.fadeNs;
    if (s.persist !== undefined) this.uPersist.value = s.persist;
    if (s.intensity !== undefined) this.uIntensity.value = s.intensity;
  }

  setTime(tNs: number): void {
    this.uTime.value = tNs;
  }

  /** Replace the displayed shower. maxSplashes caps the ground layer. */
  load(r: ShowerResult, maxSplashes = 200_000): void {
    this.clear();
    const n = r.segmentCount;
    const s = r.segments;
    const a0 = new Float32Array(n * 4);
    const a1 = new Float32Array(n * 4);
    const am = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const o = i * SEG_STRIDE;
      const k = i * 4;
      a0[k] = s[o]!; a0[k + 1] = s[o + 2]! - GROUND_ALT_M; a0[k + 2] = -s[o + 1]!; a0[k + 3] = s[o + 3]!;
      a1[k] = s[o + 4]!; a1[k + 1] = s[o + 6]! - GROUND_ALT_M; a1[k + 2] = -s[o + 5]!; a1[k + 3] = s[o + 7]!;
      am[k] = s[o + 8]!; am[k + 1] = s[o + 9]!; am[k + 2] = s[o + 10]!; am[k + 3] = 0;
    }
    const g = quad();
    g.setAttribute('aStart', new THREE.InstancedBufferAttribute(a0, 4));
    g.setAttribute('aEnd', new THREE.InstancedBufferAttribute(a1, 4));
    g.setAttribute('aMeta', new THREE.InstancedBufferAttribute(am, 4));
    g.instanceCount = n;
    // Additive blending: keep the summed brightness roughly independent of the track count.
    this.density = Math.min(1, 1.6 / Math.sqrt(Math.max(n, 1) / 10000));
    this.uDensity.value = this.density;
    const mesh = new THREE.Mesh(g, this.trackMat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 10;
    this.tracks = mesh;
    this.object.add(mesh);

    // Ground splashes: a uniform subsample if there are too many.
    const m = r.groundCount;
    const stride = Math.max(1, Math.ceil(m / maxSplashes));
    const count = Math.ceil(m / stride);
    const b0 = new Float32Array(count * 4);
    const b1 = new Float32Array(count * 4);
    let j = 0;
    for (let i = 0; i < m && j < count; i += stride, j++) {
      const o = i * GND_STRIDE;
      const k = j * 4;
      b0[k] = r.ground[o + GND.X]!; b0[k + 1] = 0.3; b0[k + 2] = -r.ground[o + GND.Y]!; b0[k + 3] = r.ground[o + GND.T]!;
      b1[k] = r.ground[o + GND.CLASS]!; b1[k + 1] = r.ground[o + GND.LOGE]!; b1[k + 2] = r.ground[o + GND.W]! * stride; b1[k + 3] = 0;
    }
    const gs = quad();
    gs.setAttribute('aPos', new THREE.InstancedBufferAttribute(b0, 4));
    gs.setAttribute('aInfo', new THREE.InstancedBufferAttribute(b1, 4));
    gs.instanceCount = j;
    const sm = new THREE.Mesh(gs, this.splashMat);
    sm.frustumCulled = false;
    sm.renderOrder = 11;
    this.splashes = sm;
    this.object.add(sm);
  }

  clear(): void {
    for (const o of [this.tracks, this.splashes]) {
      if (!o) continue;
      this.object.remove(o);
      o.geometry.dispose();
    }
    this.tracks = null;
    this.splashes = null;
  }

  private makeTrackMaterial(): THREE.MeshBasicNodeMaterial {
    const mat = new THREE.MeshBasicNodeMaterial();
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = THREE.AdditiveBlending;
    mat.side = THREE.DoubleSide;

    const aStart = attribute('aStart', 'vec4');
    const aEnd = attribute('aEnd', 'vec4');
    const aMeta = attribute('aMeta', 'vec4');
    const t0 = aStart.w;
    const t1 = aEnd.w;
    const dur = max(t1.sub(t0), float(1e-3));
    const f = clamp(this.uTime.sub(t0).div(dur), 0, 1);
    const started = step(t0, this.uTime);
    const cls = int(aMeta.x);
    const visible = started.mul(float(this.mask.element(cls) as unknown as Node<'float'>));
    const age = max(this.uTime.sub(t1), 0);
    const fade = mix(this.uPersist, float(1), exp(age.negate().div(this.uFade)));
    // Live segments (the head is on them) glow hotter: the shower front.
    const live = float(1).sub(step(float(0.9999), f)).mul(started);
    const eFac = clamp(aMeta.y.add(3).mul(0.16).add(0.35), 0.25, 1.6);
    const wFac = clamp(log(aMeta.z.add(1)).mul(0.11).add(0.55), 0.55, 1.8);
    const bright = visible.mul(fade).mul(eFac).mul(wFac).mul(live.mul(1.8).add(1)).mul(this.uIntensity).mul(this.uDensity).mul(float(this.classGain.element(cls) as unknown as Node<'float'>)).mul(0.35);
    const vBright = float(varying(bright, 'vBright') as unknown as Node<'float'>);
    const vColor = vec3(varying(this.palette.element(cls), 'vColor') as unknown as Node<'vec3'>);
    const vSide = varying(positionGeometry.x, 'vSide');
    // Tracks seen end-on pile up at the shower's radiant; fade segments whose whole
    // projected length is only a few pixels.
    const sa = cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(aStart.xyz, 1)));
    const se = cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(aEnd.xyz, 1)));
    const projLen = sa.xy.div(max(sa.w, 1e-3)).sub(se.xy.div(max(se.w, 1e-3))).mul(screenSize).mul(0.5).length();
    const vLen = float(varying(smoothstep(1.5, 14, projLen).mul(0.85).add(0.15), 'vLen') as unknown as Node<'float'>);

    mat.vertexNode = Fn(() => {
      const head = mix(aStart.xyz, aEnd.xyz, f);
      const pa = modelViewMatrix.mul(vec4(aStart.xyz, 1)).toVar();
      const pb = modelViewMatrix.mul(vec4(head, 1)).toVar();
      // Trim against the camera plane (view-space z < 0 is in front).
      const near = float(-0.05);
      const ta = clamp(near.sub(pa.z).div(pb.z.sub(pa.z).add(1e-9)), 0, 1);
      pa.assign(pa.z.greaterThan(near).select(mix(pa, pb, ta), pa));
      const tb = clamp(near.sub(pb.z).div(pa.z.sub(pb.z).add(1e-9)), 0, 1);
      pb.assign(pb.z.greaterThan(near).select(mix(pb, pa, tb), pb));
      const ca = cameraProjectionMatrix.mul(pa);
      const cb = cameraProjectionMatrix.mul(pb);
      const res = screenSize;
      const na = ca.xy.div(ca.w).mul(res);
      const nb = cb.xy.div(cb.w).mul(res);
      const d = nb.sub(na);
      const dl = max(d.length(), float(1e-4));
      const dir = d.div(dl).mul(step(float(1e-3), dl)).add(vec2(float(1).sub(step(float(1e-3), dl)), 0));
      const nrm = vec2(dir.y.negate(), dir.x);
      const isB = positionGeometry.y;
      const clip = mix(ca, cb, isB).toVar();
      const halfW = this.uWidth.mul(this.uDpr).mul(visible).mul(live.mul(0.6).add(1));
      // Extend slightly along the segment so consecutive ribbons join.
      const along = dir.mul(isB.mul(2).sub(1)).mul(halfW).mul(0.5);
      const off = nrm.mul(positionGeometry.x).mul(halfW).add(along).div(res).mul(clip.w);
      // Collapse completely when hidden or both ends are behind the camera.
      const behind = step(near, min(pa.z, pb.z));
      const keep = visible.mul(float(1).sub(behind));
      return vec4(clip.xy.add(off).mul(keep), clip.z, clip.w);
    })();

    const profile = float(1).sub(abs(vSide));
    mat.colorNode = vec4(vColor.mul(vBright).mul(vLen).mul(profile.mul(profile)), 1);
    return mat;
  }

  private makeSplashMaterial(): THREE.MeshBasicNodeMaterial {
    const mat = new THREE.MeshBasicNodeMaterial();
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = THREE.AdditiveBlending;
    mat.side = THREE.DoubleSide;
    const aPos = attribute('aPos', 'vec4');
    const aInfo = attribute('aInfo', 'vec4');
    const cls = int(aInfo.x);
    const dt = this.uTime.sub(aPos.w);
    const landed = step(float(0), dt);
    const visible = landed.mul(float(this.mask.element(cls) as unknown as Node<'float'>)).mul(this.uSplash);
    const flash = exp(max(dt, 0).negate().div(this.uFade.mul(0.35)));
    const wFac = clamp(log(aInfo.z.add(1)).mul(0.18).add(0.4), 0.4, 2.2);
    const bright = visible.mul(mix(this.uPersist.mul(0.8), float(1), flash)).mul(this.uIntensity).mul(0.9);
    const vBright = float(varying(bright, 'vSplashBright') as unknown as Node<'float'>);
    const vColor = vec3(varying(this.palette.element(cls), 'vSplashColor') as unknown as Node<'vec3'>);
    const vUv = varying(positionGeometry.xy.mul(vec2(1, 2)).sub(vec2(0, 1)), 'vSplashUv');
    mat.vertexNode = Fn(() => {
      const center = modelViewMatrix.mul(vec4(aPos.xyz, 1));
      const clip = cameraProjectionMatrix.mul(center).toVar();
      // Screen-space disc: a flash that shrinks to a small persistent dot. Pixels, so it never balloons.
      const px = mix(float(3.5), float(9), flash).mul(wFac).mul(visible).mul(this.uDpr);
      const corner = vec2(positionGeometry.x, positionGeometry.y.mul(2).sub(1));
      const behind = step(float(0), center.z);
      const off = corner.mul(px).div(screenSize).mul(2).mul(clip.w).mul(float(1).sub(behind));
      return vec4(clip.xy.add(off), clip.z, clip.w);    })();
    const r = vUv.length();
    const disc = float(1).sub(smoothstep(0.0, 1.0, r));
    mat.colorNode = vec4(vColor.mul(vBright).mul(disc.mul(disc)), 1);
    return mat;
  }
}
