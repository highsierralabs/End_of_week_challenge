// The inspector: Scene (objects and the selected object's shape, place and material), Camera
// (the lens rings) and Darkroom (exposure, colour, glare, export).
import { type GasName, type GlassName, type LightSpectrum, type Material, type MetalName, type SceneObject, type Shape, type ToneCurve, newId } from '../core/scene';
import { REST_GAP, lensParams, restHeight } from '../core/shapes';
import { glassIndex } from '../core/spectrum';
import { button, clear, group, h, ring, ringHeld, select, slider, swatches, toggle } from './controls';
import type { Interaction } from './interact';
import type { Store } from './store';

const GAS_LABEL: Record<GasName, string> = { H: 'Hydrogen', He: 'Helium', Ne: 'Neon', Na: 'Sodium', Hg: 'Mercury', Ar: 'Argon', Kr: 'Krypton', Xe: 'Xenon' };
const GLASS_LABEL: Record<GlassName, string> = { bk7: 'Crown glass (BK7)', silica: 'Fused silica', sf10: 'Flint glass (SF10)', sf11: 'Dense flint (SF11)', diamond: 'Diamond', water: 'Water', sapphire: 'Sapphire' };
const METAL_LABEL: Record<MetalName, string> = { gold: 'Gold', silver: 'Silver', copper: 'Copper', aluminium: 'Aluminium' };
const MATERIAL_LABEL: Record<Material['kind'], string> = { diffuse: 'Matte', plastic: 'Glossy', metal: 'Metal', mirror: 'Mirror', glass: 'Glass', light: 'Light', beam: 'Beam', grating: 'Grating' };

const mm = (v: number): string => (Math.abs(v) < 1 ? `${Math.round(v * 1000)} mm` : `${v.toFixed(2)} m`);
const deg = (v: number): string => `${Math.round(v)}°`;

type SpectrumChoice = 'warm' | 'day' | 'd65' | 'laser' | 'led' | `gas:${GasName}`;
function spectrumChoice(s: LightSpectrum): SpectrumChoice {
  if (s.kind === 'gas') return `gas:${s.gas}`;
  if (s.kind === 'blackbody') return s.kelvin < 4000 ? 'warm' : 'day';
  if (s.kind === 'laser' || s.kind === 'led') return s.kind;
  return 'd65';
}
function spectrumFrom(c: SpectrumChoice): LightSpectrum {
  if (c.startsWith('gas:')) return { kind: 'gas', gas: c.slice(4) as GasName };
  if (c === 'warm') return { kind: 'blackbody', kelvin: 2800 };
  if (c === 'day') return { kind: 'blackbody', kelvin: 5500 };
  if (c === 'laser') return { kind: 'laser', nm: 633 };
  if (c === 'led') return { kind: 'led', nm: 460, width: 25 };
  return { kind: 'd65' };
}

function defaultMaterial(kind: Material['kind'], old: Material): Material {
  const color = 'color' in old ? old.color : ([0.8, 0.8, 0.78] as [number, number, number]);
  const spectrum: LightSpectrum = 'spectrum' in old ? old.spectrum : { kind: 'blackbody', kelvin: 5000 };
  switch (kind) {
    case 'diffuse': return { kind, color };
    case 'plastic': return { kind, color, rough: 0 };
    case 'metal': return { kind, metal: 'gold', rough: 0.15 };
    case 'mirror': return { kind };
    case 'glass': return { kind, glass: 'bk7' };
    case 'light': return { kind, spectrum, lumens: 'lumens' in old ? old.lumens : 800 };
    case 'beam': return { kind, spectrum, lumens: 'lumens' in old ? Math.min(old.lumens, 600) : 300, spread: 15 };
    case 'grating': return { kind, linesPerMm: 600 };
  }
}

