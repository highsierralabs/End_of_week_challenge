// Scenes built for the tour and the spectroscope: each isolates one thing light does.
import { type GasName, type Material, type Rgb, type Scene, defaultCamera, defaultDarkroom } from './scene';
import { minimumDeviation, obj, onTable, prismDeviation } from './scenes';

const matte = (color: Rgb): Material => ({ kind: 'diffuse', color });
const lamp = (kelvin: number, lumens: number): Material => ({ kind: 'light', spectrum: { kind: 'blackbody', kelvin }, lumens });
const base = (name: string): Scene => ({ v: 1, name, objects: [], camera: defaultCamera(), darkroom: defaultDarkroom(), env: { luminance: 0, spectrum: { kind: 'd65' } }, bounces: 12 });
const room = (color: Rgb = [0.78, 0.78, 0.76]) => [
  obj('Table', { kind: 'quad', half: [4, 4] }, matte(color), [0, 0, 0], [0, 0, 0], true),
  obj('Backdrop', { kind: 'quad', half: [4, 2] }, matte(color), [0, 2, -1.6], [90, 0, 0], true),
];

/** One small lamp and one large one: hard and soft shadows side by side. */
export function softShadows(): Scene {
  const s = base('Shadows');
  s.objects = [
    ...room(),
    obj('Small lamp', { kind: 'sphere', r: 0.015 }, lamp(3200, 900), [-0.75, 0.8, 0.35]),
    obj('Large lamp', { kind: 'quad', half: [0.45, 0.45] }, lamp(6000, 1500), [0.8, 0.9, 0.3], [180, 0, -40]),
    onTable('Ball', { kind: 'sphere', r: 0.11 }, matte([0.85, 0.85, 0.83]), -0.05, 0),
    onTable('Column', { kind: 'cylinder', r: 0.045, h: 0.17 }, matte([0.85, 0.85, 0.83]), 0.25, -0.2),
    onTable('Block', { kind: 'box', half: [0.07, 0.05, 0.07] }, matte([0.85, 0.85, 0.83]), -0.34, 0.12, [0, 30, 0]),
  ];
  s.camera = { ...s.camera, pos: [0, 0.75, 1.45], target: [0, 0.08, -0.05], focus: 1.6, focal: 45, fstop: 0 };
  return s;
}

/** A glossy black table: reflections strengthen toward grazing angles. */
export function fresnelScene(): Scene {
  const s = base('Reflection');
  s.objects = [
    obj('Table', { kind: 'quad', half: [4, 4] }, { kind: 'plastic', color: [0.03, 0.03, 0.035], rough: 0 }, [0, 0, 0], [0, 0, 0], true),
    obj('Backdrop', { kind: 'quad', half: [4, 2] }, matte([0.55, 0.55, 0.56]), [0, 2, -1.8], [90, 0, 0], true),
    obj('Softbox', { kind: 'quad', half: [0.5, 0.35] }, lamp(5600, 2600), [-0.4, 1.2, 0.4], [180, 0, 20]),
    onTable('Glass ball', { kind: 'sphere', r: 0.11 }, { kind: 'glass', glass: 'bk7' }, -0.22, 0.25),
    onTable('Chrome ball', { kind: 'sphere', r: 0.11 }, { kind: 'metal', metal: 'silver', rough: 0 }, 0.08, -0.05),
    onTable('Copper ball', { kind: 'sphere', r: 0.11 }, { kind: 'metal', metal: 'copper', rough: 0.2 }, 0.38, -0.35),
    onTable('Red block', { kind: 'box', half: [0.06, 0.1, 0.06] }, { kind: 'plastic', color: [0.8, 0.12, 0.1], rough: 0.1 }, -0.5, -0.4, [0, 25, 0]),
    onTable('Blue block', { kind: 'box', half: [0.06, 0.06, 0.06] }, { kind: 'plastic', color: [0.12, 0.25, 0.7], rough: 0.1 }, 0.52, 0.2, [0, -20, 0]),
  ];
  s.camera = { ...s.camera, pos: [0, 0.2, 1.5], target: [0.05, 0.1, -0.1], focus: 1.6, focal: 50, fstop: 8 };
  return s;
}

