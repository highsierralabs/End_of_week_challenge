// Mode thumbnails, drawn on the CPU through the drum's raster: two-ink washes, black nodal lines,
// and the rim. Like the plates in an old acoustics textbook.

import { sampleCell } from '../render/raster';
import { type LiveDrum } from './live';

const SKIN = [248, 243, 233];
const WARM = [189, 59, 38];
const COOL = [35, 58, 102];
const INK = [28, 25, 22];

export function modeThumb(live: LiveDrum, k: number, px: number): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = px; cv.height = px;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(px, px);
  const r = live.raster;
  const nv = live.data.nv;
  const val = new Float32Array(px * px).fill(NaN);
  let mx = 0;
  for (let j = 0; j < px; j++) {
    for (let i = 0; i < px; i++) {
      // Raster row 0 is the bottom (smallest y); image row 0 is the top.
      const ci = Math.min(r.size - 1, Math.floor(((i + 0.5) / px) * r.size));
      const cj = Math.min(r.size - 1, Math.floor((1 - (j + 0.5) / px) * r.size));
      const c = cj * r.size + ci;
      if (r.v[3 * c]! < 0) continue;
      const u = sampleCell(r, c, live.data.shape, k * nv);
      val[j * px + i] = u;
      mx = Math.max(mx, Math.abs(u));
    }
  }
  for (let j = 0; j < px; j++) {
    for (let i = 0; i < px; i++) {
      const u = val[j * px + i]!;
      const o = 4 * (j * px + i);
      if (Number.isNaN(u)) {
        // Rim: an outside pixel next to an inside one.
        const nb = [val[j * px + i - 1], val[j * px + i + 1], val[(j - 1) * px + i], val[(j + 1) * px + i]];
        if ((i > 0 && i < px - 1 && j > 0 && j < px - 1) && nb.some((x) => x !== undefined && !Number.isNaN(x))) {
          img.data.set([...INK, 255], o);
        }
        continue;
      }
      const a = Math.pow(Math.abs(u) / mx, 0.8) * 0.62;
      const tone = u > 0 ? WARM : COOL;
      let col = SKIN.map((s, q) => s + (tone[q]! - s) * a);
      // Nodal line: a sign change towards the right or lower neighbour.
      const right = val[j * px + i + 1], down = val[(j + 1) * px + i];
      if ((right !== undefined && !Number.isNaN(right) && right * u < 0) || (down !== undefined && !Number.isNaN(down) && down * u < 0)) col = INK;
      img.data.set([col[0]!, col[1]!, col[2]!, 255], o);
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}
