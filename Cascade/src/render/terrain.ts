// Real-DEM terrain of the Reno-Stead area at night (architecture.md section 3).
//
// The heightmap is public/dem/stead_60km.png (Terrarium RGB, row 0 = north) with its
// metadata in stead_60km.json; scripts/fetch-dem.mjs builds both. The mesh lives in
// the render frame: X east, Y = elevation - GROUND_ALT_M, Z = -north. Inside 2.5 km of
// the origin the ground is exactly Y = 0 (the physics plane); it smoothstep-blends to
// the true relief by 6 km.
//
// Shading is unlit TSL (it ignores scene lights): faint moonlight, a sky ambient term,
// slope / elevation tint, glowing contour lines, and distance haze that fades into the
// sky gradient. Warm town lights are hashed points on the valley floors.
import * as THREE from 'three/webgpu';
import {
  abs,
  cameraPosition,
  dot,
  exp,
  float,
  fract,
  fwidth,
  instancedBufferAttribute,
  length,
  max,
  min,
  mix,
  normalWorld,
  normalize,
  positionLocal,
  positionWorld,
  select,
  smoothstep,
  uniform,
  uv,
  vec3,
  vec4,
} from 'three/tsl';
import { GROUND_ALT_M } from './frame';
import { skyGradient } from './sky';

export const FLAT_RADIUS_M = 2500;
export const BLEND_RADIUS_M = 6000;

export interface DemMeta {
  size_m: number;
  pixels: number;
  elevation_m: { min: number; max: number; at_origin?: number };
  origin: { lat: number; lon: number };
  attribution: string;
}

export interface TerrainOptions {
  /** URL of the Terrarium PNG. */
  url: string;
  /** URL of the metadata JSON. */
  metaUrl: string;
  /** Mesh segments per side (default 512). */
  segments?: number;
  /** Add the town-light points (default true). */
  townLights?: boolean;
}

/** Decoded heightmap: true elevation in metres, row 0 = north, column 0 = west. */
export interface Heightmap {
  pixels: number;
  sizeM: number;
  elev: Float32Array;
}

function smoothstepJs(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Weight of the true relief at horizontal distance r from the origin (0 inside 2.5 km, 1 beyond 6 km). */
export function reliefWeight(r: number): number {
  return smoothstepJs(FLAT_RADIUS_M, BLEND_RADIUS_M, r);
}

/** Deterministic 32-bit integer hash to [0, 1). */
function hash01(a: number, b: number, seed: number): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca77);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae3d);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

async function decodeTerrarium(url: string): Promise<{ pixels: number; elev: Float32Array }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`terrain: ${url} -> HTTP ${res.status}`);
  const blob = await res.blob();
  // Exact bytes: no premultiplication, no colour-space conversion, no resampling.
  const bmp = await createImageBitmap(blob, {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
    imageOrientation: 'none',
  });
  const w = bmp.width;
  const h = bmp.height;
  if (w !== h) throw new Error('terrain: heightmap must be square');
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
  if (!ctx) throw new Error('terrain: no 2D context');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const px = ctx.getImageData(0, 0, w, h, { colorSpace: 'srgb' }).data;
  const elev = new Float32Array(w * h);
  for (let i = 0, k = 0; i < elev.length; i++, k += 4) {
    elev[i] = px[k]! * 256 + px[k + 1]! + px[k + 2]! / 256 - 32768;
  }
  return { pixels: w, elev };
}

/** Bilinear true elevation (m) at east/north metres; clamps at the patch edge. */
export function sampleElevation(hm: Heightmap, east: number, north: number): number {
  const n = hm.pixels;
  const cell = hm.sizeM / n;
  const fx = Math.min(n - 1, Math.max(0, (east + hm.sizeM / 2) / cell - 0.5));
  const fy = Math.min(n - 1, Math.max(0, (hm.sizeM / 2 - north) / cell - 0.5));
  const x0 = Math.min(n - 2, Math.floor(fx));
  const y0 = Math.min(n - 2, Math.floor(fy));
  const ax = fx - x0;
  const ay = fy - y0;
  const i = y0 * n + x0;
  const e = hm.elev;
  const top = e[i]! * (1 - ax) + e[i + 1]! * ax;
  const bot = e[i + n]! * (1 - ax) + e[i + n + 1]! * ax;
  return top * (1 - ay) + bot * ay;
}

