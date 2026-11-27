// PURPOSE: Build Cascade's terrain heightmap from public AWS Terrain Tiles.
//   Downloads Terrarium-encoded web-mercator tiles covering a 60 km x 60 km square
//   centred on the illustrative scene origin (39.6600 N, 119.8650 W, Lemmon Valley /
//   Stead, north of Reno NV), resamples them onto a local east/north metre grid
//   (equirectangular approximation about the origin) and writes:
//     public/dem/stead_60km.png   Terrarium RGB, alpha 255, row 0 = north, column 0 = west
//     public/dem/stead_60km.json  grid metadata, elevation range, source and attribution
// USAGE: node scripts/fetch-dem.mjs [--pixels 2048] [--zoom 12] [--cache <dir>]
//   Run from the Cascade folder. Tiles are cached under the OS temp dir by default.
// OUTPUT: the two files above. Pixel (i, j) covers the cell whose centre is at
//   east = -size/2 + (i + 0.5) * size/pixels, north = size/2 - (j + 0.5) * size/pixels.
// DEPENDENCIES: Node 24 builtins only (zlib inflate/deflate/crc32, fetch). The PNG
//   reader handles 8-bit RGB/RGBA non-interlaced images, which is what the tiles are.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { inflateSync, deflateSync, crc32 } from 'node:zlib';

const ORIGIN_LAT = 39.66;
const ORIGIN_LON = -119.865;
const SIZE_M = 60000;
const TILE_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const ATTRIBUTION =
  'Elevation: Terrain Tiles (Mapzen / Linux Foundation) via the AWS Open Data Registry, ' +
  'https://registry.opendata.aws/terrain-tiles/ . Contains data from USGS 3DEP ' +
  '(3D Elevation Program, public domain) and other sources credited at ' +
  'https://github.com/tilezen/joerd/blob/master/docs/attribution.md';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

const PIXELS = Number(arg('--pixels', '2048'));
const ZOOM = Number(arg('--zoom', '12'));
const QUANT = Number(arg('--quant', '4')); // elevation steps per metre stored in B
const CACHE = arg('--cache', join(tmpdir(), 'cascade-terrarium'));
const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(here, '..', 'public', 'dem');

// ---------- PNG decode / encode (8-bit RGB or RGBA, no interlace) ----------

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function decodePng(buf) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (buf[i] !== sig[i]) throw new Error('not a PNG');
  let off = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const depth = data[8];
      colorType = data[9];
      if (depth !== 8 || (colorType !== 2 && colorType !== 6) || data[12] !== 0) {
        throw new Error(`unsupported PNG: depth ${depth} colour ${colorType} interlace ${data[12]}`);
      }
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = new Uint8Array(width * height * bpp);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const ft = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) v += paeth(a, b, c);
      else if (ft !== 0) throw new Error(`bad PNG filter ${ft}`);
      cur[x] = v & 255;
    }
    prev = cur;
  }
  return { width, height, bpp, data: out };
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}

