// Re-fetches the reference data Wheelwork is checked against and regenerates the two compact
// modules in src/data from it.
//
//   node scripts/fetch-data.mjs            fetch every source into data-src/, then regenerate
//   node scripts/fetch-data.mjs --offline  regenerate src/data from the files already in data-src/
//
// Sources (all listed with their transformations in data-src/SOURCES.md):
//   - JPL "Approximate Positions of the Planets" page (Standish's Keplerian elements);
//   - ERFA moon98.c and p06e.c (the Meeus lunar series and the IAU 2006 precession polynomials);
//   - the JPL Horizons API, geometric vectors in the J2000 ecliptic frame;
//   - Fred Espenak's Five Millennium eclipse catalogues at NASA's GSFC.
//
// Requests are sequential with a pause between them, and carry a generic user agent. Nothing
// about the machine or the project is sent. Output on the console is ASCII.

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(ROOT, 'data-src');
const OUT = join(ROOT, 'src', 'data');
const OFFLINE = process.argv.includes('--offline');
const USER_AGENT = 'Mozilla/5.0 (compatible; data-fetch/1.0)';
const PAUSE_MS = 1200;
const AU_KM = 149597870.7; // IAU 2012 definition; Horizons prints the same value in its header
const RAD = Math.PI / 180;

// ---------------------------------------------------------------------------------------------
// Sample dates. Stratified sampling: one date drawn at a fixed pseudo-random offset inside each
// equal stratum, so no sample spacing can alias with an orbital period and the list is the same
// on every run. JDs are rounded to 0.01 day so the value shipped is the value requested.
// ---------------------------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function stratified(jd0, jd1, count, seed) {
  const rnd = mulberry32(seed);
  const width = (jd1 - jd0) / count;
  const out = [];
  for (let k = 0; k < count; k++) out.push(Math.round((jd0 + (k + rnd()) * width) * 100) / 100);
  return out;
}

const JD_M1000 = 1355807.5; // -1000 January 1.0 (1001 BC, Julian calendar)
const JD_1800 = 2378496.5;
const JD_1900 = 2415020.5;
const JD_2100 = 2488069.5;
const JD_3000 = 2816787.5;

// 160 dates, one per 25 years, 1001 BC to AD 3000: shared by every body.
const LONG_SPAN = stratified(JD_M1000, JD_3000, 160, 20261127);
// 300 dates, one per year, 1800 to 2100: the planets.
const PLANET_DENSE = stratified(JD_1800, JD_2100, 300, 1800);
// 300 dates, one per 243.5 days, 1900 to 2100: the Moon and the geocentric Sun.
const MOON_DENSE = stratified(JD_1900, JD_2100, 300, 1900);

const sorted = (list) => [...list].sort((a, b) => a - b);
const PLANET_JDS = sorted([...LONG_SPAN, ...PLANET_DENSE]);
const MOON_JDS = sorted([...LONG_SPAN, ...MOON_DENSE]);

// Horizons targets. The planets are heliocentric (centre 500@10 = Sun body centre); the Moon and
// the Sun are geocentric (centre 500@399 = Earth body centre). See SOURCES.md for the choice of
// the system barycentres 3, 4, 5 and 6.
const BODIES = [
  { key: 'mercury', command: '199', center: '500@10', jds: PLANET_JDS },
  { key: 'venus', command: '299', center: '500@10', jds: PLANET_JDS },
  { key: 'earth', command: '3', center: '500@10', jds: PLANET_JDS },
  { key: 'mars', command: '4', center: '500@10', jds: PLANET_JDS },
  { key: 'jupiter', command: '5', center: '500@10', jds: PLANET_JDS },
  { key: 'saturn', command: '6', center: '500@10', jds: PLANET_JDS },
  { key: 'moon', command: '301', center: '500@399', jds: MOON_JDS },
  { key: 'sun', command: '10', center: '500@399', jds: MOON_JDS },
];
const CHUNK = 80;