/** A glass ball in front of coloured blocks: the ball is a lens and turns the view upside down. */
export function ballLens(): Scene {
  const s = base('Refraction');
  const block = (name: string, color: Rgb, x: number, h: number) => onTable(name, { kind: 'box', half: [0.06, h, 0.06] }, matte(color), x, -0.55);
  s.objects = [
    ...room(),
    obj('Softbox', { kind: 'quad', half: [0.5, 0.35] }, lamp(5600, 2600), [0, 1.3, 0.3], [180, 0, 0]),
    block('Red block', [0.8, 0.12, 0.1], -0.3, 0.2), block('Yellow block', [0.93, 0.78, 0.12], -0.1, 0.12), block('Green block', [0.2, 0.6, 0.25], 0.1, 0.16), block('Blue block', [0.12, 0.25, 0.7], 0.3, 0.08),
    onTable('Glass ball', { kind: 'sphere', r: 0.13 }, { kind: 'glass', glass: 'bk7' }, 0, 0.1),
  ];
  s.camera = { ...s.camera, pos: [0, 0.3, 1.25], target: [0, 0.14, 0], focus: 1.15, focal: 50, fstop: 0 };
  return s;
}

/** A small bright lamp above glass: the light the glass gathers lands on the table. */
export function causticScene(): Scene {
  const s = base('Caustics');
  s.objects = [
    ...room([0.8, 0.8, 0.78]),
    obj('Lamp', { kind: 'sphere', r: 0.02 }, lamp(5000, 1500), [-0.55, 0.85, 0.25]),
    onTable('Glass ball', { kind: 'sphere', r: 0.1 }, { kind: 'glass', glass: 'bk7' }, -0.18, 0.0),
    onTable('Wine glass', { kind: 'mesh', mesh: 'wineglass', size: 0.3 }, { kind: 'glass', glass: 'bk7' }, 0.2, -0.08),
    onTable('Tumbler', { kind: 'mesh', mesh: 'tumbler', size: 0.13 }, { kind: 'glass', glass: 'bk7' }, 0.02, 0.3),
  ];
  s.camera = { ...s.camera, pos: [0.25, 0.7, 1.15], target: [0.08, 0.05, 0.05], focus: 1.3, focal: 45, fstop: 0 };
  return s;
}

/** Bright paints under a sodium lamp: one wavelength, so no colour. */
export function sodiumScene(): Scene {
  const s = base('One wavelength');
  const paints: Rgb[] = [[0.8, 0.12, 0.1], [0.92, 0.45, 0.08], [0.93, 0.78, 0.12], [0.2, 0.6, 0.25], [0.12, 0.25, 0.7], [0.45, 0.2, 0.65]];
  s.objects = [
    ...room(),
    obj('Lamp', { kind: 'quad', half: [0.35, 0.25] }, { kind: 'light', spectrum: { kind: 'gas', gas: 'Na' }, lumens: 2500 }, [0, 1.2, 0.4], [180, 0, 0]),
    ...paints.map((c, i) => onTable(`Paint ${i + 1}`, { kind: 'sphere', r: 0.085 }, { kind: 'plastic', color: c, rough: 0.15 }, -0.5 + i * 0.2, i % 2 ? 0.08 : -0.1)),
  ];
  s.camera = { ...s.camera, pos: [0, 0.55, 1.4], target: [0, 0.07, 0], focus: 1.45, focal: 50, fstop: 0 };
  s.darkroom = { ...s.darkroom, wb: 5500 };
  return s;
}