export class Terrain {
  /** Group holding the ground mesh and the town lights. Keep it untransformed. */
  readonly object: THREE.Group;
  readonly meta: DemMeta;
  readonly heightmap: Heightmap;
  /** Unit vector toward the moon in the render frame; shading reads it every frame. */
  readonly moonDirection: THREE.UniformNode<'vec3', THREE.Vector3>;
  private readonly segs: number;
  private readonly step: number;
  private readonly half: number;
  /** Render-frame Y at each mesh vertex, row 0 = north. */
  private readonly grid: Float32Array;
  private readonly disposables: { dispose(): void }[] = [];

  constructor(meta: DemMeta, heightmap: Heightmap, opts: { segments: number; townLights: boolean }) {
    this.meta = meta;
    this.heightmap = heightmap;
    this.segs = opts.segments;
    this.half = heightmap.sizeM / 2;
    this.step = heightmap.sizeM / this.segs;
    this.moonDirection = uniform(new THREE.Vector3(-0.66, 0.3, 0.62).normalize());
    this.object = new THREE.Group();
    this.object.name = 'terrain';
    this.grid = this.buildGrid();
    this.object.add(this.buildMesh());
    if (opts.townLights) this.object.add(this.buildTownLights());
  }

  /**
   * Render-frame Y (m) of the visible ground surface at physics east/north metres:
   * exactly 0 within 2.5 km of the origin, and it matches the rendered triangles.
   */
  heightAt(xEast: number, yNorth: number): number {
    const n = this.segs;
    const fx = Math.min(n, Math.max(0, (xEast + this.half) / this.step));
    const fy = Math.min(n, Math.max(0, (this.half - yNorth) / this.step));
    const ix = Math.min(n - 1, Math.floor(fx));
    const iy = Math.min(n - 1, Math.floor(fy));
    const u = fx - ix;
    const v = fy - iy;
    const row = n + 1;
    const g = this.grid;
    const ha = g[iy * row + ix]!;
    const hd = g[iy * row + ix + 1]!;
    const hb = g[(iy + 1) * row + ix]!;
    const hc = g[(iy + 1) * row + ix + 1]!;
    // Same diagonal as the index buffer: triangles (a, b, d) and (b, c, d).
    if (u + v <= 1) return ha + u * (hd - ha) + v * (hb - ha);
    return hc + (1 - u) * (hb - hc) + (1 - v) * (hd - hc);
  }

  /** True (unflattened) DEM elevation above sea level, metres. */
  elevationAt(xEast: number, yNorth: number): number {
    return sampleElevation(this.heightmap, xEast, yNorth);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.object.removeFromParent();
    this.object.clear();
  }

  private buildGrid(): Float32Array {
    const n = this.segs;
    const row = n + 1;
    const grid = new Float32Array(row * row);
    const hm = this.heightmap;
    // Box-filter the DEM over the vertex footprint when the mesh is coarser than it.
    const foot = hm.pixels / n;
    const k = Math.max(1, Math.round(foot));
    const sub = this.step / k;
    for (let iy = 0; iy <= n; iy++) {
      const north = this.half - iy * this.step;
      for (let ix = 0; ix <= n; ix++) {
        const east = -this.half + ix * this.step;
        let acc = 0;
        for (let a = 0; a < k; a++) {
          for (let b = 0; b < k; b++) {
            acc += sampleElevation(hm, east + (b - (k - 1) / 2) * sub, north - (a - (k - 1) / 2) * sub);
          }
        }
        const e = acc / (k * k);
        const r = Math.hypot(east, north);
        grid[iy * row + ix] = (e - GROUND_ALT_M) * reliefWeight(r);
      }
    }
    return grid;
  }

