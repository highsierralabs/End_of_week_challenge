// Small DOM toolkit for the panels: element builder, sliders, selects, swatches, and the
// "ring": a strip of engraved stops that slides under an index mark, like the aperture ring
// of a lens laid flat.

type Child = Node | string | null | undefined | false;
type Attrs = Record<string, string | number | boolean | ((e: Event) => void) | undefined>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, ''), v);
    else if (k === 'class') el.className = String(v);
    else if (k === 'text') el.textContent = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export const clear = (el: Element): void => { while (el.firstChild) el.firstChild.remove(); };

export interface SliderOptions {
  label: string;
  min: number;
  max: number;
  value: number;
  step?: number;
  /** Map the track logarithmically (min must be > 0). */
  log?: boolean;
  fmt?: (v: number) => string;
  /** Called continuously while dragging. */
  onInput: (v: number) => void;
  /** Called once when the drag ends. */
  onChange?: (v: number) => void;
}

export function slider(o: SliderOptions): HTMLElement {
  const fmt = o.fmt ?? ((v: number) => String(Math.round(v * 100) / 100));
  const toTrack = (v: number) => (o.log ? Math.log(v / o.min) / Math.log(o.max / o.min) : (v - o.min) / (o.max - o.min));
  const fromTrack = (t: number) => {
    let v = o.log ? o.min * Math.pow(o.max / o.min, t) : o.min + t * (o.max - o.min);
    if (o.step) v = Math.round(v / o.step) * o.step;
    return Math.min(o.max, Math.max(o.min, v));
  };
  const out = h('output', { class: 'lb-val', text: fmt(o.value) });
  const input = h('input', { type: 'range', min: 0, max: 1, step: 'any', value: toTrack(Math.min(o.max, Math.max(o.min, o.value))), 'aria-label': o.label });
  input.addEventListener('input', () => { const v = fromTrack(Number(input.value)); out.textContent = fmt(v); o.onInput(v); });
  input.addEventListener('change', () => o.onChange?.(fromTrack(Number(input.value))));
  return h('label', { class: 'lb-row' }, h('span', { class: 'lb-lab', text: o.label }), input, out);
}

export function select<T extends string>(label: string, options: readonly (readonly [T, string])[], value: T, onChange: (v: T) => void): HTMLElement {
  const sel = h('select', { 'aria-label': label });
  for (const [v, text] of options) sel.append(h('option', { value: v, text, selected: v === value }));
  sel.value = value;
  sel.addEventListener('change', () => onChange(sel.value as T));
  return h('label', { class: 'lb-row' }, h('span', { class: 'lb-lab', text: label }), sel);
}

export function button(text: string, onClick: () => void, cls = ''): HTMLButtonElement {
  return h('button', { type: 'button', class: `lb-btn ${cls}`.trim(), text, onclick: onClick });
}

export function toggle(label: string, value: boolean, onChange: (v: boolean) => void): HTMLElement {
  const input = h('input', { type: 'checkbox', checked: value });
  input.checked = value;
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'lb-row lb-check' }, h('span', { class: 'lb-lab', text: label }), input);
}

const toHex = (c: readonly number[]): string => `#${c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')}`;
const fromHex = (s: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16) / 255) as [number, number, number];

export const PALETTE: [number, number, number][] = [
  [0.86, 0.86, 0.84], [0.5, 0.5, 0.5], [0.06, 0.06, 0.07], [0.8, 0.12, 0.1], [0.92, 0.45, 0.08], [0.93, 0.78, 0.12],
  [0.2, 0.6, 0.25], [0.1, 0.55, 0.6], [0.12, 0.25, 0.7], [0.45, 0.2, 0.65], [0.85, 0.3, 0.5], [0.45, 0.3, 0.2],
];

export function swatches(label: string, value: readonly number[], onChange: (c: [number, number, number]) => void): HTMLElement {
  const wrap = h('div', { class: 'lb-swatches' });
  const custom = h('input', { type: 'color', value: toHex(value), 'aria-label': `${label}: custom colour` });
  const mark = () => { for (const b of wrap.querySelectorAll('button')) b.classList.toggle('on', b.dataset.c === custom.value); };
  for (const c of PALETTE) {
    const b = h('button', { type: 'button', class: 'lb-swatch', style: `background:${toHex(c)}`, 'aria-label': `colour ${toHex(c)}` });
    b.dataset.c = toHex(c);
    b.addEventListener('click', () => { custom.value = toHex(c); mark(); onChange(c); });
    wrap.append(b);
  }
  custom.addEventListener('input', () => { mark(); onChange(fromHex(custom.value)); });
  wrap.append(custom);
  mark();
  return h('div', { class: 'lb-row lb-row-wrap' }, h('span', { class: 'lb-lab', text: label }), wrap);
}

