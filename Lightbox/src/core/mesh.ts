// Triangle meshes on the CPU side: loaders for binary glTF and OBJ, normalisation into the unit
// asset box, and the library that packs every mesh's BVH and triangles into the two arrays the
// shader reads (hitMesh in gpu/shaders/common.ts), with a ray traversal that mirrors it (used
// for picking and unit tests).
import type { Affine, Vec3 } from './vec';

export interface TriMesh {
  /** Vertex positions, xyz triples. */
  positions: Float32Array;
  /** Three vertex indices per triangle. */
  indices: Uint32Array;
  /** Unit vertex normals, xyz triples, or null when the source has none. */
  normals: Float32Array | null;
}

// ---------------------------------------------------------------- binary glTF

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;
const DRACO = 'KHR_draco_mesh_compression';
const MESHOPT = 'EXT_meshopt_compression';
const DRACO_MSG = 'This GLB is Draco compressed (KHR_draco_mesh_compression), which is not supported. Export it without compression.';
const MESHOPT_MSG = 'This GLB is meshopt compressed (EXT_meshopt_compression), which is not supported. Export it without compression.';

const FLOAT = 5126;
const COMPONENT_BYTES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

interface GltfAccessor { bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string; sparse?: unknown }
interface GltfBufferView { buffer?: number; byteOffset?: number; byteStride?: number; extensions?: Record<string, unknown> }
interface GltfPrimitive { attributes?: Record<string, number>; indices?: number; mode?: number; extensions?: Record<string, unknown> }
interface GltfNode { children?: number[]; mesh?: number; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }
interface Gltf {
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: GltfNode[];
  meshes?: { primitives?: GltfPrimitive[] }[];
  accessors?: GltfAccessor[];
  bufferViews?: GltfBufferView[];
  buffers?: { uri?: string }[];
  extensionsRequired?: string[];
}

function readGlb(buf: ArrayBuffer): { g: Gltf; bin: DataView | null } {
  const dv = new DataView(buf);
  if (buf.byteLength < 12 || dv.getUint32(0, true) !== GLB_MAGIC) throw new Error('Not a binary glTF (.glb) file.');
  const version = dv.getUint32(4, true);
  if (version !== 2) throw new Error(`Not a glTF 2.0 binary: this file is version ${version}.`);
  const declared = dv.getUint32(8, true);
  const end = declared >= 12 && declared <= buf.byteLength ? declared : buf.byteLength;
  let g: Gltf | null = null;
  let bin: DataView | null = null;
  let p = 12;
  while (p + 8 <= end) {
    const length = dv.getUint32(p, true);
    const type = dv.getUint32(p + 4, true);
    const start = p + 8;
    if (start + length > end) throw new Error('Not a valid GLB: a chunk runs past the end of the file.');
    if (type === CHUNK_JSON && g === null) {
      try {
        g = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, start, length))) as Gltf;
      } catch {
        throw new Error('Not a valid GLB: the JSON chunk does not parse.');
      }
    } else if (type === CHUNK_BIN && bin === null) {
      bin = new DataView(buf, start, length);
    }
    p = start + length;
  }
  if (g === null || typeof g !== 'object') throw new Error('Not a valid GLB: it has no JSON chunk.');
  return { g, bin };
}

interface AccessorView { view: DataView; offset: number; stride: number; count: number; componentType: number; type: string }

function accessorView(g: Gltf, bin: DataView | null, index: number, what: string): AccessorView {
  const acc = g.accessors?.[index];
  if (!acc) throw new Error(`GLB: ${what} refers to accessor ${index}, which does not exist.`);
  if (acc.sparse !== undefined) throw new Error('This GLB uses sparse accessors, which are not supported.');
  const bv = acc.bufferView === undefined ? undefined : g.bufferViews?.[acc.bufferView];
  if (!bv) throw new Error(`GLB: the ${what} accessor has no buffer view.`);
  if (bv.extensions?.[MESHOPT] !== undefined) throw new Error(MESHOPT_MSG);
  if ((bv.buffer ?? 0) !== 0 || g.buffers?.[0]?.uri !== undefined) {
    throw new Error('This GLB keeps its geometry in an external buffer, which is not supported. Export a single self-contained .glb.');
  }
  if (!bin) throw new Error('Not a valid GLB: it has no binary chunk.');
  const size = (COMPONENT_BYTES[acc.componentType] ?? 0) * (TYPE_COMPONENTS[acc.type] ?? 0);
  if (size === 0) throw new Error(`GLB: the ${what} accessor has an unknown type.`);
  const stride = bv.byteStride !== undefined && bv.byteStride > 0 ? bv.byteStride : size;
  const offset = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const count = acc.count;
  if (!(count >= 0) || (count > 0 && offset + stride * (count - 1) + size > bin.byteLength)) {
    throw new Error(`GLB: the ${what} accessor runs past the end of the binary chunk.`);
  }
  return { view: bin, offset, stride, count, componentType: acc.componentType, type: acc.type };
}

const IDENTITY: Affine = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

