// Pointer handling on the picture: orbit, dolly and pan the camera, pick and drag objects,
// double-click to focus. Also draws the selection overlay.
import { boundCentre } from '../core/pack';
import { hitHorizontal, pick } from '../core/pick';
import { boundRadius } from '../core/shapes';
import { type Vec3, add, dot, len, mul, norm, sub } from '../core/vec';
import { type CameraFrame, cameraFrame } from '../gpu/tracer';
import type { Store } from './store';

const PREVIEW_SCALE_IDLE_MS = 220;

export class Interaction {
  /** Render-resolution divisor while something is being dragged. */
  previewScale = 2;
  /** Set false to freeze the scene (tour and spectroscope still allow the camera). */
  editable = true;
  /** Set true to ignore all input (while a picture is being exported). */
  frozen = false;
  /** Set true to hold the camera still (the spectroscope's view is fixed). */
  cameraLocked = false;
  /** Extra drawing on the overlay, in CSS pixels (the spectroscope's wavelength scale). */
  decorate: ((g: CanvasRenderingContext2D, w: number, h: number) => void) | null = null;
  onHint: ((text: string) => void) | null = null;
  private readonly overlay: CanvasRenderingContext2D;
  private idleTimer = 0;
  private pointers = new Map<number, { x: number; y: number }>();
  private mode: 'none' | 'orbit' | 'pan' | 'move' | 'pinch' = 'none';
  private last = { x: 0, y: 0 };
  private downAt = { x: 0, y: 0, t: 0 };
  private moved = false;
  private grab: { id: string; offset: Vec3; height: number } | null = null;
  private pinchDist = 0;
  private lastTap = 0;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly overlayCanvas: HTMLCanvasElement, private readonly store: Store) {
    this.overlay = overlayCanvas.getContext('2d')!;
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointercancel', (e) => this.up(e));
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); if (!this.frozen) this.dolly(Math.exp(e.deltaY * 0.0012)); }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('dblclick', (e) => { if (!this.frozen) this.focusAt(e.offsetX, e.offsetY); });
    store.on(() => this.drawOverlay());
  }

  private frame(): CameraFrame {
    return cameraFrame(this.store.scene.camera, this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight));
  }

  /** World ray through a point of the picture (CSS pixels from the top left). */
  ray(x: number, y: number): { o: Vec3; d: Vec3 } {
    const f = this.frame();
    const k = (2 * f.tanHalf) / this.canvas.clientHeight;
    const u = (x - this.canvas.clientWidth / 2) * k;
    const v = (this.canvas.clientHeight / 2 - y) * k;
    return { o: f.pos, d: norm(add(f.forward, add(mul(f.right, u), mul(f.up, v)))) };
  }

  /** Picture position of a world point, or null if it is behind the camera. */
  project(p: Vec3): { x: number; y: number; z: number } | null {
    const f = this.frame();
    const v = sub(p, f.pos);
    const z = dot(v, f.forward);
    if (z <= 1e-4) return null;
    const k = this.canvas.clientHeight / (2 * f.tanHalf);
    return { x: this.canvas.clientWidth / 2 + (dot(v, f.right) / z) * k, y: this.canvas.clientHeight / 2 - (dot(v, f.up) / z) * k, z };
  }

  /** Drop to a coarse preview while the visitor is dragging; sharpen again when they stop. */
  private busy(): void {
    const t = this.store.view.tracer;
    // Slow GPUs get a coarser preview so that dragging stays fluid.
    if (t.scale === 1) this.previewScale = this.store.view.slow ? 4 : 2;
    if (t.scale !== this.previewScale) t.setScale(this.previewScale);
    clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => { if (this.mode === 'none') t.setScale(1); else this.busy(); }, PREVIEW_SCALE_IDLE_MS);
  }

  private down(e: PointerEvent): void {
    if (this.frozen) return;
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    this.last = { x: e.offsetX, y: e.offsetY };
    this.downAt = { x: e.offsetX, y: e.offsetY, t: performance.now() };
    this.moved = false;
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinchDist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      this.last = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
      this.mode = 'pinch';
      this.grab = null;
      return;
    }
    if (e.button === 2 || e.button === 1 || e.ctrlKey) { this.mode = 'pan'; return; }
    this.mode = 'orbit';
    if (!this.editable) return;
    const r = this.ray(e.offsetX, e.offsetY);
    const hit = pick(this.store.scene, r.o, r.d, this.store.meshes.hit, true);
    if (hit) {
      // Drag on the horizontal plane through the point that was grabbed.
      this.grab = { id: hit.object.id, offset: sub(hit.object.pos, hit.point), height: hit.point[1] };
      this.mode = 'move';
    }
  }

  private move(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    p.x = e.offsetX;
    p.y = e.offsetY;
    if (this.mode === 'pinch' && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      const mid = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
      if (this.pinchDist > 0 && d > 0) this.dolly(this.pinchDist / d);
      this.pan(mid.x - this.last.x, mid.y - this.last.y);
      this.pinchDist = d;
      this.last = mid;
      return;
    }
    const dx = e.offsetX - this.last.x;
    const dy = e.offsetY - this.last.y;
    if (!this.moved && Math.hypot(e.offsetX - this.downAt.x, e.offsetY - this.downAt.y) < 4) return;
    if (!this.moved) {
      this.moved = true;
      if (this.mode === 'move' && this.grab) { this.store.snapshot(); this.store.select(this.grab.id); }
    }
    this.last = { x: e.offsetX, y: e.offsetY };
    if (this.mode === 'orbit') this.orbit(dx, dy);
    else if (this.mode === 'pan') this.pan(dx, dy);
    else if (this.mode === 'move' && this.grab) {
      const o = this.store.scene.objects.find((x) => x.id === this.grab!.id);
      if (!o) return;
      if (e.shiftKey) {
        // Lift: vertical travel scaled to the object's distance.
        const z = this.project(o.pos)?.z ?? 1;
        const k = (2 * this.frame().tanHalf * z) / this.canvas.clientHeight;
        o.pos = [o.pos[0], Math.max(-1, o.pos[1] - dy * k), o.pos[2]];
        this.grab.height -= dy * k;
      } else {
        const r = this.ray(e.offsetX, e.offsetY);
        const q = hitHorizontal(r.o, r.d, this.grab.height);
        if (!q || len(sub(q, r.o)) > 40) return;
        o.pos = [q[0] + this.grab.offset[0], o.pos[1], q[2] + this.grab.offset[2]];
      }
      this.busy();
      this.store.apply();
    }
  }

  private up(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size > 0) { this.mode = this.pointers.size === 1 ? 'orbit' : 'pinch'; const p = [...this.pointers.values()][0]!; this.last = { x: p.x, y: p.y }; return; }
    const wasTap = !this.moved && performance.now() - this.downAt.t < 500 && e.type === 'pointerup';
    if (wasTap && this.mode !== 'pinch') {
      if (this.editable) this.store.select(this.grab ? this.grab.id : null);
      // Double tap on touch screens (they do not send dblclick reliably).
      const now = performance.now();
      if (e.pointerType !== 'mouse' && now - this.lastTap < 350) this.focusAt(e.offsetX, e.offsetY);
      this.lastTap = now;
    }
    this.mode = 'none';
    this.grab = null;
  }

  private orbit(dx: number, dy: number): void {
    if (this.cameraLocked) return;
    const cam = this.store.scene.camera;
    const v = sub(cam.pos, cam.target);
    const r = len(v);
    let az = Math.atan2(v[0], v[2]) - dx * 0.006;
    let el = Math.asin(Math.min(1, Math.max(-1, v[1] / r))) + dy * 0.006;
    // Not past the zenith, and not below the table top.
    const floor = Math.asin(Math.min(1, Math.max(-1, (0.02 - cam.target[1]) / r)));
    el = Math.min(1.5, Math.max(floor, el));
    az = az % (2 * Math.PI);
    cam.pos = add(cam.target, [r * Math.cos(el) * Math.sin(az), r * Math.sin(el), r * Math.cos(el) * Math.cos(az)]);
    this.busy();
    this.store.cameraChanged();
  }

  private pan(dx: number, dy: number): void {
    if (this.cameraLocked) return;
    const cam = this.store.scene.camera;
    const f = this.frame();
    const dist = len(sub(cam.pos, cam.target));
    const k = (2 * f.tanHalf * dist) / this.canvas.clientHeight;
    const shift = add(mul(f.right, -dx * k), mul(f.up, dy * k));
    // The camera stays above the table.
    if (cam.pos[1] + shift[1] < 0.02) shift[1] = 0.02 - cam.pos[1];
    cam.pos = add(cam.pos, shift);
    cam.target = add(cam.target, shift);
    this.busy();
    this.store.cameraChanged();
  }

  private dolly(factor: number): void {
    if (this.cameraLocked) return;
    const cam = this.store.scene.camera;
    const v = sub(cam.pos, cam.target);
    const r = len(v);
    const nr = Math.min(30, Math.max(0.08, r * factor));
    cam.pos = add(cam.target, mul(v, nr / r));
    // Keep the same plane in focus.
    cam.focus = Math.max(0.02, cam.focus + (nr - r));
    this.busy();
    this.store.cameraChanged();
  }

  /** Focus the lens on whatever is under a point of the picture. */
  focusAt(x: number, y: number): void {
    if (this.cameraLocked) return;
    const r = this.ray(x, y);
    const hit = pick(this.store.scene, r.o, r.d, this.store.meshes.hit);
    if (!hit) return;
    const f = this.frame();
    this.store.scene.camera.focus = Math.max(0.02, dot(sub(hit.point, f.pos), f.forward));
    this.store.cameraChanged();
    this.onHint?.(`Focused at ${this.store.scene.camera.focus.toFixed(2)} m`);
  }

  /** Point the camera's orbit centre at an object. */
  lookAt(p: Vec3): void {
    const cam = this.store.scene.camera;
    const shift = sub(p, cam.target);
    cam.target = p;
    cam.pos = add(cam.pos, shift);
    this.store.cameraChanged();
  }

  drawOverlay(): void {
    const c = this.overlayCanvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth;
    const hgt = this.canvas.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(hgt * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(hgt * dpr); }
    const g = this.overlay;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, hgt);
    if (!this.store.scene) return;
    this.decorate?.(g, w, hgt);
    const o = this.store.selected;
    if (!o || !this.editable) return;
    const centre = boundCentre(o);
    const p = this.project(centre);
    if (!p) return;
    const f = this.frame();
    const radius = (boundRadius(o.shape) / p.z) * (hgt / (2 * f.tanHalf));
    g.lineWidth = 1.25;
    g.strokeStyle = 'rgba(255,176,0,0.95)';
    g.setLineDash([5, 4]);
    g.beginPath();
    g.arc(p.x, p.y, Math.max(6, Math.min(radius, 4000)), 0, 2 * Math.PI);
    g.stroke();
    // A plumb line to the table shows where the object stands.
    const foot = this.project([centre[0], 0, centre[2]]);
    if (foot && centre[1] > 0.02) {
      g.setLineDash([2, 3]);
      g.beginPath();
      g.moveTo(p.x, p.y);
      g.lineTo(foot.x, foot.y);
      g.stroke();
      g.setLineDash([]);
      g.beginPath();
      g.arc(foot.x, foot.y, 2.5, 0, 2 * Math.PI);
      g.fillStyle = 'rgba(255,176,0,0.95)';
      g.fill();
    }
    g.setLineDash([]);
  }
}
