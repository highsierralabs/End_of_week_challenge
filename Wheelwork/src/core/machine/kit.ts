// The print kit: the machine's own solids, regrouped into pieces that can be printed and put
// together. The geometry comes from the same builders as the screen model, at print detail and
// with print backlash; nothing here is redrawn.
import { checkMesh, effectiveContactRatio } from '../gears/meshcheck';
import { checkClosed, cylinder, lathe, merge, meshStats, rotationX, rotationY, transformed, translation } from '../mesh/kit';
import { type Mesh, type Vec2 } from '../mesh/types';
import { BODIES, CHAIN, DESIGN } from './design';
import { type Layout, type Wheel } from './layout';
import { buildParts, EARTH_SOCKET_TOP, eclipticZ, type Part, PRINT_DETAIL, saturnRingFlat, trainName, wheelSolid, wheelStyle } from './parts';
import { TRAIN_IDS } from './spec';

export interface KitPiece {
  /** File name inside the kit, without directory. */
  file: string;
  name: string;
  group: string;
  count: number;
  /** In print position: lying on the bed (z from 0), centred in x and y. */
  mesh: Mesh;
  note?: string;
  closed: boolean;
  volume: number;
  size: readonly [number, number, number];
  triangles: number;
}

export interface MeshCheckLine {
  train: string;
  pair: string;
  teeth: string;
  module: number;
  contactRatio: number;
  clearance: number;
  penetration: number;
  ok: boolean;
}

export interface Kit {
  scale: number;
  pieces: KitPiece[];
  meshes: MeshCheckLine[];
  /** True when every piece is a closed solid and no gear pair interferes. */
  ok: boolean;
  totalVolume: number;
  largest: readonly [number, number, number];
  readme: string;
}

/** Lay a solid on the bed: optionally turned over, lowest point at z = 0, centred in x and y, scaled. */
function bedded(mesh: Mesh, flip: boolean, scale: number): Mesh {
  const m = flip ? transformed(mesh, rotationX(Math.PI)) : mesh;
  const s = meshStats(m);
  const moved = transformed(m, translation(-(s.min[0] + s.max[0]) / 2, -(s.min[1] + s.max[1]) / 2, -s.min[2]));
  if (scale === 1) return moved;
  const p = new Float64Array(moved.positions.length);
  for (let i = 0; i < p.length; i++) p[i] = moved.positions[i]! * scale;
  return { positions: p, indices: moved.indices };
}

/**
 * A ball with a blind socket for its stalk, centred on the origin, socket downwards. The socket
 * runs from the underside up to `socketTop` (0 is the centre). Opposite the socket a small flat is
 * cut, so that the ball can be printed socket up, standing on the flat.
 */
function socketBall(radius: number, socketRadius: number, socketTop = 0, segments = 64): Mesh {
  const start = Math.asin(socketRadius / radius);
  const flat = Math.acos(0.955);
  const profile: Vec2[] = [[0, socketTop], [socketRadius, socketTop], [socketRadius, -radius * Math.cos(start)]];
  const rings = Math.round(segments / 2);
  const from = -Math.PI / 2 + start;
  const to = Math.PI / 2 - flat;
  for (let i = 1; i <= rings; i++) {
    const a = from + ((to - from) * i) / rings;
    profile.push([radius * Math.cos(a), radius * Math.sin(a)]);
  }
  profile.push([0, radius * Math.sin(to)]);
  return lathe(profile, segments);
}

