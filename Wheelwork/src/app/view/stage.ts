// The stage: the machine on a desk under museum light. It draws what the model says and nothing
// else; every moving part is posed each frame from the crank's turn count.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { type Affine } from '../../core/mesh/kit';
import { deckZ, DESIGN } from '../../core/machine/design';
import { buildParts, eclipticZ, type MaterialId, type Part, type PartBody } from '../../core/machine/parts';
import { frameOf } from '../../core/machine/pose';
import { type Model } from '../model';
import { toGeometry, type UvMode } from './geometry';
import { Materials } from './materials';

export type ViewName = 'whole' | 'train' | 'exploded' | 'tellurion' | 'above' | 'crank' | 'sky';

interface ViewPreset {
  position: [number, number, number];
  target: [number, number, number];
  caseOpen: number;
  explode: number;
  follow?: boolean;
}

const BALLS: ReadonlySet<MaterialId> = new Set<MaterialId>(['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'moon']);
const EXPLODE_GAP = 9;
const BACKGROUND = new THREE.Color(0x060505);
const BACKGROUND_LAMP = new THREE.Color(0x020202);

const ENV = 1.25;

/**
 * What the brass reflects: a dark room with a few soft lights. Built as a scene (Z up, like the
 * machine) and filtered into an environment map once at start-up.
 */
function studio(): THREE.Scene {
  const s = new THREE.Scene();
  const lit = (color: number, k: number) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide });
  const room = new THREE.Mesh(new THREE.BoxGeometry(60, 60, 30), new THREE.MeshBasicMaterial({ color: 0x4d3d2f, side: THREE.BackSide }));
  room.position.z = 10;
  s.add(room);
  const panel = (w: number, h: number, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    s.add(m);
  };
  panel(16, 11, lit(0xfff0da, 16), 9, -12, 15);     // key softbox, warm, high on the viewer's right
  panel(30, 30, lit(0xfff6ea, 1.2), 0, 0.01, 24);    // a broad ceiling glow
  panel(5, 14, lit(0xcddcff, 5), -18, 7, 6);         // cool strip on the far left
  panel(20, 2.5, lit(0xffe6c4, 9), 2, 20, 8);        // a long warm strip behind
  panel(3, 3, lit(0xffffff, 26), -8, -16, 11);       // a small hard light for sparkle on teeth
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), lit(0x3a2414, 1));
  floor.position.z = -4.9;
  s.add(floor);
  return s;
}

