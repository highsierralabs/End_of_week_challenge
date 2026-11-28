// Every solid of the machine, built from the layout. Each part is made in the frame of the body
// it belongs to: the origin is on the body's own axis and heights are machine heights, so a body
// is posed by one rotation about its axis (and, for the bodies on the earth arm, by carrying that
// axis round). The same builders make the screen model and the print kit.
import { bevelPair } from '../gears/bevel';
import { spurGear } from '../gears/involute';
import {
  type Affine, armOutline, box, circle, compose, cylinder, extrude, lathe, linkOutline, merge, polarRing, revolve, rotationX, rotationY,
  rotationZ, segmentsFor, sphere, spokeWindow, transformed, translation, tube,
} from '../mesh/kit';
import { type Mesh, type Ring, type Vec2 } from '../mesh/types';
import {
  BODIES, type Body, bridgeZ, CHAIN, type ChainMember, deckZ, DESIGN, levelZ, nestInnerDiameter, nestOuterDiameter, tellurionLevelZ,
} from './design';
import { type BodyId, type Layout, type Wheel, wheelsOf } from './layout';

export type MaterialId =
  | 'brass' | 'brassWheel' | 'brassDark' | 'steel' | 'gilt' | 'deck' | 'walnut' | 'ebony' | 'ivory'
  | 'mercury' | 'venus' | 'earth' | 'mars' | 'jupiter' | 'saturn' | 'moon';

/** Bodies that exist only on screen: the two halves of the case. */
export type PartBody = BodyId | 'caseNear' | 'caseFar';

export interface Part {
  id: string;
  name: string;
  body: PartBody;
  material: MaterialId;
  mesh: Mesh;
  /** Set on wheels: the part also turns on its body by this wheel's phase (kinematics.wheelPhases). */
  wheel?: string;
  /** Height order for the exploded view: 0 at the base plate, rising. */
  layer: number;
  /** Centre of the part in its body frame, for labels and the camera. */
  anchor: readonly [number, number, number];
}

export interface Detail {
  flankPoints: number;
  filletPoints: number;
  /** Chord tolerance of circles, millimetres. */
  arcTol: number;
  /** Total backlash per wheel (circular thinning at the pitch circle), millimetres. */
  backlash: number;
  /**
   * Radial allowance of a fixed fit (a wheel on its tube, a tube in a plate). On screen a hair of
   * clearance keeps the two surfaces from lying in each other. In the print kit it is zero: hole
   * and seat are drawn the same size, a printed hole comes out a little small, and that makes the
   * press.
   */
  press: number;
}

export const SCREEN_DETAIL: Detail = { flankPoints: 5, filletPoints: 3, arcTol: 0.03, backlash: 0.06, press: 0.03 };
export const PRINT_DETAIL: Detail = { flankPoints: 10, filletPoints: 6, arcTol: 0.01, backlash: 0.12, press: 0 };

const TAU = Math.PI * 2;

/** Exploded-view layers: gearbox levels are 1 to 12, the bridge 5.5, the deck 13, and what stands on the deck follows. */
const TOP = 14;
const ARM_LAYER: Record<Body, number> = { saturn: TOP, jupiter: TOP + 1, mars: TOP + 2, earth: TOP + 3, venus: TOP + 8, mercury: TOP + 9 };
const tellurionLayer = (level: number): number => TOP + 3 + 0.5 * level;

// ---------------------------------------------------------------- shared dimensions

export const HUB_BOSS = 0.7;
const ARM_HUB = 3;

export function armBottomZ(m: Body): number {
  return deckZ().top + DESIGN.armZ[m];
}

export function eclipticZ(): number {
  return deckZ().top + DESIGN.eclipticZ;
}

/** Bottom and top of each tube of the nest. */
export function tubeSpan(layout: Layout, m: ChainMember | 'fixed'): { bottom: number; top: number } {
  if (m === 'fixed') {
    return { bottom: bridgeZ().bottom, top: tellurionLevelZ(3) + DESIGN.tellurionFace + 0.4 };
  }
  const wheels = wheelsOf(layout, m).filter((w) => !w.tellurion);
  const lowest = wheels[0]!.z - HUB_BOSS;
  const bottom = m === 'mercury' ? bevelSeat().wheelTop - 4 : lowest;
  const top = m === 'month' ? tellurionLevelZ(5) + DESIGN.tellurionFace + 0.5 : armBottomZ(m) + DESIGN.armThickness + ARM_HUB;
  return { bottom, top };
}

// ---------------------------------------------------------------- wheels

function segs(radius: number, detail: Detail): number {
  return segmentsFor(radius, detail.arcTol, 20, 200);
}

export interface WheelStyle {
  /** Radius of the hole through the disc; the hub fills it. */
  hubRadius: number;
  boreRadius: number;
  /** Hub length beyond each face. */
  boss: number;
  crossings: boolean;
}

