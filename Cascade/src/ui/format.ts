// Number formatting shared by the UI: SI prefixes, energies, times, compass points.

const MINUS = '−';

function sig(x: number, digits: number): string {
  // toPrecision switches to exponent form when the integer part has more digits than asked.
  const s = Math.abs(x) >= 10 ** digits ? Math.round(x).toString() : x.toPrecision(digits);
  return s.replace('-', MINUS);
}

/** Pretty-print with an SI prefix: 1234567 -> "1.23 M". Values below 1 keep plain notation. */
export function si(v: number, digits = 3): string {
  if (!Number.isFinite(v)) return '—';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a < 1) return a < 1e-3 ? sci(v, 2) : sig(v, Math.max(1, digits - 1));
  const prefixes = ['', 'k', 'M', 'G', 'T', 'P', 'E', 'Z'];
  let i = Math.min(prefixes.length - 1, Math.floor(Math.log10(a) / 3));
  let m = v / 10 ** (3 * i);
  if (Math.abs(Number(m.toPrecision(digits))) >= 1000 && i < prefixes.length - 1) {
    i++;
    m = v / 10 ** (3 * i);
  }
  if (i === 0 && Number.isInteger(v)) return String(v).replace('-', MINUS);
  return `${sig(m, digits)}${i ? ' ' + prefixes[i] : ''}`;
}

const SUP: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻',
};

export function superscript(n: number | string): string {
  return String(n).split('').map((ch) => SUP[ch] ?? ch).join('');
}

/** Scientific notation in plain Unicode: 3.2e-5 -> "3.2×10⁻⁵". */
export function sci(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return '—';
  if (v === 0) return '0';
  const e = Math.floor(Math.log10(Math.abs(v)));
  let m = v / 10 ** e;
  let ee = e;
  if (Math.abs(Number(m.toPrecision(digits))) >= 10) { m /= 10; ee += 1; }
  const ms = sig(m, digits);
  if (ms === '1' || ms === '1.0' || ms === '1.00') return `10${superscript(ee)}`;
  return `${ms}×10${superscript(ee)}`;
}

const E_PREFIX = ['eV', 'keV', 'MeV', 'GeV', 'TeV', 'PeV', 'EeV', 'ZeV'];

/** Energy in eV -> "1.00 PeV". */
export function energyEV(eV: number, digits = 3): string {
  if (!Number.isFinite(eV) || eV <= 0) return '—';
  let i = Math.max(0, Math.min(E_PREFIX.length - 1, Math.floor(Math.log10(eV) / 3)));
  let m = eV / 10 ** (3 * i);
  if (Number(m.toPrecision(digits)) >= 1000 && i < E_PREFIX.length - 1) { i++; m = eV / 10 ** (3 * i); }
  return `${sig(m, digits)} ${E_PREFIX[i]}`;
}

export function energyGeV(gev: number, digits = 3): string {
  return energyEV(gev * 1e9, digits);
}

/** Time in ns -> "812 ns" / "12.4 µs" / "1.20 ms", with a fixed number of significant digits. */
export function timeNs(ns: number, digits = 3): string {
  if (!Number.isFinite(ns)) return '—';
  const a = Math.abs(ns);
  if (a < 1e3) return `${a < 10 ? ns.toFixed(1) : ns.toFixed(0)} ns`.replace('-', MINUS);
  if (a < 1e6) return `${sig(ns / 1e3, digits)} µs`;
  if (a < 1e9) return `${sig(ns / 1e6, digits)} ms`;
  return `${sig(ns / 1e9, digits)} s`;
}

/** Distance in m -> "312 m" / "1.25 km". */
export function metres(m: number): string {
  if (!Number.isFinite(m)) return '—';
  const a = Math.abs(m);
  if (a < 10) return `${m.toFixed(1)} m`.replace('-', MINUS);
  if (a < 1000) return `${m.toFixed(0)} m`.replace('-', MINUS);
  return `${sig(m / 1000, a < 1e4 ? 3 : 4)} km`;
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

/** Bearing in degrees clockwise from north -> 16-point compass name. */
export function compass(deg: number): string {
  const d = ((deg % 360) + 360) % 360;
  return COMPASS[Math.round(d / 22.5) % 16]!;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