interface AddItem { label: string; make: () => { name: string; shape: Shape; material: Material; lift?: number; dx?: number; rot?: [number, number, number]; note?: string } }
const GLASS: Material = { kind: 'glass', glass: 'bk7' };
const ADD: AddItem[] = [
  { label: 'Sphere', make: () => ({ name: 'Sphere', shape: { kind: 'sphere', r: 0.09 }, material: GLASS }) },
  { label: 'Block', make: () => ({ name: 'Block', shape: { kind: 'box', half: [0.08, 0.08, 0.08] }, material: { kind: 'plastic', color: [0.12, 0.25, 0.7], rough: 0.2 } }) },
  { label: 'Cylinder', make: () => ({ name: 'Cylinder', shape: { kind: 'cylinder', r: 0.06, h: 0.1 }, material: { kind: 'metal', metal: 'copper', rough: 0.2 } }) },
  { label: 'Prism', make: () => ({ name: 'Prism', shape: { kind: 'prism', sides: 3, apex: 60, size: 0.12, h: 0.1 }, material: { kind: 'glass', glass: 'sf11' } }) },
  { label: 'Lens', make: () => ({ name: 'Lens', shape: { kind: 'lens', r: 0.08, t: 0.03, r1: 0.25, r2: 0.25 }, material: GLASS, lift: 0.1, rot: [90, 0, 0] }) },
  { label: 'Diamond', make: () => ({ name: 'Diamond', shape: { kind: 'gem', cut: 'brilliant', r: 0.06 }, material: { kind: 'glass', glass: 'diamond' }, rot: [180, 0, 0], lift: 0.0 }) },
  { label: 'Mirror', make: () => ({ name: 'Mirror', shape: { kind: 'box', half: [0.15, 0.12, 0.005] }, material: { kind: 'mirror' } }) },
  { label: 'Wine glass', make: () => ({ name: 'Wine glass', shape: { kind: 'mesh', mesh: 'wineglass', size: 0.3 }, material: GLASS }) },
  { label: 'Tumbler', make: () => ({ name: 'Tumbler', shape: { kind: 'mesh', mesh: 'tumbler', size: 0.14 }, material: GLASS }) },
  { label: 'Knot', make: () => ({ name: 'Knot', shape: { kind: 'mesh', mesh: 'knot', size: 0.22 }, material: { kind: 'metal', metal: 'gold', rough: 0.1 } }) },
  { label: 'Cat', make: () => ({ name: 'Cat', shape: { kind: 'mesh', mesh: 'cat', size: 0.24 }, material: { kind: 'glass', glass: 'bk7', tint: [0.1, 0.55, 0.6], density: 12 } }) },
  { label: 'Bulb', make: () => ({ name: 'Bulb', shape: { kind: 'sphere', r: 0.03 }, material: { kind: 'light', spectrum: { kind: 'blackbody', kelvin: 2800 }, lumens: 800 }, lift: 0.35 }) },
  { label: 'Softbox', make: () => ({ name: 'Softbox', shape: { kind: 'quad', half: [0.3, 0.2] }, material: { kind: 'light', spectrum: { kind: 'blackbody', kelvin: 5500 }, lumens: 2000 }, lift: 1.0, rot: [180, 0, 0] }) },
  { label: 'Gas tube', make: () => ({ name: 'Gas tube', shape: { kind: 'cylinder', r: 0.012, h: 0.25 }, material: { kind: 'light', spectrum: { kind: 'gas', gas: 'Ne' }, lumens: 300 }, lift: 0.3, rot: [0, 0, 90] }) },
  { label: 'Spotlight', make: () => ({ name: 'Spotlight', shape: { kind: 'disc', r: 0.04 }, material: { kind: 'beam', spectrum: { kind: 'blackbody', kelvin: 5500 }, lumens: 300, spread: 12 }, lift: 0.9, rot: [180, 0, 0] }) },
  { label: 'Laser', make: () => ({ name: 'Laser', shape: { kind: 'disc', r: 0.004 }, material: { kind: 'beam', spectrum: { kind: 'laser', nm: 633 }, lumens: 1, spread: 0.08 }, lift: 0.3, dx: -0.5, rot: [0, 0, -120], note: 'The laser points down at the table: look for its red spot. In clear air the beam itself is invisible.' }) },
];

