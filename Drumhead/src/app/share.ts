// A drawn drum in a URL: up to 120 outline points, in millimetres on the 1 m table, as
// little-endian int16 pairs in base64url. About 320 characters for a detailed outline.

const MAX_POINTS = 120;

export function encodeOutline(poly: ArrayLike<number>): string {
  const n = poly.length / 2;
  const m = Math.min(n, MAX_POINTS);
  const bytes = new Uint8Array(4 * m);
  const dv = new DataView(bytes.buffer);
  for (let i = 0; i < m; i++) {
    const j = Math.floor((i * n) / m);
    dv.setInt16(4 * i, clampMm(poly[2 * j]!), true);
    dv.setInt16(4 * i + 2, clampMm(poly[2 * j + 1]!), true);
  }
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeOutline(code: string): number[] | null {
  try {
    const s = atob(code.replace(/-/g, '+').replace(/_/g, '/'));
    if (s.length % 4 !== 0 || s.length < 4 * 8 || s.length > 4 * MAX_POINTS) return null;
    const bytes = Uint8Array.from(s, (c) => c.charCodeAt(0));
    const dv = new DataView(bytes.buffer);
    const out: number[] = [];
    for (let i = 0; i < bytes.length; i += 2) {
      const v = dv.getInt16(i, true) / 1000;
      if (!(Math.abs(v) <= 0.5)) return null;
      out.push(v);
    }
    return out;
  } catch {
    return null;
  }
}

function clampMm(v: number): number {
  return Math.max(-500, Math.min(500, Math.round(v * 1000)));
}
