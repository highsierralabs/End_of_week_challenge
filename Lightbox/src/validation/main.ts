// Lightbox validation: the tracer measured against things with known answers, computed live on
// the visitor's GPU. Each check renders a small scene, reads back the accumulated light, and
// compares it with a closed-form value or with an exact double-precision ray trace.
import '../app/style.css';
import './validation.css';
import { MeshLibrary, type TriMesh, prepareMesh } from '../core/mesh';
import { objectTransform, packScene } from '../core/pack';
import { type Material, type Scene, type SceneObject, defaultCamera, defaultDarkroom } from '../core/scene';
import { minimumDeviation, obj } from '../core/scenes';
import { hitLens, hitPolytope, shapePlanes } from '../core/shapes';
import { CMF, NS, cameraMatrix, glassIndex, integrate, lamAt, lightSpectrum, srgbToLinear, toXYZ } from '../core/spectrum';
import { type Vec3, add, cross, dot, invertAffine, mul, norm, sub, xformDir, xformPoint } from '../core/vec';
import { Tracer, cameraFrame } from '../gpu/tracer';

interface Row { what: string; measured: number; expected: number; unit: string; tol: number; digits?: number; abs?: boolean; /** A figure reported for reference, not a comparison. */ info?: boolean }
interface Result { id: string; title: string; note: string; rows: Row[]; image: string; seconds: number; samples: number }

declare global {
  interface Window { lightboxValidation: { done: boolean; error: string | null; results: Result[]; passed: number; total: number } }
}
window.lightboxValidation = { done: false, error: null, results: [], passed: 0, total: 0 };

const root = document.getElementById('validation')!;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

const canvas = document.createElement('canvas');
const lib = new MeshLibrary();
const lookup = (name: string) => lib.lookup(name);
const raf = () => new Promise<number>((r) => requestAnimationFrame(r));
let tracer: Tracer;
const quick = new URLSearchParams(location.search).has('quick');

const D65 = { kind: 'd65' } as const;
const white = (v = 0.8): Material => ({ kind: 'diffuse', color: [v, v, v] });
const base = (objects: SceneObject[], cam: Partial<Scene['camera']>, extra: Partial<Scene> = {}): Scene => ({
  v: 1, name: 'check', objects, camera: { ...defaultCamera(), fstop: 0, ...cam }, darkroom: defaultDarkroom(), env: { luminance: 0, spectrum: D65 }, bounces: 12, ...extra,
});

/** Trace a scene to a number of samples per pixel on a square image. */
async function trace(scene: Scene, spp: number, size = 256, lt = true): Promise<void> {
  if (quick) spp = Math.max(64, Math.round(spp / 4));
  tracer.resize(size, size);
  tracer.useLT = lt;
  const c = scene.camera;
  tracer.radius0 = 0.006 * Math.hypot(c.pos[0] - c.target[0], c.pos[1] - c.target[1], c.pos[2] - c.target[2]);
  tracer.setScene(packScene(scene, lookup), scene.bounces);
  tracer.setCamera(cameraFrame(scene.camera, 1));
  let sweeps = 1;
  let last = performance.now();
  while (tracer.frame < spp) {
    tracer.step(Math.min(Math.ceil(sweeps), spp - tracer.frame) * tracer.tilesPerSweep);
    await raf();
    const now = performance.now();
    sweeps = now - last > 50 ? Math.max(1, sweeps * 0.6) : sweeps * 1.4;
    last = now;
  }
}

/** Pixel (origin bottom left, as the tracer reads back) where a world point appears. */
function pixel(scene: Scene, size: number, p: Vec3): [number, number] {
  const f = cameraFrame(scene.camera, 1);
  const v = sub(p, f.pos);
  const z = dot(v, f.forward);
  const k = size / (2 * f.tanHalf);
  return [size / 2 + (dot(v, f.right) / z) * k, size / 2 + (dot(v, f.up) / z) * k];
}

/** Mean XYZ over a square of half-width r pixels about (x, y). */
function meanXYZ(x: number, y: number, r: number): [number, number, number] {
  const x0 = Math.max(0, Math.round(x - r));
  const y0 = Math.max(0, Math.round(y - r));
  const w = Math.min(tracer.renderWidth - x0, 2 * r);
  const h = Math.min(tracer.renderHeight - y0, 2 * r);
  const m = tracer.measure(x0, y0, w, h);
  return [m.pt[0] + m.lt[0], m.pt[1] + m.lt[1], m.pt[2] + m.lt[2]];
}
const meanY = (x: number, y: number, r: number): number => meanXYZ(x, y, r)[1];

function snapshot(): string {
  const m = tracer.meter();
  tracer.present({ matrix: cameraMatrix(6500), exposure: 0.16 / Math.max(1e-3, Math.exp(m.logMean)), tone: 0, bloom: 0 });
  return canvas.toDataURL('image/jpeg', 0.82);
}
function snapshotPeak(): string {
  const m = tracer.meter();
  tracer.present({ matrix: cameraMatrix(6500), exposure: 0.25 / Math.max(1e-3, m.peak), tone: 0, bloom: 0.2 });
  return canvas.toDataURL('image/jpeg', 0.82);
}

type Check = { id: string; title: string; note: string; run: () => Promise<{ rows: Row[]; image: string }> };