export class Panel {
  private tab: 'scene' | 'camera' | 'darkroom' = 'scene';
  private readonly body = h('div', { class: 'lb-panel-body' });
  private readonly tabs = h('div', { class: 'lb-tabs', role: 'tablist' });
  /** Called when the visitor asks for a full-resolution render. */
  onExport: ((width: number, height: number, samples: number) => void) | null = null;
  onSavePicture: (() => void) | null = null;
  onLoadFile: (() => void) | null = null;
  exportBusy = false;

  constructor(readonly root: HTMLElement, private readonly store: Store, private readonly interaction: Interaction) {
    root.append(this.tabs, this.body);
    for (const [id, label] of [['scene', 'Scene'], ['camera', 'Camera'], ['darkroom', 'Darkroom']] as const) {
      this.tabs.append(h('button', { type: 'button', role: 'tab', class: 'lb-tab', 'data-tab': id, text: label, onclick: () => { this.tab = id; this.render(); } }));
    }
    store.on((c) => {
      // Rebuild when the thing shown changes under us; sliders update themselves while dragged.
      if (c === 'load' || c === 'select') this.render();
      else if (c === 'scene' && this.tab === 'scene') this.syncPosition();
      else if (c === 'camera' && this.tab === 'camera') this.syncCamera();
    });
  }

  show(tab: 'scene' | 'camera' | 'darkroom'): void { this.tab = tab; this.render(); }

  render(): void {
    for (const b of this.tabs.querySelectorAll('button')) b.setAttribute('aria-selected', String(b.dataset.tab === this.tab));
    clear(this.body);
    if (this.tab === 'scene') this.renderScene();
    else if (this.tab === 'camera') this.renderCamera();
    else this.renderDarkroom();
  }

  // ------------------------------------------------------------------ scene tab
  /** A slider bound to the scene: snapshot once per drag, apply while dragging. */
  private bound(label: string, min: number, max: number, value: number, set: (v: number) => void, opts: { log?: boolean; step?: number; fmt?: (v: number) => string } = {}, done?: () => void): HTMLElement {
    let armed = true;
    return slider({
      label, min, max, value, ...opts,
      onInput: (v) => {
        if (armed) { this.store.snapshot(); armed = false; this.interaction.previewScale = 2; }
        set(v);
        this.store.view.tracer.setScale(2);
        this.store.apply();
      },
      onChange: () => { armed = true; this.store.view.tracer.setScale(1); done?.(); },
    });
  }

  private added = 0;
  /** A line to show the visitor (the app's toast). */
  onNote: ((text: string) => void) | null = null;
  private add(item: AddItem): void {
    const m = item.make();
    this.store.snapshot();
    const cam = this.store.scene.camera;
    // Successive additions step sideways so they do not land inside each other.
    const step = (this.added++ % 5) - 2;
    const o: SceneObject = {
      id: newId(), name: m.name, shape: m.shape, material: JSON.parse(JSON.stringify(m.material)) as Material,
      pos: [cam.target[0] + (m.dx ?? 0) + step * 0.13, restHeight(m.shape) + REST_GAP + (m.lift ?? 0), cam.target[2] + 0.25], rot: m.rot ?? [0, 0, 0],
    };
    if (m.shape.kind === 'gem') o.pos[1] = m.shape.r * 0.45;
    this.store.scene.objects.push(o);
    void this.store.load(this.store.scene, true).then(() => {
      this.store.select(o.id);
      const p = this.interaction.project(o.pos);
      const c = this.store.view.canvas;
      const outside = !p || p.x < 0 || p.y < 0 || p.x > c.clientWidth || p.y > c.clientHeight;
      if (m.note) this.onNote?.(m.note);
      else if (outside) this.onNote?.(`${m.name} added outside the picture: you will see its light. Orbit or move back to see the lamp itself.`);
    });
  }