/** The plan of a wheel: its toothed outline and, if it is large enough, the windows between its spokes. */
export function wheelRegion(w: Wheel, style: WheelStyle, detail: Detail): { outer: Ring; holes: Ring[] } {
  const g = spurGear({ teeth: w.teeth, module: w.module, backlash: detail.backlash, flankPoints: detail.flankPoints, filletPoints: detail.filletPoints });
  const holes: Ring[] = [circle(style.hubRadius - 0.25, segs(style.hubRadius, detail))];
  const rim = Math.max(1.5, 0.9 * w.module + 0.9);
  const r1 = w.rootRadius - rim;
  const r0 = style.hubRadius + Math.max(1.0, 0.06 * r1);
  if (style.crossings && r1 - r0 > 4.5) {
    const spokes = r1 > 30 ? 6 : r1 > 17 ? 5 : 4;
    const width = Math.max(1.7, Math.min(3.4, 0.17 * r1));
    const corner = Math.min(1.6, (r1 - r0) * 0.22);
    for (let i = 0; i < spokes; i++) {
      // Spokes fall between teeth of the phase mark so the wheel reads the same from both sides.
      const a0 = ((i + 0.5) / spokes) * TAU;
      const a1 = ((i + 1.5) / spokes) * TAU;
      holes.push(spokeWindow(r0, r1, a0, a1, width, corner, detail.arcTol));
    }
  }
  return { outer: g.outline, holes };
}

/** A wheel with its hub, on its own axis at its own height. */
export function wheelSolid(w: Wheel, style: WheelStyle, detail: Detail): Mesh {
  const disc = extrude(wheelRegion(w, style, detail), w.z, w.z + w.face);
  const hub = tube(style.hubRadius, style.boreRadius, w.z - style.boss, w.z + w.face + style.boss, segs(style.hubRadius, detail));
  return merge([disc, hub]);
}

/** How each wheel is made, from what it sits on. */
export function wheelStyle(w: Wheel, detail: Detail = SCREEN_DETAIL): WheelStyle {
  if (w.tellurion) {
    return { hubRadius: w.seatRadius + DESIGN.tellurionHubWall, boreRadius: w.seatRadius + detail.press, boss: 0.25, crossings: true };
  }
  return { hubRadius: w.seatRadius + DESIGN.hubWall, boreRadius: w.seatRadius + detail.press, boss: HUB_BOSS, crossings: true };
}

// ---------------------------------------------------------------- the crank's bevel pair

interface BevelSeat {
  /** Top of the bevel wheel's body on Mercury's tube. */
  wheelTop: number;
  wheel: Mesh;
  /** The pinion in the crank's own frame: shaft along +X from the central axis. */
  pinion: Mesh;
  /** Turns of the pinion per turn of the wheel, signed, about the crank's +X. */
  ratio: number;
  pinionOuterX: number;
}

let bevelCache: { key: string; seat: BevelSeat } | null = null;

/**
 * The bevel wheel on Mercury's tube and the pinion on the crank. The pair is generated with the
 * wheel's axis on +Z and the pinion's on +X, apexes at the origin; here it is turned so that the
 * wheel hangs above the crank with its teeth down.
 */
export function bevelSeat(teethCrank: number = DESIGN.bevelTeethCrank, teethMercury: number = DESIGN.bevelTeethMercury): BevelSeat {
  const key = `${teethCrank}:${teethMercury}`;
  if (bevelCache?.key === key) return bevelCache.seat;
  const mercuryBore = nestOuterDiameter('mercury') + 0.06;
  const pair = bevelPair({
    teethA: teethMercury, teethB: teethCrank, module: DESIGN.bevelModule, faceWidth: DESIGN.bevelFaceWidth, backlash: 0.1,
    boreA: mercuryBore, boreB: DESIGN.crankShaftDiameter + 0.06,
    hubLengthA: 4, hubDiameterA: mercuryBore + 5, hubLengthB: 4, hubDiameterB: DESIGN.crankShaftDiameter + 4.5,
  });
  // Which side of the apex the wheel was generated on decides whether the pair must be turned over.
  const above = pair.extentA[0] >= 0 && pair.extentA[1] > 0;
  const flip: Affine = above ? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0] : rotationX(Math.PI);
  const lift = translation(0, 0, DESIGN.crankAxisZ);
  const wheel = transformed(pair.gearA, compose(lift, flip));
  const pinion = transformed(pair.gearB, flip);
  const far = Math.max(Math.abs(pair.extentA[0]), Math.abs(pair.extentA[1]));
  const seat: BevelSeat = {
    wheelTop: DESIGN.crankAxisZ + far,
    wheel,
    pinion,
    // Turning the pair over about X reverses the wheel's sense about Z but not the pinion's about X.
    ratio: above ? pair.ratioBperA : -pair.ratioBperA,
    pinionOuterX: Math.max(Math.abs(pair.extentB[0]), Math.abs(pair.extentB[1])),
  };
  bevelCache = { key, seat };
  return seat;
}

