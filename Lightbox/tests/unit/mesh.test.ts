import { describe, expect, it } from 'vitest';
import { MeshLibrary, type TriMesh, parseGlb, parseObj, prepareMesh } from '../../src/core/mesh';
import type { Vec3 } from '../../src/core/vec';

// ---------------------------------------------------------------- GLB assembly

const U8 = 5121;
const U16 = 5123;
const U32 = 5125;
const F32 = 5126;

interface Prim { attributes: Record<string, number>; indices?: number; mode?: number; extensions?: Record<string, unknown> }
interface Doc {
  asset: { version: string };
  scene?: number;
  scenes?: { nodes: number[] }[];
  nodes: Record<string, unknown>[];
  meshes: { primitives: Prim[] }[];
  buffers: { byteLength: number; uri?: string }[];
  bufferViews: { buffer: number; byteOffset: number; byteLength: number; byteStride?: number; extensions?: Record<string, unknown> }[];
  accessors: { bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string; sparse?: unknown }[];
  extensionsRequired?: string[];
}

const bytesOf = (a: Float32Array | Uint8Array | Uint16Array | Uint32Array): Uint8Array => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

/** A GLB container around a JSON document and a binary chunk. */
function makeGlb(doc: unknown, bin: Uint8Array): ArrayBuffer {
  const json = new TextEncoder().encode(JSON.stringify(doc));
  const jsonLen = (json.length + 3) & ~3;
  const binLen = (bin.length + 3) & ~3;
  const total = 12 + 8 + jsonLen + (bin.length > 0 ? 8 + binLen : 0);
  const out = new ArrayBuffer(total);
  const dv = new DataView(out);
  const u8 = new Uint8Array(out);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLen, true);
  dv.setUint32(16, 0x4e4f534a, true);
  u8.fill(0x20, 20, 20 + jsonLen);
  u8.set(json, 20);
  if (bin.length > 0) {
    dv.setUint32(20 + jsonLen, binLen, true);
    dv.setUint32(24 + jsonLen, 0x004e4942, true);
    u8.set(bin, 28 + jsonLen);
  }
  return out;
}

/** Assembles a small glTF document and its buffer piece by piece. */
class GlbBuilder {
  doc: Doc = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], buffers: [{ byteLength: 0 }], bufferViews: [], accessors: [] };
  private readonly bytes: number[] = [];

  view(data: Uint8Array, byteStride?: number): number {
    while (this.bytes.length % 4 !== 0) this.bytes.push(0);
    const byteOffset = this.bytes.length;
    for (const b of data) this.bytes.push(b);
    this.doc.bufferViews.push({ buffer: 0, byteOffset, byteLength: data.length, ...(byteStride ? { byteStride } : {}) });
    return this.doc.bufferViews.length - 1;
  }

  accessor(bufferView: number, componentType: number, count: number, type: string, byteOffset = 0): number {
    this.doc.accessors.push({ bufferView, byteOffset, componentType, count, type });
    return this.doc.accessors.length - 1;
  }

  vec3(values: number[]): number {
    return this.accessor(this.view(bytesOf(new Float32Array(values))), F32, values.length / 3, 'VEC3');
  }

  index(values: number[], componentType: number): number {
    const data = componentType === U8 ? new Uint8Array(values) : componentType === U16 ? new Uint16Array(values) : new Uint32Array(values);
    return this.accessor(this.view(bytesOf(data)), componentType, values.length, 'SCALAR');
  }

  primitive(positions: number[], opts: { indices?: number[]; indexType?: number; normals?: number[]; mode?: number } = {}): Prim {
    const prim: Prim = { attributes: { POSITION: this.vec3(positions) } };
    if (opts.normals) prim.attributes.NORMAL = this.vec3(opts.normals);
    if (opts.indices) prim.indices = this.index(opts.indices, opts.indexType ?? U16);
    if (opts.mode !== undefined) prim.mode = opts.mode;
    return prim;
  }

  mesh(...primitives: Prim[]): number {
    this.doc.meshes.push({ primitives });
    return this.doc.meshes.length - 1;
  }

  node(node: Record<string, unknown>, root = true): number {
    this.doc.nodes.push(node);
    const index = this.doc.nodes.length - 1;
    if (root) this.doc.scenes?.[0]?.nodes.push(index);
    return index;
  }

  build(): ArrayBuffer {
    this.doc.buffers[0]!.byteLength = this.bytes.length;
    return makeGlb(this.doc, new Uint8Array(this.bytes));
  }
}

const QUAD = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0];
const TRI = [0, 0, 0, 1, 0, 0, 0, 1, 0];

function expectClose(actual: ArrayLike<number>, expected: number[], eps = 1e-6): void {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i++) expect(Math.abs(actual[i]! - expected[i]!)).toBeLessThan(eps);
}