export interface RingOptions {
  label: string;
  /** The engraved stops, in order. */
  stops: readonly number[];
  value: number;
  fmt: (v: number) => string;
  /** Label for a stop on the strip (defaults to fmt). */
  tick?: (v: number) => string;
  /** Minor divisions between stops that the ring clicks into (0 = free). */
  detents?: number;
  onInput: (v: number) => void;
  onChange?: (v: number) => void;
}

const RING_STEP = 46;
let ringsHeld = 0;
/** True while a ring is being dragged (the panel must not rebuild it then). */
export const ringHeld = (): boolean => ringsHeld > 0;

/** A lens ring. Values between stops are interpolated geometrically. */
export function ring(o: RingOptions): HTMLElement {
  const n = o.stops.length;
  const toPos = (v: number): number => {
    if (v <= o.stops[0]!) return 0;
    for (let i = 0; i < n - 1; i++) {
      const a = o.stops[i]!;
      const b = o.stops[i + 1]!;
      if (v <= b) return i + (a > 0 && b > 0 ? Math.log(v / a) / Math.log(b / a) : (v - a) / (b - a));
    }
    return n - 1;
  };
  const fromPos = (p: number): number => {
    p = Math.min(n - 1, Math.max(0, p));
    if (o.detents) p = Math.round(p * o.detents) / o.detents;
    const i = Math.min(n - 2, Math.floor(p));
    const a = o.stops[i]!;
    const b = o.stops[i + 1]!;
    const f = p - i;
    return a > 0 && b > 0 ? a * Math.pow(b / a, f) : a + (b - a) * f;
  };
  let pos = toPos(o.value);
  const strip = h('div', { class: 'lb-ring-strip' });
  o.stops.forEach((s, i) => {
    strip.append(h('span', { class: 'lb-ring-tick major', style: `left:${i * RING_STEP}px` }));
    strip.append(h('span', { class: 'lb-ring-num', style: `left:${i * RING_STEP}px`, text: (o.tick ?? o.fmt)(s) }));
    if (i < n - 1) for (let k = 1; k < 3; k++) strip.append(h('span', { class: 'lb-ring-tick', style: `left:${(i + k / 3) * RING_STEP}px` }));
  });
  const readout = h('output', { class: 'lb-val', text: o.fmt(o.value) });
  const body = h('div', { class: 'lb-ring', role: 'slider', tabindex: 0, 'aria-label': o.label, 'aria-valuetext': o.fmt(o.value) }, strip, h('span', { class: 'lb-ring-index' }));
  const place = () => { strip.style.transform = `translateX(${-pos * RING_STEP}px)`; };
  const emit = (final: boolean) => {
    const v = fromPos(pos);
    readout.textContent = o.fmt(v);
    body.setAttribute('aria-valuetext', o.fmt(v));
    if (final) o.onChange?.(v); else o.onInput(v);
  };
  place();
  let dragX = 0;
  let dragPos = 0;
  let dragging = false;
  body.addEventListener('pointerdown', (e) => { dragging = true; ringsHeld++; dragX = e.clientX; dragPos = pos; body.setPointerCapture(e.pointerId); body.focus({ preventScroll: true }); e.preventDefault(); });
  body.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    pos = Math.min(n - 1, Math.max(0, dragPos - (e.clientX - dragX) / RING_STEP));
    if (o.detents) pos = Math.round(pos * o.detents) / o.detents;
    place();
    emit(false);
  });
  const end = () => { if (dragging) { dragging = false; ringsHeld = Math.max(0, ringsHeld - 1); emit(false); emit(true); } };
  body.addEventListener('pointerup', end);
  body.addEventListener('pointercancel', end);
  body.addEventListener('keydown', (e) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    pos = Math.min(n - 1, Math.max(0, pos + d / (o.detents || 3)));
    place();
    emit(false);
    emit(true);
  });
  body.addEventListener('wheel', (e) => {
    // Only a ring the visitor has clicked turns with the wheel; otherwise the panel scrolls.
    if (document.activeElement !== body) return;
    e.preventDefault();
    pos = Math.min(n - 1, Math.max(0, pos + Math.sign(e.deltaY) / (o.detents || 3)));
    place();
    emit(false);
    emit(true);
  }, { passive: false });
  return h('div', { class: 'lb-ringrow' }, h('div', { class: 'lb-ringhead' }, h('span', { class: 'lb-lab', text: o.label }), readout), body);
}

/** A titled group of controls. */
export function group(title: string, ...children: Child[]): HTMLElement {
  return h('section', { class: 'lb-group' }, h('h3', { text: title }), ...children);
}
