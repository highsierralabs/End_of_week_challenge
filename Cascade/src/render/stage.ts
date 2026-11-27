// Renderer, scene graph, post-processing and the camera rig.
import * as THREE from 'three/webgpu';
import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createTerrain, type Terrain } from './terrain';
import { createSky } from './sky';
import { ShowerLayer } from './tracks';
import { Detector } from './detector';
import { GROUND_ALT_M } from './frame';
import { altitudeAtDepth } from '../physics/atmosphere';
import { C_M_PER_NS } from '../physics/constants';
import type { ShowerResult } from '../physics/types';

export type CameraPreset = 'overview' | 'follow' | 'side' | 'ground' | 'detector';
export type Quality = 'low' | 'medium' | 'high';

export interface StageOptions {
  container: HTMLElement;
  colors: readonly number[];
  forceWebGL: boolean;
  quality: Quality;
}

interface Flight {
  fromPos: THREE.Vector3; fromTarget: THREE.Vector3;
  toPos: THREE.Vector3; toTarget: THREE.Vector3;
  t: number; dur: number;
}

export class Stage {
  readonly renderer: THREE.WebGPURenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 1, 400000);
  readonly controls: OrbitControls;
  readonly shower: ShowerLayer;
  readonly detector = new Detector();
  terrain: Terrain | null = null;
  backend: 'WebGPU' | 'WebGL2' = 'WebGL2';
  private pipeline: THREE.RenderPipeline | null = null;
  private bloomNode: ReturnType<typeof bloom> | null = null;
  private flight: Flight | null = null;
  private preset: CameraPreset = 'overview';
  private result: ShowerResult | null = null;
  private quality: Quality;
  private readonly container: HTMLElement;
  private lastFrontTarget: THREE.Vector3 | null = null;

  constructor(opts: StageOptions) {
    this.container = opts.container;
    this.quality = opts.quality;
    this.renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL: opts.forceWebGL, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.classList.add('cx-canvas');
    this.container.appendChild(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxDistance = 150000;
    this.controls.minDistance = 0.3;
    this.controls.addEventListener('start', () => { this.flight = null; });
    this.shower = new ShowerLayer(opts.colors);
    this.scene.add(this.shower.object);
    this.scene.add(this.detector.object);
    this.scene.add(createSky());
    this.scene.add(new THREE.HemisphereLight(0x8fa6d8, 0x1a1410, 0.5));
    const moon = new THREE.DirectionalLight(0xc8d4ff, 0.6);
    moon.position.set(-3, 4, 1);
    this.scene.add(moon);
    this.camera.position.set(-6000, 4000, 9000);
    this.controls.target.set(0, 3000, 0);
  }

  async init(): Promise<void> {
    await this.renderer.init();
    const backend = (this.renderer.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend;
    this.backend = backend ? 'WebGPU' : 'WebGL2';
    this.setQuality(this.quality);
    this.resize();
    new ResizeObserver(() => this.resize()).observe(this.container);
    const scenePass = pass(this.scene, this.camera);
    const color = scenePass.getTextureNode('output');
    this.bloomNode = bloom(color, 0.45, 0.3, 0.55);
    this.pipeline = new THREE.RenderPipeline(this.renderer);
    this.pipeline.outputNode = color.add(this.bloomNode);
    try {
      this.terrain = await createTerrain({ url: 'dem/stead_60km.png', metaUrl: 'dem/stead_60km.json', segments: this.quality === 'low' ? 256 : 512 });
      this.scene.add(this.terrain.object);
    } catch (e) {
      console.warn('terrain failed to load', e);
    }
  }

  setQuality(q: Quality): void {
    this.quality = q;
    const cap = q === 'low' ? 1 : q === 'medium' ? 1.5 : 2;
    const dpr = Math.min(window.devicePixelRatio || 1, cap);
    this.renderer.setPixelRatio(dpr);
    this.shower.uDpr.value = dpr;
    this.resize();
  }

  resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  load(r: ShowerResult): void {
    this.result = r;
    const splashes = this.quality === 'low' ? 40_000 : this.quality === 'medium' ? 120_000 : 300_000;
    this.shower.load(r, splashes);
    this.lastFrontTarget = null;
  }

  // ------------------------------------------------------------ camera

  /** Render-frame point on the shower axis at physics altitude z (metres ASL). */
  private axisPoint(zAsl: number): THREE.Vector3 {
    const r = this.result!;
    const [ax, ay, az] = r.stats.axis;
    const s = (zAsl - r.params.groundAltitudeM) / -az;
    const x = r.params.coreX - ax * s;
    const y = r.params.coreY - ay * s;
    return new THREE.Vector3(x, zAsl - GROUND_ALT_M, -y);
  }

  /** Where the plane shower front crosses the axis at time t. */
  private frontPoint(tNs: number): THREE.Vector3 {
    const r = this.result!;
    const [ax, ay, az] = r.stats.axis;
    const back = (r.stats.tCore - tNs) * C_M_PER_NS; // metres before the core
    const x = r.params.coreX - ax * back;
    const y = r.params.coreY - ay * back;
    const z = Math.max(r.params.groundAltitudeM, r.params.groundAltitudeM - az * back);
    return new THREE.Vector3(x, z - GROUND_ALT_M, -y);
  }

  setPreset(p: CameraPreset, animate = true): void {
    this.preset = p;
    const r = this.result;
    let pos: THREE.Vector3;
    let target: THREE.Vector3;
    if (!r) {
      pos = new THREE.Vector3(-6000, 4000, 9000);
      target = new THREE.Vector3(0, 3000, 0);
    } else {
      const cos = -r.stats.axis[2];
      const x1 = Number.isFinite(r.stats.firstInteractionDepth) ? r.stats.firstInteractionDepth : 50;
      const xm = r.stats.gh?.xmax ?? 600;
      const z1 = Math.min(altitudeAtDepth(x1 * cos), 40000);
      const zm = altitudeAtDepth(Math.min(xm, r.stats.groundSlantDepth) * cos);
      const top = this.axisPoint(z1);
      const mid = this.axisPoint((z1 + zm) / 2);
      const core = this.axisPoint(r.params.groundAltitudeM);
      const height = Math.max(2000, z1 - r.params.groundAltitudeM);
      // A horizontal direction perpendicular to the axis.
      const axR = new THREE.Vector3(r.stats.axis[0], r.stats.axis[2], -r.stats.axis[1]);
      let side = new THREE.Vector3().crossVectors(axR, new THREE.Vector3(0, 1, 0));
      if (side.lengthSq() < 1e-6) side = new THREE.Vector3(1, 0, 0.35);
      side.normalize();
      switch (p) {
        case 'side':
          target = mid.clone();
          pos = mid.clone().addScaledVector(side, height * 1.05).add(new THREE.Vector3(0, -height * 0.05, 0));
          break;
        case 'ground':
          target = this.axisPoint(r.params.groundAltitudeM + 900);
          pos = core.clone().addScaledVector(side, 700).addScaledVector(axR, 350).add(new THREE.Vector3(0, 35, 0));
          break;
        case 'detector':
          target = new THREE.Vector3(0, 0.85, 0);
          pos = new THREE.Vector3(0.9, 1.25, 1.1);
          break;
        case 'follow':
          target = this.frontPoint(0);
          pos = target.clone().addScaledVector(side, 3200).add(new THREE.Vector3(0, 600, 0)).addScaledVector(axR, -1800);
          this.lastFrontTarget = target.clone();
          break;
        default:
          // Three-quarter view of the lower shower, the footprint and the valley behind it.
          target = this.axisPoint(r.params.groundAltitudeM + Math.min(3500, height * 0.25));
          pos = target.clone().addScaledVector(side, Math.min(9000, height * 0.55)).add(new THREE.Vector3(0, -Math.min(2000, height * 0.1), 0)).addScaledVector(axR, -Math.min(4000, height * 0.2));
          void top;
      }
    }
    // Portrait screens see a narrower horizontal field: back off so the shower still fits.
    if (this.camera.aspect < 1 && p !== 'detector') {
      pos = target.clone().add(pos.clone().sub(target).multiplyScalar(Math.pow(1 / this.camera.aspect, 0.75)));
    }
    if (pos.y < 2) pos.y = 2;
    this.flyTo(pos, target, animate ? 1.6 : 0);
  }

  getPreset(): CameraPreset {
    return this.preset;
  }

  private flyTo(pos: THREE.Vector3, target: THREE.Vector3, dur: number): void {
    if (dur <= 0) {
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.flight = null;
      return;
    }
    this.flight = {
      fromPos: this.camera.position.clone(), fromTarget: this.controls.target.clone(),
      toPos: pos, toTarget: target, t: 0, dur,
    };
  }

  // ------------------------------------------------------------ frame

  render(dt: number, tNs: number): void {
    if (this.flight) {
      const f = this.flight;
      f.t += dt;
      const k = Math.min(1, f.t / f.dur);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      // Fly in log-distance so long hops do not overshoot the scale.
      this.camera.position.lerpVectors(f.fromPos, f.toPos, e);
      this.controls.target.lerpVectors(f.fromTarget, f.toTarget, e);
      if (k >= 1) this.flight = null;
    } else if (this.preset === 'follow' && this.result) {
      const t = this.frontPoint(tNs);
      if (this.lastFrontTarget) {
        const d = t.clone().sub(this.lastFrontTarget);
        this.camera.position.add(d);
        this.controls.target.add(d);
      }
      this.lastFrontTarget = t;
    }
    this.controls.update();
    // Near plane scales with the distance to what we look at (depth precision).
    const dist = this.camera.position.distanceTo(this.controls.target);
    const above = Math.max(0.05, this.camera.position.y - (this.terrain?.heightAt(this.camera.position.x, -this.camera.position.z) ?? 0));
    this.camera.near = THREE.MathUtils.clamp(Math.min(dist, above) / 200, 0.02, 20);
    this.camera.far = 400000;
    this.camera.updateProjectionMatrix();
    this.detector.update(this.camera);
    this.shower.setTime(tNs);
    if (this.pipeline) this.pipeline.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