const STATIC_SOURCES = [
  { url: 'https://ssd.jpl.nasa.gov/planets/approx_pos.html', file: 'jpl/approx_pos.html' },
  { url: 'https://raw.githubusercontent.com/liberfa/erfa/master/src/moon98.c', file: 'erfa/moon98.c' },
  { url: 'https://raw.githubusercontent.com/liberfa/erfa/master/src/p06e.c', file: 'erfa/p06e.c' },
  { url: 'https://eclipse.gsfc.nasa.gov/SEcat5/SE1901-2000.html', file: 'eclipses/SE1901-2000.html' },
  { url: 'https://eclipse.gsfc.nasa.gov/SEcat5/SE2001-2100.html', file: 'eclipses/SE2001-2100.html' },
  { url: 'https://eclipse.gsfc.nasa.gov/LEcat5/LE1901-2000.html', file: 'eclipses/LE1901-2000.html' },
  { url: 'https://eclipse.gsfc.nasa.gov/LEcat5/LE2001-2100.html', file: 'eclipses/LE2001-2100.html' },
];

// ---------------------------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------------------------

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function get(url) {
  let lastError = new Error('no attempt made');
  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: controller.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.log('  attempt ' + attempt + ' failed: ' + lastError.message);
      await sleep(PAUSE_MS * 3 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

function save(relative, bytes) {
  const target = join(RAW, relative);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
}

function horizonsUrl(body, jds) {
  const url = new URL('https://ssd.jpl.nasa.gov/api/horizons.api');
  const params = {
    format: 'text',
    COMMAND: "'" + body.command + "'",
    OBJ_DATA: "'NO'",
    MAKE_EPHEM: "'YES'",
    EPHEM_TYPE: "'VECTORS'",
    CENTER: "'" + body.center + "'",
    REF_PLANE: "'ECLIPTIC'",
    REF_SYSTEM: "'ICRF'",
    OUT_UNITS: "'AU-D'",
    VEC_TABLE: "'1'",
    VEC_CORR: "'NONE'",
    CSV_FORMAT: "'YES'",
    TIME_TYPE: "'TDB'",
    TLIST_TYPE: "'JD'",
    TLIST: "'" + jds.map((jd) => jd.toFixed(2)).join(',') + "'",
  };
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  return url.toString();
}

const pad2 = (n) => String(n).padStart(2, '0');

async function fetchAll() {
  for (const src of STATIC_SOURCES) {
    console.log('GET ' + src.url);
    save(src.file, await get(src.url));
    await sleep(PAUSE_MS);
  }
  rmSync(join(RAW, 'horizons'), { recursive: true, force: true });
  const log = ['# One line per raw Horizons response in this folder: file, then the exact request URL.', ''];
  for (const body of BODIES) {
    for (let i = 0, part = 0; i < body.jds.length; i += CHUNK, part++) {
      const url = horizonsUrl(body, body.jds.slice(i, i + CHUNK));
      const file = body.key + '-' + pad2(part) + '.txt';
      console.log('GET Horizons ' + file);
      const bytes = await get(url);
      if (!bytes.toString('utf8').includes('$$SOE')) throw new Error('Horizons returned no ephemeris for ' + file);
      save('horizons/' + file, bytes);
      log.push(file + '  ' + url);
      await sleep(PAUSE_MS);
    }
  }
  save('horizons/REQUESTS.txt', Buffer.from(log.join('\n') + '\n', 'utf8'));
}

// ---------------------------------------------------------------------------------------------
// Horizons responses -> src/data/horizons.ts
// ---------------------------------------------------------------------------------------------

function parseHorizons(key) {
  const dir = join(RAW, 'horizons');
  const files = readdirSync(dir).filter((name) => name.startsWith(key + '-') && name.endsWith('.txt')).sort();
  if (files.length === 0) throw new Error('no raw Horizons files for ' + key);
  const rows = [];
  for (const name of files) {
    const text = readFileSync(join(dir, name), 'utf8');
    if (!text.includes('Reference frame : Ecliptic of J2000.0')) throw new Error(name + ': unexpected reference frame');
    if (!text.includes('Output units    : AU-D')) throw new Error(name + ': unexpected units');
    const start = text.indexOf('$$SOE');
    const end = text.indexOf('$$EOE');
    if (start < 0 || end < 0) throw new Error(name + ': no ephemeris block');
    for (const line of text.slice(start + 5, end).split('\n')) {
      const cells = line.split(',').map((cell) => cell.trim());
      if (cells.length < 5) continue;
      const jd = Number(cells[0]);
      const x = Number(cells[2]);
      const y = Number(cells[3]);
      const z = Number(cells[4]);
      if (![jd, x, y, z].every(Number.isFinite)) throw new Error(name + ': bad row ' + line);
      const r = Math.hypot(x, y, z);
      let lon = Math.atan2(y, x) / RAD;
      if (lon < 0) lon += 360;
      rows.push({ jd, lon, lat: Math.asin(z / r) / RAD, r });
    }
  }
  rows.sort((a, b) => a.jd - b.jd);
  return rows;
}

// Shortest decimal text for a rounded number: no trailing zeros.
const num = (value, digits) => String(Number(value.toFixed(digits)));

function writeHorizons() {
  const out = [];
  out.push('// GENERATED by scripts/fetch-data.mjs from data-src/horizons/*.txt. Do not edit by hand.');
  out.push('//');
  out.push('// JPL Horizons (ephemeris DE441), geometric positions in the ecliptic and mean equinox of J2000.0,');
  out.push('// retrieved 2026-11-27. Times are Julian Dates in TDB. Longitudes and latitudes in degrees.');
  out.push('//   planets: heliocentric (Sun body centre). mercury 199, venus 299, earth = Earth-Moon barycentre 3,');
  out.push('//            mars, jupiter, saturn = the system barycentres 4, 5, 6. Radius in au.');
  out.push('//   moon:    geocentric (Earth body centre), target 301. Distance in km.');
  out.push('//   sun:     geocentric (Earth body centre), target 10. Radius in au. Same dates as the Moon.');
  out.push('// Rounded to 1e-6 degree, 1e-9 au and 0.1 km. See data-src/SOURCES.md.');
  out.push('');
  out.push("type PlanetKey = 'mercury' | 'venus' | 'earth' | 'mars' | 'jupiter' | 'saturn';");
  out.push('type Row = readonly [jd: number, lonDeg: number, latDeg: number, r: number];');
  out.push('');
  out.push('export const HORIZONS: {');
  out.push('  readonly planets: Readonly<Record<PlanetKey, readonly Row[]>>;');
  out.push('  readonly moon: readonly Row[];');
  out.push('  readonly sun: readonly Row[];');
  out.push('} = {');
  out.push('  planets: {');
  const counts = {};
  const emit = (key, indent, toKm) => {
    const rows = parseHorizons(key);
    counts[key] = rows.length;
    out.push(indent + key + ': [');
    for (const row of rows) {
      const radius = toKm ? num(row.r * AU_KM, 1) : num(row.r, 9);
      out.push(indent + '  [' + num(row.jd, 2) + ',' + num(row.lon, 6) + ',' + num(row.lat, 6) + ',' + radius + '],');
    }
    out.push(indent + '],');
  };
  for (const key of ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn']) emit(key, '    ', false);
  out.push('  },');
  emit('moon', '  ', true);
  emit('sun', '  ', false);
  out.push('};');
  out.push('');
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'horizons.ts'), out.join('\n'), 'utf8');
  return counts;
}

// ---------------------------------------------------------------------------------------------
// Eclipse catalogues -> src/data/eclipse-catalogue.ts
// ---------------------------------------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Gregorian calendar date to Julian Date (Meeus, Astronomical Algorithms, ch. 7). Every catalogue
// date here is after 1582.
function jdGregorian(year, month, day) {
  let y = year;
  let m = month;
  if (m <= 2) {
    y -= 1;
    m += 12;
  }
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + b - 1524.5;
}

function parseCatalogue(file, kind) {
  const html = readFileSync(join(RAW, 'eclipses', file), 'utf8');
  const text = html.replace(/<[^>]*>/g, '');
  const rows = [];
  // Catalogue number, calendar date, TD of greatest eclipse, delta T, lunation, saros, type,
  // QLE or QSE, gamma. The columns after gamma are not used.
  const line = /^\s*(\d{5})\s+(-?\d{4}) ([A-Z][a-z]{2}) (\d{2})\s+(\d{2}):(\d{2}):(\d{2})\s+(-?\d+)\s+(-?\d+)\s+(\d+)\s+([A-Z][A-Za-z0-9+-]?)\s+(\S+)\s+(-?\d+\.\d+)\s/;
  for (const raw of text.split('\n')) {
    const m = line.exec(raw);
    if (!m) continue;
    const month = MONTHS.indexOf(m[3]) + 1;
    if (month === 0) throw new Error(file + ': bad month in ' + raw);
    const dayFraction = (Number(m[5]) * 3600 + Number(m[6]) * 60 + Number(m[7])) / 86400;
    const jd = jdGregorian(Number(m[2]), month, Number(m[4])) + dayFraction;
    const type = m[11].charAt(0);
    const allowed = kind === 's' ? 'PATH' : 'NPT';
    if (!allowed.includes(type)) throw new Error(file + ': unexpected type ' + m[11]);
    rows.push({ jd, kind, type, gamma: Number(m[13]) });
  }
  return rows;
}

function writeEclipses() {
  const solar = [...parseCatalogue('SE1901-2000.html', 's'), ...parseCatalogue('SE2001-2100.html', 's')];
  const lunar = [...parseCatalogue('LE1901-2000.html', 'l'), ...parseCatalogue('LE2001-2100.html', 'l')];
  const all = [...solar, ...lunar].sort((a, b) => a.jd - b.jd);
  const out = [];
  out.push('// GENERATED by scripts/fetch-data.mjs from data-src/eclipses/*.html. Do not edit by hand.');
  out.push('//');
  out.push("// Eclipse Predictions by Fred Espenak, NASA's GSFC.");
  out.push('// Five Millennium Catalogs of Solar and Lunar Eclipses, 1901 to 2100, retrieved 2026-11-27 from');
  out.push('// eclipse.gsfc.nasa.gov: ' + solar.length + ' solar and ' + lunar.length + ' lunar eclipses.');
  out.push('// jd is the instant of greatest eclipse as a Julian Date in Terrestrial Dynamical Time, rounded to');
  out.push("// 1e-5 day (0.9 s). type is the first letter of the catalogue's type code: solar P partial, A annular,");
  out.push('// T total, H hybrid; lunar N penumbral, P partial, T total. gamma is in Earth equatorial radii.');
  out.push('// See data-src/SOURCES.md.');
  out.push('');
  out.push('export interface CatalogueEclipse {');
  out.push('  /** Greatest eclipse, Julian Date (TD). */');
  out.push('  readonly jd: number;');
  out.push("  readonly kind: 'solar' | 'lunar';");
  out.push('  /** Solar P, A, T or H; lunar N, P or T. */');
  out.push('  readonly type: string;');
  out.push("  /** Least distance of the shadow axis from the Earth's centre (solar) or of the Moon's centre from the");
  out.push('   *  shadow axis (lunar), in Earth equatorial radii; positive when north. */');
  out.push('  readonly gamma: number;');
  out.push('}');
  out.push('');
  out.push("// [jd, 's' solar or 'l' lunar, type, gamma], sorted by jd.");
  out.push("const ROWS: readonly (readonly [number, 's' | 'l', string, number])[] = [");
  for (const row of all) {
    out.push('  [' + num(row.jd, 5) + ",'" + row.kind + "','" + row.type + "'," + num(row.gamma, 4) + '],');
  }
  out.push('];');
  out.push('');
  out.push('export const ECLIPSES: readonly CatalogueEclipse[] = ROWS.map(([jd, kind, type, gamma]) => ({');
  out.push('  jd,');
  out.push("  kind: kind === 's' ? 'solar' : 'lunar',");
  out.push('  type,');
  out.push('  gamma,');
  out.push('}));');
  out.push('');
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'eclipse-catalogue.ts'), out.join('\n'), 'utf8');
  return { solar: solar.length, lunar: lunar.length };
}

// ---------------------------------------------------------------------------------------------

async function main() {
  if (OFFLINE) console.log('offline: regenerating from data-src only');
  else await fetchAll();
  const counts = writeHorizons();
  for (const [key, count] of Object.entries(counts)) console.log('horizons ' + key + ': ' + count + ' rows');
  const eclipses = writeEclipses();
  console.log('eclipses: ' + eclipses.solar + ' solar, ' + eclipses.lunar + ' lunar');
  console.log('wrote src/data/horizons.ts and src/data/eclipse-catalogue.ts');
}

main().catch((err) => {
  console.log('FAILED: ' + (err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