/** a after b: the affine that applies b first. */
function mulAffine(a: Affine, b: Affine): Affine {
  const o = new Array<number>(12);
  for (let r = 0; r < 3; r++) {
    const a0 = a[r * 4]!;
    const a1 = a[r * 4 + 1]!;
    const a2 = a[r * 4 + 2]!;
    for (let c = 0; c < 4; c++) o[r * 4 + c] = a0 * b[c]! + a1 * b[4 + c]! + a2 * b[8 + c]!;
    o[r * 4 + 3] = o[r * 4 + 3]! + a[r * 4 + 3]!;
  }
  return o;
}

/** A node's local transform: its column-major `matrix`, or translation * rotation * scale. */
function nodeMatrix(n: GltfNode): Affine {
  const k = n.matrix;
  if (k && k.length === 16) {
    return [k[0]!, k[4]!, k[8]!, k[12]!, k[1]!, k[5]!, k[9]!, k[13]!, k[2]!, k[6]!, k[10]!, k[14]!];
  }
  const t = n.translation ?? [];
  const q = n.rotation ?? [];
  const s = n.scale ?? [];
  const [x, y, z, w] = [q[0] ?? 0, q[1] ?? 0, q[2] ?? 0, q[3] ?? 1];
  const [sx, sy, sz] = [s[0] ?? 1, s[1] ?? 1, s[2] ?? 1];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y - z * w) * sy, 2 * (x * z + y * w) * sz, t[0] ?? 0,
    2 * (x * y + z * w) * sx, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z - x * w) * sz, t[1] ?? 0,
    2 * (x * z - y * w) * sx, 2 * (y * z + x * w) * sy, (1 - 2 * (x * x + y * y)) * sz, t[2] ?? 0,
  ];
}

function concatF32(parts: Float32Array[]): Float32Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Float32Array(n);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/**
 * Every triangle primitive of a binary glTF 2.0 file, merged into one mesh in scene space.
 * Normals are returned only when every primitive has them.
 */
