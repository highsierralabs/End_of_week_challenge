// Turns a Scene into the flat arrays the shaders read (layout documented in
// gpu/shaders/common.ts). Pure: no WebGL here, so the packing is unit-testable.
import { type Material, type Scene, type SceneObject, isDelta, isEmitter } from './scene';
import { boundRadius, emitterArea, shapePlanes, shapeScale } from './shapes';
import { CMF, NS, type Spectrum, absorption, glassSpectrum, lightSpectrum, metalSpectra, reflectance, wavelengthTable } from './spectrum';
import { type Affine, type Vec3, compose, eulerToMat3, invertAffine } from './vec';

export const OBJ_W = 8;
export const MAT_W = 2;
export const LIGHT_W = 4;
export const PLANE_W = 256;

export const SHAPE_TYPE = { sphere: 0, box: 1, cylinder: 2, quad: 3, disc: 4, prism: 5, gem: 5, lens: 6, mesh: 7 } as const;
export const MAT_TYPE = { diffuse: 0, plastic: 1, metal: 2, mirror: 3, glass: 4, light: 5, beam: 6, grating: 7 } as const;

/** Where a mesh asset's BVH starts in the node texture; supplied by the mesh library. */
export type MeshLookup = (name: string) => { root: number } | null;

export interface Packed {
  obj: Float32Array;
  numObj: number;
  mat: Float32Array;
  numMat: number;
  planes: Float32Array;
  planeRows: number;
  spec: Float32Array;
  numSpec: number;
  lam: Float32Array;
  lights: Float32Array;
  numLights: number;
  targets: Float32Array;
  numTargets: number;
  envRow: number;
  envScale: number;
  /** Object-to-world transform of each object, for the CPU side (picking, gizmos). */
  world: Affine[];
  inverse: Affine[];
  /** Total luminous flux of the sampled lights, lumens. */
  lumens: number;
}

const DEG = Math.PI / 180;

/** Luminance (cd/m2) of an emitter of the given shape and total luminous flux. */
export function emitterLuminance(o: SceneObject): number {
  const m = o.material;
  if (!isEmitter(m)) return 0;
  let area = emitterArea(o.shape);
  if (area === 0) {
    // Shapes the tracer cannot sample as lights: a rough figure from the bounding sphere.
    const r = boundRadius(o.shape);
    area = 4 * Math.PI * r * r * 0.5;
  }
  if (m.kind === 'beam') {
    const s = Math.sin(Math.max(0.05, Math.min(89, m.spread)) * DEG);
    return m.lumens / (area * Math.PI * s * s);
  }
  return m.lumens / (Math.PI * area);
}

/** Shapes whose surface the tracer can sample directly as a light. */
export function sampledLight(o: SceneObject): boolean {
  const k = o.shape.kind;
  if (!isEmitter(o.material)) return false;
  if (o.material.kind === 'beam') return k === 'quad' || k === 'disc';
  return k === 'sphere' || k === 'quad' || k === 'disc' || k === 'cylinder' || k === 'box';
}

export function objectTransform(o: SceneObject): Affine {
  return compose(o.pos, o.rot, shapeScale(o.shape));
}

/** Centre of the object's bounding sphere in world space. */
export function boundCentre(o: SceneObject): Vec3 {
  if (o.shape.kind !== 'mesh') return o.pos;
  const r = eulerToMat3(o.rot);
  const h = 0.5 * o.shape.size;
  return [o.pos[0] + r[1]! * h, o.pos[1] + r[4]! * h, o.pos[2] + r[7]! * h];
}

