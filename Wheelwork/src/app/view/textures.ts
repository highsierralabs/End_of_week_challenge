// Textures drawn at start-up on canvases: the engraved deck and the painted balls. Nothing is
// loaded from a file.
import * as THREE from 'three';
import { meanLongitudeUnwrapped } from '../../core/astro/planets';
import { jdFromCalendar, norm360 } from '../../core/astro/time';
import { DESIGN } from '../../core/machine/design';
import { LAND_MASK } from '../../data/land';

const SERIF = '"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif';
const DEG = Math.PI / 180;

const SIGNS = ['ARIES', 'TAURUS', 'GEMINI', 'CANCER', 'LEO', 'VIRGO', 'LIBRA', 'SCORPIO', 'SAGITTARIUS', 'CAPRICORN', 'AQUARIUS', 'PISCES'];
const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** The year whose dates are engraved on the calendar ring. */
export const CALENDAR_YEAR = 2026;

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, g: c.getContext('2d')! };
}

function texture(c: HTMLCanvasElement, srgb: boolean, anisotropy = 8): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = anisotropy;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

// A small deterministic noise for mottling.
function hash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x: number, y: number, octaves = 4): number {
  let s = 0, amp = 0.5, f = 1;
  for (let i = 0; i < octaves; i++) { s += amp * valueNoise(x * f, y * f); amp *= 0.5; f *= 2; }
  return s;
}

/**
 * The deck: zodiac and calendar rings engraved in brass. Longitude zero lies along +X and grows
 * counter-clockwise, as the arms turn. Returns the ink layer (dark lines on white, to multiply the
 * brass) and a height layer for the engraver's cut.
 */