export function parseGlb(buf: ArrayBuffer): TriMesh {
  const { g, bin } = readGlb(buf);
  for (const ext of g.extensionsRequired ?? []) {
    if (ext === DRACO) throw new Error(DRACO_MSG);
    if (ext === MESHOPT) throw new Error(MESHOPT_MSG);
  }
  const nodes = g.nodes ?? [];
  let roots: number[];
  const scene = g.scenes?.[g.scene ?? 0];
  if (scene) {
    roots = scene.nodes ?? [];
  } else {
    const child = new Set<number>();
    for (const n of nodes) for (const c of n.children ?? []) child.add(c);
    roots = nodes.map((_, i) => i).filter((i) => !child.has(i));
  }

  const posParts: Float32Array[] = [];
  const nrmParts: Float32Array[] = [];
  const idxParts: Uint32Array[] = [];
  let vertexBase = 0;
  let indexCount = 0;
  let allNormals = true;

  const addPrimitive = (prim: GltfPrimitive, m: Affine): void => {
    if ((prim.mode ?? 4) !== 4) return;
    if (prim.extensions?.[DRACO] !== undefined) throw new Error(DRACO_MSG);
    const posIndex = prim.attributes?.POSITION;
    if (posIndex === undefined) return;
    const pa = accessorView(g, bin, posIndex, 'POSITION');
    if (pa.componentType !== FLOAT || pa.type !== 'VEC3') {
      throw new Error('GLB: POSITION must be float32 VEC3 (quantized meshes are not supported).');
    }
    const nv = pa.count;

    // The linear part's determinant and cofactors: normals go through the inverse transpose,
    // and a mirroring transform reverses the winding.
    const [a, b, c, , d, e, f, , gg, h, i] = m as [number, number, number, number, number, number, number, number, number, number, number, number];
    const c0 = e * i - f * h;
    const c1 = f * gg - d * i;
    const c2 = d * h - e * gg;
    const det = a * c0 + b * c1 + c * c2;
    const flip = det < 0;

    let idx: Uint32Array;
    if (prim.indices !== undefined) {
      const ia = accessorView(g, bin, prim.indices, 'index');
      const ct = ia.componentType;
      if (ia.type !== 'SCALAR' || (ct !== 5121 && ct !== 5123 && ct !== 5125)) {
        throw new Error('GLB: triangle indices must be uint8, uint16 or uint32.');
      }
      const n = ia.count - (ia.count % 3);
      idx = new Uint32Array(n);
      for (let k = 0; k < n; k++) {
        const at = ia.offset + k * ia.stride;
        const v = ct === 5121 ? ia.view.getUint8(at) : ct === 5123 ? ia.view.getUint16(at, true) : ia.view.getUint32(at, true);
        if (v >= nv) throw new Error('GLB: a triangle index is out of range.');
        idx[k] = v + vertexBase;
      }
    } else {
      const n = nv - (nv % 3);
      idx = new Uint32Array(n);
      for (let k = 0; k < n; k++) idx[k] = k + vertexBase;
    }
    if (idx.length === 0) return;
    if (flip) {
      for (let k = 0; k < idx.length; k += 3) {
        const t = idx[k + 1]!;
        idx[k + 1] = idx[k + 2]!;
        idx[k + 2] = t;
      }
    }

    const pos = new Float32Array(nv * 3);
    for (let k = 0; k < nv; k++) {
      const at = pa.offset + k * pa.stride;
      const x = pa.view.getFloat32(at, true);
      const y = pa.view.getFloat32(at + 4, true);
      const z = pa.view.getFloat32(at + 8, true);
      pos[k * 3] = m[0]! * x + m[1]! * y + m[2]! * z + m[3]!;
      pos[k * 3 + 1] = m[4]! * x + m[5]! * y + m[6]! * z + m[7]!;
      pos[k * 3 + 2] = m[8]! * x + m[9]! * y + m[10]! * z + m[11]!;
    }

    let nrm: Float32Array | null = null;
    const nrmIndex = prim.attributes?.NORMAL;
    if (nrmIndex !== undefined) {
      const na = accessorView(g, bin, nrmIndex, 'NORMAL');
      if (na.componentType === FLOAT && na.type === 'VEC3' && na.count >= nv) {
        // Cofactor matrix = det * inverse transpose; the sign of det restores the direction.
        const s = flip ? -1 : 1;
        const n00 = c0 * s, n01 = c1 * s, n02 = c2 * s;
        const n10 = (c * h - b * i) * s, n11 = (a * i - c * gg) * s, n12 = (b * gg - a * h) * s;
        const n20 = (b * f - c * e) * s, n21 = (c * d - a * f) * s, n22 = (a * e - b * d) * s;
        nrm = new Float32Array(nv * 3);
        for (let k = 0; k < nv; k++) {
          const at = na.offset + k * na.stride;
          const x = na.view.getFloat32(at, true);
          const y = na.view.getFloat32(at + 4, true);
          const z = na.view.getFloat32(at + 8, true);
          const X = n00 * x + n01 * y + n02 * z;
          const Y = n10 * x + n11 * y + n12 * z;
          const Z = n20 * x + n21 * y + n22 * z;
          const l = Math.hypot(X, Y, Z);
          if (l > 0 && Number.isFinite(l)) {
            nrm[k * 3] = X / l;
            nrm[k * 3 + 1] = Y / l;
            nrm[k * 3 + 2] = Z / l;
          }
        }
      }
    }

    posParts.push(pos);
    idxParts.push(idx);
    if (nrm) nrmParts.push(nrm); else allNormals = false;
    vertexBase += nv;
    indexCount += idx.length;
  };

  const onPath = new Set<number>();
  const visit = (index: number, parent: Affine): void => {
    const node = nodes[index];
    if (!node) return;
    if (onPath.has(index)) throw new Error('Not a valid GLB: the node hierarchy contains a cycle.');
    onPath.add(index);
    const world = mulAffine(parent, nodeMatrix(node));
    const mesh = node.mesh === undefined ? undefined : g.meshes?.[node.mesh];
    for (const prim of mesh?.primitives ?? []) addPrimitive(prim, world);
    for (const c of node.children ?? []) visit(c, world);
    onPath.delete(index);
  };
  for (const r of roots) visit(r, IDENTITY);

  if (indexCount === 0) throw new Error('This GLB contains no triangles.');
  const indices = new Uint32Array(indexCount);
  let at = 0;
  for (const p of idxParts) { indices.set(p, at); at += p.length; }
  return { positions: concatF32(posParts), indices, normals: allNormals ? concatF32(nrmParts) : null };
}

// ---------------------------------------------------------------- OBJ

/** The `v` and `f` records of a Wavefront OBJ; polygons are fan-triangulated, `vn` is ignored. */
export function parseObj(text: string): TriMesh {
  const pos: number[] = [];
  const idx: number[] = [];
  const face: number[] = [];
  for (const raw of text.split('\n')) {
    const hash = raw.indexOf('#');
    const line = (hash >= 0 ? raw.slice(0, hash) : raw).trim();
    if (line.length < 3) continue;
    const c0 = line.charCodeAt(0);
    const c1 = line.charCodeAt(1);
    if (c1 !== 32 && c1 !== 9) continue;
    if (c0 === 118) { // v
      const p = line.split(/\s+/);
      const x = Number(p[1]);
      const y = Number(p[2]);
      const z = Number(p[3]);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) throw new Error(`OBJ: bad vertex "${line}".`);
      pos.push(x, y, z);
    } else if (c0 === 102) { // f
      const p = line.split(/\s+/);
      const nv = pos.length / 3;
      face.length = 0;
      for (let k = 1; k < p.length; k++) {
        const i = parseInt(p[k]!, 10); // stops at the first slash
        if (!Number.isFinite(i) || i === 0) throw new Error(`OBJ: bad face "${line}".`);
        face.push(i < 0 ? nv + i : i - 1);
      }
      for (let k = 2; k < face.length; k++) idx.push(face[0]!, face[k - 1]!, face[k]!);
    }
  }
  if (idx.length === 0) throw new Error('This OBJ contains no faces.');
  const nv = pos.length / 3;
  for (const i of idx) if (i < 0 || i >= nv) throw new Error('OBJ: a face refers to a vertex that does not exist.');
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx), normals: null };
}