  private renderScene(): void {
    const s = this.store;
    const o = s.selected;
    const list = h('div', { class: 'lb-objects' });
    for (const obj of s.scene.objects) {
      if (obj.locked) continue;
      list.append(h('button', { type: 'button', class: `lb-obj${obj.id === s.selectedId ? ' on' : ''}`, text: obj.name, onclick: () => s.select(obj.id === s.selectedId ? null : obj.id) }));
    }
    const addGrid = h('div', { class: 'lb-addgrid' });
    for (const item of ADD) addGrid.append(button(item.label, () => this.add(item)));
    addGrid.append(button('Your model…', () => this.onLoadFile?.(), 'ghost'));
    this.body.append(group('In the scene', list));
    if (o) this.body.append(this.objectEditor(o));
    else this.body.append(h('p', { class: 'lb-note', text: window.matchMedia('(pointer: coarse)').matches
      ? 'Tap an object in the picture to select it and drag it to move it. Drag the background to orbit, pinch to move in or out, drag with two fingers to pan. Double-tap to focus.'
      : 'Click an object in the picture to select it, drag it to move it (hold Shift to lift). Drag the background to orbit, scroll to move in, right-drag to pan. Double-click to focus.' }));
    this.body.append(group('Add', addGrid));
    this.body.append(group('Room',
      this.bound('Surround', 0, 2000, s.scene.env.luminance, (v) => { s.scene.env.luminance = v; }, { step: 10, fmt: (v) => (v === 0 ? 'dark' : `${Math.round(v)} cd/m²`) }),
      this.bound('Bounces', 2, 48, s.scene.bounces, (v) => { s.scene.bounces = Math.round(v); }, { step: 1 })));
  }

  private posSliders: HTMLElement | null = null;
  private syncPosition(): void {
    // Dragging in the picture moves the object: refresh only the position readouts.
    const o = this.store.selected;
    if (!o || !this.posSliders || document.activeElement?.closest('.lb-pos')) return;
    this.posSliders.replaceWith(this.posSliders = this.positionGroup(o));
  }

  private positionGroup(o: SceneObject): HTMLElement {
    const g = group('Place',
      this.bound('Left / right', -2, 2, o.pos[0], (v) => { o.pos[0] = v; }, { fmt: mm }),
      this.bound('Height', -0.5, 2.5, o.pos[1], (v) => { o.pos[1] = v; }, { fmt: mm }),
      this.bound('Near / far', -2, 2, o.pos[2], (v) => { o.pos[2] = v; }, { fmt: mm }),
      this.bound('Turn', -180, 180, o.rot[1], (v) => { o.rot[1] = v; }, { step: 1, fmt: deg }),
      this.bound('Tilt', -180, 180, o.rot[0], (v) => { o.rot[0] = v; }, { step: 1, fmt: deg }),
      this.bound('Roll', -180, 180, o.rot[2], (v) => { o.rot[2] = v; }, { step: 1, fmt: deg }));
    g.classList.add('lb-pos');
    return g;
  }