// ------------------------------------------------------------------ the checks
const furnace = (material: Material, bounces: number): Scene => base(
  [obj('Ball', { kind: 'sphere', r: 0.3 }, material, [0, 0, 0])],
  { pos: [0, 0, 2], target: [0, 0, 0], focal: 50 }, { env: { luminance: 100, spectrum: D65 }, bounces });

const checks: Check[] = [
  {
    id: 'furnace-diffuse',
    title: 'Furnace: a grey ball in uniform light',
    note: 'A matte ball of reflectance 0.214 inside a surround of 100 cd/m² on all sides. A convex Lambertian surface in uniform light must have a luminance of reflectance × surround, whatever its shape.',
    run: async () => {
      const s = furnace(white(0.5), 12);
      await trace(s, 400);
      return {
        rows: [
          { what: 'Ball luminance', measured: meanY(128, 128, 20), expected: 100 * srgbToLinear(0.5), unit: 'cd/m²', tol: 0.01 },
          { what: 'Surround luminance', measured: meanY(20, 20, 16), expected: 100, unit: 'cd/m²', tol: 0.002 },
        ],
        image: snapshot(),
      };
    },
  },
  {
    id: 'furnace-glass',
    title: 'Furnace: a glass ball in uniform light',
    note: 'A clear crown-glass ball in the same surround. Glass absorbs nothing, so reflection plus refraction must return exactly what arrives and the ball must vanish. This tests Fresnel’s equations, refraction and the path termination together.',
    run: async () => {
      const s = furnace({ kind: 'glass', glass: 'bk7' }, 64);
      await trace(s, 500);
      return {
        rows: [
          { what: 'Centre of the ball', measured: meanY(128, 128, 20), expected: 100, unit: 'cd/m²', tol: 0.01 },
          { what: 'Near its rim', measured: meanY(128 + 62, 128, 8), expected: 100, unit: 'cd/m²', tol: 0.015 },
        ],
        image: snapshot(),
      };
    },
  },
  {
    id: 'inverse-square',
    title: 'A small lamp over a table: inverse square and cosine laws',
    note: 'A 1,000 lm spherical lamp 1 m above a matte table of reflectance 0.604. The table’s luminance at a horizontal distance x must be (ρ/π) · (Φ/4π) · h / (h² + x²)^1.5.',
    run: async () => {
      const rho = srgbToLinear(0.8);
      const s = base([
        obj('Table', { kind: 'quad', half: [6, 6] }, white(), [0, 0, 0]),
        obj('Lamp', { kind: 'sphere', r: 0.02 }, { kind: 'light', spectrum: D65, lumens: 1000 }, [0, 1, 0]),
      ], { pos: [1.0, 3.0, 1.2], target: [1, 0, 0], focal: 28 });
      await trace(s, 800, 384);
      const rows = [0, 1, 2].map((x): Row => {
        const p = pixel(s, 384, [x, 0, 0]);
        return { what: `Table luminance at x = ${x} m`, measured: meanY(p[0], p[1], 4), expected: (rho / Math.PI) * (1000 / (4 * Math.PI)) / (1 + x * x) ** 1.5, unit: 'cd/m²', tol: 0.02 };
      });
      return { rows, image: snapshot() };
    },
  },
  {
    id: 'rectangle',
    title: 'A rectangular lamp: closed-form irradiance',
    note: 'A 0.6 × 0.4 m panel of 1,000 lm, 0.5 m above the table and parallel to it. The irradiance from a uniform rectangle has an exact formula (a sum of four arctangent terms); it is compared at three points. This tests light sampling and its combination with BSDF sampling.',
    run: async () => {
      const rho = srgbToLinear(0.8);
      const [a, b, hgt] = [0.3, 0.2, 0.5];
      const L = 1000 / (Math.PI * 4 * a * b);
      const corner = (x: number, z: number) => 0.5 * L * ((x / Math.hypot(x, hgt)) * Math.atan(z / Math.hypot(x, hgt)) + (z / Math.hypot(z, hgt)) * Math.atan(x / Math.hypot(z, hgt)));
      const E = (px: number, pz: number) => corner(a - px, b - pz) - corner(-a - px, b - pz) - corner(a - px, -b - pz) + corner(-a - px, -b - pz);
      const s = base([
        obj('Table', { kind: 'quad', half: [6, 6] }, white(), [0, 0, 0]),
        obj('Panel', { kind: 'quad', half: [a, b] }, { kind: 'light', spectrum: D65, lumens: 1000 }, [0, hgt, 0], [180, 0, 0]),
      ], { pos: [1.7, 1.1, 1.3], target: [0.3, 0, 0.08], focal: 50 });
      await trace(s, 3000, 384);
      const pts: [string, number, number][] = [['under the centre', 0, 0], ['under a corner', a, b], ['0.8 m to the side', 0.8, 0]];
      const rows = pts.map(([name, x, z]): Row => {
        const p = pixel(s, 384, [x, 0, z]);
        return { what: `Table luminance ${name}`, measured: meanY(p[0], p[1], 2), expected: (rho * E(x, z)) / Math.PI, unit: 'cd/m²', tol: 0.02 };
      });
      return { rows, image: snapshot() };
    },
  },
  {
    id: 'fresnel',
    title: 'Fresnel reflection from black glass',
    note: 'A lamp reflected in the flat top of a block of crown glass dyed so dark that nothing returns from inside. The reflection’s luminance over the lamp’s own is the Fresnel reflectance for unpolarised light at that angle, here weighted over the lamp’s spectrum because the index varies with wavelength.',
    run: async () => {
      const r = 0.05;
      const Ls = 1000 / (4 * Math.PI * Math.PI * r * r);
      const spec = lightSpectrum(D65);
      const fres = (deg: number): number => {
        const w = new Float32Array(NS);
        const ci = Math.cos((deg * Math.PI) / 180);
        for (let i = 0; i < NS; i++) {
          const n = glassIndex('bk7', lamAt(i));
          const ct = Math.sqrt(1 - (1 - ci * ci) / (n * n));
          const rs = (ci - n * ct) / (ci + n * ct);
          const rp = (n * ci - ct) / (n * ci + ct);
          w[i] = spec[i]! * 0.5 * (rs * rs + rp * rp);
        }
        return integrate(w, CMF[1]);
      };
      const rows: Row[] = [];
      let image = '';
      for (const deg of [15, 45, 60, 75, 85]) {
        const t = (deg * Math.PI) / 180;
        const s = base([
          obj('Block', { kind: 'box', half: [3, 0.1, 3] }, { kind: 'glass', glass: 'bk7', tint: [0.05, 0.05, 0.05], density: 500 }, [0, -0.1, 0]),
          obj('Lamp', { kind: 'sphere', r }, { kind: 'light', spectrum: D65, lumens: 1000 }, [-Math.sin(t), Math.cos(t), 0]),
        ], { pos: [Math.sin(t), Math.cos(t), 0], target: [0, 0, 0], focal: 200 });
        await trace(s, deg < 50 ? 2400 : 800);
        const p = pixel(s, 256, [-Math.sin(t), -Math.cos(t), 0]);
        rows.push({ what: `Reflectance at ${deg}°`, measured: meanY(p[0], p[1], 8) / Ls, expected: fres(deg), unit: '', tol: 0.03, digits: 4 });
        if (deg === 60) image = snapshot();
      }
      return { rows, image };
    },
  },
  {
    id: 'prism',
    title: 'Refraction and dispersion: laser beams through a prism',
    note: 'Laser beams of three wavelengths through a 60° dense-flint prism onto a screen 1 m away, traced by the photon pass. Where each spot lands is compared with an exact double-precision trace of the central ray using the glass’s Sellmeier formula. One pixel here is 0.75 mm, or 0.04° of deviation.',
    run: async () => {
      const m = minimumDeviation(0.1);
      const out: Vec3 = [m.out[0], 0, m.out[1]];
      const exit: Vec3 = [m.exit[0], 0, m.exit[1]];
      const D = 1;
      const screenAt = add(exit, mul(out, D));
      const phi = (Math.atan2(-out[0], -out[2]) * 180) / Math.PI;
      const prism = obj('Prism', { kind: 'prism', sides: 3, apex: 60, size: 0.1, h: 0.1 }, { kind: 'glass', glass: 'sf11' }, [m.centre[0], 0, m.centre[1]], [90, m.turn, 0]);
      const fwd = objectTransform(prism);
      const inv = invertAffine(fwd);
      const planes = shapePlanes(prism.shape)!;
      const refract = (d: Vec3, n: Vec3, eta: number): Vec3 => {
        const ci = -dot(d, n);
        return norm(add(mul(d, eta), mul(n, eta * ci - Math.sqrt(1 - eta * eta * (1 - ci * ci)))));
      };
      const right = norm(cross(out, [0, 1, 0]));
      const rows: Row[] = [];
      let image = '';
      for (const nm of [450, 550, 650]) {
        const s = base([
          prism,
          obj('Laser', { kind: 'disc', r: 0.002 }, { kind: 'beam', spectrum: { kind: 'laser', nm }, lumens: 1, spread: 0.05 }, [-0.5, 0, 0], [0, 0, -90]),
          obj('Screen', { kind: 'quad', half: [0.5, 0.5] }, white(), screenAt, [90, phi, 0]),
        ], { pos: add(exit, mul(out, D - 0.4)), target: screenAt, focal: 50 }, { bounces: 8 });
        await trace(s, 120);
        const lum = tracer.luminance(0, 0, 256, 256);
        let sum = 0;
        let cx = 0;
        let peak = 0;
        for (const v of lum) peak = Math.max(peak, v);
        for (let i = 0; i < lum.length; i++) if (lum[i]! > 0.2 * peak) { sum += lum[i]!; cx += lum[i]! * ((i % 256) + 0.5); }
        const f = cameraFrame(s.camera, 1);
        const measured = ((cx / sum - 128) * (2 * f.tanHalf) / 256) * 0.4 * 1000;
        // The same ray, traced exactly.
        const n = glassIndex('sf11', nm);
        const o = xformPoint(inv, [-0.5, 0, 0]);
        const d = norm(xformDir(inv, [1, 0, 0]));
        const h1 = hitPolytope(planes, o, d, 1e-9)!;
        const p1 = add(o, mul(d, h1.t));
        const d1 = refract(d, h1.n, 1 / n);
        const h2 = hitPolytope(planes, p1, d1, 1e-7)!;
        const d2 = norm(xformDir(fwd, refract(d1, mul(h2.n, -1), n)));
        const p2 = xformPoint(fwd, add(p1, mul(d1, h2.t)));
        const t = dot(sub(screenAt, p2), out) / dot(d2, out);
        const expected = dot(sub(add(p2, mul(d2, t)), screenAt), right) * 1000;
        rows.push({ what: `${nm} nm spot, across the screen`, measured, expected, unit: 'mm', tol: 1.0, abs: true, digits: 2 });
        if (nm === 550) image = snapshotPeak();
      }
      return { rows, image };
    },
  },
  {
    id: 'lens',
    title: 'A thick lens: where parallel rays land',
    note: 'Narrow beams parallel to the axis of a biconvex crown-glass lens (radii 150 mm, 20 mm thick), at three heights, onto a screen 100 mm behind it (one pixel is 0.125 mm). Each spot’s height is compared with an exact trace through the two spherical faces. The outer rays cross the axis sooner than the inner ones: spherical aberration, which the paraxial focal length ignores.',
    run: async () => {
      const [R, t, screenX] = [0.15, 0.02, 0.1];
      const lens = obj('Lens', { kind: 'lens', r: 0.05, t, r1: R, r2: R }, { kind: 'glass', glass: 'bk7' }, [0, 0, 0], [0, 0, 90]);
      const fwd = objectTransform(lens);
      const inv = invertAffine(fwd);
      const n = glassIndex('bk7', 550);
      const refract = (d: Vec3, nrm: Vec3, eta: number): Vec3 => {
        const ci = -dot(d, nrm);
        return norm(add(mul(d, eta), mul(nrm, eta * ci - Math.sqrt(1 - eta * eta * (1 - ci * ci)))));
      };
      const rows: Row[] = [];
      let image = '';
      for (const y0 of [0.01, 0.025, 0.04]) {
        const s = base([
          lens,
          obj('Laser', { kind: 'disc', r: 0.0015 }, { kind: 'beam', spectrum: { kind: 'laser', nm: 550 }, lumens: 1, spread: 0.05 }, [-0.3, y0, 0], [0, 0, -90]),
          obj('Screen', { kind: 'quad', half: [0.2, 0.2] }, white(), [screenX, 0, 0], [0, 0, 90]),
        ], { pos: [screenX - 0.08, 0, 0], target: [screenX, 0, 0], focal: 60 }, { bounces: 8 });
        await trace(s, 120);
        const lum = tracer.luminance(0, 0, 256, 256);
        let sum = 0;
        let cy = 0;
        let peak = 0;
        for (const v of lum) peak = Math.max(peak, v);
        for (let i = 0; i < lum.length; i++) if (lum[i]! > 0.2 * peak) { sum += lum[i]!; cy += lum[i]! * (Math.floor(i / 256) + 0.5); }
        const f = cameraFrame(s.camera, 1);
        const measured = ((cy / sum - 128) * (2 * f.tanHalf) / 256) * 0.08 * 1000;
        const o = xformPoint(inv, [-0.3, y0, 0]);
        const d = norm(xformDir(inv, [1, 0, 0]));
        const h1 = hitLens(0.05, t, R, R, o, d, 1e-9)!;
        const p1 = add(o, mul(d, h1.t));
        const d1 = refract(d, norm(h1.n), 1 / n);
        const h2 = hitLens(0.05, t, R, R, p1, d1, 1e-7)!;
        const d2 = norm(xformDir(fwd, refract(d1, mul(norm(h2.n), -1), n)));
        const p2 = xformPoint(fwd, add(p1, mul(d1, h2.t)));
        const expected = (p2[1] + (d2[1] * (screenX - p2[0])) / d2[0]) * 1000;
        rows.push({ what: `Beam entering ${y0 * 1000} mm above the axis`, measured, expected, unit: 'mm', tol: 0.2, abs: true, digits: 2 });
        if (y0 === 0.025) image = snapshotPeak();
      }
      const c = 1 / R;
      const power = (n - 1) * (2 * c - ((n - 1) * t * c * c) / n);
      rows.push({ what: 'Paraxial focal length by the lensmaker\u2019s equation', measured: 1000 / power, expected: 1000 / power, unit: 'mm', tol: 1, digits: 1, info: true });
      return { rows, image };
    },
  },
  {
    id: 'two-tracers',
    title: 'Two tracers, one answer',
    note: 'A glass ball under a small lamp throws a caustic. With the photon pass on, the photons carry the caustic and the path tracer carries everything else; with it off, the path tracer carries all of it. The comparison is made on the caustic itself (the brightest 12 \u00d7 12 pixel block, where photons carry most of the light) and on the whole picture.',
    run: async () => {
      const s = base([
        obj('Table', { kind: 'quad', half: [3, 3] }, white(), [0, 0, 0]),
        obj('Ball', { kind: 'sphere', r: 0.1 }, { kind: 'glass', glass: 'bk7' }, [0, 0.1, 0]),
        obj('Lamp', { kind: 'sphere', r: 0.03 }, { kind: 'light', spectrum: D65, lumens: 1000 }, [-0.3, 0.6, 0]),
      ], { pos: [0.5, 0.9, 0.9], target: [0.05, 0, 0], focal: 50 }, { bounces: 16 });
      await trace(s, 800, 256, true);
      const lum = tracer.luminance(0, 0, 256, 256);
      // Find the caustic: the 12 x 12 block with the most light.
      let best = -1;
      let bx = 0;
      let by = 0;
      for (let y = 0; y + 12 <= 256; y += 3) {
        for (let x = 0; x + 12 <= 256; x += 3) {
          let sum = 0;
          for (let j = 0; j < 12; j++) for (let i = 0; i < 12; i++) sum += lum[(y + j) * 256 + x + i]!;
          if (sum > best) { best = sum; bx = x; by = y; }
        }
      }
      const block = tracer.measure(bx, by, 12, 12);
      const both = tracer.measure(0, 0, 256, 256);
      const image = snapshot();
      await trace(s, 12000, 256, false);
      const blockAlone = tracer.measure(bx, by, 12, 12);
      const alone = tracer.measure(0, 0, 256, 256);
      return {
        rows: [
          { what: 'The caustic, photon pass on', measured: block.pt[1] + block.lt[1], expected: blockAlone.pt[1], unit: 'cd/m\u00b2', tol: 0.03 },
          { what: 'Whole picture, photon pass on', measured: both.pt[1] + both.lt[1], expected: alone.pt[1], unit: 'cd/m\u00b2', tol: 0.01 },
          { what: 'Share of the caustic carried by photons', measured: (100 * block.lt[1]) / (block.pt[1] + block.lt[1]), expected: 0, unit: '%', tol: 1, digits: 1, info: true },
        ],
        image,
      };
    },
  },
  {
    id: 'inside-glass',
    title: 'A lamp inside a glass ball',
    note: 'Radiance is not conserved when light crosses into glass; radiance divided by the square of the index is. A lamp at the centre of a crown-glass ball must therefore look larger and dimmer from outside: its luminance through the glass is the transmitted fraction over n\u00b2. The light it throws on the table, carried by photons or found by the path tracer alone, must agree, and follows the inverse-square law times the transmission.',
    run: async () => {
      const r = 0.02;
      const Ls = 1000 / (4 * Math.PI * Math.PI * r * r);
      const spec = lightSpectrum(D65);
      const wT = new Float32Array(NS);
      const wTn = new Float32Array(NS);
      for (let i = 0; i < NS; i++) {
        const n = glassIndex('bk7', lamAt(i));
        const T = 1 - ((n - 1) / (n + 1)) ** 2;
        wT[i] = spec[i]! * T;
        wTn[i] = (spec[i]! * T) / (n * n);
      }
      const objects = [
        obj('Table', { kind: 'quad', half: [3, 3] }, white(), [0, 0, 0]),
        obj('Lamp', { kind: 'sphere', r }, { kind: 'light', spectrum: D65, lumens: 1000 }, [0, 0.3, 0]),
        obj('Ball', { kind: 'sphere', r: 0.1 }, { kind: 'glass', glass: 'bk7' }, [0, 0.3, 0]),
      ];
      const look = base(objects, { pos: [0, 0.3, 1], target: [0, 0.3, 0], focal: 200 }, { bounces: 12 });
      await trace(look, 600);
      const seen = meanY(128, 128, 8);
      const image = snapshotPeak();
      const floor = base(objects, { pos: [1.3, 1.0, 0.9], target: [0.6, 0, 0], focal: 50 }, { bounces: 12 });
      const at = pixel(floor, 256, [0.6, 0, 0]);
      await trace(floor, 400, 256, true);
      const on = meanY(at[0], at[1], 6);
      const onWide = meanY(at[0], at[1], 40);
      // Alone, the path tracer finds this lamp about once in a thousand tries, so its answer
      // is averaged over a much wider patch.
      await trace(floor, 12000, 256, false);
      const offWide = meanY(at[0], at[1], 40);
      const rho = srgbToLinear(0.8);
      const law = (rho / Math.PI) * (1000 / (4 * Math.PI)) * 0.3 / (0.3 * 0.3 + 0.6 * 0.6) ** 1.5 * integrate(wT, CMF[1]);
      return {
        rows: [
          { what: 'Lamp seen through the glass, over its own luminance', measured: seen / Ls, expected: integrate(wTn, CMF[1]), unit: '', tol: 0.01, digits: 4 },
          { what: 'Table around 0.6 m away, photons on (expected: path tracer alone)', measured: onWide, expected: offWide, unit: 'cd/m\u00b2', tol: 0.02 },
          { what: 'Table 0.6 m away, against inverse square \u00d7 transmission', measured: on, expected: law, unit: 'cd/m\u00b2', tol: 0.02 },
        ],
        image,
      };
    },
  },
  {
    id: 'beam',
    title: 'A spotlight, bare and through a window',
    note: 'A 100 lm beam with a 5\u00b0 half-angle from a 40 mm disc, 1 m above the table. On the axis the whole disc is visible inside the cone, so the irradiance is the disc\u2019s radiance times its projected solid angle. Then a 20 mm pane of crown glass is put in the beam: all the light now arrives as photons, and must be the bare value times the pane\u2019s transmission with its internal reflections, (1 \u2212 R)/(1 + R), and times a little more because a pane of thickness t brings the source optically closer by t(1 \u2212 1/n).',
    run: async () => {
      const [a, half, lumens] = [0.02, 5, 100];
      const rho = srgbToLinear(0.5);
      const s2 = Math.sin((half * Math.PI) / 180) ** 2;
      const bare = (rho / Math.PI) * lumens / (Math.PI * (a * a + 1) * s2);
      const spec = lightSpectrum(D65);
      const w = new Float32Array(NS);
      const thick = 0.02;
      for (let i = 0; i < NS; i++) {
        const n = glassIndex('bk7', lamAt(i));
        const R = ((n - 1) / (n + 1)) ** 2;
        // Seen through the pane the source is closer by t (1 - 1/n), which raises the irradiance.
        const d = 1 - thick * (1 - 1 / n);
        w[i] = ((spec[i]! * (1 - R)) / (1 + R)) * ((a * a + 1) / (a * a + d * d));
      }
      const make = (pane: boolean): Scene => base([
        obj('Table', { kind: 'quad', half: [3, 3] }, white(0.5), [0, 0, 0]),
        obj('Spot', { kind: 'disc', r: a }, { kind: 'beam', spectrum: D65, lumens, spread: half }, [0, 1, 0], [180, 0, 0]),
        ...(pane ? [obj('Pane', { kind: 'box', half: [0.2, thick / 2, 0.2] }, { kind: 'glass', glass: 'bk7' }, [0, 0.5, 0])] : []),
      ], { pos: [0.7, 0.42, 0.5], target: [0, 0, 0], focal: 85 }, { bounces: 12 });
      await trace(make(false), 300);
      const direct = meanY(128, 128, 6);
      await trace(make(true), 600);
      const through = meanY(128, 128, 6);
      return {
        rows: [
          { what: 'Table at the centre of the bare beam', measured: direct, expected: bare, unit: 'cd/m\u00b2', tol: 0.015 },
          { what: 'The same through the pane (photons)', measured: through, expected: bare * integrate(w, CMF[1]), unit: 'cd/m\u00b2', tol: 0.02 },
        ],
        image: snapshot(),
      };
    },
  },
  {
    id: 'photon-map',
    title: 'A caustic seen in a mirror',
    note: 'The same caustic, but the camera looks only at a mirror. Light that reaches a surface through glass and is then seen through another specular bounce is beyond both tracers, so camera paths gather it from a map of the sweep\u2019s photons within a small, shrinking radius. That estimate is blurred, not exact, so the comparison is of the mean over a patch much wider than the blur, against the path tracer working alone for many more samples.',
    run: async () => {
      const s = base([
        obj('Table', { kind: 'quad', half: [3, 3] }, white(), [0, 0, 0]),
        obj('Ball', { kind: 'sphere', r: 0.1 }, { kind: 'glass', glass: 'bk7' }, [0, 0.1, 0]),
        obj('Lamp', { kind: 'sphere', r: 0.03 }, { kind: 'light', spectrum: D65, lumens: 1000 }, [-0.3, 0.6, 0]),
        obj('Mirror', { kind: 'box', half: [0.7, 0.4, 0.005] }, { kind: 'mirror' }, [0, 0.4, -0.405]),
      ], { pos: [0.3, 0.5, 0.6], target: [0.15, 0, -0.8], focal: 60 }, { bounces: 16 });
      const at = pixel(s, 256, [0.15, 0, -0.8]);
      await trace(s, 1000, 256, true);
      const on = meanY(at[0], at[1], 44);
      const image = snapshot();
      const radius = tracer.gatherRadius * 1000;
      await trace(s, 6000, 256, false);
      const alone = meanY(at[0], at[1], 44);
      return {
        rows: [
          { what: 'Mean luminance of the reflected patch, photons on', measured: on, expected: alone, unit: 'cd/m\u00b2', tol: 0.025 },
          { what: 'Gather radius after 1,000 sweeps', measured: radius, expected: radius, unit: 'mm', tol: 1, digits: 2, info: true },
        ],
        image,
      };
    },
  },
  {
    id: 'colour',
    title: 'From spectrum to colour',
    note: 'The camera looks straight at a lamp. The chromaticity the tracer accumulates, one wavelength per ray, must match the CIE values for that spectrum: the published coordinates of daylight D65 and of illuminant A (a 2,856 K blackbody), and for neon the direct integral of its line spectrum.',
    run: async () => {
      const rows: Row[] = [];
      let image = '';
      const neon = toXYZ(lightSpectrum({ kind: 'gas', gas: 'Ne' }));
      const cases: [string, Extract<Material, { kind: 'light' }>['spectrum'], number, number][] = [
        ['D65', D65, 0.3127, 0.329],
        ['Illuminant A', { kind: 'blackbody', kelvin: 2856 }, 0.44758, 0.40745],
        ['Neon', { kind: 'gas', gas: 'Ne' }, neon[0] / (neon[0] + neon[1] + neon[2]), neon[1] / (neon[0] + neon[1] + neon[2])],
      ];
      for (const [name, spectrum, x, y] of cases) {
        const s = base([obj('Lamp', { kind: 'quad', half: [1, 1] }, { kind: 'light', spectrum, lumens: 4 * Math.PI * 100 }, [0, 0, 0], [90, 0, 0])], { pos: [0, 0, 1], target: [0, 0, 0], focal: 50 });
        await trace(s, 1200, 128);
        const m = meanXYZ(64, 64, 60);
        const sum = m[0] + m[1] + m[2];
        rows.push({ what: `${name}: x`, measured: m[0] / sum, expected: x, unit: '', tol: 0.0015, abs: true, digits: 4 });
        rows.push({ what: `${name}: y`, measured: m[1] / sum, expected: y, unit: '', tol: 0.0015, abs: true, digits: 4 });
        if (name === 'D65') rows.push({ what: 'D65: luminance', measured: m[1], expected: 100, unit: 'cd/m²', tol: 0.005 });
        if (name === 'Neon') image = snapshot();
      }
      return { rows, image };
    },
  },
  {
    id: 'mesh',
    title: 'A triangle mesh against the exact sphere',
    note: 'Two matte balls side by side under a lamp and a surround: one an exact sphere, the other a mesh of 7,936 triangles behind a bounding-volume hierarchy, traversed in the shader. Their mean luminance must agree to within the faceting.',
    run: async () => {
      const lit = (o: SceneObject): Scene => base([
        obj('Table', { kind: 'quad', half: [3, 3] }, white(), [0, 0, 0]),
        obj('Lamp', { kind: 'quad', half: [0.3, 0.3] }, { kind: 'light', spectrum: D65, lumens: 1500 }, [-0.4, 1, 0.4], [180, 0, 0]),
        o,
      ], { pos: [0, 0.6, 1.4], target: [0, 0.2, 0], focal: 85 }, { env: { luminance: 30, spectrum: D65 } });
      const exact = lit(obj('Exact', { kind: 'sphere', r: 0.2 }, white(), [0, 0.2, 0]));
      const meshed = lit(obj('Mesh', { kind: 'mesh', mesh: 'vsphere', size: 0.4 }, white(), [0, 0, 0]));
      const c = pixel(exact, 256, [0, 0.2, 0]);
      await trace(exact, 500);
      const a = meanY(c[0], c[1], 22);
      await trace(meshed, 500);
      const b = meanY(c[0], c[1], 22);
      return { rows: [{ what: 'Mesh ball luminance (expected: the exact ball’s)', measured: b, expected: a, unit: 'cd/m²', tol: 0.01 }], image: snapshot() };
    },
  },
  {
    id: 'defocus',
    title: 'Depth of field: the size of a blur disc',
    note: 'A point of light 1 m away, seen by a 50 mm lens at f/2 focused at 0.5 m. A thin lens of aperture radius a focused at s spreads a point at distance d into a disc of angular radius a\u00b7|d \u2212 s| / (d\u00b7s). The disc\u2019s radius is taken from the second moment of the light in the picture (a uniform disc of radius R has mean square radius R\u00b2/2), after removing the small contributions of the source\u2019s own size and of the pixels.',
    run: async () => {
      const [d, sFocus, r] = [1, 0.5, 0.002];
      const s = base([obj('Point', { kind: 'sphere', r }, { kind: 'light', spectrum: D65, lumens: 1 }, [0, 0, -d])], { pos: [0, 0, 0], target: [0, 0, -1], focal: 50, fstop: 2, focus: sFocus });
      await trace(s, 2400, 512);
      const lum = tracer.luminance(0, 0, 512, 512);
      let sum = 0;
      let cx = 0;
      let cy = 0;
      for (let i = 0; i < lum.length; i++) { sum += lum[i]!; cx += lum[i]! * ((i % 512) + 0.5); cy += lum[i]! * (Math.floor(i / 512) + 0.5); }
      cx /= sum;
      cy /= sum;
      let m2 = 0;
      for (let i = 0; i < lum.length; i++) m2 += lum[i]! * (((i % 512) + 0.5 - cx) ** 2 + (Math.floor(i / 512) + 0.5 - cy) ** 2);
      m2 /= sum;
      const f = cameraFrame(s.camera, 1);
      const pxPerTan = 512 / (2 * f.tanHalf);
      const src = (r / d) * pxPerTan;
      // Mean square radius = R^2/2 (blur) + src^2/2 (source disc) + 1/6 (square pixels).
      const measured = Math.sqrt(Math.max(0, 2 * (m2 - 1 / 6) - src * src));
      const expected = ((f.lensRadius * Math.abs(d - sFocus)) / (d * sFocus)) * pxPerTan;
      return { rows: [{ what: 'Blur disc radius', measured, expected, unit: 'px', tol: 0.01 }], image: snapshotPeak() };
    },
  },
];