// ---------------------------------------------------------------- preparation

/**
 * Area-weighted vertex normals. Vertices whose positions are bit-identical share one normal, so
 * a mesh without shared indices still shades smoothly. A vertex whose faces cancel gets zero.
 */
function vertexNormals(P: Float32Array, I: Uint32Array): Float32Array {
  const nv = P.length / 3;
  const bits = new Uint32Array(P.buffer, P.byteOffset, P.length);
  let size = 16;
  while (size < nv * 2) size *= 2;
  const mask = size - 1;
  const table = new Int32Array(size).fill(-1);
  const weld = new Uint32Array(nv);
  for (let v = 0; v < nv; v++) {
    const a = bits[v * 3]!;
    const b = bits[v * 3 + 1]!;
    const c = bits[v * 3 + 2]!;
    let h = Math.imul(a, 0x9e3779b1) ^ Math.imul(b, 0x85ebca6b) ^ Math.imul(c, 0xc2b2ae35);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12;
    h &= mask;
    for (;;) {
      const e = table[h]!;
      if (e < 0) { table[h] = v; weld[v] = v; break; }
      if (bits[e * 3] === a && bits[e * 3 + 1] === b && bits[e * 3 + 2] === c) { weld[v] = e; break; }
      h = (h + 1) & mask;
    }
  }
  const acc = new Float64Array(nv * 3);
  for (let t = 0; t + 2 < I.length; t += 3) {
    const a = I[t]! * 3;
    const b = I[t + 1]! * 3;
    const c = I[t + 2]! * 3;
    const e1x = P[b]! - P[a]!, e1y = P[b + 1]! - P[a + 1]!, e1z = P[b + 2]! - P[a + 2]!;
    const e2x = P[c]! - P[a]!, e2y = P[c + 1]! - P[a + 1]!, e2z = P[c + 2]! - P[a + 2]!;
    // The cross product's length is twice the area, which is the weight.
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    for (const v of [a, b, c]) {
      const w = weld[v / 3]! * 3;
      acc[w] = acc[w]! + nx;
      acc[w + 1] = acc[w + 1]! + ny;
      acc[w + 2] = acc[w + 2]! + nz;
    }
  }
  const N = new Float32Array(nv * 3);
  for (let v = 0; v < nv; v++) {
    const w = weld[v]! * 3;
    const l = Math.hypot(acc[w]!, acc[w + 1]!, acc[w + 2]!);
    if (l > 0) {
      N[v * 3] = acc[w]! / l;
      N[v * 3 + 1] = acc[w + 1]! / l;
      N[v * 3 + 2] = acc[w + 2]! / l;
    }
  }
  return N;
}

/**
 * A new mesh ready for the library: degenerate triangles and unused vertices dropped; scaled
 * uniformly and moved so the bounding box's largest dimension is 1, x and z are centred on 0
 * and the lowest point is y = 0; vertex normals computed if the source had none.
 */