  private objectEditor(o: SceneObject): HTMLElement {
    const s = this.store;
    const wrap = h('div', { class: 'lb-editor' });
    const name = h('input', { type: 'text', class: 'lb-name', value: o.name, maxlength: 40, 'aria-label': 'Name' });
    name.addEventListener('change', () => { const v = name.value.trim(); if (!v) { name.value = o.name; return; } s.snapshot(); o.name = v; this.render(); });
    wrap.append(h('div', { class: 'lb-editor-head' }, name,
      button('Copy', () => {
        s.snapshot();
        const c = JSON.parse(JSON.stringify(o)) as SceneObject;
        c.id = newId();
        c.pos = [o.pos[0] + 0.15, o.pos[1], o.pos[2] + 0.1];
        s.scene.objects.push(c);
        s.apply();
        s.select(c.id);
      }, 'small'),
      button('Remove', () => {
        s.snapshot();
        s.scene.objects = s.scene.objects.filter((x) => x.id !== o.id);
        s.select(null);
        s.apply();
        this.render();
      }, 'small')));

    // ---- shape
    const sh = o.shape;
    const shape: HTMLElement[] = [];
    const size = (label: string, get: number, set: (v: number) => void, lo = 0.005, hi = 1.5) => this.bound(label, lo, hi, get, set, { log: true, fmt: mm });
    switch (sh.kind) {
      case 'sphere': shape.push(size('Radius', sh.r, (v) => { sh.r = v; })); break;
      case 'box':
        shape.push(size('Width', sh.half[0] * 2, (v) => { sh.half[0] = v / 2; }), size('Height', sh.half[1] * 2, (v) => { sh.half[1] = v / 2; }), size('Depth', sh.half[2] * 2, (v) => { sh.half[2] = v / 2; }, 0.002));
        break;
      case 'cylinder': shape.push(size('Radius', sh.r, (v) => { sh.r = v; }, 0.002), size('Length', sh.h * 2, (v) => { sh.h = v / 2; })); break;
      case 'quad': shape.push(size('Width', sh.half[0] * 2, (v) => { sh.half[0] = v / 2; }, 0.001, 8), size('Depth', sh.half[1] * 2, (v) => { sh.half[1] = v / 2; }, 0.001, 8)); break;
      case 'disc': shape.push(size('Radius', sh.r, (v) => { sh.r = v; }, 0.001)); break;
      case 'prism':
        shape.push(this.bound('Sides', 3, 8, sh.sides, (v) => { sh.sides = Math.round(v); }, { step: 1 }, () => this.render()));
        if (sh.sides <= 3) shape.push(this.bound('Apex angle', 20, 120, sh.apex, (v) => { sh.apex = v; }, { step: 1, fmt: deg }));
        shape.push(size('Size', sh.size, (v) => { sh.size = v; }), size('Length', sh.h * 2, (v) => { sh.h = v / 2; }));
        break;
      case 'gem':
        shape.push(select('Cut', [['brilliant', 'Round brilliant'], ['step', 'Step (emerald)'], ['octahedron', 'Octahedron']] as const, sh.cut, (v) => { s.snapshot(); sh.cut = v; s.apply(); }));
        shape.push(size('Radius', sh.r, (v) => { sh.r = v; }, 0.005, 0.5));
        break;
      case 'lens': {
        const focal = h('p', { class: 'lb-note' });
        const curve = (label: string, get: number, set: (v: number) => void) => this.bound(label, -12, 12, get === 0 ? 0 : 1 / get, (c) => { set(Math.abs(c) < 0.05 ? 0 : 1 / c); showFocal(); },
          { step: 0.1, fmt: (c) => (Math.abs(c) < 0.05 ? 'flat' : `${c > 0 ? 'convex' : 'concave'} ${mm(Math.abs(1 / c))}`) });
        const showFocal = () => {
          const n = o.material.kind === 'glass' ? glassIndex(o.material.glass, 587.56) : 1.5;
          const c1 = sh.r1 === 0 ? 0 : 1 / sh.r1;
          const c2 = sh.r2 === 0 ? 0 : 1 / sh.r2;
          // Thick-lens lensmaker's equation; both faces count as positive when convex.
          const p = (n - 1) * (c1 + c2 - ((n - 1) * sh.t * c1 * c2) / n);
          const usable = lensParams(sh)[0];
          focal.textContent = (Math.abs(p) < 1e-6 ? 'No focusing power.' : `Focal length ${mm(Math.abs(1 / p))} (${p > 0 ? 'converging' : 'diverging'}) in yellow light.`)
            + (usable < sh.r - 1e-6 ? ` Faces this curved cannot span the whole aperture; ${mm(usable)} of its radius is used.` : '');
        };
        shape.push(size('Aperture radius', sh.r, (v) => { sh.r = v; showFocal(); }, 0.01, 0.5), size('Thickness', sh.t, (v) => { sh.t = v; showFocal(); }, 0.002, 0.3),
          curve('Front face', sh.r1, (v) => { sh.r1 = v; }), curve('Back face', sh.r2, (v) => { sh.r2 = v; }), focal);
        showFocal();
        break;
      }
      case 'mesh': shape.push(size('Size', sh.size, (v) => { sh.size = v; }, 0.03, 2), h('p', { class: 'lb-note', text: `${s.meshes.label(sh.mesh)}: ${s.meshes.triangles(sh.mesh).toLocaleString()} triangles.` })); break;
    }
    wrap.append(group('Shape', ...shape));
    wrap.append(this.posSliders = this.positionGroup(o));
    wrap.append(this.materialEditor(o));
    return wrap;
  }

