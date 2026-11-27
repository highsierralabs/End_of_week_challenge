// The editor's state: the scene being edited, the selection, undo history, and the mesh
// assets. Every change goes through here so the view and the panels stay in step.
import { MeshLibrary, parseGlb, parseObj, prepareMesh } from '../core/mesh';
import { type Scene, type SceneObject, cloneScene, reserveIds } from '../core/scene';
import type { Vec3 } from '../core/vec';
import type { View } from './view';

export type Change = 'load' | 'scene' | 'camera' | 'display' | 'select';

export const BUILTIN_MESHES: Record<string, string> = { wineglass: 'Wine glass', tumbler: 'Tumbler', knot: 'Trefoil knot', cat: 'Cat figurine' };
const isBuiltin = (name: string): boolean => Object.hasOwn(BUILTIN_MESHES, name);

export class Meshes {
  readonly lib = new MeshLibrary();
  /** Display names of meshes the visitor dropped in (they cannot travel in a share link). */
  readonly user = new Map<string, string>();
  private uploaded = -1;

  constructor(private readonly view: View) {
    view.meshes = (name) => this.lib.lookup(name);
  }

  private sync(): void {
    if (this.uploaded === this.lib.version) return;
    this.view.tracer.setMeshes(this.lib.nodes, this.lib.tris);
    this.uploaded = this.lib.version;
  }

  /** Load any built-in meshes the scene uses and are not in memory yet. */
  async ensure(scene: Scene): Promise<void> {
    const need = new Set<string>();
    for (const o of scene.objects) if (o.shape.kind === 'mesh' && !this.lib.has(o.shape.mesh) && isBuiltin(o.shape.mesh)) need.add(o.shape.mesh);
    await Promise.all([...need].map(async (name) => {
      const res = await fetch(`./models/${name}.glb`);
      if (!res.ok) throw new Error(`Could not load the ${BUILTIN_MESHES[name]} model (${res.status}).`);
      const mesh = prepareMesh(parseGlb(await res.arrayBuffer()));
      if (!this.lib.has(name)) this.lib.add(name, mesh);
    }));
    this.sync();
  }

  /** Add a dropped .glb or .obj file; returns the asset name to use in a mesh shape. */
  async addFile(file: File): Promise<string> {
    const lower = file.name.toLowerCase();
    const raw = lower.endsWith('.obj') ? parseObj(await file.text()) : parseGlb(await file.arrayBuffer());
    const mesh = prepareMesh(raw);
    let name = `user${this.user.size + 1}`;
    while (this.lib.has(name)) name += 'x';
    this.lib.add(name, mesh);
    this.user.set(name, file.name.replace(/\.[^.]+$/, '').slice(0, 30));
    this.sync();
    return name;
  }

  label(name: string): string { return (isBuiltin(name) ? BUILTIN_MESHES[name] : this.user.get(name)) ?? name; }
  triangles(name: string): number { return this.lib.lookup(name)?.tris ?? 0; }

  /** Ray against a mesh asset in its own space, for picking. */
  hit = (name: string, o: Vec3, d: Vec3): number | null => {
    const m = this.lib.lookup(name);
    return m ? this.lib.hit(m.root, o, d, 1e-9)?.t ?? null : null;
  };
}

/** A studio session set aside while the tour or the spectroscope borrows the view. */
export interface Stash { scene: Scene; undo: string[]; redo: string[]; selected: string | null }

export class Store {
  scene: Scene = undefined as unknown as Scene;
  selectedId: string | null = null;
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private generation = 0;
  private readonly listeners = new Set<(c: Change) => void>();

  constructor(readonly view: View, readonly meshes: Meshes) {}

  on(fn: (c: Change) => void): void { this.listeners.add(fn); }
  private emit(c: Change): void { for (const fn of this.listeners) fn(c); }

  get selected(): SceneObject | null {
    return this.scene?.objects.find((o) => o.id === this.selectedId) ?? null;
  }

  /**
   * Replace the scene (a preset, a shared link, a tour step). Returns false if a later load
   * overtook this one while its models were still arriving.
   */
  async load(scene: Scene, keepHistory = false): Promise<boolean> {
    const mine = ++this.generation;
    await this.meshes.ensure(scene);
    if (mine !== this.generation) return false;
    if (!keepHistory) { this.undoStack = []; this.redoStack = []; }
    this.scene = scene;
    reserveIds(scene);
    this.selectedId = null;
    this.view.setScene(scene);
    this.emit('load');
    return true;
  }

  /** Set the studio's session aside, to bring back with unstash. */
  stash(): Stash { return { scene: this.scene, undo: this.undoStack, redo: this.redoStack, selected: this.selectedId }; }
  async unstash(s: Stash): Promise<void> {
    if (!(await this.load(s.scene))) return;
    this.undoStack = s.undo;
    this.redoStack = s.redo;
    this.selectedId = s.scene.objects.some((o) => o.id === s.selected) ? s.selected : null;
    this.emit('load');
  }

  /** What undo covers: the things in the scene, not the camera or the darkroom. */
  private capture(): string {
    const s = this.scene;
    return JSON.stringify({ objects: s.objects, env: s.env, bounces: s.bounces });
  }

  /** Remember the scene as it is now; call before changing it. */
  snapshot(): void {
    this.undoStack.push(this.capture());
    if (this.undoStack.length > 60) this.undoStack.shift();
    this.redoStack = [];
  }

  /** The scene's objects or light changed. */
  apply(): void {
    this.view.setScene(this.scene);
    this.emit('scene');
  }
  cameraChanged(): void {
    this.view.applyCamera();
    this.emit('camera');
  }
  displayChanged(): void {
    this.view.invalidateDisplay();
    this.emit('display');
  }

  select(id: string | null): void {
    if (id === this.selectedId) return;
    this.selectedId = id;
    this.emit('select');
  }

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }

  private restore(from: string[], to: string[]): void {
    const snap = from.pop();
    if (!snap) return;
    to.push(this.capture());
    const v = JSON.parse(snap) as Pick<Scene, 'objects' | 'env' | 'bounces'>;
    this.scene.objects = v.objects;
    this.scene.env = v.env;
    this.scene.bounces = v.bounces;
    if (!this.scene.objects.some((o) => o.id === this.selectedId)) this.selectedId = null;
    this.view.setScene(this.scene);
    this.emit('load');
  }
  undo(): void { this.restore(this.undoStack, this.redoStack); }
  redo(): void { this.restore(this.redoStack, this.undoStack); }

  /** A deep copy, for share links and exports. */
  copy(): Scene { return cloneScene(this.scene); }
}