// ---------------------------------------------------------------- small builders

/** Cyclic change of axes: a mesh built along Z comes out along X (u, v, w) -> (w, u, v). */
const Z_TO_X: Affine = [0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0];

function at(mesh: Mesh, x: number, y: number, z = 0): Mesh {
  return transformed(mesh, translation(x, y, z));
}

function turned(mesh: Mesh, angle: number): Mesh {
  return transformed(mesh, rotationZ(angle));
}

/** Radius of the pins that join the pillars to the plates and to each other, and the depth of their sockets. */
export const PILLAR_PIN = 2;
const PILLAR_SOCKET = 3;

/** A turned pillar from z0 to z1 with a socket in its foot for the pin of whatever it stands on. */
function pillarProfile(z0: number, z1: number, detail: Detail): Vec2[] {
  const r = DESIGN.pillarDiameter / 2;
  const f = r + 2.2;
  const hole = PILLAR_PIN + detail.press;
  const pts: Vec2[] = [[0, z0 + PILLAR_SOCKET], [hole, z0 + PILLAR_SOCKET], [hole, z0], [f, z0], [f, z0 + 1.2], [r + 0.8, z0 + 2], [r + 0.8, z0 + 3.4]];
  // An entasis: the column swells slightly at mid height, like a turned baluster.
  const n = 10;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const z = z0 + 4 + (z1 - z0 - 8) * t;
    pts.push([r - 0.9 + 0.9 * Math.sin(Math.PI * t) ** 0.7, z]);
  }
  pts.push([r + 0.8, z1 - 3], [r + 0.8, z1 - 2], [f, z1 - 1.2], [f, z1], [0, z1]);
  return pts;
}

function pillarXY(i: number): Vec2 {
  const a = (DESIGN.pillarAngles[i]! * Math.PI) / 180;
  return [DESIGN.pillarRadius * Math.cos(a), DESIGN.pillarRadius * Math.sin(a)];
}

/** The bridge: a hub that grips the fixed tube, with four arms out to the pillars. */
export function bridgeOutline(): Ring {
  const core = nestOuterDiameter('fixed') / 2 + 6;
  const half = 4.2;
  const pad = DESIGN.pillarDiameter / 2 + 3.4;
  const R = DESIGN.pillarRadius;
  const arms = DESIGN.pillarAngles.map((d) => (d * Math.PI) / 180);
  return polarRing((theta) => {
    let r = core;
    for (const a of arms) {
      let d = Math.abs(theta - a) % TAU;
      if (d > Math.PI) d = TAU - d;
      if (d >= Math.PI / 2) continue;
      const s = Math.sin(d);
      const reach = R * s <= pad ? R * Math.cos(d) + Math.sqrt(pad * pad - R * R * s * s) : 0;
      const bar = s < 1e-9 ? Infinity : half / s;
      r = Math.max(r, Math.max(reach, Math.min(bar, R * Math.cos(d))));
    }
    return r;
  }, 1440);
}

function plateHoles(centreRadius: number, detail: Detail, pillars: boolean): Ring[] {
  const [ix, iy] = [DESIGN.centreDistance * Math.cos(DESIGN.idlerAngle), DESIGN.centreDistance * Math.sin(DESIGN.idlerAngle)];
  const holes: Ring[] = [circle(centreRadius, segs(centreRadius, detail)), circle(DESIGN.idlerPostDiameter / 2 + detail.press, 32, ix, iy)];
  for (let i = 0; pillars && i < DESIGN.pillarAngles.length; i++) {
    const [x, y] = pillarXY(i);
    holes.push(circle(PILLAR_PIN + detail.press, 24, x, y));
  }
  return holes;
}

function armSolid(length: number, hubRadius: number, endRadius: number, z: number, holes: Ring[], detail: Detail, half = 2.6): Mesh {
  return extrude({ outer: armOutline(hubRadius, half, endRadius, length, detail.arcTol), holes }, z, z + DESIGN.armThickness);
}

// ---------------------------------------------------------------- the machine

export interface PartsOptions {
  detail?: Detail;
  /** Include the walnut case (screen only). */
  withCase?: boolean;
}