/** Encode RGBA8 with the Paeth filter on every row (good for smooth relief). */
function encodePngRgba(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 4;
    for (let x = 0; x < stride; x++) {
      const cur = rgba[y * stride + x];
      const a = x >= 4 ? rgba[y * stride + x - 4] : 0;
      const b = y > 0 ? rgba[(y - 1) * stride + x] : 0;
      const c = x >= 4 && y > 0 ? rgba[(y - 1) * stride + x - 4] : 0;
      raw[y * (stride + 1) + 1 + x] = (cur - paeth(a, b, c)) & 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- geometry ----------

const RAD = Math.PI / 180;
const phi0 = ORIGIN_LAT * RAD;
// Metres per degree at the origin latitude (WGS84 series).
const M_PER_DEG_LAT = 111132.92 - 559.82 * Math.cos(2 * phi0) + 1.175 * Math.cos(4 * phi0);
const M_PER_DEG_LON = 111412.84 * Math.cos(phi0) - 93.5 * Math.cos(3 * phi0);

/** Global web-mercator pixel coordinates (256-px tiles) at ZOOM. */
function lonLatToGlobalPx(lon, lat) {
  const n = 256 * 2 ** ZOOM;
  const x = ((lon + 180) / 360) * n;
  const s = Math.sin(lat * RAD);
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
  return [x, y];
}

function enToLonLat(east, north) {
  return [ORIGIN_LON + east / M_PER_DEG_LON, ORIGIN_LAT + north / M_PER_DEG_LAT];
}

// ---------- tiles ----------

async function getTile(x, y) {
  const file = join(CACHE, `${ZOOM}_${x}_${y}.png`);
  if (existsSync(file)) return readFile(file);
  const url = TILE_URL.replace('{z}', String(ZOOM)).replace('{x}', String(x)).replace('{y}', String(y));
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      const buf = Buffer.from(await res.arrayBuffer());
      await writeFile(file, buf);
      return buf;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  throw lastErr;
}

async function main() {
  await mkdir(CACHE, { recursive: true });
  await mkdir(OUT_DIR, { recursive: true });
  const half = SIZE_M / 2;
  // Bounding box in global pixels (corners suffice: the mapping is monotone in each axis).
  const corners = [
    enToLonLat(-half, half),
    enToLonLat(half, half),
    enToLonLat(-half, -half),
    enToLonLat(half, -half),
  ].map(([lo, la]) => lonLatToGlobalPx(lo, la));
  const minPx = Math.floor(Math.min(...corners.map((c) => c[0]))) - 2;
  const maxPx = Math.ceil(Math.max(...corners.map((c) => c[0]))) + 2;
  const minPy = Math.floor(Math.min(...corners.map((c) => c[1]))) - 2;
  const maxPy = Math.ceil(Math.max(...corners.map((c) => c[1]))) + 2;
  const tx0 = Math.floor(minPx / 256);
  const tx1 = Math.floor(maxPx / 256);
  const ty0 = Math.floor(minPy / 256);
  const ty1 = Math.floor(maxPy / 256);
  const mw = (tx1 - tx0 + 1) * 256;
  const mh = (ty1 - ty0 + 1) * 256;
  console.log(`zoom ${ZOOM}: tiles x ${tx0}..${tx1}, y ${ty0}..${ty1} (${(tx1 - tx0 + 1) * (ty1 - ty0 + 1)} tiles)`);

  // Mosaic of elevations (metres, float32).
  const mosaic = new Float32Array(mw * mh);
  const jobs = [];
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) jobs.push([tx, ty]);
  }
  let done = 0;
  const worker = async () => {
    while (jobs.length > 0) {
      const [tx, ty] = jobs.shift();
      const png = decodePng(await getTile(tx, ty));
      if (png.width !== 256 || png.height !== 256) throw new Error('unexpected tile size');
      const ox = (tx - tx0) * 256;
      const oy = (ty - ty0) * 256;
      for (let y = 0; y < 256; y++) {
        for (let x = 0; x < 256; x++) {
          const k = (y * 256 + x) * png.bpp;
          const e = png.data[k] * 256 + png.data[k + 1] + png.data[k + 2] / 256 - 32768;
          mosaic[(oy + y) * mw + ox + x] = e;
        }
      }
      done++;
    }
  };
  await Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]);
  console.log(`decoded ${done} tiles`);

  // Bilinear sample at a global pixel position (tile pixel centres are at +0.5).
  const sample = (gx, gy) => {
    const fx = gx - tx0 * 256 - 0.5;
    const fy = gy - ty0 * 256 - 0.5;
    const x0 = Math.max(0, Math.min(mw - 2, Math.floor(fx)));
    const y0 = Math.max(0, Math.min(mh - 2, Math.floor(fy)));
    const ax = Math.min(1, Math.max(0, fx - x0));
    const ay = Math.min(1, Math.max(0, fy - y0));
    const i = y0 * mw + x0;
    const top = mosaic[i] * (1 - ax) + mosaic[i + 1] * ax;
    const bot = mosaic[i + mw] * (1 - ax) + mosaic[i + mw + 1] * ax;
    return top * (1 - ay) + bot * ay;
  };

  const N = PIXELS;
  const cell = SIZE_M / N;
  const rgba = new Uint8Array(N * N * 4);
  let minE = Infinity;
  let maxE = -Infinity;
  let minAt = [0, 0];
  let maxAt = [0, 0];
  for (let j = 0; j < N; j++) {
    const north = half - (j + 0.5) * cell;
    for (let i = 0; i < N; i++) {
      const east = -half + (i + 0.5) * cell;
      const [lon, lat] = enToLonLat(east, north);
      const [gx, gy] = lonLatToGlobalPx(lon, lat);
      const e = sample(gx, gy);
      if (e < minE) { minE = e; minAt = [Math.round(east), Math.round(north)]; }
      if (e > maxE) { maxE = e; maxAt = [Math.round(east), Math.round(north)]; }
      // Terrarium, quantised to 1/QUANT m - below the source accuracy at this cell
      // size, and it keeps the PNG small (the low B bits are otherwise noise).
      const v = Math.round((e + 32768) * QUANT) / QUANT;
      const r = Math.floor(v / 256);
      const g = Math.floor(v - r * 256);
      const b = Math.round((v - r * 256 - g) * 256);
      const k = (j * N + i) * 4;
      rgba[k] = r;
      rgba[k + 1] = g;
      rgba[k + 2] = b;
      rgba[k + 3] = 255;
    }
  }
  const centre = sample(...lonLatToGlobalPx(ORIGIN_LON, ORIGIN_LAT));
  const png = encodePngRgba(N, N, rgba);
  await writeFile(join(OUT_DIR, 'stead_60km.png'), png);
  const meta = {
    name: 'stead_60km',
    size_m: SIZE_M,
    pixels: N,
    cell_m: cell,
    origin: { lat: ORIGIN_LAT, lon: ORIGIN_LON, note: 'illustrative valley-floor point, not an observatory location' },
    elevation_m: { min: Math.round(minE * 100) / 100, max: Math.round(maxE * 100) / 100, at_origin: Math.round(centre * 100) / 100, min_at_en_m: minAt, max_at_en_m: maxAt },
    encoding: 'terrarium: elevation_m = R*256 + G + B/256 - 32768 (quantised to 1/' + QUANT + ' m); alpha 255',
    layout: 'row 0 = north edge, column 0 = west edge; pixel centres at east = -size/2 + (i+0.5)*cell, north = size/2 - (j+0.5)*cell',
    projection: 'local equirectangular about the origin (east = dlon * m_per_deg_lon, north = dlat * m_per_deg_lat)',
    m_per_deg: { lat: M_PER_DEG_LAT, lon: M_PER_DEG_LON },
    source: { url: TILE_URL, zoom: ZOOM, tiles: done },
    attribution: ATTRIBUTION,
  };
  await writeFile(join(OUT_DIR, 'stead_60km.json'), JSON.stringify(meta, null, 2) + '\n');
  console.log(`wrote ${N}x${N} heightmap, ${(png.length / 1048576).toFixed(2)} MB; elevation ${minE.toFixed(1)}..${maxE.toFixed(1)} m, origin ${centre.toFixed(1)} m`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