describe('parseGlb', () => {
  it('applies a node translation and non-uniform scale, with uint16 indices and inverse-transpose normals', () => {
    const s = Math.SQRT1_2;
    const b = new GlbBuilder();
    const prim = b.primitive(QUAD, { indices: [0, 1, 2, 0, 2, 3], indexType: U16, normals: [s, s, 0, s, s, 0, s, s, 0, s, s, 0] });
    b.node({ mesh: b.mesh(prim), translation: [1, 2, 3], scale: [2, 3, 4] });
    expect(b.doc.accessors[prim.indices!]!.componentType).toBe(U16);
    const m = parseGlb(b.build());
    expect(Array.from(m.positions)).toEqual([1, 2, 3, 3, 2, 3, 3, 5, 3, 1, 5, 3]);
    expect(Array.from(m.indices)).toEqual([0, 1, 2, 0, 2, 3]);
    // (1, 1, 0) through diag(1/2, 1/3, 1/4), renormalised.
    const l = Math.hypot(1 / 2, 1 / 3);
    expectClose(m.normals!, [0, 1, 2, 3].flatMap(() => [0.5 / l, 1 / 3 / l, 0]));
  });

  it('walks the node hierarchy: a parent rotation over a child matrix', () => {
    const b = new GlbBuilder();
    const mesh = b.mesh(b.primitive([0, 0, 0, 0, 0, 1, 0, 1, 0], { indices: [0, 1, 2], normals: [1, 0, 0, 1, 0, 0, 1, 0, 0] }));
    const child = b.node({ mesh, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1] }, false);
    b.node({ rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2], children: [child] });
    const m = parseGlb(b.build());
    // Shift by +x, then a quarter turn about y: (x, y, z) -> (z, y, -x).
    expectClose(m.positions, [0, 0, -1, 1, 0, -1, 0, 1, -1]);
    expectClose(m.normals!, [0, 0, -1, 0, 0, -1, 0, 0, -1]);
  });

  it('reverses the winding under a mirroring transform so the face normal still follows the geometry', () => {
    const b = new GlbBuilder();
    b.node({ mesh: b.mesh(b.primitive(TRI, { indices: [0, 1, 2], normals: [0.6, 0, 0.8, 0.6, 0, 0.8, 0.6, 0, 0.8] })), scale: [-1, 1, 1] });
    const m = parseGlb(b.build());
    expect(Array.from(m.positions)).toEqual([0, 0, 0, -1, 0, 0, 0, 1, 0]);
    expect(Array.from(m.indices)).toEqual([0, 2, 1]);
    expectClose(m.normals!, [-0.6, 0, 0.8, -0.6, 0, 0.8, -0.6, 0, 0.8]);
  });

  it('reads a non-indexed primitive as consecutive triples and reports missing normals', () => {
    const b = new GlbBuilder();
    const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 0, 0, 3, 0, 0, 2, 1, 0, 9, 9, 9];
    b.node({ mesh: b.mesh(b.primitive(positions)) });
    const m = parseGlb(b.build());
    expect(Array.from(m.indices)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(Array.from(m.positions)).toEqual(positions);
    expect(m.normals).toBeNull();
  });

  it('reads an interleaved buffer view with byteStride, accessor offsets and uint8 indices', () => {
    const b = new GlbBuilder();
    const indices = b.index([2, 0, 1], U8); // three bytes, so the next view starts at a padded offset
    const data = new Float32Array([
      77, 77, // two floats the accessors skip
      0, 0, 0, 0, 0, 1,
      1, 0, 0, 0, 1, 0,
      0, 1, 0, 1, 0, 0,
    ]);
    const view = b.view(bytesOf(data), 24);
    expect(b.doc.bufferViews[view]!.byteOffset).toBe(4);
    const pos = b.accessor(view, F32, 3, 'VEC3', 8);
    const nrm = b.accessor(view, F32, 3, 'VEC3', 20);
    b.node({ mesh: b.mesh({ attributes: { POSITION: pos, NORMAL: nrm }, indices }) });
    const m = parseGlb(b.build());
    expect(Array.from(m.positions)).toEqual(TRI);
    expect(Array.from(m.normals!)).toEqual([0, 0, 1, 0, 1, 0, 1, 0, 0]);
    expect(Array.from(m.indices)).toEqual([2, 0, 1]);
  });

  it('merges primitives with offset indices, skips non-triangle modes, and drops normals if any primitive lacks them', () => {
    const b = new GlbBuilder();
    const withNormals = b.primitive(TRI, { indices: [0, 1, 2], indexType: U32, normals: [0, 0, 1, 0, 0, 1, 0, 0, 1] });
    const lines = b.primitive([5, 5, 5, 6, 6, 6], { indices: [0, 1], mode: 1 });
    const bare = b.primitive(QUAD, { indices: [0, 1, 2, 0, 2, 3], mode: 4 });
    b.node({ mesh: b.mesh(withNormals, lines) });
    b.node({ mesh: b.mesh(bare), translation: [0, 0, 5] });
    const m = parseGlb(b.build());
    expect(m.positions.length).toBe(21);
    expect(Array.from(m.indices)).toEqual([0, 1, 2, 3, 4, 5, 3, 5, 6]);
    expect(Array.from(m.positions.subarray(9, 12))).toEqual([0, 0, 5]);
    expect(m.normals).toBeNull();

    const only = new GlbBuilder();
    only.node({ mesh: only.mesh(only.primitive(TRI, { indices: [0, 1, 2], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1] })) });
    expect(Array.from(parseGlb(only.build()).normals!)).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  });

  it('uses every root node when the file has no scene', () => {
    const b = new GlbBuilder();
    const mesh = b.mesh(b.primitive(TRI, { indices: [0, 1, 2] }));
    const child = b.node({ mesh, translation: [0, 0, 1] }, false);
    b.node({ translation: [10, 0, 0], children: [child] }, false);
    b.node({ mesh }, false);
    delete b.doc.scene;
    delete b.doc.scenes;
    const m = parseGlb(b.build());
    expect(Array.from(m.positions)).toEqual([10, 0, 1, 11, 0, 1, 10, 1, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(Array.from(m.indices)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  const triangleFile = (): GlbBuilder => {
    const b = new GlbBuilder();
    b.node({ mesh: b.mesh(b.primitive(TRI, { indices: [0, 1, 2] })) });
    return b;
  };

  it('rejects files that are not GLB', () => {
    expect(() => parseGlb(new ArrayBuffer(4))).toThrow(/not a binary glTF/i);
    const text = new ArrayBuffer(64);
    new Uint8Array(text).fill(0x7b);
    expect(() => parseGlb(text)).toThrow(/not a binary glTF/i);
    const v1 = triangleFile().build();
    new DataView(v1).setUint32(4, 1, true);
    expect(() => parseGlb(v1)).toThrow(/version 1/);
    const noJson = new ArrayBuffer(12);
    new DataView(noJson).setUint32(0, 0x46546c67, true);
    new DataView(noJson).setUint32(4, 2, true);
    new DataView(noJson).setUint32(8, 12, true);
    expect(() => parseGlb(noJson)).toThrow(/no JSON chunk/);
  });

  it('rejects a file with no triangles', () => {
    const lines = new GlbBuilder();
    lines.node({ mesh: lines.mesh(lines.primitive([0, 0, 0, 1, 1, 1], { indices: [0, 1], mode: 1 })) });
    expect(() => parseGlb(lines.build())).toThrow(/no triangles/);
    expect(() => parseGlb(new GlbBuilder().build())).toThrow(/no triangles/);
  });

  it('rejects Draco and meshopt compression', () => {
    const draco = triangleFile();
    draco.doc.meshes[0]!.primitives[0]!.extensions = { KHR_draco_mesh_compression: { bufferView: 0, attributes: { POSITION: 0 } } };
    expect(() => parseGlb(draco.build())).toThrow(/Draco/);
    const dracoRequired = triangleFile();
    dracoRequired.doc.extensionsRequired = ['KHR_draco_mesh_compression'];
    expect(() => parseGlb(dracoRequired.build())).toThrow(/Draco/);
    const meshopt = triangleFile();
    meshopt.doc.bufferViews[0]!.extensions = { EXT_meshopt_compression: { buffer: 0, byteLength: 4, byteStride: 12, count: 3, mode: 'ATTRIBUTES' } };
    expect(() => parseGlb(meshopt.build())).toThrow(/meshopt/);
    const meshoptRequired = triangleFile();
    meshoptRequired.doc.extensionsRequired = ['EXT_meshopt_compression'];
    expect(() => parseGlb(meshoptRequired.build())).toThrow(/meshopt/);
  });

  it('rejects sparse accessors, external buffers and accessors that overrun the buffer', () => {
    const sparse = triangleFile();
    sparse.doc.accessors[0]!.sparse = { count: 1, indices: { bufferView: 1, componentType: U16 }, values: { bufferView: 0 } };
    expect(() => parseGlb(sparse.build())).toThrow(/sparse/);
    const external = triangleFile();
    external.doc.buffers[0]!.uri = 'geometry.bin';
    expect(() => parseGlb(external.build())).toThrow(/external buffer/);
    const second = triangleFile();
    second.doc.buffers.push({ byteLength: 36, uri: 'more.bin' });
    second.doc.bufferViews[0]!.buffer = 1;
    expect(() => parseGlb(second.build())).toThrow(/external buffer/);
    const overrun = triangleFile();
    overrun.doc.accessors[0]!.count = 4000;
    expect(() => parseGlb(overrun.build())).toThrow(/past the end/);
    const badIndex = new GlbBuilder();
    badIndex.node({ mesh: badIndex.mesh(badIndex.primitive(TRI, { indices: [0, 1, 3] })) });
    expect(() => parseGlb(badIndex.build())).toThrow(/out of range/);
  });
});

// ---------------------------------------------------------------- OBJ

describe('parseObj', () => {
  it('fan-triangulates a quad and reads slash forms and negative indices', () => {
    const text = [
      '# a quad and a triangle',
      'o thing',
      'v 0 0 0',
      'v 1 0 0',
      'v 1 1 0',
      'v 0 1 0   # trailing comment',
      'vn 0 0 1',
      'vt 0.5 0.5',
      'f 1//1 2//1 3//1 4//1',
      'v 0 0 1.5e0',
      'usemtl none',
      'f -1 1/1 2/1/1',
      '',
    ].join('\r\n');
    const m = parseObj(text);
    expect(Array.from(m.positions)).toEqual([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1.5]);
    expect(Array.from(m.indices)).toEqual([0, 1, 2, 0, 2, 3, 4, 0, 1]);
    expect(m.normals).toBeNull();
  });

  it('resolves a negative index against the vertices read so far', () => {
    const m = parseObj('v 0 0 0\nv 1 0 0\nv 0 1 0\nf -3 -2 -1\nv 5 5 5\nv 6 5 5\nv 5 6 5\nf -3 -2 -1\n');
    expect(Array.from(m.indices)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('triangulates a pentagon into three triangles', () => {
    const m = parseObj('v 0 0 0\nv 1 0 0\nv 2 1 0\nv 1 2 0\nv 0 1 0\nf 1 2 3 4 5\n');
    expect(Array.from(m.indices)).toEqual([0, 1, 2, 0, 2, 3, 0, 3, 4]);
  });

  it('rejects files without faces and faces that point nowhere', () => {
    expect(() => parseObj('v 0 0 0\nv 1 0 0\nv 0 1 0\n')).toThrow(/no faces/);
    expect(() => parseObj('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 9\n')).toThrow(/does not exist/);
    expect(() => parseObj('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 x\n')).toThrow(/bad face/);
  });
});

// ---------------------------------------------------------------- prepareMesh

function bounds(m: TriMesh): { lo: Vec3; hi: Vec3 } {
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.positions.length; i++) {
    lo[i % 3] = Math.min(lo[i % 3]!, m.positions[i]!);
    hi[i % 3] = Math.max(hi[i % 3]!, m.positions[i]!);
  }
  return { lo, hi };
}

describe('prepareMesh', () => {
  it('normalises the bounds and drops degenerate triangles and the vertices only they use', () => {
    const positions = new Float32Array([
      2, 10, -1, // 0
      6, 10, -1, // 1
      6, 12, 0, // 2
      2, 12, 0, // 3
      4, 10, -1, // 4: on the edge 0-1
      100, 100, 100, // 5: unused
      -50, 0, 0, // 6: only in degenerate triangles
      2, 10, -1, // 7: a copy of 0
    ]);
    const indices = new Uint32Array([
      0, 1, 2,
      0, 2, 3,
      0, 0, 1, // repeated index
      0, 4, 1, // collinear
      0, 7, 2, // two corners at the same place
      6, 6, 2, // repeated index, far away
      1, 2, 99, // index out of range
    ]);
    const m = prepareMesh({ positions, indices, normals: null });
    expect(m.indices.length).toBe(6);
    expect(m.positions.length).toBe(12);
    expect(Array.from(m.indices)).toEqual([0, 1, 2, 0, 2, 3]);
    const { lo, hi } = bounds(m);
    // Source box 4 x 2 x 1, so the scale is 1/4.
    expectClose(lo, [-0.5, 0, -0.125], 1e-7);
    expectClose(hi, [0.5, 0.5, 0.125], 1e-7);
    expect(lo[1]).toBe(0);
    expect(m.normals!.length).toBe(12);
    // The source mesh is untouched.
    expect(positions[0]).toBe(2);
  });

  it('puts the largest dimension on whichever axis has it', () => {
    const tall = prepareMesh({ positions: new Float32Array([0, -3, 0, 1, -3, 0, 0, 7, 2]), indices: new Uint32Array([0, 1, 2]), normals: null });
    const { lo, hi } = bounds(tall);
    expectClose(lo, [-0.05, 0, -0.1], 1e-7);
    expectClose(hi, [0.05, 1, 0.1], 1e-7);
  });

  it('computes area-weighted normals, welding vertices at the same position', () => {
    // Two triangles folded along the y axis with no shared indices; the second has twice the area.
    const positions = new Float32Array([
      0, 0, 0, 1, 0, 0, 0, 1, 0, // normal +z, area 1/2
      0, 0, 0, 0, 1, 0, 0, 0, 2, // normal +x, area 1
    ]);
    const m = prepareMesh({ positions, indices: new Uint32Array([0, 1, 2, 3, 4, 5]), normals: null });
    const n = m.normals!;
    const fold = [2 / Math.sqrt(5), 0, 1 / Math.sqrt(5)];
    expectClose(n.subarray(0, 3), fold);
    expectClose(n.subarray(3, 6), [0, 0, 1]);
    expectClose(n.subarray(6, 9), fold);
    expectClose(n.subarray(9, 12), fold);
    expectClose(n.subarray(12, 15), fold);
    expectClose(n.subarray(15, 18), [1, 0, 0]);
  });

  it('keeps supplied normals, normalised and matched to the surviving vertices', () => {
    const positions = new Float32Array([9, 9, 9, 0, 0, 0, 2, 0, 0, 0, 2, 0]);
    const normals = new Float32Array([1, 0, 0, 0, 0, 3, 0, 3, 4, 0, 0, 1]);
    const m = prepareMesh({ positions, indices: new Uint32Array([1, 2, 3]), normals });
    expect(m.positions.length).toBe(9);
    expectClose(m.normals!, [0, 0, 1, 0, 0.6, 0.8, 0, 0, 1]);
  });

  it('throws when nothing is left or the mesh is too large', () => {
    const flat = { positions: new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0]), indices: new Uint32Array([0, 1, 2]), normals: null };
    expect(() => prepareMesh(flat)).toThrow(/no triangles/);
    expect(() => prepareMesh({ positions: new Float32Array(0), indices: new Uint32Array(0), normals: null })).toThrow(/no triangles/);
    const two = { positions: new Float32Array(QUAD), indices: new Uint32Array([0, 1, 2, 0, 2, 3]), normals: null };
    expect(() => prepareMesh(two, 1)).toThrow(/limit is 1/);
    expect(prepareMesh(two, 2).indices.length).toBe(6);
  });
});

// ---------------------------------------------------------------- library and BVH

/** A deterministic generator of uniform numbers in [0, 1). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function unitVector(rnd: () => number): Vec3 {
  const z = 2 * rnd() - 1;
  const phi = 2 * Math.PI * rnd();
  const r = Math.sqrt(1 - z * z);
  return [r * Math.cos(phi), r * Math.sin(phi), z];
}

/** A UV sphere with outward winding and exact vertex normals. */
function uvSphere(segs: number, rings: number, r: number, c: Vec3): TriMesh {
  const pos: number[] = [c[0], c[1] + r, c[2]];
  for (let j = 1; j < rings; j++) {
    const th = (Math.PI * j) / rings;
    for (let k = 0; k < segs; k++) {
      const ph = (2 * Math.PI * k) / segs;
      pos.push(c[0] + r * Math.sin(th) * Math.cos(ph), c[1] + r * Math.cos(th), c[2] + r * Math.sin(th) * Math.sin(ph));
    }
  }
  pos.push(c[0], c[1] - r, c[2]);
  const bottom = pos.length / 3 - 1;
  const at = (j: number, k: number): number => 1 + (j - 1) * segs + (k % segs);
  const idx: number[] = [];
  for (let k = 0; k < segs; k++) {
    idx.push(0, at(1, k + 1), at(1, k));
    for (let j = 1; j < rings - 1; j++) {
      idx.push(at(j, k), at(j, k + 1), at(j + 1, k));
      idx.push(at(j, k + 1), at(j + 1, k + 1), at(j + 1, k));
    }
    idx.push(bottom, at(rings - 1, k), at(rings - 1, k + 1));
  }
  const positions = new Float32Array(pos);
  const normals = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i++) normals[i] = (pos[i]! - c[i % 3]!) / r;
  return { positions, indices: new Uint32Array(idx), normals };
}

/** A torus about the y axis with outward winding and no normals. */
function torus(nu: number, nv: number, R: number, r: number): TriMesh {
  const pos: number[] = [];
  for (let i = 0; i < nu; i++) {
    const u = (2 * Math.PI * i) / nu;
    for (let j = 0; j < nv; j++) {
      const v = (2 * Math.PI * j) / nv;
      pos.push((R + r * Math.cos(v)) * Math.cos(u), r * Math.sin(v), (R + r * Math.cos(v)) * Math.sin(u));
    }
  }
  const at = (i: number, j: number): number => (i % nu) * nv + (j % nv);
  const idx: number[] = [];
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      idx.push(at(i, j), at(i, j + 1), at(i + 1, j));
      idx.push(at(i + 1, j), at(i, j + 1), at(i + 1, j + 1));
    }
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx), normals: null };
}