  private materialEditor(o: SceneObject): HTMLElement {
    const s = this.store;
    const m = o.material;
    const flat = o.shape.kind === 'quad' || o.shape.kind === 'disc';
    const kinds = (Object.keys(MATERIAL_LABEL) as Material['kind'][]).filter((k) => (k !== 'beam' && k !== 'grating') || flat);
    const rows: HTMLElement[] = [select('Made of', kinds.map((k) => [k, MATERIAL_LABEL[k]] as const), m.kind, (k) => { s.snapshot(); o.material = defaultMaterial(k, m); s.apply(); this.render(); })];
    const colour = (target: { color: [number, number, number] }) => swatches('Colour', target.color, (c) => { s.snapshot(); target.color = c; s.apply(); });
    const rough = (target: { rough: number }) => this.bound('Roughness', 0, 1, target.rough, (v) => { target.rough = v; }, { step: 0.01, fmt: (v) => (v < 0.02 ? 'polished' : v.toFixed(2)) });
    if (m.kind === 'diffuse') rows.push(colour(m));
    else if (m.kind === 'plastic') rows.push(colour(m), rough(m));
    else if (m.kind === 'metal') {
      rows.push(select('Metal', (Object.keys(METAL_LABEL) as MetalName[]).map((k) => [k, METAL_LABEL[k]] as const), m.metal, (v) => { s.snapshot(); m.metal = v; s.apply(); }), rough(m));
    } else if (m.kind === 'glass') {
      rows.push(select('Glass', (Object.keys(GLASS_LABEL) as GlassName[]).map((k) => [k, GLASS_LABEL[k]] as const), m.glass, (v) => { s.snapshot(); m.glass = v; s.apply(); this.render(); }));
      rows.push(h('p', { class: 'lb-note', text: `Index ${glassIndex(m.glass, 450).toFixed(3)} in blue, ${glassIndex(m.glass, 650).toFixed(3)} in red.` }));
      rows.push(toggle('Tinted', !!m.tint, (on) => { s.snapshot(); if (on) { m.tint = [0.1, 0.55, 0.6]; m.density = 15; } else { delete m.tint; delete m.density; } s.apply(); this.render(); }));
      if (m.tint) {
        rows.push(swatches('Tint', m.tint, (c) => { s.snapshot(); m.tint = c; s.apply(); }));
        rows.push(this.bound('Depth of colour', 1, 300, m.density ?? 15, (v) => { m.density = v; }, { log: true, fmt: (v) => `full at ${mm(1 / v)}` }));
      }
    } else if (m.kind === 'light' || m.kind === 'beam') {
      const options: (readonly [SpectrumChoice, string])[] = [['warm', 'Warm white'], ['day', 'Daylight'], ['d65', 'Standard daylight (D65)'],
        ...(Object.keys(GAS_LABEL) as GasName[]).map((g) => [`gas:${g}`, `${GAS_LABEL[g]} discharge`] as const), ['laser', 'Laser line'], ['led', 'Coloured LED']];
      rows.push(select('Light', options, spectrumChoice(m.spectrum), (c) => { s.snapshot(); m.spectrum = spectrumFrom(c); s.apply(); this.render(); }));
      const sp = m.spectrum;
      if (sp.kind === 'blackbody') rows.push(this.bound('Temperature', 1500, 12000, sp.kelvin, (v) => { sp.kelvin = v; }, { step: 50, fmt: (v) => `${Math.round(v)} K` }));
      if (sp.kind === 'laser' || sp.kind === 'led') rows.push(this.bound('Wavelength', 405, 690, sp.nm, (v) => { sp.nm = v; }, { step: 1, fmt: (v) => `${Math.round(v)} nm` }));
      if (sp.kind === 'led') rows.push(this.bound('Width', 8, 120, sp.width, (v) => { sp.width = v; }, { step: 1, fmt: (v) => `${Math.round(v)} nm` }));
      rows.push(this.bound('Output', 0.5, 50000, Math.max(0.5, m.lumens), (v) => { m.lumens = v; }, { log: true, fmt: (v) => `${v < 10 ? v.toFixed(1) : Math.round(v)} lm` }));
      if (m.kind === 'beam') rows.push(this.bound('Spread', 0.05, 60, m.spread, (v) => { m.spread = v; }, { log: true, fmt: (v) => `${v < 1 ? v.toFixed(2) : v.toFixed(1)}°` }));
      if (sp.kind === 'gas') rows.push(h('p', { class: 'lb-note', text: 'Line wavelengths are NIST values; line strengths come from a simple excitation model and are approximate.' }));
    } else if (m.kind === 'grating') {
      rows.push(this.bound('Lines per mm', 100, 1800, m.linesPerMm, (v) => { m.linesPerMm = v; }, { step: 10 }));
    }
    return group('Material', ...rows);
  }

