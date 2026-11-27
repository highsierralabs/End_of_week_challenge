// Solver worker: mesh a shape and find its lowest modes off the main thread.

import { resample, smooth, type Poly } from '../solver/geometry';
import { latticeMesh, type Mesh } from '../solver/mesh';
import { PRESETS } from '../solver/shapes';
import { hearShape, solveDrum } from '../solver/spectrum';

export type SolveJob =
  | { kind: 'preset'; preset: string; detail: number; modes: number }
  | { kind: 'poly'; poly: Poly; detail: number; modes: number };
export type SolveRequest = SolveJob & { id: number };

export interface DrumData {
  xy: Float64Array;
  tri: Uint32Array;
  rim: Uint8Array;
  outline: number[];
  lambda: Float64Array;
  shape: Float32Array;
  count: number;
  nv: number;
  area: number;
  perimeter: number;
  heard: { area: number; perimeter: number };
  ms: number;
}

export type SolveReply =
  | { id: number; type: 'progress'; f: number }
  | { id: number; type: 'done'; drum: DrumData }
  | { id: number; type: 'error'; message: string };

/** Prepare a freehand loop: even spacing, a little smoothing. */
export function cleanStroke(p: Poly): Poly {
  let len = 0;
  for (let i = 2; i < p.length; i += 2) len += Math.hypot(p[i]! - p[i - 2]!, p[i + 1]! - p[i - 1]!);
  const step = Math.max(0.004, len / 400);
  return smooth(resample(p, step), 3);
}

const post = (m: SolveReply, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

self.onmessage = (ev: MessageEvent<SolveRequest>) => {
  const req = ev.data;
  const t0 = performance.now();
  try {
    let mesh: Mesh | null;
    if (req.kind === 'preset') {
      const p = PRESETS.find((x) => x.id === req.preset);
      if (!p) throw new Error(`unknown preset ${req.preset}`);
      mesh = p.mesh(req.detail);
    } else {
      mesh = latticeMesh(cleanStroke(req.poly), req.detail);
    }
    if (!mesh || mesh.tri.length < 60) throw new Error('That shape is too thin to vibrate. Try a rounder one.');
    const d = solveDrum(mesh, req.modes, (f) => post({ id: req.id, type: 'progress', f }));
    const drum: DrumData = {
      xy: d.mesh.xy, tri: d.mesh.tri, rim: d.mesh.rim, outline: d.mesh.outline,
      lambda: d.lambda, shape: d.shape, count: d.count, nv: d.mesh.xy.length / 2,
      area: d.area, perimeter: d.perimeter, heard: hearShape(d.lambda), ms: performance.now() - t0,
    };
    post({ id: req.id, type: 'done', drum }, [drum.xy.buffer, drum.tri.buffer, drum.rim.buffer, drum.lambda.buffer, drum.shape.buffer]);
  } catch (e) {
    post({ id: req.id, type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
};