/** Nearest hit by testing every triangle of the source mesh, in double precision. */
function bruteForce(m: TriMesh, o: Vec3, d: Vec3, tmin: number): number {
  const P = m.positions;
  let best = Infinity;
  for (let i = 0; i < m.indices.length; i += 3) {
    const a = m.indices[i]! * 3;
    const b = m.indices[i + 1]! * 3;
    const c = m.indices[i + 2]! * 3;
    const e1x = P[b]! - P[a]!, e1y = P[b + 1]! - P[a + 1]!, e1z = P[b + 2]! - P[a + 2]!;
    const e2x = P[c]! - P[a]!, e2y = P[c + 1]! - P[a + 1]!, e2z = P[c + 2]! - P[a + 2]!;
    const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-20) continue;
    const tx = o[0] - P[a]!, ty = o[1] - P[a + 1]!, tz = o[2] - P[a + 2]!;
    const u = (tx * px + ty * py + tz * pz) / det;
    if (u < 0 || u > 1) continue;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
    const v = (d[0] * qx + d[1] * qy + d[2] * qz) / det;
    if (v < 0 || u + v > 1) continue;
    const t = (e2x * qx + e2y * qy + e2z * qz) / det;
    if (t > tmin && t < best) best = t;
  }
  return best;
}

interface Ray { o: Vec3; d: Vec3 }

