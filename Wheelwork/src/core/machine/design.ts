// The fixed dimensions of the machine, in millimetres. Tooth counts are not here: they are the
// variable part (spec.ts) and everything that depends on them is derived in layout.ts.
//
// Frame: Z up, origin on the sun post's axis at the top face of the base plate. Ecliptic longitude
// is measured counter-clockwise from +X seen from above, so prograde motion is counter-clockwise.

/** The nest of coaxial members on the central axis, innermost first. */
export const NEST = ['post', 'mercury', 'venus', 'month', 'fixed', 'earth', 'mars', 'jupiter', 'saturn'] as const;
export type NestMember = (typeof NEST)[number];

/** The members of the nest that turn, in nest order: the gearbox chain runs through them in this order. */
export const CHAIN = ['mercury', 'venus', 'month', 'earth', 'mars', 'jupiter', 'saturn'] as const;
export type ChainMember = (typeof CHAIN)[number];

export const BODIES = ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn'] as const;
export type Body = (typeof BODIES)[number];

export const DESIGN = {
  // ---- central nest
  postDiameter: 5,
  /** Each member's outside diameter grows by this over the one inside it. */
  nestStep: 3,
  /** Radial running clearance between neighbouring tubes. */
  nestClearance: 0.25,

  // ---- gearbox
  /** Centre distance from the central axis to the idler post. */
  centreDistance: 54,
  /** Direction of the idler post from the centre (radians). */
  idlerAngle: 0,
  idlerPostDiameter: 5,
  /** Face width of a gearbox wheel, and the distance from one level to the next. */
  faceWidth: 4.5,
  levelPitch: 6,
  /** Bottom of level 1. The crank's bevel pair lives below it. */
  firstLevelZ: 34,
  bridgeThickness: 3,
  /** Extra height taken by the bridge, which sits between levels 5 and 6. */
  bridgeGap: 5,
  bridgeBelowLevel: 6,
  deckThickness: 3,
  basePlateThickness: 4,
  plateRadius: 108,
  pillarRadius: 102,
  pillarAngles: [45, 135, 225, 315],
  pillarDiameter: 9,
  /** Material left between a wheel's root circle and the tube or sleeve it is fixed on. */
  hubWall: 1.6,
  /** Bore clearance of a cluster on its post (radial). */
  postClearance: 0.2,
  clusterHubDiameter: 10,

  // ---- crank
  bevelModule: 1.25,
  bevelTeethCrank: 16,
  bevelTeethMercury: 48,
  bevelFaceWidth: 6,
  /** Height of the crank shaft's axis above the base plate. */
  crankAxisZ: 14,
  crankShaftDiameter: 5,
  /** The crank leaves the case in this direction (radians). */
  crankAngle: Math.PI,
  crankArm: 26,

  // ---- above the deck
  armThickness: 2.4,
  /** Height of each arm's underside above the deck. */
  armZ: { saturn: 3, jupiter: 10, mars: 17, earth: 24, venus: 53, mercury: 60 },
  /** Arm lengths: the orbits are spaced for clearance, not to scale. */
  armLength: { mercury: 34, venus: 52, earth: 82, mars: 112, jupiter: 142, saturn: 170 },
  /** Height of the ecliptic plane (the centres of the Sun and planets) above the deck. */
  eclipticZ: 80,
  stalkDiameter: 2,
  ballDiameter: { sun: 26, mercury: 5, venus: 8.5, earth: 13, mars: 6.5, jupiter: 17, saturn: 13.5, moon: 4.4 },

  // ---- tellurion (on the earth arm)
  /** Bottom of tellurion level 1 above the deck. */
  tellurionZ: 28,
  tellurionFace: 3,
  tellurionPitch: 3.6,
  /** The cluster stud stands midway along the earth arm. */
  studDistance: 41,
  studDiameter: 3,
  earthAxisDiameter: 3,
  moonSleeveDiameter: 5.6,
  nodeSleeveDiameter: 8.2,
  /** The node cluster's long sleeve, on which the moon cluster turns. */
  nodeClusterSleeveDiameter: 5.6,
  /** Wall of the hub that fixes a tellurion wheel on its seat. */
  tellurionHubWall: 1.3,
  moonOrbitRadius: 18,
  /** True inclination of the Moon's orbit to the ecliptic, degrees. */
  moonInclination: 5.145,
  /** Obliquity of the ecliptic, degrees. */
  obliquity: 23.44,
  /** The inclined ring's top face at the earth post, above the deck. */
  nodeRingZ: 54,
  moonArmZ: 58,

  // ---- case (drawn, not printed)
  caseOuterRadius: 124,
  caseWall: 8,
  deskZ: -18,
} as const;

/** Outside diameter of a nest member. */
export function nestOuterDiameter(m: NestMember): number {
  return DESIGN.postDiameter + DESIGN.nestStep * NEST.indexOf(m);
}

/** Inside diameter of a nest member (0 for the solid post). */
export function nestInnerDiameter(m: NestMember): number {
  const i = NEST.indexOf(m);
  return i === 0 ? 0 : nestOuterDiameter(NEST[i - 1]!) + 2 * DESIGN.nestClearance;
}

/** Bottom of gearbox level k (1..12). */
export function levelZ(k: number): number {
  return DESIGN.firstLevelZ + (k - 1) * DESIGN.levelPitch + (k >= DESIGN.bridgeBelowLevel ? DESIGN.bridgeGap : 0);
}

/** Number of gearbox levels: two per chain step. */
export const LEVELS = (CHAIN.length - 1) * 2;

/** Underside and top of the deck plate. */
export function deckZ(): { bottom: number; top: number } {
  const bottom = levelZ(LEVELS) + DESIGN.faceWidth + 1.5;
  return { bottom, top: bottom + DESIGN.deckThickness };
}

/** Underside and top of the bridge plate. */
export function bridgeZ(): { bottom: number; top: number } {
  const bottom = levelZ(DESIGN.bridgeBelowLevel - 1) + DESIGN.faceWidth + 1;
  return { bottom, top: bottom + DESIGN.bridgeThickness };
}

/** Bottom of tellurion level k (1..6), in the machine frame. */
export function tellurionLevelZ(k: number): number {
  return deckZ().top + DESIGN.tellurionZ + (k - 1) * DESIGN.tellurionPitch;
}