export function prepareMesh(mesh: TriMesh, maxTris = 300000): TriMesh {
  const P = mesh.positions;
  const I = mesh.indices;
  const nv = Math.floor(P.length / 3);
  const nt = Math.floor(I.length / 3);

  // Triangles with area in source coordinates, and the bounds of the vertices they use.
  const keep = new Uint8Array(nt);
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  let kept = 0;
  for (let t = 0; t < nt; t++) {
    const ia = I[t * 3]!;
    const ib = I[t * 3 + 1]!;
    const ic = I[t * 3 + 2]!;
    if (ia === ib || ib === ic || ia === ic || ia >= nv || ib >= nv || ic >= nv) continue;
    const a = ia * 3, b = ib * 3, c = ic * 3;
    const e1x = P[b]! - P[a]!, e1y = P[b + 1]! - P[a + 1]!, e1z = P[b + 2]! - P[a + 2]!;
    const e2x = P[c]! - P[a]!, e2y = P[c + 1]! - P[a + 1]!, e2z = P[c + 2]! - P[a + 2]!;
    const area = Math.hypot(e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x);
    if (!(area > 0) || !Number.isFinite(area)) continue;
    keep[t] = 1;
    kept++;
    for (const v of [a, b, c]) {
      for (let k = 0; k < 3; k++) {
        const x = P[v + k]!;
        if (x < lo[k]!) lo[k] = x;
        if (x > hi[k]!) hi[k] = x;
      }
    }
  }
  if (kept === 0) throw new Error('The mesh has no triangles with any area.');

  const dim = Math.max(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!);
  const origin = [(lo[0]! + hi[0]!) / 2, lo[1]!, (lo[2]! + hi[2]!) / 2];
  const Q = new Float32Array(nv * 3);
  // Adding 0 turns -0 into +0, so welding by bit pattern treats them as the same place.
  for (let i = 0; i < nv * 3; i++) Q[i] = Math.fround((P[i]! - origin[i % 3]!) / dim) + 0;

  // A triangle can lose its area to float32 rounding once scaled; drop those too, as stored.
  const remap = new Int32Array(nv).fill(-1);
  let used = 0;
  kept = 0;
  for (let t = 0; t < nt; t++) {
    if (keep[t] === 0) continue;
    const a = I[t * 3]! * 3, b = I[t * 3 + 1]! * 3, c = I[t * 3 + 2]! * 3;
    const e1x = Math.fround(Q[b]! - Q[a]!), e1y = Math.fround(Q[b + 1]! - Q[a + 1]!), e1z = Math.fround(Q[b + 2]! - Q[a + 2]!);
    const e2x = Math.fround(Q[c]! - Q[a]!), e2y = Math.fround(Q[c + 1]! - Q[a + 1]!), e2z = Math.fround(Q[c + 2]! - Q[a + 2]!);
    const area = Math.hypot(e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x);
    if (!(area > 0)) { keep[t] = 0; continue; }
    kept++;
    remap[a / 3] = 0;
    remap[b / 3] = 0;
    remap[c / 3] = 0;
  }
  if (kept === 0) throw new Error('The mesh has no triangles with any area.');
  if (kept > maxTris) throw new Error(`The mesh has ${kept} triangles; the limit is ${maxTris}.`);
  // Surviving vertices keep their order.
  for (let v = 0; v < nv; v++) if (remap[v] === 0) remap[v] = used++;

  const positions = new Float32Array(used * 3);
  const indices = new Uint32Array(kept * 3);
  const src = mesh.normals && mesh.normals.length >= nv * 3 ? mesh.normals : null;
  let normals: Float32Array | null = src ? new Float32Array(used * 3) : null;
  for (let v = 0; v < nv; v++) {
    const r = remap[v]!;
    if (r < 0) continue;
    positions[r * 3] = Q[v * 3]!;
    positions[r * 3 + 1] = Q[v * 3 + 1]!;
    positions[r * 3 + 2] = Q[v * 3 + 2]!;
    if (src && normals) {
      const l = Math.hypot(src[v * 3]!, src[v * 3 + 1]!, src[v * 3 + 2]!);
      if (l > 0 && Number.isFinite(l)) {
        normals[r * 3] = src[v * 3]! / l;
        normals[r * 3 + 1] = src[v * 3 + 1]! / l;
        normals[r * 3 + 2] = src[v * 3 + 2]! / l;
      }
    }
  }
  let w = 0;
  for (let t = 0; t < nt; t++) {
    if (keep[t] === 0) continue;
    indices[w++] = remap[I[t * 3]!]!;
    indices[w++] = remap[I[t * 3 + 1]!]!;
    indices[w++] = remap[I[t * 3 + 2]!]!;
  }
  normals ??= vertexNormals(positions, indices);
  return { positions, indices, normals };
}

// ---------------------------------------------------------------- library and BVH

const NODE_FLOATS = 8;
const TRI_FLOATS = 24;
/** Most triangles a leaf holds, unless the depth limit forces more. */
const LEAF_MAX = 4;
/** Deepest node allowed (the root is depth 0). The shader's stack holds 32 entries. */
const MAX_DEPTH = 30;
const STACK_SIZE = 32;
const BINS = 16;
/** Indices are stored as float32, which is exact below 2^24. */
const MAX_INDEX = 16777216;
/** Leaf boxes grow by this fraction of their extent plus an absolute margin, per axis. */
const PAD_REL = 1e-5;
const PAD_ABS = 1e-6;

const F32 = new Float32Array(1);
const I32 = new Int32Array(F32.buffer);
/** The largest float32 that is not above x. */
function f32Down(x: number): number {
  F32[0] = x;
  const f = F32[0]!;
  if (f > x) {
    if (f === 0) I32[0] = -2147483647; // the smallest negative float
    else I32[0] = I32[0]! + (f > 0 ? -1 : 1);
  }
  return F32[0]!;
}
const f32Up = (x: number): number => -f32Down(-x);