  // ------------------------------------------------------------------ camera tab
  private dofNote: HTMLElement | null = null;
  private shownLens = '';
  private syncCamera(): void {
    if (this.dofNote) this.dofNote.textContent = this.dofText();
    // The lens changed from outside the tab (a double-click focus, a dolly): redraw the rings.
    const c = this.store.scene.camera;
    const lens = `${c.focal.toFixed(2)}/${c.fstop.toFixed(3)}/${c.focus.toFixed(3)}`;
    if (lens !== this.shownLens && !ringHeld() && !this.body.contains(document.activeElement)) this.render();
  }
  private dofText(): string {
    const c = this.store.scene.camera;
    if (c.fstop <= 0) return 'Pinhole: everything is sharp.';
    const f = c.focal / 1000;
    const coc = 0.00003;
    const H = (f * f) / (c.fstop * coc) + f;
    const s = c.focus;
    const near = (s * (H - f)) / (H + s - 2 * f);
    const far = s < H ? (s * (H - f)) / (H - s) : Infinity;
    return `Focused at ${s.toFixed(2)} m. Sharp from ${near.toFixed(2)} m to ${Number.isFinite(far) ? `${far.toFixed(2)} m` : 'infinity'}. Aperture ${(c.focal / c.fstop).toFixed(1)} mm across.`;
  }

  private renderCamera(): void {
    const s = this.store;
    const c = s.scene.camera;
    const d = s.scene.darkroom;
    const cam = () => { this.interaction.previewScale = 2; s.view.tracer.setScale(2); s.cameraChanged(); };
    const done = () => { s.view.tracer.setScale(1); };
    this.dofNote = h('p', { class: 'lb-note', text: this.dofText() });
    this.shownLens = `${c.focal.toFixed(2)}/${c.fstop.toFixed(3)}/${c.focus.toFixed(3)}`;
    const pinhole = c.fstop <= 0;
    this.body.append(group('Lens',
      ring({ label: 'Focal length', stops: [18, 24, 35, 50, 85, 135, 200], value: c.focal, fmt: (v) => `${Math.round(v)} mm`, tick: (v) => String(v), onInput: (v) => { c.focal = v; cam(); }, onChange: done }),
      toggle('Pinhole (no blur)', pinhole, (on) => { c.fstop = on ? 0 : 4; s.cameraChanged(); this.render(); }),
      pinhole ? null : ring({ label: 'Aperture', stops: [1, 1.4, 2, 2.8, 4, 5.6, 8, 11, 16, 22], value: c.fstop, detents: 3, fmt: (v) => `f/${v < 10 ? v.toFixed(1) : Math.round(v)}`, tick: (v) => String(v), onInput: (v) => { c.fstop = v; cam(); }, onChange: done }),
      pinhole ? null : ring({ label: 'Focus', stops: [0.1, 0.2, 0.3, 0.5, 0.7, 1, 1.5, 2, 3, 5, 10], value: c.focus, fmt: (v) => `${v.toFixed(2)} m`, tick: (v) => String(v), onInput: (v) => { c.focus = v; cam(); }, onChange: done }),
      pinhole ? null : select('Aperture blades', [['0', 'Round'], ['5', 'Five'], ['6', 'Six'], ['8', 'Eight']] as const, String(c.blades) as '0', (v) => { c.blades = Number(v); s.cameraChanged(); }),
      this.dofNote));
    this.body.append(group('Exposure',
      toggle('Meter sets exposure', d.auto, (on) => { d.auto = on; s.displayChanged(); this.render(); }),
      d.auto ? h('p', { class: 'lb-note', text: 'The meter picks the exposure. Turn it off to set shutter and ISO yourself: then stopping the lens down darkens the picture, as on a real camera.' }) : null,
      d.auto ? null : ring({ label: 'Shutter', stops: [1 / 1000, 1 / 500, 1 / 250, 1 / 125, 1 / 60, 1 / 30, 1 / 15, 1 / 8, 1 / 4, 1 / 2, 1, 2, 4], value: c.shutter, detents: 3, fmt: (v) => (v < 1 ? `1/${Math.round(1 / v)} s` : `${v.toFixed(v < 10 ? 1 : 0)} s`), tick: (v) => (v < 1 ? String(Math.round(1 / v)) : `${v}s`), onInput: (v) => { c.shutter = v; s.displayChanged(); } }),
      d.auto ? null : ring({ label: 'ISO', stops: [50, 100, 200, 400, 800, 1600, 3200, 6400, 12800], value: c.iso, detents: 3, fmt: (v) => `ISO ${Math.round(v)}`, tick: (v) => String(v), onInput: (v) => { c.iso = v; s.displayChanged(); } })));
    this.body.append(h('p', { class: 'lb-note', text: window.matchMedia('(pointer: coarse)').matches ? 'Double-tap anything in the picture to focus on it.' : 'Double-click anything in the picture to focus on it. Click a ring, then use the arrow keys or the wheel for fine steps.' }));
  }