export interface StageOptions {
  /** 'high' adds ambient occlusion and larger shadow maps; 'low' is for phones and slow GPUs. */
  quality: 'high' | 'low';
}

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private composer: EffectComposer | null = null;
  private gtao: GTAOPass | null = null;
  private materials: Materials;
  private bodies = new Map<PartBody, THREE.Group>();
  private meshes = new Map<string, THREE.Mesh>();
  parts: Part[] = [];
  private key: THREE.DirectionalLight;
  private fill: THREE.HemisphereLight;
  private rim: THREE.DirectionalLight;
  private sunLight: THREE.PointLight;
  private highlightCache = new Map<string, THREE.Material>();
  private hoverId: string | null = null;
  private selected = new Set<string>();
  private raycaster = new THREE.Raycaster();

  // Animated state: each has a current value that eases towards its target.
  caseOpen = 0;
  caseTarget = 0;
  explode = 0;
  explodeTarget = 0;
  lamp = 0;
  lampTarget = 0;
  private follow = false;
  private followLast = new THREE.Vector3();
  private tween: { from: THREE.Vector3; to: THREE.Vector3; fromTarget: THREE.Vector3; toTarget: THREE.Vector3; t: number; duration: number } | null = null;
  view: ViewName = 'whole';
  frames = 0;

  constructor(readonly canvas: HTMLCanvasElement, private model: Model, readonly options: StageOptions) {
    const high = options.quality === 'high';
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !high, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, high ? 2 : 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene.background = BACKGROUND.clone();
    this.scene.fog = new THREE.Fog(BACKGROUND.clone(), 1100, 2600);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(studio(), 0.025).texture;
    this.scene.environmentIntensity = ENV;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(30, 1, 20, 6000);
    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 70;
    this.controls.maxDistance = 1700;
    this.controls.maxPolarAngle = Math.PI * 0.497;
    this.controls.zoomSpeed = 0.8;
    // Until the visitor takes hold, the camera drifts slowly round the machine.
    this.controls.autoRotate = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.controls.autoRotateSpeed = -0.5;
    this.controls.addEventListener('start', () => { this.tween = null; this.controls.autoRotate = false; });

    // Key light: warm, high and to one side, with a shadow frustum that just covers the machine.
    this.key = new THREE.DirectionalLight(0xfff0dc, 3.0);
    this.key.position.set(260, -330, 620);
    this.key.target.position.set(0, 0, 60);
    this.key.castShadow = true;
    const sm = high ? 4096 : 2048;
    this.key.shadow.mapSize.set(sm, sm);
    const sc = this.key.shadow.camera;
    sc.left = -280; sc.right = 280; sc.top = 280; sc.bottom = -280; sc.near = 200; sc.far = 1300;
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.6;
    this.key.shadow.radius = 5;
    this.scene.add(this.key, this.key.target);
    this.rim = new THREE.DirectionalLight(0xbfd4ff, 0.7);
    this.rim.position.set(-420, 380, 260);
    this.scene.add(this.rim);
    this.fill = new THREE.HemisphereLight(0xfff4e6, 0x20140c, 0.35);
    this.scene.add(this.fill);
    // The lamp in the Sun, for phases and eclipses.
    this.sunLight = new THREE.PointLight(0xffe2b0, 0, 0, 0);
    this.sunLight.position.set(0, 0, eclipticZ());
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(high ? 2048 : 1024, high ? 2048 : 1024);
    this.sunLight.shadow.camera.near = DESIGN.ballDiameter.sun / 2 + 1;
    this.sunLight.shadow.camera.far = 420;
    this.sunLight.shadow.bias = -0.002;
    this.sunLight.shadow.normalBias = 0.25;
    this.sunLight.visible = false;
    this.scene.add(this.sunLight);

    this.materials = new Materials(high ? 4096 : 2048);
    const desk = new THREE.Mesh(new THREE.CircleGeometry(1500, 96), this.materials.desk);
    desk.position.z = DESIGN.deskZ;
    desk.receiveShadow = true;
    desk.name = 'desk';
    this.scene.add(desk);

    if (high) {
      const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
      this.composer = new EffectComposer(this.renderer, target);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.gtao = new GTAOPass(this.scene, this.camera, size.x, size.y);
      this.gtao.updateGtaoMaterial({ radius: 9, distanceExponent: 1.4, thickness: 2.2, scale: 1.15, samples: 12, distanceFallOff: 1, screenSpaceRadius: false });
      this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, radiusExponent: 1.5, rings: 2, samples: 12 });
      this.gtao.blendIntensity = 0.9;
      this.composer.addPass(this.gtao);
      this.composer.addPass(new OutputPass());
    }

    this.rebuild();
    this.applyPreset(this.preset('whole'), 0);
    this.resize();
  }

  // ---------------------------------------------------------------- parts

  private body(id: PartBody): THREE.Group {
    let g = this.bodies.get(id);
    if (!g) {
      g = new THREE.Group();
      g.name = id;
      g.matrixAutoUpdate = false;
      this.bodies.set(id, g);
      this.scene.add(g);
    }
    return g;
  }

  /** Rebuild every part from the model's layout: called when a tooth count changes. */
  rebuild(): void {
    for (const m of this.meshes.values()) {
      m.geometry.dispose();
      m.parent?.remove(m);
    }
    this.meshes.clear();
    this.parts = buildParts(this.model.layout, { withCase: true });
    for (const part of this.parts) {
      let uv: UvMode = 'none';
      if (part.material === 'deck') uv = 'planar';
      else if (BALLS.has(part.material) && part.id.endsWith('Ball')) uv = 'sphere';
      const geometry = toGeometry(part.mesh, {
        uv,
        extent: DESIGN.plateRadius,
        centre: part.anchor,
        lean: part.id === 'earthBall' ? (DESIGN.obliquity * Math.PI) / 180 : 0,
        crease: part.material === 'walnut' ? 0.5 : 0.62,
      });
      if (uv === 'none' && BALLS.has(part.material)) {
        // A ring or pin in a ball's colour: sample the texture's middle.
        const n = geometry.getAttribute('position').count;
        geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2).fill(0.5), 2));
      }
      const mesh = new THREE.Mesh(geometry, this.materials.get(part.material));
      mesh.name = part.id;
      mesh.castShadow = part.id !== 'sun';
      mesh.receiveShadow = part.id !== 'sun';
      mesh.userData.part = part;
      this.meshes.set(part.id, mesh);
      this.body(part.body).add(mesh);
    }
    this.lastExplode = -1;
    this.applyPhases();
    this.applyHighlights();
  }

  /** Turn each wheel on its body to the phase that meshes: called when the machine is re-set. */
  applyPhases(): void {
    for (const part of this.parts) {
      if (!part.wheel) continue;
      this.meshes.get(part.id)!.rotation.z = this.model.phases.get(part.wheel) ?? 0;
    }
  }

  mesh(id: string): THREE.Mesh | undefined {
    return this.meshes.get(id);
  }

  // ---------------------------------------------------------------- highlight

  private tinted(base: THREE.Material, kind: 'hover' | 'select'): THREE.Material {
    const key = `${base.uuid}:${kind}`;
    let m = this.highlightCache.get(key);
    if (!m) {
      const c = base.clone() as THREE.MeshPhysicalMaterial;
      c.onBeforeCompile = base.onBeforeCompile;
      c.customProgramCacheKey = base.customProgramCacheKey;
      c.emissive = new THREE.Color(kind === 'hover' ? 0xff8a2a : 0x2a9dff);
      c.emissiveIntensity = kind === 'hover' ? 0.32 : 0.3;
      m = c;
      this.highlightCache.set(key, m);
    }
    return m;
  }

  private applyHighlights(): void {
    for (const part of this.parts) {
      const mesh = this.meshes.get(part.id)!;
      const base = this.materials.get(part.material);
      mesh.material = part.id === this.hoverId ? this.tinted(base, 'hover') : this.selected.has(part.id) ? this.tinted(base, 'select') : base;
    }
  }

  setHover(id: string | null): void {
    if (id === this.hoverId) return;
    this.hoverId = id;
    this.applyHighlights();
  }

  setSelected(ids: Iterable<string>): void {
    this.selected = new Set(ids);
    this.applyHighlights();
  }

  /** The part under a point of the canvas (client coordinates), nearest first; the desk is not a part. */
  pick(clientX: number, clientY: number): Part | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects([...this.meshes.values()].filter((m) => m.visible), false);
    for (const h of hits) {
      const part = h.object.userData.part as Part | undefined;
      if (!part) continue;
      // An open case does not get in the way of what is behind it.
      if ((part.body === 'caseNear' || part.body === 'caseFar') && this.caseOpen > 0.5) continue;
      return part;
    }
    return null;
  }

  // ---------------------------------------------------------------- views

  preset(name: ViewName): ViewPreset {
    const top = deckZ().top;
    const ecl = eclipticZ();
    switch (name) {
      case 'whole': return { position: [420, -670, 420], target: [0, 0, top - 48], caseOpen: 0, explode: 0 };
      case 'train': return { position: [500, -210, 200], target: [6, 0, top * 0.5 + 6], caseOpen: 1, explode: 0 };
      case 'exploded': return { position: [560, -760, 420], target: [0, 0, top * 0.5 + 120], caseOpen: 1, explode: 1 };
      case 'tellurion': return { position: [-118, 84, 66], target: [0, 4, ecl - 12], caseOpen: 0, explode: 0, follow: true };
      case 'above': return { position: [0, -8, 840], target: [0, 0, top], caseOpen: 0, explode: 0 };
      case 'crank': return { position: [-560, -330, 250], target: [-40, 0, 62], caseOpen: 0, explode: 0 };
      case 'sky': return { position: [0, -500, 250], target: [0, 0, ecl], caseOpen: 0, explode: 0 };
    }
  }

  private earthPost(): THREE.Vector3 {
    const a = this.model.pose().angle.earth;
    return new THREE.Vector3(DESIGN.armLength.earth * Math.cos(a), DESIGN.armLength.earth * Math.sin(a), 0);
  }

  setView(name: ViewName, seconds = 1.4): void {
    this.view = name;
    this.applyPreset(this.preset(name), seconds);
  }

  private applyPreset(p: ViewPreset, seconds: number): void {
    this.caseTarget = p.caseOpen;
    this.explodeTarget = p.explode;
    this.follow = !!p.follow;
    const to = new THREE.Vector3(...p.position);
    const toTarget = new THREE.Vector3(...p.target);
    if (this.follow) {
      const e = this.earthPost();
      // The preset is given with the earth at the origin, looking along its arm from outside.
      const a = this.model.pose().angle.earth;
      to.applyAxisAngle(new THREE.Vector3(0, 0, 1), a + Math.PI / 2).add(e);
      toTarget.add(e);
      this.followLast.copy(e);
    }
    if (seconds <= 0) {
      this.camera.position.copy(to);
      this.controls.target.copy(toTarget);
      this.caseOpen = this.caseTarget;
      this.explode = this.explodeTarget;
      this.tween = null;
      this.controls.update();
      return;
    }
    this.tween = { from: this.camera.position.clone(), to, fromTarget: this.controls.target.clone(), toTarget, t: 0, duration: seconds };
  }

  // ---------------------------------------------------------------- frame

  resize(): void {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Keep the whole machine in view on a tall screen by widening the field of view.
    this.camera.fov = w / h < 1 ? 30 + (1 - w / h) * 26 : 30;
    // Centre the machine in the part of the window the drawer leaves free.
    const sx = Math.min(this.insetRight, w * 0.6) / 2;
    const sy = Math.min(this.insetBottom, h * 0.6) / 2;
    if (sx > 0 || sy > 0) this.camera.setViewOffset(w, h, sx, sy, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      this.composer.setSize(size.x / this.renderer.getPixelRatio(), size.y / this.renderer.getPixelRatio());
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
    }
  }

  private insetRight = 0;
  private insetBottom = 0;

  /** Pixels of the canvas covered by the drawer on the right, or by the sheet at the bottom. */
  setInset(right: number, bottom: number): void {
    if (right === this.insetRight && bottom === this.insetBottom) return;
    this.insetRight = right;
    this.insetBottom = bottom;
    this.resize();
  }

  private setMatrix(g: THREE.Group, a: Affine, dx = 0, dy = 0): void {
    g.matrix.set(a[0], a[1], a[2], a[3] + dx, a[4], a[5], a[6], a[7] + dy, a[8], a[9], a[10], a[11], 0, 0, 0, 1);
    g.matrixWorldNeedsUpdate = true;
  }

  private ease(current: number, target: number, dt: number, rate = 3.2): number {
    const d = target - current;
    if (Math.abs(d) < 1e-4) return target;
    return current + d * Math.min(1, dt * rate);
  }

  frame(dt: number): void {
    this.caseOpen = this.ease(this.caseOpen, this.caseTarget, dt);
    this.explode = this.ease(this.explode, this.explodeTarget, dt, 2.4);
    this.lamp = this.ease(this.lamp, this.lampTarget, dt, 2.2);

    const pose = this.model.pose();
    // The case halves part across the crank's line.
    const side = DESIGN.crankAngle + Math.PI / 2;
    const slide = 300 * this.caseOpen;
    for (const [id, g] of this.bodies) {
      if (id === 'caseNear') this.setMatrix(g, frameOf(pose, id), -slide * Math.cos(side), -slide * Math.sin(side));
      else if (id === 'caseFar') this.setMatrix(g, frameOf(pose, id), slide * Math.cos(side), slide * Math.sin(side));
      else this.setMatrix(g, frameOf(pose, id));
    }
    if (this.explode !== this.lastExplode) {
      for (const part of this.parts) {
        if (part.body === 'crank' || part.body === 'caseNear' || part.body === 'caseFar') continue;
        this.meshes.get(part.id)!.position.z = this.explode * EXPLODE_GAP * part.layer;
      }
      this.lastExplode = this.explode;
    }

    // Lamp mode: the room goes dark and the Sun lights the planets.
    const k = this.lamp;
    this.scene.environmentIntensity = ENV * (1 - k) + 0.2 * k;
    this.key.intensity = 3.0 * (1 - k);
    this.rim.intensity = 0.7 * (1 - k);
    this.fill.intensity = 0.35 * (1 - k) + 0.06 * k;
    this.key.castShadow = k < 0.98;
    this.sunLight.visible = k > 0.01;
    this.sunLight.intensity = 8 * k;
    this.sunLight.position.z = eclipticZ() + this.explode * EXPLODE_GAP * (this.meshes.get('sun')?.userData.part as Part).layer;
    this.materials.sun.emissiveIntensity = 2.4 * k;
    (this.scene.background as THREE.Color).copy(BACKGROUND).lerp(BACKGROUND_LAMP, k);
    (this.scene.fog as THREE.Fog).color.copy(this.scene.background as THREE.Color);

    if (this.tween) {
      const tw = this.tween;
      tw.t = Math.min(1, tw.t + dt / tw.duration);
      const s = tw.t * tw.t * (3 - 2 * tw.t);
      this.camera.position.lerpVectors(tw.from, tw.to, s);
      this.controls.target.lerpVectors(tw.fromTarget, tw.toTarget, s);
      if (tw.t >= 1) this.tween = null;
    }
    if (this.follow) {
      const e = this.earthPost();
      const d = e.clone().sub(this.followLast);
      this.followLast.copy(e);
      if (this.tween) { this.tween.to.add(d); this.tween.toTarget.add(d); }
      else { this.camera.position.add(d); this.controls.target.add(d); }
    }
    this.controls.update();
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
    this.frames++;
  }

  private lastExplode = -1;

  /** Where a point of the machine falls on the canvas, in CSS pixels, or null when behind the camera. */
  project(x: number, y: number, z: number): { x: number; y: number } | null {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    if (v.z > 1) return null;
    return { x: (v.x * 0.5 + 0.5) * this.canvas.clientWidth, y: (-v.y * 0.5 + 0.5) * this.canvas.clientHeight };
  }
}