function buildBvh(mesh: TriMesh, nodeBase: number, triBase: number): { nodes: Float32Array; tris: Float32Array } {
  const P = mesh.positions;
  const I = mesh.indices;
  const N = mesh.normals && mesh.normals.length >= P.length ? mesh.normals : null;
  const nv = Math.floor(P.length / 3);
  const n = Math.floor(I.length / 3);

  // Triangle records in source order, with the bounds and centre of each as the shader will
  // see it: v0, v0 + e1 and v0 + e2 with float32 edges.
  const src = new Float32Array(n * TRI_FLOATS);
  const tb = new Float64Array(n * 6);
  const cen = new Float64Array(n * 3);
  for (let t = 0; t < n; t++) {
    const ia = I[t * 3]!;
    const ib = I[t * 3 + 1]!;
    const ic = I[t * 3 + 2]!;
    if (ia >= nv || ib >= nv || ic >= nv) throw new Error('The mesh has a triangle index that is out of range.');
    const o = t * TRI_FLOATS;
    let finite = true;
    for (let k = 0; k < 3; k++) {
      const v0 = P[ia * 3 + k]!;
      const e1 = Math.fround(P[ib * 3 + k]! - v0);
      const e2 = Math.fround(P[ic * 3 + k]! - v0);
      if (!Number.isFinite(v0) || !Number.isFinite(e1) || !Number.isFinite(e2)) finite = false;
      src[o + k] = v0;
      src[o + 4 + k] = e1;
      src[o + 8 + k] = e2;
      const mn = Math.min(v0, v0 + e1, v0 + e2);
      const mx = Math.max(v0, v0 + e1, v0 + e2);
      tb[t * 6 + k] = mn;
      tb[t * 6 + 3 + k] = mx;
      cen[t * 3 + k] = 0.5 * (mn + mx);
    }
    if (!finite) throw new Error('The mesh has a vertex that is not a finite number.');
    // Vertex normals; a missing or zero one falls back to the face normal so the shader never
    // normalises a zero vector.
    const e1x = src[o + 4]!, e1y = src[o + 5]!, e1z = src[o + 6]!;
    const e2x = src[o + 8]!, e2y = src[o + 9]!, e2z = src[o + 10]!;
    let gx = e1y * e2z - e1z * e2y;
    let gy = e1z * e2x - e1x * e2z;
    let gz = e1x * e2y - e1y * e2x;
    const gl = Math.hypot(gx, gy, gz);
    if (gl > 0) { gx /= gl; gy /= gl; gz /= gl; } else { gx = 0; gy = 1; gz = 0; }
    const corners = [ia, ib, ic];
    for (let c = 0; c < 3; c++) {
      const v = corners[c]! * 3;
      const at = o + 12 + c * 4;
      const nx = N ? N[v]! : 0;
      const ny = N ? N[v + 1]! : 0;
      const nz = N ? N[v + 2]! : 0;
      const l = Math.hypot(nx, ny, nz);
      if (l > 1e-12 && Number.isFinite(l)) {
        src[at] = nx;
        src[at + 1] = ny;
        src[at + 2] = nz;
      } else {
        src[at] = gx;
        src[at + 1] = gy;
        src[at + 2] = gz;
      }
    }
  }

  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  // A full binary tree over at most n leaves.
  const nodes = new Float32Array((2 * n - 1) * NODE_FLOATS);
  let nodeCount = 0;

  const binCount = new Uint32Array(3 * BINS);
  const binLo = new Float64Array(3 * BINS * 3);
  const binHi = new Float64Array(3 * BINS * 3);
  const rightArea = new Float64Array(BINS);
  const rightCount = new Uint32Array(BINS);
  const cLo = new Float64Array(3);
  const cExt = new Float64Array(3);
  const cScale = new Float64Array(3);

  /** Reorders order[start, end) into two non-empty halves and returns where the second begins. */
  const split = (start: number, end: number, depth: number): number => {
    for (let a = 0; a < 3; a++) {
      let mn = Infinity;
      let mx = -Infinity;
      for (let i = start; i < end; i++) {
        const x = cen[order[i]! * 3 + a]!;
        if (x < mn) mn = x;
        if (x > mx) mx = x;
      }
      const usable = mx > mn && Number.isFinite(BINS / (mx - mn));
      cLo[a] = mn;
      cExt[a] = usable ? mx - mn : 0;
      cScale[a] = usable ? BINS / (mx - mn) : 0;
    }
    // A child at depth + 1 can still hold this many triangles in leaves of LEAF_MAX within the
    // depth limit. Splits that overfill a child are not considered, so the limit never has to
    // produce an oversized leaf; the median split always fits.
    const cap = LEAF_MAX * 2 ** (MAX_DEPTH - depth - 1);

    binCount.fill(0);
    binLo.fill(Infinity);
    binHi.fill(-Infinity);
    for (let i = start; i < end; i++) {
      const t = order[i]!;
      for (let a = 0; a < 3; a++) {
        if (cExt[a] === 0) continue;
        const b = a * BINS + Math.min(BINS - 1, Math.floor((cen[t * 3 + a]! - cLo[a]!) * cScale[a]!));
        binCount[b] = binCount[b]! + 1;
        for (let k = 0; k < 3; k++) {
          const mn = tb[t * 6 + k]!;
          const mx = tb[t * 6 + 3 + k]!;
          if (mn < binLo[b * 3 + k]!) binLo[b * 3 + k] = mn;
          if (mx > binHi[b * 3 + k]!) binHi[b * 3 + k] = mx;
        }
      }
    }

    let bestCost = Infinity;
    let bestAxis = -1;
    let bestSplit = 0;
    for (let a = 0; a < 3; a++) {
      if (cExt[a] === 0) continue;
      let lx = Infinity, ly = Infinity, lz = Infinity, hx = -Infinity, hy = -Infinity, hz = -Infinity;
      let cnt = 0;
      for (let s = BINS - 1; s >= 1; s--) {
        const b = (a * BINS + s) * 3;
        lx = Math.min(lx, binLo[b]!); ly = Math.min(ly, binLo[b + 1]!); lz = Math.min(lz, binLo[b + 2]!);
        hx = Math.max(hx, binHi[b]!); hy = Math.max(hy, binHi[b + 1]!); hz = Math.max(hz, binHi[b + 2]!);
        cnt += binCount[a * BINS + s]!;
        rightCount[s] = cnt;
        rightArea[s] = cnt > 0 ? (hx - lx) * (hy - ly) + (hy - ly) * (hz - lz) + (hz - lz) * (hx - lx) : 0;
      }
      lx = Infinity; ly = Infinity; lz = Infinity; hx = -Infinity; hy = -Infinity; hz = -Infinity;
      cnt = 0;
      for (let s = 1; s < BINS; s++) {
        const b = (a * BINS + s - 1) * 3;
        lx = Math.min(lx, binLo[b]!); ly = Math.min(ly, binLo[b + 1]!); lz = Math.min(lz, binLo[b + 2]!);
        hx = Math.max(hx, binHi[b]!); hy = Math.max(hy, binHi[b + 1]!); hz = Math.max(hz, binHi[b + 2]!);
        cnt += binCount[a * BINS + s - 1]!;
        const right = rightCount[s]!;
        if (cnt === 0 || right === 0 || cnt > cap || right > cap) continue;
        const cost = ((hx - lx) * (hy - ly) + (hy - ly) * (hz - lz) + (hz - lz) * (hx - lx)) * cnt + rightArea[s]! * right;
        if (cost < bestCost) { bestCost = cost; bestAxis = a; bestSplit = s; }
      }
    }

    if (bestAxis >= 0) {
      const mn = cLo[bestAxis]!;
      const sc = cScale[bestAxis]!;
      let i = start;
      let j = end - 1;
      while (i <= j) {
        const t = order[i]!;
        if (Math.min(BINS - 1, Math.floor((cen[t * 3 + bestAxis]! - mn) * sc)) < bestSplit) i++;
        else { order[i] = order[j]!; order[j] = t; j--; }
      }
      return i;
    }
    // No bin boundary separates the centroids usefully (they coincide, or every split is too
    // lopsided for the depth left): halve the set, along the longest axis if there is one.
    let axis = 0;
    if (cExt[1]! > cExt[axis]!) axis = 1;
    if (cExt[2]! > cExt[axis]!) axis = 2;
    if (cExt[axis]! > 0) order.subarray(start, end).sort((p, q) => cen[p * 3 + axis]! - cen[q * 3 + axis]!);
    return start + ((end - start) >> 1);
  };

  const build = (start: number, end: number, depth: number): number => {
    const index = nodeCount++;
    const o = index * NODE_FLOATS;
    const count = end - start;
    if (count <= LEAF_MAX || depth >= MAX_DEPTH) {
      for (let k = 0; k < 3; k++) {
        let mn = Infinity;
        let mx = -Infinity;
        for (let i = start; i < end; i++) {
          const t = order[i]! * 6;
          if (tb[t + k]! < mn) mn = tb[t + k]!;
          if (tb[t + 3 + k]! > mx) mx = tb[t + 3 + k]!;
        }
        const pad = PAD_REL * (mx - mn) + PAD_ABS;
        nodes[o + k] = f32Down(mn - pad);
        nodes[o + 4 + k] = f32Up(mx + pad);
      }
      nodes[o + 3] = triBase + start;
      nodes[o + 7] = count;
      return index;
    }
    const mid = split(start, end, depth);
    const left = build(start, mid, depth + 1) * NODE_FLOATS;
    const rightIndex = build(mid, end, depth + 1);
    const right = rightIndex * NODE_FLOATS;
    // The children's boxes are already float32, so their union is exact.
    for (let k = 0; k < 3; k++) {
      nodes[o + k] = Math.min(nodes[left + k]!, nodes[right + k]!);
      nodes[o + 4 + k] = Math.max(nodes[left + 4 + k]!, nodes[right + 4 + k]!);
    }
    nodes[o + 3] = nodeBase + rightIndex;
    nodes[o + 7] = 0;
    return index;
  };
  build(0, n, 0);

  const tris = new Float32Array(n * TRI_FLOATS);
  for (let i = 0; i < n; i++) {
    const s = order[i]! * TRI_FLOATS;
    tris.set(src.subarray(s, s + TRI_FLOATS), i * TRI_FLOATS);
  }
  return { nodes: nodes.slice(0, nodeCount * NODE_FLOATS), tris };
}