export function buildParts(layout: Layout, options: PartsOptions = {}): Part[] {
  const detail = options.detail ?? SCREEN_DETAIL;
  const parts: Part[] = [];
  const deck = deckZ();
  const bridge = bridgeZ();
  const ecl = eclipticZ();
  const add = (p: Omit<Part, 'anchor'> & { anchor?: readonly [number, number, number] }): void => {
    let anchor = p.anchor;
    if (!anchor) {
      const pos = p.mesh.positions;
      let x = 0, y = 0, z = 0;
      for (let i = 0; i < pos.length; i += 3) { x += pos[i]!; y += pos[i + 1]!; z += pos[i + 2]!; }
      const n = Math.max(1, pos.length / 3);
      anchor = [x / n, y / n, z / n];
    }
    parts.push({ ...p, anchor });
  };
  const [idlerX, idlerY] = [DESIGN.centreDistance * Math.cos(DESIGN.idlerAngle), DESIGN.centreDistance * Math.sin(DESIGN.idlerAngle)];
  const bevel = bevelSeat(layout.spec.bevel.crank, layout.spec.bevel.mercury);

  // ---- frame
  const baseT = DESIGN.basePlateThickness;
  add({
    id: 'base', name: 'Base plate', body: 'frame', material: 'brassDark', layer: 0,
    // The base plate carries a pin for the foot of each pillar, so that plate and pillars both print flat.
    mesh: merge([
      extrude({ outer: circle(DESIGN.plateRadius, segs(DESIGN.plateRadius, detail)), holes: plateHoles(DESIGN.postDiameter / 2 + detail.press, detail, false) }, -baseT, 0),
      ...DESIGN.pillarAngles.map((_, i) => at(cylinder(PILLAR_PIN, -0.5, PILLAR_SOCKET - 0.4, 20), ...pillarXY(i))),
    ]),
  });
  add({
    id: 'post', name: 'Sun post', body: 'frame', material: 'steel', layer: 0,
    mesh: cylinder(DESIGN.postDiameter / 2, -baseT, ecl, 32),
  });
  add({
    id: 'sun', name: 'Sun', body: 'frame', material: 'gilt', layer: TOP + 10,
    mesh: sphere(DESIGN.ballDiameter.sun / 2, ecl, 64), anchor: [0, 0, ecl],
  });
  add({
    id: 'idlerPost', name: 'Idler post', body: 'frame', material: 'steel', layer: 0,
    mesh: at(cylinder(DESIGN.idlerPostDiameter / 2, -baseT, deck.top, 32), idlerX, idlerY),
  });
  add({
    id: 'idlerCollar', name: 'Idler post collar', body: 'frame', material: 'brass', layer: 0,
    mesh: at(tube(DESIGN.clusterHubDiameter / 2, DESIGN.idlerPostDiameter / 2 + detail.press, 0, levelZ(1) - HUB_BOSS - 0.15, 32), idlerX, idlerY),
  });
  for (let i = 0; i < DESIGN.pillarAngles.length; i++) {
    const [x, y] = pillarXY(i);
    add({
      id: `pillarLower${i}`, name: 'Pillar', body: 'frame', material: 'brass', layer: 0,
      // Its pin passes through the bridge into the socket of the upper pillar.
      mesh: at(merge([lathe(pillarProfile(0, bridge.bottom, detail), 40), cylinder(PILLAR_PIN, bridge.bottom - 0.5, bridge.top + PILLAR_SOCKET - 0.4, 20)]), x, y),
    });
    add({
      id: `pillarUpper${i}`, name: 'Pillar', body: 'frame', material: 'brass', layer: 5.5,
      mesh: at(merge([lathe(pillarProfile(bridge.top, deck.bottom, detail), 40), cylinder(PILLAR_PIN, deck.bottom - 0.5, deck.top, 20)]), x, y),
    });
  }
  const fixedOuter = nestOuterDiameter('fixed') / 2;
  add({
    id: 'bridge', name: 'Bridge', body: 'frame', material: 'brassDark', layer: 5.5,
    mesh: extrude({
      outer: bridgeOutline(),
      holes: [circle(fixedOuter + detail.press, segs(fixedOuter, detail)), ...DESIGN.pillarAngles.map((_, i) => circle(PILLAR_PIN + detail.press, 24, ...pillarXY(i)))],
    }, bridge.bottom, bridge.top),
  });
  const fixed = tubeSpan(layout, 'fixed');
  add({
    id: 'fixedTube', name: 'Fixed tube', body: 'frame', material: 'steel', layer: 5.5,
    mesh: tube(fixedOuter, nestInnerDiameter('fixed') / 2, fixed.bottom, fixed.top, segs(fixedOuter, detail)),
  });
  add({
    id: 'deck', name: 'Deck plate', body: 'frame', material: 'deck', layer: 13,
    mesh: extrude({ outer: circle(DESIGN.plateRadius, segs(DESIGN.plateRadius, detail)), holes: plateHoles(nestOuterDiameter('saturn') / 2 + 0.4, detail, true) }, deck.bottom, deck.top),
  });
  // Bearing blocks for the crank shaft: a block with a hole, built on its side.
  const blockRegion = (h: number) => ({
    outer: [[-7, 0], [7, 0], [7, h - 3], [4, h], [-4, h], [-7, h - 3]] as Ring,
    holes: [circle(DESIGN.crankShaftDiameter / 2 + 0.15, 32, 0, DESIGN.crankAxisZ)],
  });
  const crankTurn = rotationZ(DESIGN.crankAngle);
  for (const [i, x] of [bevel.pinionOuterX + 6, DESIGN.plateRadius - 10].entries()) {
    const block = transformed(extrude(blockRegion(DESIGN.crankAxisZ + 7), 0, 7), compose(translation(x, 0, 0), Z_TO_X));
    add({ id: `bearing${i}`, name: 'Crank bearing', body: 'frame', material: 'brass', layer: 0, mesh: transformed(block, crankTurn) });
  }

  // ---- crank (its own frame: shaft along +X from the central axis, origin at the apex)
  const shaftEnd = DESIGN.caseOuterRadius + 22;
  add({
    id: 'crankShaft', name: 'Crank shaft', body: 'crank', material: 'steel', layer: 0,
    mesh: transformed(cylinder(DESIGN.crankShaftDiameter / 2, bevel.pinionOuterX - 6, shaftEnd, 32), Z_TO_X),
  });
  add({ id: 'bevelPinion', name: 'Crank pinion', body: 'crank', material: 'brassWheel', layer: 0, mesh: bevel.pinion });
  {
    // The arm lies in the plane across the shaft; (u, v, w) -> (w, -v, u) puts its length along local Z.
    const toArm: Affine = [0, 0, 1, shaftEnd - 4, 0, -1, 0, 0, 1, 0, 0, 0];
    const arm = extrude({ outer: linkOutline(5.5, 4, DESIGN.crankArm, detail.arcTol), holes: [] }, 0, 3.2);
    add({ id: 'crankArm', name: 'Crank', body: 'crank', material: 'brass', layer: 0, mesh: transformed(arm, toArm) });
    const knob: Vec2[] = [[0, 0], [2.2, 0], [2.2, 3], [4.6, 5], [5.4, 12], [4.8, 22], [3.2, 26], [0, 27]];
    add({
      id: 'crankHandle', name: 'Crank handle', body: 'crank', material: 'ebony', layer: 0,
      mesh: transformed(lathe(knob, 40), compose(translation(shaftEnd - 1, 0, DESIGN.crankArm), Z_TO_X)),
    });
    add({
      id: 'crankCollar', name: 'Crank collar', body: 'crank', material: 'brass', layer: 0,
      mesh: transformed(tube(6.5, DESIGN.crankShaftDiameter / 2 - 0.1, DESIGN.caseOuterRadius + 0.5, DESIGN.caseOuterRadius + 4, 40), Z_TO_X),
    });
  }

  // ---- the chain: tubes, their wheels, arms and planets
  CHAIN.forEach((m, index) => {
    const span = tubeSpan(layout, m);
    const outer = nestOuterDiameter(m) / 2;
    add({
      id: `${m}Tube`, name: m === 'month' ? 'Month tube' : `${title(m)}'s tube`, body: m, material: 'steel', layer: index === 0 ? 1 : 2 * index,
      mesh: tube(outer, nestInnerDiameter(m) / 2, span.bottom, span.top, segs(outer, detail)),
    });
    for (const w of wheelsOf(layout, m)) {
      add({
        id: w.id, name: wheelName(w), body: m, material: 'brassWheel', wheel: w.id, layer: w.tellurion ? tellurionLayer(w.level) : w.level,
        mesh: wheelSolid(w, wheelStyle(w, detail), detail), anchor: [0, 0, w.z + w.face / 2],
      });
    }
    if (m === 'mercury') {
      add({ id: 'bevelWheel', name: 'Crank wheel', body: 'mercury', material: 'brassWheel', layer: 0, mesh: bevel.wheel });
    }
    if (m === 'month') return;
    const body = m as Body;
    const z = armBottomZ(body);
    const length = DESIGN.armLength[body];
    const hub = outer + 3.2;
    // The collar stands on the arm's upper face only, so the arm lies flat on a print bed.
    const collar = tube(hub - 0.8, outer + detail.press, z, z + DESIGN.armThickness + ARM_HUB, segs(hub, detail));
    if (body === 'earth') {
      const holes = [
        circle(hub - 1.2, segs(hub, detail)),
        circle(DESIGN.studDiameter / 2 + 0.02, 24, DESIGN.studDistance, 0),
        circle(DESIGN.earthAxisDiameter / 2 + 0.12, 24, length, 0),
      ];
      add({
        id: 'earthArm', name: "Earth's arm", body, material: 'brass', layer: ARM_LAYER.earth,
        mesh: merge([armSolid(length, hub + 1.5, 5.2, z, holes, detail, 4.4), collar]),
      });
      add({
        id: 'stud', name: 'Cluster stud', body, material: 'steel', layer: ARM_LAYER.earth,
        mesh: at(cylinder(DESIGN.studDiameter / 2, z, tellurionLevelZ(6) + DESIGN.tellurionFace + 1, 24), DESIGN.studDistance, 0),
      });
      return;
    }
    const stalkR = DESIGN.stalkDiameter / 2;
    add({
      id: `${body}Arm`, name: `${title(body)}'s arm`, body, material: 'brass', layer: ARM_LAYER[body],
      mesh: merge([
        armSolid(length, hub + 1.2, 3.1, z, [circle(hub - 1.2, segs(hub, detail)), circle(stalkR - 0.1, 20, length, 0)], detail),
        collar,
        at(cylinder(stalkR, z, ecl, 20), length, 0),
      ]),
    });
    const ball = sphere(DESIGN.ballDiameter[body] / 2, ecl, 48);
    add({ id: `${body}Ball`, name: title(body), body, material: body, layer: ARM_LAYER[body], mesh: at(ball, length, 0), anchor: [length, 0, ecl] });
    if (body === 'saturn') {
      const ring = transformed(saturnRingFlat(), rotationX((20 * Math.PI) / 180));
      add({ id: 'saturnRing', name: "Saturn's ring", body, material: 'saturn', layer: ARM_LAYER.saturn, mesh: at(ring, length, 0, ecl) });
    }
  });

  // ---- idler clusters
  for (let i = 0; i < CHAIN.length - 1; i++) {
    const body = `cluster${i}` as BodyId;
    const ws = wheelsOf(layout, body);
    for (const w of ws) {
      add({
        id: w.id, name: wheelName(w), body, material: 'brassWheel', wheel: w.id, layer: w.level,
        mesh: wheelSolid(w, { hubRadius: DESIGN.clusterHubDiameter / 2, boreRadius: w.seatRadius, boss: HUB_BOSS, crossings: true }, detail),
        anchor: [0, 0, w.z + w.face / 2],
      });
    }
    // The sleeve that makes the two wheels one piece.
    add({
      id: `${body}Sleeve`, name: 'Cluster sleeve', body, material: 'brass', layer: ws[0]!.level,
      mesh: tube(DESIGN.clusterHubDiameter / 2 - 0.4, ws[0]!.seatRadius, ws[0]!.z - HUB_BOSS, ws[1]!.z + ws[1]!.face + HUB_BOSS, 32),
    });
  }

  // ---- fixed wheels of the tellurion (on the fixed tube)
  for (const w of wheelsOf(layout, 'frame')) {
    add({
      id: w.id, name: wheelName(w), body: 'frame', material: 'brassWheel', wheel: w.id, layer: tellurionLayer(w.level),
      mesh: wheelSolid(w, wheelStyle(w, detail), detail), anchor: [0, 0, w.z + w.face / 2],
    });
  }

  // ---- tellurion clusters on the stud
  const clusterSleeve: Record<string, { outer: number; inner: number }> = {
    tiltCluster: { outer: DESIGN.studDiameter / 2 + 0.2 + DESIGN.tellurionHubWall, inner: DESIGN.studDiameter / 2 + 0.2 },
    nodeCluster: { outer: DESIGN.nodeClusterSleeveDiameter / 2, inner: DESIGN.studDiameter / 2 + 0.2 },
    moonCluster: { outer: DESIGN.nodeClusterSleeveDiameter / 2 + 0.2 + DESIGN.tellurionHubWall, inner: DESIGN.nodeClusterSleeveDiameter / 2 + 0.2 },
  };
  for (const body of ['tiltCluster', 'nodeCluster', 'moonCluster'] as const) {
    const ws = wheelsOf(layout, body);
    const sl = clusterSleeve[body]!;
    for (const w of ws) {
      add({
        id: w.id, name: wheelName(w), body, material: 'brassWheel', wheel: w.id, layer: tellurionLayer(w.level),
        mesh: wheelSolid(w, wheelStyle(w, detail), detail), anchor: [0, 0, w.z + w.face / 2],
      });
    }
    add({
      id: `${body}Sleeve`, name: 'Cluster sleeve', body, material: 'brass', layer: tellurionLayer(ws[0]!.level),
      mesh: tube(sl.outer, sl.inner, ws[0]!.z - 0.2, ws[ws.length - 1]!.z + DESIGN.tellurionFace + 0.2, 28),
    });
  }

  // ---- earth's axis, the moon's sleeve and the node sleeve, on the earth post
  const moonArmZ = deck.top + DESIGN.moonArmZ;
  const ringTop = deck.top + DESIGN.nodeRingZ;
  const earthR = DESIGN.ballDiameter.earth / 2;
  {
    const ws = wheelsOf(layout, 'earthAxis');
    for (const w of ws) {
      add({ id: w.id, name: wheelName(w), body: 'earthAxis', material: 'brassWheel', wheel: w.id, layer: tellurionLayer(w.level), mesh: wheelSolid(w, wheelStyle(w, detail), detail), anchor: [0, 0, w.z + w.face / 2] });
    }
    add({
      id: 'earthAxisShaft', name: "Earth's axis shaft", body: 'earthAxis', material: 'steel', layer: TOP + 7,
      // It ends in a socket in the globe's underside, short of the centre.
      mesh: cylinder(DESIGN.earthAxisDiameter / 2, armBottomZ('earth'), ecl - EARTH_SOCKET_TOP, 24),
    });
    // The globe leans towards the body's +X by the obliquity, and keeps that lean as the arm carries it round.
    const lean = compose(translation(0, 0, ecl), compose(rotationY((DESIGN.obliquity * Math.PI) / 180), translation(0, 0, -ecl)));
    add({ id: 'earthBall', name: 'Earth', body: 'earthAxis', material: 'earth', layer: TOP + 7, mesh: transformed(sphere(earthR, ecl, 64), lean), anchor: [0, 0, ecl] });
    add({
      id: 'earthPin', name: "Earth's polar axis", body: 'earthAxis', material: 'brass', layer: TOP + 7,
      // Two stubs at the poles rather than a pin through the middle, which would cross the shaft's socket.
      mesh: transformed(merge([cylinder(0.45, ecl + earthR - 0.6, ecl + earthR + 2.2, 12), cylinder(0.45, ecl - earthR - 2.2, ecl - earthR + 0.6, 12)]), lean),
    });
  }
  {
    const ws = wheelsOf(layout, 'moonSleeve');
    for (const w of ws) {
      add({ id: w.id, name: wheelName(w), body: 'moonSleeve', material: 'brassWheel', wheel: w.id, layer: tellurionLayer(w.level), mesh: wheelSolid(w, wheelStyle(w, detail), detail), anchor: [0, 0, w.z + w.face / 2] });
    }
    const r = DESIGN.moonSleeveDiameter / 2;
    add({
      id: 'moonSleeveTube', name: "Moon's sleeve", body: 'moonSleeve', material: 'brass', layer: TOP + 6.5,
      mesh: tube(r, DESIGN.earthAxisDiameter / 2 + 0.2, tellurionLevelZ(2) + 0.3, moonArmZ + 3, 28),
    });
    add({
      id: 'moonArm', name: "Moon's arm", body: 'moonSleeve', material: 'brass', layer: TOP + 6.5,
      mesh: extrude({ outer: linkOutline(r + 1.6, 2.3, DESIGN.moonOrbitRadius, detail.arcTol), holes: [circle(r - 0.2, 24), circle(0.95, 16, DESIGN.moonOrbitRadius, 0)] }, moonArmZ, moonArmZ + 1.8),
    });
  }
  {
    const ws = wheelsOf(layout, 'nodeSleeve');
    for (const w of ws) {
      add({ id: w.id, name: wheelName(w), body: 'nodeSleeve', material: 'brassWheel', wheel: w.id, layer: tellurionLayer(w.level), mesh: wheelSolid(w, wheelStyle(w, detail), detail), anchor: [0, 0, w.z + w.face / 2] });
    }
    const r = DESIGN.nodeSleeveDiameter / 2;
    add({
      id: 'nodeSleeveTube', name: 'Node sleeve', body: 'nodeSleeve', material: 'brass', layer: TOP + 6,
      mesh: tube(r, DESIGN.moonSleeveDiameter / 2 + 0.2, tellurionLevelZ(5) + 0.3, ringTop, 28),
    });
    // The inclined ring: built flat, tipped about the node line (the body's X axis) so that it is
    // highest a quarter turn after the ascending node, then set at its height.
    const rm = DESIGN.moonOrbitRadius;
    const flat: Mesh[] = [lathe([[rm - 1.7, -1.2], [rm + 1.7, -1.2], [rm + 1.7, 0], [rm - 1.7, 0]], 96)];
    for (let k = 0; k < 3; k++) flat.push(turned(box(r - 0.5, -0.9, -1.2, rm - 1.4, 0.9, 0), (k / 3) * TAU + 0.5));
    flat.push(tube(r + 1.4, r - 0.3, -1.2, 0, 28));
    const tip = compose(translation(0, 0, ringTop), rotationX((DESIGN.moonInclination * Math.PI) / 180));
    add({ id: 'nodeRing', name: 'Inclined ring', body: 'nodeSleeve', material: 'brassDark', layer: TOP + 6, mesh: transformed(merge(flat), tip), anchor: [0, 0, ringTop] });
    // A small pointer at the ascending node.
    add({
      id: 'nodeMark', name: 'Ascending node', body: 'nodeSleeve', material: 'brass', layer: TOP + 6,
      mesh: transformed(at(sphere(0.9, 0, 16), rm + 1.7, 0, -0.6), tip),
    });
  }
  add({
    id: 'moonStalk', name: "Moon's stalk", body: 'moonStalk', material: 'steel', layer: TOP + 6.5,
    // The foot is a ball that stands on the ring's upper face.
    mesh: at(merge([cylinder(0.8, ringTop + 1.1, ecl, 16), sphere(1.1, ringTop + 1.1, 16)]), DESIGN.moonOrbitRadius, 0),
  });
  add({
    id: 'moonBall', name: 'Moon', body: 'moonStalk', material: 'moon', layer: TOP + 6.5,
    mesh: at(sphere(DESIGN.ballDiameter.moon / 2, ecl, 40), DESIGN.moonOrbitRadius, 0), anchor: [DESIGN.moonOrbitRadius, 0, ecl],
  });

  if (options.withCase) parts.push(...caseParts(detail));
  return parts;
}