export function buildKit(layout: Layout, scale = 1): Kit {
  const parts = buildParts(layout, { detail: PRINT_DETAIL });
  const byId = new Map<string, Part>(parts.map((p) => [p.id, p]));
  const pieces: KitPiece[] = [];
  const used = new Set<string>();

  const addMesh = (group: string, name: string, mesh: Mesh, opts: { count?: number; flip?: boolean; note?: string } = {}): void => {
    const m = bedded(mesh, !!opts.flip, scale);
    const stats = meshStats(m);
    pieces.push({
      file: '', name, group, count: opts.count ?? 1, mesh: m, note: opts.note,
      closed: checkClosed(m, 1e-5).closed, volume: stats.volume,
      size: [stats.max[0] - stats.min[0], stats.max[1] - stats.min[1], stats.max[2] - stats.min[2]],
      triangles: stats.triangles,
    });
  };
  const take = (ids: string[]): Mesh => {
    const meshes: Mesh[] = [];
    for (const id of ids) {
      const p = byId.get(id);
      if (!p) throw new Error(`kit: no part ${id}`);
      used.add(id);
      meshes.push(p.mesh);
    }
    return meshes.length === 1 ? meshes[0]! : merge(meshes);
  };
  const add = (group: string, name: string, ids: string[], opts: { count?: number; flip?: boolean; note?: string; also?: string[] } = {}): void => {
    for (const id of opts.also ?? []) used.add(id);
    addMesh(group, name, take(ids), opts);
  };
  const wheel = (id: string): Wheel => layout.byId.get(id)!;

  // ---- frame
  add('Frame', 'Base plate', ['base'], { note: 'Four pins stand on it for the feet of the lower pillars.' });
  add('Frame', 'Pillar, lower', ['pillarLower0'], { count: 4, also: ['pillarLower1', 'pillarLower2', 'pillarLower3'], note: 'A socket in the foot takes the pin on the base plate; the pin on top passes through the bridge into the socket of the upper pillar.' });
  add('Frame', 'Bridge', ['bridge']);
  add('Frame', 'Pillar, upper', ['pillarUpper0'], { count: 4, also: ['pillarUpper1', 'pillarUpper2', 'pillarUpper3'], note: 'The pin on top enters the deck plate.' });
  add('Frame', 'Deck plate', ['deck'], { note: 'The engraving of the screen model is not in the solid.' });
  add('Frame', 'Sun post', ['post'], { note: `Or a ${DESIGN.postDiameter * scale} mm rod, ${(eclipticZ() + DESIGN.basePlateThickness) * scale} mm long.` });
  add('Frame', 'Idler post', ['idlerPost'], { note: `Or a ${DESIGN.idlerPostDiameter * scale} mm rod.` });
  add('Frame', 'Idler post collar', ['idlerCollar']);
  add('Frame', 'Fixed tube', ['fixedTube'], { note: 'Pressed and glued into the bridge. It must not turn.' });
  add('Frame', 'Crank bearing', ['bearing0'], { count: 2, also: ['bearing1'], note: 'Glued to the base plate along the crank line.' });

  // ---- crank
  add('Crank', 'Crank shaft', ['crankShaft'], { note: `Or a ${DESIGN.crankShaftDiameter * scale} mm rod.` });
  add('Crank', 'Crank pinion', ['bevelPinion']);
  add('Crank', 'Crank arm and handle', ['crankArm', 'crankHandle']);
  add('Crank', 'Crank collar', ['crankCollar']);
  add('Crank', 'Crank wheel', ['bevelWheel'], { flip: true, note: "Fixed on the bottom of Mercury's tube, teeth down." });

  // ---- tubes and the wheels fixed on them
  for (const m of CHAIN) {
    add('Tubes', m === 'month' ? 'Month tube' : `${cap(m)} tube`, [`${m}Tube`], { note: 'Printed upright. Brass tube of the same diameters is better.' });
  }
  for (const w of layout.wheels) {
    if (w.axis !== 'centre') continue;
    add(w.tellurion ? 'Tellurion' : 'Gearbox wheels', `${trainName(w.train)} wheel ${w.role.toUpperCase()} ${w.teeth}T`, [w.id],
      { note: w.body === 'frame' ? 'Fixed on the fixed tube: press and glue.' : `A friction fit on the ${w.body === 'month' ? 'month' : cap(w.body)} tube.` });
  }

  // ---- idler clusters
  for (let i = 0; i < CHAIN.length - 1; i++) {
    const body = `cluster${i}`;
    const ws = layout.wheels.filter((w) => w.body === body).sort((p, q) => p.z - q.z);
    add('Gearbox clusters', `${trainName(ws[0]!.train)} cluster ${ws.map((w) => `${w.role.toUpperCase()}${w.teeth}`).join('-')}`, [ws[0]!.id, ws[1]!.id, `${body}Sleeve`],
      { flip: ws[1]!.tipRadius > ws[0]!.tipRadius, note: 'Turns freely on the idler post.' });
  }

  // ---- arms and bodies
  for (const b of BODIES) {
    if (b === 'earth') {
      add('Arms', "Earth's arm", ['earthArm']);
      add('Arms', 'Cluster stud', ['stud'], { note: `Or a ${DESIGN.studDiameter * scale} mm pin, pressed into the earth's arm.` });
      continue;
    }
    add('Arms', `${cap(b)} arm`, [`${b}Arm`], { note: 'Arm, collar and stalk in one piece. A friction fit on its tube, so the planet can be set by hand.' });
    used.add(`${b}Ball`);
    addMesh('Bodies', cap(b), socketBall(DESIGN.ballDiameter[b] / 2, DESIGN.stalkDiameter / 2 + 0.05), { flip: true, note: 'Printed socket up, standing on a small flat cut for the purpose.' });
  }
  used.add('saturnRing');
  addMesh('Bodies', "Saturn's ring", saturnRingFlat(), { note: 'Printed flat. Its three spokes are glued into Saturn at a tilt.' });
  used.add('sun');
  addMesh('Bodies', 'Sun', socketBall(DESIGN.ballDiameter.sun / 2, DESIGN.postDiameter / 2 + 0.05), { flip: true, note: 'Printed socket up, standing on its flat.' });

  // ---- tellurion
  for (const body of ['tiltCluster', 'moonCluster'] as const) {
    const ws = layout.wheels.filter((w) => w.body === body).sort((p, q) => p.z - q.z);
    add('Tellurion', `${trainName(ws[0]!.train)} cluster ${ws.map((w) => `${w.role.toUpperCase()}${w.teeth}`).join('-')}`, [ws[0]!.id, ws[1]!.id, `${body}Sleeve`],
      { flip: ws[1]!.tipRadius > ws[0]!.tipRadius, note: body === 'moonCluster' ? "Turns on the node cluster's sleeve." : 'Turns on the stud.' });
  }
  {
    // The node cluster is tall and the moon cluster rides on its sleeve, so its upper wheel goes on last.
    const b = wheel('node.b');
    const c = wheel('node.c');
    add('Tellurion', `Moon's nodes cluster, wheel B${b.teeth} with sleeve`, ['node.b', 'nodeClusterSleeve'], { note: 'Turns on the stud. The moon cluster slides on before wheel C.' });
    used.add('node.c');
    const sleeve = DESIGN.nodeClusterSleeveDiameter / 2;
    addMesh('Tellurion', `Moon's nodes cluster, wheel C${c.teeth}`, wheelSolid(c, { ...wheelStyle(c, PRINT_DETAIL), boreRadius: sleeve + PRINT_DETAIL.press, hubRadius: sleeve + DESIGN.tellurionHubWall }, PRINT_DETAIL),
      { note: 'A press fit on the top of the node cluster sleeve.' });
  }
  add('Tellurion', `Earth's axis wheel D${wheel('tilt.d').teeth}`, ['tilt.d'], { note: "A press fit on the earth's axis shaft." });
  add('Tellurion', "Earth's axis shaft", ['earthAxisShaft'], { note: `Or a ${DESIGN.earthAxisDiameter * scale} mm pin.` });
  {
    // The globe: a socket for the shaft underneath, leaning by the obliquity.
    used.add('earthBall');
    used.add('earthPin');
    const r = DESIGN.ballDiameter.earth / 2;
    // The polar axis is two stubs outside the ball; a pin through the middle would cross the socket.
    const stubs = transformed(merge([cylinder(0.45, r - 0.6, r + 2.2, 12), cylinder(0.45, -r - 2.2, -r + 0.6, 12)]), rotationY((DESIGN.obliquity * Math.PI) / 180));
    const globe = merge([socketBall(r, DESIGN.earthAxisDiameter / 2 + 0.05, -EARTH_SOCKET_TOP), stubs]);
    addMesh('Bodies', 'Earth', globe, { flip: true, note: 'Needs supports: the polar stubs lean 23.4 degrees from the socket. Set the lean towards the June solstice.' });
  }
  add('Tellurion', `Moon wheel D${wheel('moon.d').teeth}`, ['moon.d'], { note: "A press fit on the moon's sleeve." });
  add('Tellurion', "Moon's sleeve and arm", ['moonSleeveTube', 'moonArm'], { flip: true });
  add('Tellurion', `Node wheel D${wheel('node.d').teeth}`, ['node.d'], { note: 'A press fit on the node sleeve.' });
  add('Tellurion', 'Node sleeve and inclined ring', ['nodeSleeveTube', 'nodeRing', 'nodeMark'], { flip: true, note: 'Needs supports: the ring is tipped 5.1 degrees to the sleeve.' });
  add('Tellurion', "Moon's stalk", ['moonStalk'], { note: 'Slides freely in the hole of the moon arm; its foot rides on the inclined ring.' });
  used.add('moonBall');
  addMesh('Bodies', 'Moon', socketBall(DESIGN.ballDiameter.moon / 2, 0.85), { flip: true, note: 'Printed socket up, standing on its flat.' });

  // Keep each group together, in the order the machine goes together, and number the files in that order.
  const order = ['Frame', 'Crank', 'Tubes', 'Gearbox wheels', 'Gearbox clusters', 'Arms', 'Tellurion', 'Bodies'];
  pieces.sort((p, q) => order.indexOf(p.group) - order.indexOf(q.group));
  pieces.forEach((p, i) => {
    const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    p.file = `${String(i + 1).padStart(2, '0')}-${slug}.stl`;
  });

  const missed = parts.filter((p) => !used.has(p.id)).map((p) => p.id);
  if (missed.length) throw new Error(`kit: parts left out: ${missed.join(', ')}`);

  // ---- every meshing pair, checked in the plane at print backlash
  const meshes: MeshCheckLine[] = [];
  for (const id of TRAIN_IDS) {
    for (const [r1, r2] of [['a', 'b'], ['c', 'd']] as const) {
      const w1 = wheel(`${id}.${r1}`);
      const w2 = wheel(`${id}.${r2}`);
      const spec = (w: Wheel) => ({ teeth: w.teeth, module: w.module, backlash: PRINT_DETAIL.backlash, flankPoints: PRINT_DETAIL.flankPoints, filletPoints: PRINT_DETAIL.filletPoints });
      const cd = (w1.module * (w1.teeth + w2.teeth)) / 2;
      const report = checkMesh(spec(w1), spec(w2), cd, 24);
      const ratio = effectiveContactRatio(spec(w1), spec(w2), cd);
      meshes.push({
        train: trainName(id), pair: `${r1.toUpperCase()}-${r2.toUpperCase()}`, teeth: `${w1.teeth}:${w2.teeth}`, module: w1.module * scale,
        contactRatio: ratio, clearance: report.minFlankClearance * scale, penetration: report.maxPenetration * scale,
        ok: !report.interferes && ratio > 1,
      });
    }
  }

  let largest: [number, number, number] = [0, 0, 0];
  let totalVolume = 0;
  for (const p of pieces) {
    totalVolume += p.volume * p.count;
    largest = [Math.max(largest[0], p.size[0]), Math.max(largest[1], p.size[1]), Math.max(largest[2], p.size[2])];
  }
  const ok = pieces.every((p) => p.closed && p.volume > 0) && meshes.every((m) => m.ok);
  const kit: Kit = { scale, pieces, meshes, ok, totalVolume, largest, readme: '' };
  kit.readme = readme(kit, layout);
  return kit;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function readme(kit: Kit, layout: Layout): string {
  const f = (v: number, d = 1) => v.toFixed(d);
  const lines: string[] = [];
  lines.push('WHEELWORK PRINT KIT');
  lines.push('===================');
  lines.push('');
  lines.push('A geared orrery: Mercury to Saturn, and the Moon with a tilted orbit whose nodes regress.');
  lines.push(`Scale ${f(kit.scale, 2)}. Units are millimetres. ${kit.pieces.reduce((n, p) => n + p.count, 0)} pieces from ${kit.pieces.length} files.`);
  lines.push('');
  lines.push('READ THIS FIRST');
  lines.push('This kit was generated by the Wheelwork app from the tooth counts on its workbench. Every');
  lines.push('file is a closed solid and every pair of spur wheels was checked for interference in the');
  lines.push('plane (table below; the bevel pair of the crank is not in that table), but THE KIT HAS NOT');
  lines.push('BEEN PRINTED OR ASSEMBLED BY ITS AUTHOR. Fits are nominal. Fixed fits (a wheel on its tube,');
  lines.push('a pin in its socket) are drawn size for size: a printed hole comes out a little small,');
  lines.push('which makes the press; ream it if it is too tight and glue it if it is loose. Running');
  lines.push('fits have 0.2 to 0.25 mm on radius. The tellurion parts are small; a resin printer, or a');
  lines.push('larger scale, suits them better than a 0.4 mm nozzle at scale 1. The Earth, and the node');
  lines.push('sleeve with its inclined ring, have no flat face to stand on and need supports.');
  lines.push('');
  lines.push('TOOTH COUNTS (wheel A meshes B, C meshes D; B and C are one cluster)');
  for (const id of TRAIN_IDS) {
    const w = (r: string) => layout.byId.get(`${id}.${r}`)!;
    lines.push(`  ${pad(trainName(id), 28)} A ${pad(String(w('a').teeth), 4)} B ${pad(String(w('b').teeth), 4)} C ${pad(String(w('c').teeth), 4)} D ${w('d').teeth}`);
  }
  lines.push(`  ${pad('Crank', 28)} pinion ${layout.spec.bevel.crank}, wheel ${layout.spec.bevel.mercury} (straight bevels, Tredgold tooth form)`);
  lines.push('');
  lines.push('GEAR PAIRS, CHECKED');
  lines.push(`  ${pad('train', 28)} ${pad('pair', 5)} ${pad('teeth', 8)} ${pad('module', 7)} ${pad('contact', 8)} ${pad('clearance', 10)} verdict`);
  for (const m of kit.meshes) {
    lines.push(`  ${pad(m.train, 28)} ${pad(m.pair, 5)} ${pad(m.teeth, 8)} ${pad(f(m.module, 2), 7)} ${pad(f(m.contactRatio, 2), 8)} ${pad(`${f(m.clearance, 3)} mm`, 10)} ${m.ok ? 'ok' : 'INTERFERES'}`);
  }
  lines.push('  contact: contact ratio with undercut counted (above 1 means a tooth is always engaged).');
  lines.push('  clearance: smallest gap between the two outlines over one tooth pitch, backlash centred.');
  lines.push('');
  lines.push('PIECES');
  let group = '';
  for (const p of kit.pieces) {
    if (p.group !== group) { group = p.group; lines.push(`  ${group}`); }
    lines.push(`    ${pad(p.file, 54)} x${p.count}  ${f(p.size[0])} x ${f(p.size[1])} x ${f(p.size[2])}${p.closed ? '' : '  NOT CLOSED'}`);
    if (p.note) lines.push(`        ${p.note}`);
  }
  lines.push('');
  lines.push(`Largest piece: ${f(kit.largest[0])} x ${f(kit.largest[1])} mm on the bed, tallest ${f(kit.largest[2])} mm. Plastic: about ${f(kit.totalVolume / 1000, 0)} cubic centimetres solid.`);
  lines.push('');
  lines.push('ASSEMBLY, FROM THE BOTTOM');
  lines.push(' 1. Press the sun post and the idler post into the base plate; stand the four lower pillars');
  lines.push('    on its pins. Glue the two crank bearings on the crank line, slide the crank shaft');
  lines.push('    through them and fix the pinion on its inner end.');
  lines.push(" 2. Fix the crank wheel on the bottom of Mercury's tube, teeth down, and lower the tube over");
  lines.push('    the sun post until the wheel meshes with the pinion. Drop the collar on the idler post.');
  lines.push(' 3. Build upwards, a level at a time. Each tube takes its lower wheel (D) and its upper');
  lines.push('    wheel (A); each cluster (B and C) drops onto the idler post between them. The order of');
  lines.push('    tubes is Mercury, Venus, month tube, then the bridge with the fixed tube, then Earth,');
  lines.push('    Mars, Jupiter and Saturn. Every tube stands on the hub of the wheel below it.');
  lines.push(' 4. After the month tube and its wheels, fit the bridge over the pillar pins, with the fixed');
  lines.push('    tube glued into it, then stand the upper pillars on the same pins. The month-to-earth');
  lines.push('    cluster passes between the arms of the bridge.');
  lines.push(' 5. Put on the deck plate, then the arms of Saturn, Jupiter and Mars.');
  lines.push(" 6. The earth's arm carries the tellurion. Press the stud into it. On the earth post go, in");
  lines.push("    order, the axis shaft with its wheel, the moon's sleeve with its wheel and arm, and the");
  lines.push('    node sleeve with its wheel and ring. On the stud go the axis cluster, the node cluster');
  lines.push('    (wheel B and sleeve), the moon cluster, and last wheel C of the node cluster. The fixed');
  lines.push("    tube takes the earth's axis wheel A and the node wheel A; the month tube takes the moon");
  lines.push('    wheel A.');
  lines.push(" 7. Fit Venus's and Mercury's arms, the balls and the Sun.");
  lines.push(' 8. Set the machine: turn each arm on its tube to the planet\'s place for today (the app');
  lines.push('    gives the longitudes; zero is along the line from the centre to the idler post).');
  lines.push('');
  lines.push('MIT licence. https://github.com/highsierralabs/End_of_week_challenge');
  return lines.join('\n') + '\n';
}