function append(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

/**
 * Any number of named meshes in the two arrays the shader reads.
 *
 * `nodes`: 8 floats per BVH node, (bounds min xyz, w) then (bounds max xyz, count). A leaf has
 * count > 0 and w = the index of its first triangle; an inner node has count 0, its left child
 * is the next node and w = the index of its right child. Nodes are in depth-first order.
 *
 * `tris`: 24 floats per triangle: v0, e1 = v1 - v0, e2 = v2 - v0, then the vertex normals n0,
 * n1, n2, each padded to four floats with 0.
 *
 * Every index is absolute within the library, so one pair of textures serves all meshes.
 */
export class MeshLibrary {
  nodes: Float32Array = new Float32Array(0);
  tris: Float32Array = new Float32Array(0);
  /** Goes up whenever the arrays change. */
  version = 0;
  private readonly entries = new Map<string, { root: number; tris: number }>();
  private readonly stack = new Int32Array(STACK_SIZE);

  /** Adds a prepared mesh (see prepareMesh) under a new name. */
  add(name: string, mesh: TriMesh): void {
    if (this.entries.has(name)) throw new Error(`A mesh named "${name}" is already in the library.`);
    const n = Math.floor(mesh.indices.length / 3);
    if (n === 0) throw new Error(`Mesh "${name}" has no triangles.`);
    const nodeBase = this.nodes.length / NODE_FLOATS;
    const triBase = this.tris.length / TRI_FLOATS;
    if (triBase + n > MAX_INDEX) throw new Error('The mesh library is full.');
    const built = buildBvh(mesh, nodeBase, triBase);
    if (nodeBase + built.nodes.length / NODE_FLOATS > MAX_INDEX) throw new Error('The mesh library is full.');
    this.nodes = append(this.nodes, built.nodes);
    this.tris = append(this.tris, built.tris);
    this.entries.set(name, { root: nodeBase, tris: n });
    this.version++;
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  /** Where a mesh's BVH root is in `nodes`, and how many triangles it has. */
  lookup(name: string): { root: number; tris: number } | null {
    const e = this.entries.get(name);
    return e ? { root: e.root, tris: e.tris } : null;
  }

  /**
   * Nearest hit with t > tmin of the mesh whose BVH starts at node `root`, by the shader's
   * traversal. `n` is the geometric normal cross(e1, e2), not normalised.
   */
  hit(root: number, o: Vec3, d: Vec3, tmin: number): { t: number; n: Vec3 } | null {
    const nodes = this.nodes;
    const tris = this.tris;
    const stack = this.stack;
    if (!(root >= 0) || (root + 1) * NODE_FLOATS > nodes.length) return null;
    const [ox, oy, oz] = o;
    const [dx, dy, dz] = d;
    let sp = 0;
    let node = root;
    let bt = Infinity;
    let best = -1;
    for (;;) {
      const a = node * NODE_FLOATS;
      // Slab test. An axis the ray does not move along only has to contain the origin (the
      // shader's 1/d form gives the same answer except exactly on a box face).
      let t0 = tmin;
      let t1 = bt;
      let inside = true;
      for (let k = 0; k < 3; k++) {
        const ok = o[k]!;
        const dk = d[k]!;
        const mn = nodes[a + k]!;
        const mx = nodes[a + 4 + k]!;
        if (dk === 0) {
          if (ok < mn || ok > mx) { inside = false; break; }
          continue;
        }
        const ta = (mn - ok) / dk;
        const tb = (mx - ok) / dk;
        if (ta < tb) {
          if (ta > t0) t0 = ta;
          if (tb < t1) t1 = tb;
        } else {
          if (tb > t0) t0 = tb;
          if (ta < t1) t1 = ta;
        }
      }
      let descend = false;
      if (inside && t0 <= t1) {
        const count = nodes[a + 7]!;
        if (count > 0) {
          const first = nodes[a + 3]!;
          for (let k = 0; k < count; k++) {
            const ti = (first + k) * TRI_FLOATS;
            const e1x = tris[ti + 4]!, e1y = tris[ti + 5]!, e1z = tris[ti + 6]!;
            const e2x = tris[ti + 8]!, e2y = tris[ti + 9]!, e2z = tris[ti + 10]!;
            const pvx = dy * e2z - dz * e2y;
            const pvy = dz * e2x - dx * e2z;
            const pvz = dx * e2y - dy * e2x;
            const det = e1x * pvx + e1y * pvy + e1z * pvz;
            if (Math.abs(det) < 1e-20) continue;
            const idet = 1 / det;
            const tvx = ox - tris[ti]!;
            const tvy = oy - tris[ti + 1]!;
            const tvz = oz - tris[ti + 2]!;
            const u = (tvx * pvx + tvy * pvy + tvz * pvz) * idet;
            if (u < 0 || u > 1) continue;
            const qvx = tvy * e1z - tvz * e1y;
            const qvy = tvz * e1x - tvx * e1z;
            const qvz = tvx * e1y - tvy * e1x;
            const v = (dx * qvx + dy * qvy + dz * qvz) * idet;
            if (v < 0 || u + v > 1) continue;
            const t = (e2x * qvx + e2y * qvy + e2z * qvz) * idet;
            if (t > tmin && t < bt) { bt = t; best = first + k; }
          }
        } else {
          // Inner node: visit the left child next and remember the right one.
          if (sp < STACK_SIZE) stack[sp++] = nodes[a + 3]!;
          node = node + 1;
          descend = true;
        }
      }
      if (!descend) {
        if (sp === 0) break;
        node = stack[--sp]!;
      }
    }
    if (best < 0) return null;
    const ti = best * TRI_FLOATS;
    const e1x = tris[ti + 4]!, e1y = tris[ti + 5]!, e1z = tris[ti + 6]!;
    const e2x = tris[ti + 8]!, e2y = tris[ti + 9]!, e2z = tris[ti + 10]!;
    return { t: bt, n: [e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x] };
  }
}