  private buildMesh(): THREE.Mesh {
    const n = this.segs;
    const row = n + 1;
    const pos = new Float32Array(row * row * 3);
    const nor = new Float32Array(row * row * 3);
    const g = this.grid;
    const at = (ix: number, iy: number): number =>
      g[Math.min(n, Math.max(0, iy)) * row + Math.min(n, Math.max(0, ix))]!;
    for (let iy = 0; iy <= n; iy++) {
      for (let ix = 0; ix <= n; ix++) {
        const i = iy * row + ix;
        pos[i * 3] = -this.half + ix * this.step;
        pos[i * 3 + 1] = g[i]!;
        pos[i * 3 + 2] = -this.half + iy * this.step;
        // Central differences; Z grows with iy, so dY/dZ = (south - north) / 2 step.
        const dx = (at(ix + 1, iy) - at(ix - 1, iy)) / (2 * this.step);
        const dz = (at(ix, iy + 1) - at(ix, iy - 1)) / (2 * this.step);
        const inv = 1 / Math.hypot(dx, 1, dz);
        nor[i * 3] = -dx * inv;
        nor[i * 3 + 1] = inv;
        nor[i * 3 + 2] = -dz * inv;
      }
    }
    const index = new Uint32Array(n * n * 6);
    let k = 0;
    for (let iy = 0; iy < n; iy++) {
      for (let ix = 0; ix < n; ix++) {
        const a = iy * row + ix;
        const b = a + row;
        const c = b + 1;
        const d = a + 1;
        index[k++] = a;
        index[k++] = b;
        index[k++] = d;
        index[k++] = b;
        index[k++] = c;
        index[k++] = d;
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();

    const material = new THREE.MeshBasicNodeMaterial({ fog: false });
    material.colorNode = this.groundColor();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'terrain-ground';
    this.disposables.push(geometry, material);
    return mesh;
  }

  private groundColor(): THREE.Node<'vec3'> {
    const nrm = normalize(normalWorld);
    const elev = positionLocal.y.add(GROUND_ALT_M);
    const slope = float(1.0).sub(nrm.y).clamp(0.0, 1.0);

    // Albedo: dusty sage-brown valley floors, darker rock on slopes, paler high ground.
    const floorCol = vec3(0.15, 0.135, 0.115);
    const rockCol = vec3(0.085, 0.08, 0.085);
    let albedo = mix(floorCol, rockCol, smoothstep(0.04, 0.3, slope));
    albedo = mix(albedo, vec3(0.24, 0.25, 0.28), smoothstep(2150.0, 2700.0, elev).mul(0.7));
    // Playas / basin floors a touch lighter.
    albedo = mix(albedo, vec3(0.2, 0.185, 0.16), smoothstep(0.02, 0.0, slope).mul(0.5));

    const moon = max(dot(nrm, this.moonDirection), 0.0);
    const moonCol = vec3(0.2, 0.24, 0.34);
    const skyAmb = vec3(0.012, 0.015, 0.026).mul(nrm.y.mul(0.5).add(0.5));
    const lit = albedo.mul(moonCol.mul(moon).add(skyAmb));

    // Contours: 100 m minor, 500 m major, about one pixel wide, faded where they crowd.
    const fw = max(fwidth(elev), 1e-3);
    const line = (spacing: number, widthPx: number): THREE.Node<'float'> => {
      const f = fract(elev.div(spacing));
      const distPx = min(f, float(1.0).sub(f)).mul(spacing).div(fw);
      const crowd = float(1.0).sub(smoothstep(spacing * 0.04, spacing * 0.16, fw));
      return float(1.0).sub(smoothstep(0.0, widthPx, distPx)).mul(crowd);
    };
    const minor = line(100.0, 0.9);
    const major = line(500.0, 1.2);
    // No contours on the flattened disc (they would ring its edge, not the relief).
    const rH = length(positionLocal.xz);
    const reliefMask = smoothstep(FLAT_RADIUS_M + 500.0, BLEND_RADIUS_M, rH);
    const contourCol = vec3(0.12, 0.42, 0.55);
    const camDist = length(positionWorld.sub(cameraPosition));
    const nearBoost = float(1.0).sub(smoothstep(6000.0, 30000.0, camDist)).mul(0.6).add(0.4);
    const contours = contourCol.mul(max(minor.mul(0.08), major.mul(0.22))).mul(reliefMask).mul(nearBoost);

    // A faint 1 km grid near the site, for scale.
    const gx = abs(fract(positionLocal.x.div(1000.0).add(0.5)).sub(0.5)).mul(1000.0).div(max(fwidth(positionLocal.x), 1e-3));
    const gz = abs(fract(positionLocal.z.div(1000.0).add(0.5)).sub(0.5)).mul(1000.0).div(max(fwidth(positionLocal.z), 1e-3));
    const gridLine = float(1.0).sub(smoothstep(0.4, 1.1, min(gx, gz)));
    const gridFade = float(1.0).sub(smoothstep(4000.0, 14000.0, rH));
    const grid = vec3(0.26, 0.14, 0.4).mul(gridLine.mul(gridFade).mul(0.02));

    // Distance haze toward the sky's own horizon colour.
    const toFrag = positionWorld.sub(cameraPosition);
    const dist = length(toFrag);
    const viewDir = toFrag.div(max(dist, 1e-3));
    // Distance haze, forced to 1 at the patch edge so the square boundary dissolves
    // into the sky's horizon colour (the sky shows that colour below the horizon).
    const edge = max(abs(positionLocal.x), abs(positionLocal.z));
    // Haze lives in the lowest couple of km: weight the path length by the mean of
    // exp(-Y / H) between camera and fragment, so looking down from altitude stays clear.
    const H = 1800.0;
    const fragY = positionWorld.y;
    const camY = cameraPosition.y;
    const dh = camY.sub(fragY);
    const meanDensity = select(
      abs(dh).greaterThan(1.0),
      exp(fragY.div(-H)).sub(exp(camY.div(-H))).mul(H).div(dh),
      exp(fragY.div(-H)),
    );
    const tau = dist.mul(meanDensity).div(26000.0);
    const haze = max(
      float(1.0).sub(exp(tau.pow(1.8).negate())),
      smoothstep(this.half * 0.78, this.half * 0.995, edge),
    );
    // The sky shows exactly this colour beyond the patch edge, so the edge dissolves.
    const hazeCol = skyGradient(viewDir);

    return mix(lit.add(contours).add(grid), hazeCol, haze);
  }

  private buildTownLights(): THREE.Sprite {
    const hm = this.heightmap;
    const half = this.half;
    // Places (render-independent, physics east/north km) used only to shape density.
    const towns: [number, number, number, number][] = [
      // east, north, sigma, weight
      [6000, -14500, 4500, 1.0], // Reno-Sparks core, ~15 km SSE
      [10500, -12500, 3000, 0.55], // Sparks
      [7300, -6700, 1800, 0.45], // Sun Valley
      [13300, -1200, 2600, 0.4], // Spanish Springs
      [-9900, 2200, 1800, 0.35], // Cold Springs
      [2800, -3800, 1500, 0.35], // Lemmon Valley south
      [-10700, -15500, 1500, 0.25], // Verdi
      [-2500, -16500, 2500, 0.45], // west Reno
    ];
    const spacing = 45;
    const nCells = Math.floor((2 * half) / spacing);
    const positions: number[] = [];
    const colors: number[] = [];
    const sizes: number[] = [];
    for (let j = 0; j < nCells; j++) {
      for (let i = 0; i < nCells; i++) {
        // Street-like layout: candidates only on every 3rd row or column.
        const onStreet = i % 3 === 0 || j % 3 === 0;
        if (!onStreet) continue;
        const h0 = hash01(i, j, 1);
        const east = -half + (i + 0.5) * spacing + (hash01(i, j, 2) - 0.5) * 12;
        const north = half - (j + 0.5) * spacing + (hash01(i, j, 3) - 0.5) * 12;
        const r = Math.hypot(east, north);
        const awayFromSite = smoothstepJs(3200, 4800, r);
        if (awayFromSite <= 0) continue;
        let dens = 0.0006 + 0.0024 * smoothstepJs(5000, -20000, north);
        for (const [te, tn, s, w] of towns) {
          const dx = east - te;
          const dy = north - tn;
          dens += w * 0.3 * Math.exp(-(dx * dx + dy * dy) / (2 * s * s));
        }
        if (h0 >= dens * awayFromSite) continue;
        const e = sampleElevation(hm, east, north);
        if (e < 1200 || e > 1720) continue; // Pyramid Lake surface / mountain slopes
        const ex = sampleElevation(hm, east + 60, north) - sampleElevation(hm, east - 60, north);
        const ey = sampleElevation(hm, east, north + 60) - sampleElevation(hm, east, north - 60);
        const slope = Math.hypot(ex, ey) / 120;
        const flatW = smoothstepJs(0.14, 0.05, slope) * smoothstepJs(1720, 1600, e);
        if (hash01(i, j, 4) >= flatW) continue;
        positions.push(east, this.heightAt(east, north) + 4, -north);
        const t = hash01(i, j, 5);
        const b = 1.0 + 4.0 * Math.pow(hash01(i, j, 6), 3);
        // Mostly sodium orange, some warm-white LED, a few cool white.
        const c: [number, number, number] =
          t < 0.6 ? [1.0, 0.52, 0.18] : t < 0.92 ? [1.0, 0.8, 0.58] : [0.8, 0.88, 1.0];
        colors.push(c[0] * b, c[1] * b, c[2] * b);
        sizes.push(3.0 + 3.0 * hash01(i, j, 7));
      }
    }
    const count = sizes.length;
    const posAttr = new THREE.InstancedBufferAttribute(new Float32Array(positions), 3);
    const colAttr = new THREE.InstancedBufferAttribute(new Float32Array(colors), 3);
    const sizeAttr = new THREE.InstancedBufferAttribute(new Float32Array(sizes), 1);

    const p = instancedBufferAttribute(posAttr, 'vec3') as unknown as THREE.Node<'vec3'>;
    // Slide each light toward the camera along its view ray by 1% of the distance:
    // its screen position is unchanged, but it wins against coarse far-field depth.
    const toCam = cameraPosition.sub(p);
    const d = length(toCam);
    const pulled = p.add(toCam.div(max(d, 1e-3)).mul(d.mul(0.01).add(3.0)));

    const material = new THREE.PointsNodeMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: false,
      fog: false,
    });
    material.positionNode = pulled;
    material.sizeNode = instancedBufferAttribute(sizeAttr, 'float');
    const q = uv().sub(0.5).mul(2.0);
    const fall = exp(dot(q, q).mul(-6.0));
    const distFade = float(9000.0).div(max(d, 9000.0)).pow(0.6).max(0.3);
    const col = instancedBufferAttribute(colAttr, 'vec3') as unknown as THREE.Node<'vec3'>;
    const outCol = col.mul(fall.mul(distFade));
    material.colorNode = vec4(outCol, fall);
    material.opacityNode = fall;

    const sprite = new THREE.Sprite(material);
    sprite.count = count;
    sprite.name = 'terrain-town-lights';
    sprite.frustumCulled = false;
    sprite.userData.count = count;
    this.disposables.push(material);
    return sprite;
  }
}

/** Load the DEM and build the terrain. */
export async function createTerrain(opts: TerrainOptions): Promise<Terrain> {
  const [metaRes, decoded] = await Promise.all([fetch(opts.metaUrl), decodeTerrarium(opts.url)]);
  if (!metaRes.ok) throw new Error(`terrain: ${opts.metaUrl} -> HTTP ${metaRes.status}`);
  const meta = (await metaRes.json()) as DemMeta;
  if (meta.pixels !== decoded.pixels) throw new Error('terrain: metadata does not match the heightmap size');
  const heightmap: Heightmap = { pixels: decoded.pixels, sizeM: meta.size_m, elev: decoded.elev };
  return new Terrain(meta, heightmap, {
    segments: opts.segments ?? 512,
    townLights: opts.townLights ?? true,
  });
}