export function packScene(scene: Scene, meshes: MeshLookup): Packed {
  const objs = scene.objects.filter((o) => o.shape.kind !== 'mesh' || meshes(o.shape.mesh) !== null);
  const numObj = objs.length;

  // Spectra: rows 0..2 are the colour matching functions.
  const rows: Spectrum[] = [CMF[0], CMF[1], CMF[2]];
  const rowIndex = new Map<string, number>();
  const row = (key: string, make: () => Spectrum): number => {
    let i = rowIndex.get(key);
    if (i === undefined) {
      i = rows.length;
      rows.push(make());
      rowIndex.set(key, i);
    }
    return i;
  };

  // Materials, one row per distinct description.
  const mats: number[][] = [];
  const matIndex = new Map<string, number>();
  const material = (m: Material, luminance: number): number => {
    const key = JSON.stringify(m) + (isEmitter(m) ? `@${luminance}` : '');
    const have = matIndex.get(key);
    if (have !== undefined) return have;
    let rec: number[];
    switch (m.kind) {
      case 'diffuse': rec = [MAT_TYPE.diffuse, row(`r${m.color.join()}`, () => reflectance(m.color)), 0, 0, 0, 0, 0, 0]; break;
      case 'plastic': rec = [MAT_TYPE.plastic, row(`r${m.color.join()}`, () => reflectance(m.color)), 0, m.rough, 0, 0, 0, 0]; break;
      case 'metal': {
        const n = row(`mn${m.metal}`, () => metalSpectra(m.metal)[0]);
        const k = row(`mk${m.metal}`, () => metalSpectra(m.metal)[1]);
        rec = [MAT_TYPE.metal, n, k, m.rough, 0, 0, 0, 0];
        break;
      }
      case 'mirror': rec = [MAT_TYPE.mirror, 0, 0, 0, 0, 0, 0, 0]; break;
      case 'glass': {
        const ior = row(`g${m.glass}`, () => glassSpectrum(m.glass));
        const tinted = m.tint && (m.density ?? 0) > 0;
        const ab = tinted ? row(`a${m.tint!.join()}@${m.density}`, () => absorption(m.tint!, m.density!)) : -1;
        rec = [MAT_TYPE.glass, ior, ab, m.rough ?? 0, 0, 0, 0, 0];
        break;
      }
      case 'light': rec = [MAT_TYPE.light, row(`l${JSON.stringify(m.spectrum)}`, () => lightSpectrum(m.spectrum)), 0, 0, luminance, 0, 0, 0]; break;
      case 'beam': rec = [MAT_TYPE.beam, row(`l${JSON.stringify(m.spectrum)}`, () => lightSpectrum(m.spectrum)), 0, 0, luminance, Math.cos(Math.max(0.05, Math.min(89, m.spread)) * DEG), 0, 0]; break;
      case 'grating': rec = [MAT_TYPE.grating, 0, 0, 0, 0, 1e6 / m.linesPerMm, 0, 0]; break;
    }
    mats.push(rec);
    matIndex.set(key, mats.length - 1);
    return mats.length - 1;
  };

  const obj = new Float32Array(Math.max(1, numObj) * OBJ_W * 4);
  const planeList: number[] = [];
  const lightRows: number[][] = [];
  const targetList: number[] = [];
  const world: Affine[] = [];
  const inverse: Affine[] = [];
  // Luminous flux per distinct emission spectrum (by spectrum row), for the wavelength sampler.
  const flux = new Map<number, number>();
  let lumens = 0;

  objs.forEach((o, i) => {
    const fwd = objectTransform(o);
    const inv = invertAffine(fwd);
    world.push(fwd);
    inverse.push(inv);
    const lum = emitterLuminance(o);
    const mi = material(o.material, lum);
    const base = i * OBJ_W * 4;
    obj.set(inv, base);
    let lightIdx = -1;
    if (sampledLight(o) && isEmitter(o.material) && o.material.lumens > 0) {
      lightIdx = lightRows.length;
      const area = emitterArea(o.shape);
      let fx = 0;
      let fy = 0;
      let side = 0;
      if (o.shape.kind === 'box') {
        const [a, b, c] = o.shape.half;
        const tot = a * b + b * c + a * c;
        fx = (b * c) / tot;
        fy = (a * c) / tot;
      } else if (o.shape.kind === 'cylinder') {
        side = (2 * o.shape.h) / (2 * o.shape.h + o.shape.r);
      }
      lightRows.push([i, 0, o.material.lumens, area, fwd[0]!, fwd[1]!, fwd[2]!, fx, fwd[4]!, fwd[5]!, fwd[6]!, fy, fwd[8]!, fwd[9]!, fwd[10]!, side]);
      lumens += o.material.lumens;
    }
    if (isEmitter(o.material) && o.material.lumens > 0) {
      const r = mats[mi]![1]!;
      flux.set(r, (flux.get(r) ?? 0) + o.material.lumens);
    }
    obj.set([SHAPE_TYPE[o.shape.kind], mi, lightIdx, 0], base + 12);
    const planes = shapePlanes(o.shape);
    if (planes) {
      obj.set([planeList.length / 4, planes.length, 0, 0], base + 16);
      for (const p of planes) planeList.push(p[0], p[1], p[2], p[3]);
    } else if (o.shape.kind === 'lens') {
      obj.set([o.shape.r, o.shape.t, o.shape.r1, o.shape.r2], base + 16);
    } else if (o.shape.kind === 'mesh') {
      obj.set([meshes(o.shape.mesh)!.root, 0, 0, 0], base + 16);
    }
    const c = boundCentre(o);
    const br = boundRadius(o.shape) * 1.0001 + 1e-6;
    obj.set([c[0], c[1], c[2], br], base + 20);
    obj.set([o.pos[0], o.pos[1], o.pos[2], 0], base + 24);
    const m = o.material;
    const traversable = isDelta(m) && m.kind !== 'plastic';
    if (traversable) targetList.push(c[0], c[1], c[2], br);
  });

  // Light pick probabilities and their running sum.
  let acc = 0;
  for (const l of lightRows) {
    const p = l[2]! / lumens;
    acc += p;
    l[1] = acc;
    l[2] = p;
  }
  if (lightRows.length) lightRows[lightRows.length - 1]![1] = 2;
  const lights = new Float32Array(Math.max(1, lightRows.length) * LIGHT_W * 4);
  lightRows.forEach((l, i) => lights.set(l, i * LIGHT_W * 4));

  // Environment.
  let envRow = 0;
  const envScale = Math.max(0, scene.env.luminance);
  if (envScale > 0) {
    envRow = row(`l${JSON.stringify(scene.env.spectrum)}`, () => lightSpectrum(scene.env.spectrum));
    // Weigh the surround as if it were a lamp lighting a few square metres.
    flux.set(envRow, (flux.get(envRow) ?? 0) + envScale * 40);
  }
  // Wavelengths are drawn from a mixture of the emission spectra. Half the weight follows each
  // spectrum's share of the light and half is split evenly, so a dim lamp of a different
  // colour (a neon tube beside a softbox) still gets its share of samples.
  const power = new Float64Array(NS);
  let fluxTotal = 0;
  for (const f of flux.values()) fluxTotal += f;
  for (const [r, f] of flux) {
    const w = 0.5 * (f / fluxTotal) + 0.5 / flux.size;
    const s = rows[r]!;
    for (let k = 0; k < NS; k++) power[k]! += w * s[k]!;
  }

  const mat = new Float32Array(Math.max(1, mats.length) * MAT_W * 4);
  mats.forEach((m, i) => mat.set(m, i * MAT_W * 4));

  const planeRows = Math.max(1, Math.ceil(planeList.length / 4 / PLANE_W));
  const planes = new Float32Array(planeRows * PLANE_W * 4);
  planes.set(planeList);

  const spec = new Float32Array(rows.length * NS);
  rows.forEach((r, i) => spec.set(r, i * NS));

  const targets = new Float32Array(Math.max(1, targetList.length / 4) * 4);
  targets.set(targetList);

  return {
    obj, numObj, mat, numMat: mats.length, planes, planeRows, spec, numSpec: rows.length,
    lam: wavelengthTable(Float32Array.from(power)),
    lights, numLights: lightRows.length, targets, numTargets: targetList.length / 4,
    envRow, envScale, world, inverse, lumens,
  };
}
