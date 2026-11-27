// One palette for the whole app: the renderer colours tracks with CLASS_COLORS[c].hex,
// the UI (swatches, charts) with CLASS_COLORS[c].css. Indexed by RClass.
import { RClass, RCLASS_COUNT } from '../physics/types';

export interface ClassColor {
  /** 0xRRGGBB, for three.js Color / TSL uniforms. */
  hex: number;
  /** '#rrggbb', for CSS and canvas 2D. */
  css: string;
  /** Plain-English name. */
  label: string;
  /** Short particle symbol used in legends. */
  symbol: string;
}

export const CLASS_COLORS: readonly ClassColor[] = [
  { hex: 0xffcf5a, css: '#ffcf5a', label: 'photon', symbol: 'γ' },
  { hex: 0x4fd8ff, css: '#4fd8ff', label: 'electron', symbol: 'e⁻' },
  { hex: 0xff5fd2, css: '#ff5fd2', label: 'positron', symbol: 'e⁺' },
  { hex: 0x7dff7a, css: '#7dff7a', label: 'muon', symbol: 'μ±' },
  { hex: 0xff7a3d, css: '#ff7a3d', label: 'hadron', symbol: 'h' },
];

if (CLASS_COLORS.length !== RCLASS_COUNT) throw new Error('CLASS_COLORS must cover every RClass');

/** Hex numbers indexed by RClass. */
export const CLASS_HEX: readonly number[] = CLASS_COLORS.map((c) => c.hex);
/** CSS colour strings indexed by RClass. */
export const CLASS_CSS: readonly string[] = CLASS_COLORS.map((c) => c.css);

export function classColor(c: RClass): ClassColor {
  return CLASS_COLORS[c]!;
}

/** UI accent (controls, X_max marker): a pale periwinkle that sits between the class hues. */
export const ACCENT = { hex: 0xa7b6ff, css: '#a7b6ff' } as const;
/** Charged-total curve and reference fits. */
export const NEUTRAL_CSS = '#eef2fb';
/** e+- combined (lateral / timing charts) uses the electron hue. */
export const EPM_CSS = CLASS_COLORS[RClass.ELECTRON]!.css;