// ------------------------------------------------------------------ page
function uvSphere(nu: number, nv: number): TriMesh {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= nv; j++) {
    const th = (Math.PI * j) / nv;
    for (let i = 0; i < nu; i++) {
      const ph = (2 * Math.PI * i) / nu;
      pos.push(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph));
    }
  }
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * nu + i;
      const b = j * nu + ((i + 1) % nu);
      const c = a + nu;
      const d = b + nu;
      if (j > 0) idx.push(a, b, c);
      if (j < nv - 1) idx.push(b, d, c);
    }
  }
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx), normals: null };
}

const fmt = (v: number, digits: number): string => (Math.abs(v) >= 1000 ? v.toFixed(0) : Math.abs(v) >= 100 ? v.toFixed(Math.max(1, digits - 2)) : v.toFixed(digits));

function passes(r: Row): boolean {
  if (r.info) return true;
  if (!Number.isFinite(r.measured)) return false;
  return r.abs ? Math.abs(r.measured - r.expected) <= r.tol : Math.abs(r.measured / r.expected - 1) <= r.tol;
}

function card(c: Check): { box: HTMLElement; fill: (r: Result | null, err?: string) => void } {
  const box = el('section', 'lv-card');
  const head = el('div', 'lv-head');
  const badge = el('span', 'lv-badge wait', 'waiting');
  head.append(el('h2', '', c.title), badge);
  const body = el('div', 'lv-body');
  const img = el('img', 'lv-img');
  img.alt = `Render used for the check: ${c.title}`;
  img.hidden = true;
  const text = el('div', 'lv-text');
  text.append(el('p', '', c.note));
  const table = el('table', 'lv-table');
  text.append(table);
  body.append(img, text);
  box.append(head, body);
  return {
    box,
    fill: (r, err) => {
      if (!r) { badge.className = 'lv-badge bad'; badge.textContent = 'error'; text.append(el('p', 'lv-err', err ?? '')); return; }
      img.src = r.image;
      img.hidden = !r.image;
      const ok = r.rows.every(passes);
      badge.className = `lv-badge ${ok ? 'good' : 'bad'}`;
      badge.textContent = ok ? 'agrees' : 'differs';
      const hr = el('tr');
      for (const t of ['', 'measured', 'expected', 'difference', 'allowed']) hr.append(el('th', '', t));
      table.append(hr);
      for (const row of r.rows) {
        const tr = el('tr', passes(row) ? '' : 'lv-fail');
        const dg = row.digits ?? 2;
        if (row.info) {
          for (const t of [row.what, `${fmt(row.measured, dg)} ${row.unit}`, '', '', 'for reference']) tr.append(el('td', '', t));
          table.append(tr);
          continue;
        }
        const diff = row.abs ? `${(row.measured - row.expected >= 0 ? '+' : '') + fmt(row.measured - row.expected, dg)} ${row.unit}` : `${((row.measured / row.expected - 1) * 100 >= 0 ? '+' : '') + ((row.measured / row.expected - 1) * 100).toFixed(2)}%`;
        const allow = row.abs ? `±${row.tol} ${row.unit}` : `±${(row.tol * 100).toFixed(1)}%`;
        for (const t of [row.what, `${fmt(row.measured, dg)} ${row.unit}`, `${fmt(row.expected, dg)} ${row.unit}`, diff, allow]) tr.append(el('td', '', t));
        table.append(tr);
      }
      text.append(el('p', 'lv-meta', `${r.samples.toLocaleString()} samples per pixel in the last render · ${r.seconds.toFixed(1)} s`));
    },
  };
}