/** How far below the globe's centre the earth's axis shaft stops. */
export const EARTH_SOCKET_TOP = 3;

/** Saturn's ring lying flat, centred on the origin: an annulus held off the ball by three spokes that reach into it. */
export function saturnRingFlat(): Mesh {
  const r = DESIGN.ballDiameter.saturn / 2;
  const solids: Mesh[] = [lathe([[r * 1.25, -0.25], [r * 1.95, -0.25], [r * 1.95, 0.25], [r * 1.25, 0.25]], 72)];
  for (let k = 0; k < 3; k++) solids.push(turned(box(r - 0.7, -0.4, -0.25, r * 1.3, 0.4, 0.25), (k / 3) * TAU));
  return merge(solids);
}

/** The walnut drum, in two halves that part along the crank's line. */
export function caseParts(_detail: Detail): Part[] {
  const deck = deckZ();
  const ro = DESIGN.caseOuterRadius;
  const ri = ro - DESIGN.caseWall;
  const lip = DESIGN.plateRadius + 0.6;
  const z0 = DESIGN.deskZ;
  const zt = deck.top + 1.2;
  const profile: Vec2[] = [
    [ri, z0], [ro + 9, z0], [ro + 9, z0 + 5], [ro + 7.5, z0 + 7.5], [ro + 4, z0 + 9], [ro + 2.2, z0 + 12], [ro, z0 + 14],
    [ro, zt - 12], [ro + 1.6, zt - 10], [ro + 3.4, zt - 7], [ro + 3.4, zt - 2], [ro + 2.4, zt], [lip, zt],
    [lip, deck.bottom - 0.4], [ri, deck.bottom - 0.4],
  ];
  const a = DESIGN.crankAngle;
  // Where the crank shaft leaves the case, on the seam, each half is cut away round it: a narrow
  // strip of wall next to the seam is made in two pieces, one under the shaft and one over.
  const gap = DESIGN.crankShaftDiameter / 2 + 0.7;
  const strip = Math.asin(gap / ri);
  const under: Vec2[] = [...profile.slice(0, 7), [ro, DESIGN.crankAxisZ - gap], [ri, DESIGN.crankAxisZ - gap]];
  const over: Vec2[] = [[ri, DESIGN.crankAxisZ + gap], [ro, DESIGN.crankAxisZ + gap], ...profile.slice(7)];
  const near = merge([revolve(profile, a - Math.PI, a - strip, 96), revolve(under, a - strip, a, 2), revolve(over, a - strip, a, 2)]);
  const far = merge([revolve(under, a, a + strip, 2), revolve(over, a, a + strip, 2), revolve(profile, a + strip, a + Math.PI, 96)]);
  const anchor: readonly [number, number, number] = [0, 0, (z0 + zt) / 2];
  // Two brass stringing lines let into the wood.
  const band = (z: number): Vec2[] => [[ro - 0.6, z], [ro + 0.35, z], [ro + 0.35, z + 1.3], [ro - 0.6, z + 1.3]];
  const bands = (from: number, to: number) => merge([revolve(band(z0 + 19), from, to, 96), revolve(band(zt - 17), from, to, 96)]);
  return [
    { id: 'caseNear', name: 'Walnut case', body: 'caseNear', material: 'walnut', mesh: near, layer: 0, anchor },
    { id: 'caseFar', name: 'Walnut case', body: 'caseFar', material: 'walnut', mesh: far, layer: 0, anchor },
    { id: 'caseNearInlay', name: 'Walnut case', body: 'caseNear', material: 'brass', mesh: bands(a - Math.PI, a), layer: 0, anchor },
    { id: 'caseFarInlay', name: 'Walnut case', body: 'caseFar', material: 'brass', mesh: bands(a, a + Math.PI), layer: 0, anchor },
  ];
}

function title(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const TRAIN_NAMES: Record<string, string> = {
  'mercury-venus': 'Mercury to Venus', 'venus-month': 'Venus to the month tube', 'month-earth': 'Month tube to Earth',
  'earth-mars': 'Earth to Mars', 'mars-jupiter': 'Mars to Jupiter', 'jupiter-saturn': 'Jupiter to Saturn',
  tilt: "Earth's axis", node: "Moon's nodes", moon: 'Moon',
};

export function trainName(id: string): string {
  return TRAIN_NAMES[id] ?? id;
}

export function wheelName(w: Wheel): string {
  return `${trainName(w.train)}, wheel ${w.role.toUpperCase()} (${w.teeth} teeth)`;
}

export { BODIES };