/** Rays from a shell around `c` towards a ball that the mesh only partly fills, and from inside it. */
function makeRays(count: number, seed: number, c: Vec3, inner: number): Ray[] {
  const rnd = lcg(seed);
  const rays: Ray[] = [];
  for (let i = 0; i < count; i++) {
    const a = unitVector(rnd);
    const b = unitVector(rnd);
    if (i % 3 === 2) {
      const s = inner * rnd();
      rays.push({ o: [c[0] + a[0] * s, c[1] + a[1] * s, c[2] + a[2] * s], d: b });
      continue;
    }
    const o: Vec3 = [c[0] + 2 * a[0], c[1] + 2 * a[1], c[2] + 2 * a[2]];
    const s = 0.6 * Math.cbrt(rnd());
    const to: Vec3 = [c[0] + b[0] * s - o[0], c[1] + b[1] * s - o[1], c[2] + b[2] * s - o[2]];
    const l = Math.hypot(to[0], to[1], to[2]);
    rays.push({ o, d: [to[0] / l, to[1] / l, to[2] / l] });
  }
  return rays;
}

/** Compares the library's traversal with brute force, for first hits and for the hit after each. */
function compareRays(lib: MeshLibrary, root: number, m: TriMesh, rays: Ray[]): { hits: number; misses: number; wrong: string[] } {
  const wrong: string[] = [];
  let hits = 0;
  let misses = 0;
  const check = (r: Ray, tmin: number): number => {
    const h = lib.hit(root, r.o, r.d, tmin);
    const t = bruteForce(m, r.o, r.d, tmin);
    if (h === null) {
      misses++;
      if (t !== Infinity && wrong.length < 10) wrong.push(`missed a hit at t = ${t}`);
      return Infinity;
    }
    hits++;
    if (!(Math.abs(h.t - t) < 1e-6) && wrong.length < 10) wrong.push(`t = ${h.t}, brute force ${t}`);
    return h.t;
  };
  for (const r of rays) {
    const t = check(r, 0);
    if (t < Infinity) check(r, t + 1e-4);
  }
  return { hits, misses, wrong };
}