async function main(): Promise<void> {
  const intro = el('header', 'lv-intro');
  intro.append(el('h1', '', 'Lightbox: validation'));
  intro.append(el('p', '', 'A renderer can look right and be wrong. Each check below renders a small scene on your GPU, now, reads back the light it accumulated, and compares it with a value known in advance: a closed-form result of radiometry or optics, a published CIE figure, an exact double-precision trace of a single ray, or the path tracer working alone where two techniques must agree. Allowed differences are set by the sampling noise of each check; nothing here is precomputed. Not covered: glossy and rough materials, meshes of glass, and the grating have no check with a known answer here.'));
  const summary = el('p', 'lv-summary', 'Compiling shaders…');
  const back = el('a', 'lb-btn', 'Back to Lightbox');
  back.href = './';
  intro.append(summary, back);
  root.append(intro);
  try {
    tracer = new Tracer(canvas);
    await tracer.ready();
  } catch (e) {
    summary.textContent = `The tracer could not start: ${(e as Error).message}`;
    window.lightboxValidation.error = (e as Error).message;
    window.lightboxValidation.done = true;
    return;
  }
  lib.add('vsphere', prepareMesh(uvSphere(128, 32)));
  tracer.setMeshes(lib.nodes, lib.tris);
  const dbg = tracer.gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = dbg ? String(tracer.gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : 'unknown GPU';
  const cards = checks.map((c) => ({ c, ui: card(c) }));
  for (const { ui } of cards) root.append(ui.box);
  let passed = 0;
  let total = 0;
  for (const { c, ui } of cards) {
    summary.textContent = `Running: ${c.title}…`;
    const t0 = performance.now();
    try {
      const out = await c.run();
      const r: Result = { id: c.id, title: c.title, note: c.note, rows: out.rows, image: out.image, seconds: (performance.now() - t0) / 1000, samples: tracer.frame };
      window.lightboxValidation.results.push(r);
      ui.fill(r);
      for (const row of r.rows) { if (row.info) continue; total++; if (passes(row)) passed++; }
    } catch (e) {
      ui.fill(null, (e as Error).message);
      total++;
    }
    window.lightboxValidation.passed = passed;
    window.lightboxValidation.total = total;
  }
  summary.textContent = `${passed} of ${total} comparisons agree on this device (${gpu}).${quick ? ' Quick mode: a quarter of the samples, so expect more noise.' : ''}`;
  summary.classList.add(passed === total ? 'good' : 'bad');
  window.lightboxValidation.done = true;
}

void main();