/** A row of objects receding from a wide-open lens. */
export function depthScene(): Scene {
  const s = base('Depth of field');
  const cols: Rgb[] = [[0.8, 0.12, 0.1], [0.93, 0.78, 0.12], [0.2, 0.6, 0.25], [0.12, 0.25, 0.7], [0.45, 0.2, 0.65]];
  s.objects = [
    ...room(),
    obj('Softbox', { kind: 'quad', half: [0.5, 0.35] }, lamp(5200, 2600), [-0.4, 1.2, 0.4], [180, 0, 20]),
    ...cols.map((c, i) => onTable(`Ball ${i + 1}`, { kind: 'sphere', r: 0.06 }, { kind: 'plastic', color: c, rough: 0.05 }, -0.32 + i * 0.16, 0.5 - i * 0.32)),
    obj('Pin light 1', { kind: 'sphere', r: 0.006 }, lamp(3000, 25), [-0.38, 0.15, -1.2]),
    obj('Pin light 2', { kind: 'sphere', r: 0.006 }, lamp(3000, 25), [0.08, 0.22, -1.3]),
    obj('Pin light 3', { kind: 'sphere', r: 0.006 }, lamp(6500, 25), [0.42, 0.11, -1.1]),
  ];
  s.camera = { ...s.camera, pos: [0.1, 0.22, 1.25], target: [0, 0.06, -0.1], focus: 1.4, focal: 85, fstop: 1.4, blades: 6 };
  return s;
}

export const GRATING_LINES = 1200;
/** Distances from the camera (grating view) or the prism to the tube and to the grating, metres. */
export const SPECTRO_TUBE = 1.2;
export const SPECTRO_GRATING = 0.03;
/** Half the tube's length. */
export const SPECTRO_HALF = 0.1;

/** Angle (radians) at which a first-order line of the grating appears, from the grating normal. */
export const gratingAngle = (nm: number): number => Math.asin(Math.min(1, (nm * GRATING_LINES) / 1e6));

/** A gas tube seen through a grating or a prism placed just in front of the camera. */
export function spectroscopeScene(gas: GasName, disperser: 'grating' | 'prism'): Scene {
  const s = base('Spectroscope');
  const tube = obj('Gas tube', { kind: 'cylinder', r: 0.0012, h: SPECTRO_HALF }, { kind: 'light', spectrum: { kind: 'gas', gas }, lumens: 60 }, [0, 0.2, -SPECTRO_TUBE]);
  s.objects = [tube];
  if (disperser === 'grating') {
    const mid = gratingAngle(545);
    s.objects.push(obj('Grating', { kind: 'quad', half: [0.06, 0.06] }, { kind: 'grating', linesPerMm: GRATING_LINES }, [0, 0.2, -SPECTRO_GRATING], [90, 0, 0], true));
    s.camera = { ...s.camera, pos: [0, 0.2, 0], target: [Math.sin(mid), 0.2, -Math.cos(mid)], focal: 62, fstop: 0, focus: 1.2 };
  } else {
    // The tube's light travels along +x into the middle of the prism's first face and leaves
    // the middle of the second, turned by the deviation; the camera looks back along that ray.
    const m = minimumDeviation(0.12);
    tube.pos = [-SPECTRO_TUBE, 0.2, 0];
    s.objects.push(obj('Prism', { kind: 'prism', sides: 3, apex: 60, size: 0.12, h: 0.12 }, { kind: 'glass', glass: 'sf11' }, [m.centre[0], 0.2, m.centre[1]], [90, m.turn, 0], true));
    const pos: [number, number, number] = [m.exit[0] + m.out[0] * 0.1, 0.2, m.exit[1] + m.out[1] * 0.1];
    // Aim between the directions of the violet and the red images, so the spectrum is centred.
    const mid = 0.5 * (prismDeviation(410) + prismDeviation(700));
    s.camera = { ...s.camera, pos, target: [pos[0] - Math.cos(mid), 0.2, pos[2] + Math.sin(mid)], focal: 105, fstop: 0, focus: 1.2 };
  }
  s.darkroom = { ...s.darkroom, bloom: 0.3, wb: 6500, tone: 'film' };
  s.bounces = 8;
  return s;
}