interface TreeStats { nodes: number; leaves: number; maxDepth: number; maxLeaf: number; problems: string[] }

/** Walks one mesh's BVH and checks every structural rule the shader relies on. */
function walkTree(lib: MeshLibrary, root: number, triBase: number, triCount: number): TreeStats {
  const N = lib.nodes;
  const T = lib.tris;
  const refs = new Uint32Array(triCount);
  const problems: string[] = [];
  const note = (s: string): void => { if (problems.length < 20) problems.push(s); };
  let next = root;
  let leaves = 0;
  let maxDepth = 0;
  let maxLeaf = 0;
  const visit = (i: number, depth: number, parent: number): void => {
    if (i !== next) { note(`node ${i} is out of depth-first order (expected ${next})`); return; }
    next = i + 1;
    const a = i * 8;
    if (a + 8 > N.length) { note(`node ${i} is past the end of the array`); return; }
    maxDepth = Math.max(maxDepth, depth);
    for (let k = 0; k < 3; k++) {
      if (!(N[a + 4 + k]! > N[a + k]!)) note(`node ${i} has no thickness on axis ${k}`);
      if (parent >= 0 && (N[a + k]! < N[parent * 8 + k]! || N[a + 4 + k]! > N[parent * 8 + 4 + k]!)) note(`node ${i} is not inside its parent on axis ${k}`);
    }
    const count = N[a + 7]!;
    if (count > 0) {
      leaves++;
      maxLeaf = Math.max(maxLeaf, count);
      const first = N[a + 3]!;
      for (let k = 0; k < count; k++) {
        const t = first + k - triBase;
        if (!Number.isInteger(t) || t < 0 || t >= triCount) { note(`leaf ${i} refers to triangle ${first + k}, outside its mesh`); continue; }
        refs[t] = refs[t]! + 1;
        const s = (first + k) * 24;
        for (let axis = 0; axis < 3; axis++) {
          const v0 = T[s + axis]!;
          for (const x of [v0, v0 + T[s + 4 + axis]!, v0 + T[s + 8 + axis]!]) {
            if (x < N[a + axis]! || x > N[a + 4 + axis]!) note(`triangle ${first + k} sticks out of leaf ${i}`);
          }
        }
      }
      return;
    }
    if (count !== 0) note(`node ${i} has count ${count}`);
    const right = N[a + 3]!;
    visit(i + 1, depth + 1, i);
    if (right !== next) { note(`node ${i} names right child ${right}, but its left subtree ends before ${next}`); return; }
    visit(right, depth + 1, i);
  };
  visit(root, 0, -1);
  for (let t = 0; t < triCount; t++) if (refs[t] !== 1) note(`triangle ${triBase + t} is in ${refs[t]} leaves`);
  return { nodes: next - root, leaves, maxDepth, maxLeaf, problems };
}