  // ------------------------------------------------------------------ darkroom tab
  private renderDarkroom(): void {
    const s = this.store;
    const d = s.scene.darkroom;
    const show = () => s.displayChanged();
    const t = s.view.tracer;
    this.body.append(group('Develop',
      slider({ label: 'Exposure', min: -5, max: 5, step: 0.1, value: d.ev, fmt: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} EV`, onInput: (v) => { d.ev = v; show(); } }),
      slider({ label: 'White balance', min: 2000, max: 10000, step: 50, value: d.wb, fmt: (v) => `${Math.round(v)} K`, onInput: (v) => { d.wb = v; show(); } }),
      select('Film', [['film', 'Colour film'], ['contrast', 'High contrast'], ['mono', 'Black and white'], ['linear', 'Linear (no curve)']] as const, d.tone, (v: ToneCurve) => { d.tone = v; show(); }),
      slider({ label: 'Glare', min: 0, max: 1, step: 0.01, value: d.bloom, onInput: (v) => { d.bloom = v; show(); } }),
      toggle('Natural vignetting', d.vignette, (on) => { d.vignette = on; show(); })));
    this.body.append(group('Tracer',
      toggle('Photon pass for caustics', t.useLT, (on) => { t.useLT = on; t.reset(); }),
      toggle('Clamp fireflies (biased)', t.clamp < 1e20, (on) => { t.clamp = on ? 40 / Math.max(1e-9, s.view.autoExposure) : 1e30; t.reset(); }),
      h('p', { class: 'lb-note', text: 'With the photon pass off, the path tracer finds caustics by itself: the same picture, far more slowly. With it on, caustics seen through glass or in a mirror are gathered from a photon map and start slightly soft. Clamping removes bright speckles at the cost of a little lost light.' })));
    let size = 'view';
    let samples = 256;
    const sizes = [['view', 'This view'], ['1920x1080', '1920 × 1080'], ['2560x1440', '2560 × 1440'], ['3840x2160', '3840 × 2160'], ['2048x2048', '2048 × 2048']] as const;
    this.body.append(group('Print',
      button('Save this picture', () => this.onSavePicture?.()),
      select('Size', sizes, 'view' as (typeof sizes)[number][0], (v) => { size = v; }),
      slider({ label: 'Samples', min: 16, max: 8192, log: true, value: samples, fmt: (v) => String(Math.round(v)), onInput: (v) => { samples = Math.round(v); } }),
      button('Render and save', () => {
        if (this.exportBusy) return;
        const [w, hgt] = size === 'view' ? [t.width, t.height] : size.split('x').map(Number);
        this.onExport?.(w!, hgt!, samples);
      }),
      h('p', { class: 'lb-note', text: 'Renders the scene afresh at the chosen size to the chosen number of samples per pixel, then saves a PNG.' })));
  }
}