export function deckTextures(size: number): { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  const { c, g } = canvas(size, size);
  const R = DESIGN.plateRadius;
  const s = size / (2 * R);
  const cx = size / 2;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, size, size);
  const ink = '#2a1c0c';
  g.strokeStyle = ink;
  g.fillStyle = ink;
  g.lineCap = 'butt';

  const ring = (r: number, w: number) => { g.lineWidth = w * s; g.beginPath(); g.arc(cx, cx, r * s, 0, Math.PI * 2); g.stroke(); };
  const tick = (lon: number, r0: number, r1: number, w: number) => {
    const a = lon * DEG;
    g.lineWidth = w * s;
    g.beginPath();
    g.moveTo(cx + r0 * s * Math.cos(a), cx - r0 * s * Math.sin(a));
    g.lineTo(cx + r1 * s * Math.cos(a), cx - r1 * s * Math.sin(a));
    g.stroke();
  };
  // Text set along a circle, centred on longitude `lon`, letter feet towards the centre.
  const arcText = (text: string, lon: number, r: number, px: number, spacing = 0.12, weight = 500) => {
    g.font = `${weight} ${px * s}px ${SERIF}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const widths = [...text].map((ch) => g.measureText(ch).width + spacing * px * s);
    const total = widths.reduce((p, q) => p + q, 0);
    // Reading clockwise seen from above (left to right for a reader standing outside the ring).
    let along = -total / 2;
    [...text].forEach((ch, i) => {
      const w = widths[i]!;
      const a = lon * DEG - (along + w / 2) / (r * s);
      g.save();
      g.translate(cx + r * s * Math.cos(a), cx - r * s * Math.sin(a));
      g.rotate(Math.PI / 2 - a);
      g.fillText(ch, 0, 0);
      g.restore();
      along += w;
    });
  };

  // ---- outer margin
  ring(107, 0.5);
  ring(105.6, 0.18);
  // ---- zodiac ring, 84 to 99.5
  ring(99.5, 0.35);
  ring(84, 0.35);
  ring(96.4, 0.14);
  ring(86.6, 0.14);
  for (let d = 0; d < 360; d++) {
    const major = d % 10 === 0;
    tick(d, d % 30 === 0 ? 84 : major ? 95.2 : d % 5 === 0 ? 96.9 : 97.9, d % 30 === 0 ? 99.5 : 99.5, d % 30 === 0 ? 0.3 : major ? 0.24 : 0.14);
    if (major && d % 30 !== 0) arcText(String(d % 30), d, 94, 2.3, 0.02);
  }
  SIGNS.forEach((name, i) => arcText(name, i * 30 + 15, 90.3, 3.6, 0.3, 600));
  // ---- calendar ring, 66 to 83
  ring(83, 0.22);
  ring(66, 0.35);
  ring(80.4, 0.14);
  ring(68.2, 0.14);
  let dayOfYear = 0;
  MONTHS.forEach((name, m) => {
    const start = norm360(meanLongitudeUnwrapped('earth', jdFromCalendar(CALENDAR_YEAR, m + 1, 1)));
    const end = norm360(meanLongitudeUnwrapped('earth', jdFromCalendar(CALENDAR_YEAR, m + 1, MONTH_DAYS[m]! + 1)));
    tick(start, 66, 83, 0.3);
    for (let d = 1; d <= MONTH_DAYS[m]!; d++) {
      const lon = norm360(meanLongitudeUnwrapped('earth', jdFromCalendar(CALENDAR_YEAR, m + 1, d)));
      if (d > 1) tick(lon, d % 10 === 1 ? 79.4 : d % 5 === 1 ? 81 : 81.9, 83, d % 10 === 1 ? 0.22 : 0.13);
      if (d === 11 || d === 21) arcText(String(d - 1), lon, 78, 2.1, 0.02);
      dayOfYear++;
    }
    let mid = start + norm360(end - start) / 2;
    if (mid >= 360) mid -= 360;
    arcText(name, mid, 72.6, 3.3, 0.28, 600);
  });
  void dayOfYear;
  // ---- the field inside
  ring(63.4, 0.14);
  ring(62.4, 0.3);
  arcText('WHEELWORK', 90, 54.5, 5.2, 0.5, 600);
  arcText('A CLOCKWORK ORRERY', 90, 47.6, 2.6, 0.45, 500);
  arcText('EVERY MOTION COUNTED IN TEETH', 270, 54, 2.5, 0.45, 500);
  arcText('HIGH SIERRA LABS  MMXXVI', 270, 47.6, 2.2, 0.45, 500);
  // A sixteen-point star, lightly cut.
  g.globalAlpha = 0.75;
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    const len = k % 4 === 0 ? 42 : k % 2 === 0 ? 36 : 30;
    const half = k % 4 === 0 ? 0.12 : 0.085;
    g.lineWidth = 0.16 * s;
    g.beginPath();
    g.moveTo(cx + 19 * s * Math.cos(a - half), cx - 19 * s * Math.sin(a - half));
    g.lineTo(cx + len * s * Math.cos(a), cx - len * s * Math.sin(a));
    g.lineTo(cx + 19 * s * Math.cos(a + half), cx - 19 * s * Math.sin(a + half));
    g.stroke();
    if (k % 2 === 0) {
      g.globalAlpha = 0.28;
      g.beginPath();
      g.moveTo(cx + 19 * s * Math.cos(a - half), cx - 19 * s * Math.sin(a - half));
      g.lineTo(cx + len * s * Math.cos(a), cx - len * s * Math.sin(a));
      g.lineTo(cx + 19 * s * Math.cos(a), cx - 19 * s * Math.sin(a));
      g.closePath();
      g.fill();
      g.globalAlpha = 0.75;
    }
  }
  g.globalAlpha = 1;
  ring(19, 0.3);
  ring(42.6, 0.12);

  // The cut: the same lines as a height map (white high, engraved lines low).
  const bumpCanvas = canvas(size, size);
  bumpCanvas.g.filter = `blur(${Math.max(0.6, size / 3000)}px)`;
  bumpCanvas.g.drawImage(c, 0, 0);
  return { map: texture(c, true, 16), bump: texture(bumpCanvas.c, false, 16) };
}

function equirect(w: number, h: number, shade: (lon: number, lat: number, x: number, y: number) => [number, number, number]): THREE.CanvasTexture {
  const { c, g } = canvas(w, h);
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const lat = 90 - ((y + 0.5) / h) * 180;
    for (let x = 0; x < w; x++) {
      const lon = ((x + 0.5) / w) * 360 - 180;
      const [r, gg, b] = shade(lon, lat, x, y);
      const o = (y * w + x) * 4;
      img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b; img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = texture(c, true, 4);
  // Triangles that cross the seam carry u beyond 1.
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

function mix(a: readonly number[], b: readonly number[], t: number): [number, number, number] {
  const k = Math.max(0, Math.min(1, t));
  return [a[0]! + (b[0]! - a[0]!) * k, a[1]! + (b[1]! - a[1]!) * k, a[2]! + (b[2]! - a[2]!) * k];
}

/** Sample the land mask (one bit per degree) with bilinear smoothing. */
function land(lon: number, lat: number): number {
  const bit = (ix: number, iy: number): number => {
    const x = ((ix % 360) + 360) % 360;
    const y = Math.max(0, Math.min(179, iy));
    const i = y * 360 + x;
    return (LAND_MASK[i >> 3]! >> (7 - (i & 7))) & 1;
  };
  const fx = lon + 180 - 0.5;
  const fy = 90 - lat - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const u = fx - x0, v = fy - y0;
  return bit(x0, y0) * (1 - u) * (1 - v) + bit(x0 + 1, y0) * u * (1 - v) + bit(x0, y0 + 1) * (1 - u) * v + bit(x0 + 1, y0 + 1) * u * v;
}

/** The terrestrial globe: enamel seas, gilt land, a fine graticule. */
export function earthTexture(): THREE.CanvasTexture {
  const sea = [28, 66, 92];
  const deep = [18, 44, 70];
  const landA = [196, 164, 96];
  const landB = [150, 128, 78];
  const line = [214, 190, 130];
  return equirect(1440, 720, (lon, lat) => {
    const n = fbm((lon + 180) / 14, (lat + 90) / 14, 4);
    const l = land(lon, lat);
    let col = mix(mix(deep, sea, n * 1.6 - 0.2), mix(landB, landA, n * 1.4), Math.min(1, Math.max(0, (l - 0.42) * 6)));
    // Graticule every 15 degrees, with the equator and tropics a little stronger.
    const dLon = Math.abs(((lon + 180 + 7.5) % 15) - 7.5) * Math.cos(lat * DEG);
    const dLat = Math.abs(((lat + 90 + 7.5) % 15) - 7.5);
    const special = Math.min(Math.abs(lat), Math.abs(Math.abs(lat) - 23.44), Math.abs(Math.abs(lat) - 66.56));
    const g1 = Math.max(0, 1 - Math.min(dLon, dLat) / 0.22) * 0.35;
    const g2 = Math.max(0, 1 - special / 0.3) * 0.6;
    col = mix(col, line, Math.max(g1, g2) * (Math.abs(lat) < 84 ? 1 : 0));
    return col;
  });
}

/** Banded agate for Jupiter. */
export function jupiterTexture(): THREE.CanvasTexture {
  const a = [222, 196, 160], b = [168, 118, 82], c = [236, 222, 200];
  return equirect(512, 256, (lon, lat) => {
    const warp = fbm((lon + 180) / 22, lat / 6 + 9, 4) * 7;
    const v = Math.sin((lat + warp) * 0.22) * 0.5 + Math.sin((lat + warp * 0.6) * 0.61 + 1.3) * 0.3 + (fbm((lon + 180) / 6, lat / 2.5, 3) - 0.5) * 0.5;
    let col = mix(a, b, v + 0.55);
    col = mix(col, c, Math.max(0, -v - 0.1) * 1.4);
    // The red spot, as a jeweller's inclusion.
    const dx = (lon - 40) / 13, dy = (lat + 21) / 6;
    return mix(col, [176, 84, 60], Math.max(0, 1 - (dx * dx + dy * dy)) * 0.9);
  });
}

/** A mottled stone ball: base colour, a second colour, and how strongly they mix. */
export function stoneTexture(base: readonly number[], other: readonly number[], scale: number, contrast: number): THREE.CanvasTexture {
  return equirect(512, 256, (lon, lat) => {
    const n = fbm((lon + 180) / scale, (lat + 90) / scale, 5);
    return mix(base, other, (n - 0.5) * contrast + 0.5);
  });
}

/** Faint bands for Saturn. */
export function saturnTexture(): THREE.CanvasTexture {
  const a = [226, 204, 150], b = [196, 168, 112];
  return equirect(256, 128, (lon, lat) => mix(a, b, Math.sin(lat * 0.24 + fbm((lon + 180) / 30, lat / 9, 3) * 1.5) * 0.5 + 0.5));
}

/** The desk: dark baize in a pool of light that falls away to black. */
export function deskTexture(): THREE.CanvasTexture {
  const size = 1024;
  const { c, g } = canvas(size, size);
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - size / 2) / (size / 2), dy = (y - size / 2) / (size / 2);
      const r = Math.hypot(dx, dy);
      const pool = Math.exp(-r * r * 22);
      const grain = 0.86 + 0.28 * hash(x, y) * (0.6 + 0.4 * valueNoise(x / 3, y / 3));
      const k = (0.08 + 0.92 * pool) * grain;
      const o = (y * size + x) * 4;
      img.data[o] = 58 * k; img.data[o + 1] = 46 * k; img.data[o + 2] = 38 * k; img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return texture(c, true, 8);
}