describe('MeshLibrary', () => {
  const C: Vec3 = [0, 0.5, 0];
  const sphere = uvSphere(50, 50, 0.5, C);
  const lib = new MeshLibrary();
  lib.add('sphere', sphere);
  const sphereEntry = lib.lookup('sphere')!;
  const sphereStats = walkTree(lib, sphereEntry.root, 0, sphereEntry.tris);
  const sphereNodes = lib.nodes.slice();
  const sphereTris = lib.tris.slice();
  const rays = makeRays(3000, 20261127, C, 0.3);

  it('registers a mesh with exact-length arrays', () => {
    expect(sphere.indices.length / 3).toBe(4900);
    expect(sphereEntry).toEqual({ root: 0, tris: 4900 });
    expect(lib.has('sphere')).toBe(true);
    expect(lib.has('teapot')).toBe(false);
    expect(lib.lookup('teapot')).toBeNull();
    expect(sphereTris.length).toBe(4900 * 24);
    expect(sphereNodes.length).toBe(sphereStats.nodes * 8);
    expect(() => lib.add('sphere', sphere)).toThrow(/already/);
    expect(new MeshLibrary().hit(0, [0, 0, 0], [0, 1, 0], 0)).toBeNull();
    const empty = new MeshLibrary();
    expect(empty.nodes.length).toBe(0);
    expect(empty.tris.length).toBe(0);
    expect(empty.version).toBe(0);
    expect(() => empty.add('nothing', { positions: new Float32Array(0), indices: new Uint32Array(0), normals: null })).toThrow(/no triangles/);
    expect(empty.version).toBe(0);
  });

  it('stores each triangle as v0, e1, e2 and three vertex normals with zero w', () => {
    let bad = 0;
    for (let t = 0; t < 4900; t++) {
      const s = t * 24;
      for (let texel = 0; texel < 6; texel++) if (sphereTris[s + texel * 4 + 3] !== 0) bad++;
      // On this sphere every vertex normal is (vertex - centre) / radius.
      for (let c = 0; c < 3; c++) {
        for (let k = 0; k < 3; k++) {
          const v = sphereTris[s + k]! + (c === 0 ? 0 : sphereTris[s + c * 4 + k]!);
          if (Math.abs(sphereTris[s + 12 + c * 4 + k]! - (v - C[k]!) / 0.5) > 1e-6) bad++;
        }
      }
    }
    expect(bad).toBe(0);
  });

  it('matches a brute-force loop over all triangles', () => {
    const r = compareRays(lib, sphereEntry.root, sphere, rays);
    expect(r.wrong).toEqual([]);
    expect(r.hits).toBeGreaterThan(2000);
    expect(r.misses).toBeGreaterThan(300);
  });

  it('matches the analytic sphere within the faceting error, with outward normals', () => {
    let compared = 0;
    let worst = 0;
    let inward = 0;
    for (const { o, d } of rays) {
      const oc: Vec3 = [o[0] - C[0], o[1] - C[1], o[2] - C[2]];
      const b = oc[0] * d[0] + oc[1] * d[1] + oc[2] * d[2];
      const cc = oc[0] * oc[0] + oc[1] * oc[1] + oc[2] * oc[2] - 0.25;
      const impact2 = cc + 0.25 - b * b;
      const h = lib.hit(sphereEntry.root, o, d, 0);
      if (h) {
        const p: Vec3 = [o[0] + d[0] * h.t - C[0], o[1] + d[1] * h.t - C[1], o[2] + d[2] * h.t - C[2]];
        if (h.n[0] * p[0] + h.n[1] * p[1] + h.n[2] * p[2] <= 0) inward++;
      }
      if (impact2 > 0.09) continue; // well inside the silhouette, where faceting is a small shift in t
      const s = Math.sqrt(b * b - cc);
      const exact = -b - s > 0 ? -b - s : -b + s;
      expect(h).not.toBeNull();
      worst = Math.max(worst, Math.abs(h!.t - exact));
      compared++;
    }
    expect(inward).toBe(0);
    expect(compared).toBeGreaterThan(1000);
    expect(worst).toBeLessThan(0.004);
    expect(worst).toBeGreaterThan(1e-5);
  });

  it('honours tmin and rays along the axes', () => {
    // Just off the equator vertex at (0.5, 0.5, 0), so the ray crosses a face, not a corner.
    const o: Vec3 = [2, 0.52, 0.013];
    const first = lib.hit(0, o, [-1, 0, 0], 0)!;
    expect(first.t).toBeCloseTo(1.5, 2);
    expect(first.n[0]).toBeGreaterThan(0);
    const second = lib.hit(0, o, [-1, 0, 0], first.t + 1e-3)!;
    expect(second.t).toBeCloseTo(2.5, 2);
    expect(second.n[0]).toBeLessThan(0);
    expect(lib.hit(0, o, [-1, 0, 0], second.t + 1e-3)).toBeNull();
    expect(lib.hit(0, o, [1, 0, 0], 0)).toBeNull();
    const down: Ray = { o: [0.1, 2, 0.05], d: [0, -1, 0] };
    expect(lib.hit(0, down.o, down.d, 0)!.t).toBeCloseTo(bruteForce(sphere, down.o, down.d, 0), 6);
    expect(lib.hit(0, [0.7, 2, 0], [0, -1, 0], 0)).toBeNull();
    expect(lib.hit(0, [0.1, 0.5, -3], [0, 0, 2], 0)!.t).toBeCloseTo(bruteForce(sphere, [0.1, 0.5, -3], [0, 0, 2], 0), 6);
  });

  it('keeps the structure the shader walks: depth-first order, nested bounds, every triangle in one leaf', () => {
    expect(sphereStats.problems).toEqual([]);
    expect(sphereStats.maxDepth).toBeLessThanOrEqual(30);
    expect(sphereStats.maxLeaf).toBeLessThanOrEqual(4);
    expect(sphereStats.nodes).toBe(2 * sphereStats.leaves - 1);
    // A useful tree, not a degenerate one.
    expect(sphereStats.maxDepth).toBeLessThan(24);
    expect(sphereStats.leaves).toBeGreaterThanOrEqual(4900 / 4);
    // The root covers the whole sphere, barely (no vertex reaches the z extremes exactly).
    expectClose(sphereNodes.subarray(0, 3), [-0.5, 0, -0.5], 2e-3);
    expectClose(sphereNodes.subarray(4, 7), [0.5, 1, 0.5], 2e-3);
    for (let k = 0; k < 3; k++) {
      expect(sphereNodes[k]!).toBeLessThan(k === 2 ? -0.499 : k === 1 ? 0 : -0.5);
      expect(sphereNodes[4 + k]!).toBeGreaterThan(k === 2 ? 0.499 : k === 1 ? 1 : 0.5);
    }
  });

  it('offsets a second mesh by what the first one used', () => {
    const donut = prepareMesh(torus(48, 24, 1, 0.4));
    expect(donut.indices.length / 3).toBe(2304);
    const before = lib.version;
    lib.add('donut', donut);
    expect(lib.version).toBe(before + 1);
    const e = lib.lookup('donut')!;
    expect(e).toEqual({ root: sphereStats.nodes, tris: 2304 });
    const stats = walkTree(lib, e.root, 4900, 2304);
    expect(stats.problems).toEqual([]);
    expect(stats.maxDepth).toBeLessThanOrEqual(30);
    expect(lib.nodes.length).toBe((sphereStats.nodes + stats.nodes) * 8);
    expect(lib.tris.length).toBe((4900 + 2304) * 24);
    // The first mesh's data did not move.
    expect(Array.from(lib.nodes.subarray(0, sphereNodes.length))).toEqual(Array.from(sphereNodes));
    expect(Array.from(lib.tris.subarray(0, sphereTris.length))).toEqual(Array.from(sphereTris));

    // The same mesh alone in a library gives the same tree with the indices shifted back.
    const alone = new MeshLibrary();
    alone.add('donut', donut);
    expect(alone.lookup('donut')).toEqual({ root: 0, tris: 2304 });
    expect(alone.nodes.length).toBe(stats.nodes * 8);
    let different = 0;
    for (let i = 0; i < stats.nodes; i++) {
      const a = i * 8;
      const b = (e.root + i) * 8;
      const shift = alone.nodes[a + 7]! > 0 ? 4900 : e.root;
      for (let k = 0; k < 8; k++) if (lib.nodes[b + k] !== alone.nodes[a + k]! + (k === 3 ? shift : 0)) different++;
    }
    expect(different).toBe(0);
    expect(Array.from(lib.tris.subarray(4900 * 24))).toEqual(Array.from(alone.tris));

    const donutRays = makeRays(2000, 77, [0, 0.14, 0], 0.5);
    const r = compareRays(lib, e.root, donut, donutRays);
    expect(r.wrong).toEqual([]);
    expect(r.hits).toBeGreaterThan(500);
    expect(r.misses).toBeGreaterThan(200);
    // And the first mesh still answers from the reallocated arrays.
    expect(compareRays(lib, sphereEntry.root, sphere, rays.slice(0, 500)).wrong).toEqual([]);
  });

  it('computes smooth normals for a mesh that has none', () => {
    const donut = prepareMesh(torus(48, 24, 1, 0.4));
    let worst = 1;
    for (let i = 0; i < 48; i++) {
      for (let j = 0; j < 24; j++) {
        const u = (2 * Math.PI * i) / 48;
        const v = (2 * Math.PI * j) / 24;
        const at = (i * 24 + j) * 3;
        const n = donut.normals!;
        worst = Math.min(worst, n[at]! * Math.cos(v) * Math.cos(u) + n[at + 1]! * Math.sin(v) + n[at + 2]! * Math.cos(v) * Math.sin(u));
      }
    }
    expect(worst).toBeGreaterThan(0.995);
  });

  it('gives a flat axis-aligned mesh boxes with thickness', () => {
    const flat = new MeshLibrary();
    const quad: TriMesh = { positions: new Float32Array([-0.5, 0.25, -0.5, 0.5, 0.25, -0.5, 0.5, 0.25, 0.5, -0.5, 0.25, 0.5]), indices: new Uint32Array([0, 2, 1, 0, 3, 2]), normals: null };
    flat.add('quad', quad);
    expect(walkTree(flat, 0, 0, 2).problems).toEqual([]);
    const h = flat.hit(0, [0.2, 1, -0.3], [0, -1, 0], 0)!;
    expect(h.t).toBeCloseTo(0.75, 9);
    expect(h.n[1]).toBeGreaterThan(0);
    // Without vertex normals the face normal is stored at each corner.
    expect(Array.from(flat.tris.subarray(12, 24))).toEqual([0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0]);
    expect(flat.hit(0, [0.2, 1, -0.3], [1, 0, 0], 0)).toBeNull();
    expect(flat.hit(0, [0.2, 0.25, -3], [0, 0, 1], 0)).toBeNull(); // in the plane: no crossing
  });

  it('builds a pile of identical triangles, where no split helps, within the depth limit', () => {
    const count = 6000;
    const indices = new Uint32Array(count * 3);
    for (let i = 0; i < count; i++) indices.set([0, 1, 2], i * 3);
    const pile: TriMesh = { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices, normals: null };
    const p = new MeshLibrary();
    p.add('pile', pile);
    const stats = walkTree(p, 0, 0, count);
    expect(stats.problems).toEqual([]);
    expect(stats.maxDepth).toBeLessThanOrEqual(30);
    expect(stats.maxLeaf).toBeLessThanOrEqual(4);
    expect(p.tris.length).toBe(count * 24);
    expect(p.hit(0, [0.2, 0.2, 1], [0, 0, -1], 0)!.t).toBeCloseTo(1, 12);
    expect(p.hit(0, [0.8, 0.8, 1], [0, 0, -1], 0)).toBeNull();
  });

  it('keeps a geometric cascade, which drives a greedy split into a long chain, within the depth limit', () => {
    // Three chains of triangles shrinking towards the origin along x, y and z: the cheapest
    // split always peels a few of the largest off the rest.
    const per = 250;
    const pos: number[] = [];
    for (let axis = 0; axis < 3; axis++) {
      for (let i = 0; i < per; i++) {
        const s = 0.8 ** i;
        const p: Vec3 = [0, 0, 0];
        p[axis] = s;
        const u: Vec3 = [0, 0, 0];
        u[(axis + 1) % 3] = 0.3 * s;
        const v: Vec3 = [0, 0, 0];
        v[(axis + 2) % 3] = 0.3 * s;
        pos.push(...p, p[0] + u[0], p[1] + u[1], p[2] + u[2], p[0] + v[0], p[1] + v[1], p[2] + v[2]);
      }
    }
    const indices = new Uint32Array(per * 9);
    for (let i = 0; i < indices.length; i++) indices[i] = i;
    const cascade: TriMesh = { positions: new Float32Array(pos), indices, normals: null };
    const c = new MeshLibrary();
    c.add('cascade', cascade);
    const stats = walkTree(c, 0, 0, per * 3);
    expect(stats.problems).toEqual([]);
    expect(stats.maxDepth).toBeLessThanOrEqual(30);
    expect(stats.maxLeaf).toBeLessThanOrEqual(4);
    const rnd = lcg(5);
    const cascadeRays: Ray[] = [];
    for (let i = 0; i < 1500; i++) {
      const axis = i % 3;
      const o: Vec3 = [0, 0, 0];
      o[axis] = 1.2 * rnd() ** 3;
      o[(axis + 1) % 3] = 0.3 * rnd() * o[axis]!;
      o[(axis + 2) % 3] = 0.3 * rnd() * o[axis]!;
      const d: Vec3 = [0.2 * rnd() - 0.1, 0.2 * rnd() - 0.1, 0.2 * rnd() - 0.1];
      d[axis] = -1;
      o[axis] = o[axis]! + 0.5;
      cascadeRays.push({ o, d });
    }
    const r = compareRays(c, 0, cascade, cascadeRays);
    expect(r.wrong).toEqual([]);
    expect(r.hits).toBeGreaterThan(300);
  });
});
