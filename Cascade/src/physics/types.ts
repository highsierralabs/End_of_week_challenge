// Contracts between the Monte Carlo (src/physics, runs in a worker) and the
// renderer / UI. Units everywhere: metres, nanoseconds, GeV, g/cm^2.
// Frame: x = east, y = north, z = up, z measured as altitude above sea level.
// The detector sits at (0, 0, groundAltitudeM).

/** Particle species tracked by the Monte Carlo. */
export const PType = {
  GAMMA: 0,
  ELECTRON: 1,
  POSITRON: 2,
  MUON_MINUS: 3,
  MUON_PLUS: 4,
  PION_PLUS: 5,
  PION_MINUS: 6,
  PROTON: 7,
  NEUTRON: 8,
  NUCLEUS: 9,
} as const;
export type PType = (typeof PType)[keyof typeof PType];

/** Coarse classes used for colour and for the per-class profiles. */
export const RClass = {
  GAMMA: 0,
  ELECTRON: 1,
  POSITRON: 2,
  MUON: 3,
  HADRON: 4,
} as const;
export type RClass = (typeof RClass)[keyof typeof RClass];
export const RCLASS_COUNT = 5;
export const RCLASS_NAMES = ['photon', 'electron', 'positron', 'muon', 'hadron'] as const;

export function renderClass(t: PType): RClass {
  switch (t) {
    case PType.GAMMA: return RClass.GAMMA;
    case PType.ELECTRON: return RClass.ELECTRON;
    case PType.POSITRON: return RClass.POSITRON;
    case PType.MUON_MINUS:
    case PType.MUON_PLUS: return RClass.MUON;
    default: return RClass.HADRON;
  }
}

export type Primary = 'proton' | 'helium' | 'nitrogen' | 'iron' | 'gamma';
export const PRIMARY_MASS_NUMBER: Record<Primary, number> = { proton: 1, helium: 4, nitrogen: 14, iron: 56, gamma: 0 };

export interface ShowerParams {
  primary: Primary;
  /** Primary total energy in eV (the cosmic-ray convention). */
  energyEV: number;
  /** Zenith angle of the arrival direction, degrees (0 = straight down). */
  zenithDeg: number;
  /** Azimuth the shower comes FROM, degrees clockwise from north. */
  azimuthDeg: number;
  seed: number;
  /** Hillas thinning level epsilon (E_thin = epsilon * E0). 0 disables thinning. */
  thinning: number;
  /** Kinetic-energy cut for e+-, and energy cut for photons, MeV. */
  emCutMeV: number;
  /** Kinetic-energy cut for muons, MeV. */
  muonCutMeV: number;
  /** Kinetic-energy cut for hadrons, GeV. */
  hadronCutGeV: number;
  /** Track the electromagnetic component at all (false = hadrons + muons only, for rate mode). */
  trackEm: boolean;
  /** Hard cap on recorded track segments (memory budget). */
  maxSegments: number;
  /** Where the shower core lands, metres from the detector. */
  coreX: number;
  coreY: number;
  /** Ground (detector) altitude above sea level, metres. */
  groundAltitudeM: number;
  /** Record track segments at all (false for batch / validation runs). */
  recordTracks: boolean;
}

/** Track segment record layout in ShowerResult.segments. */
export const SEG = {
  X0: 0, Y0: 1, Z0: 2, T0: 3,
  X1: 4, Y1: 5, Z1: 6, T1: 7,
  CLASS: 8,
  /** log10 of the particle energy in GeV at the segment start. */
  LOGE: 9,
  /** Thinning weight of the particle (number of real particles it represents). */
  W: 10,
} as const;
export const SEG_STRIDE = 11;

/** Ground-particle record layout in ShowerResult.ground. */
export const GND = {
  X: 0, Y: 1,
  /** Arrival time, ns, on the same clock as the segments. */
  T: 2,
  CLASS: 3,
  /** log10 of the energy in GeV. */
  LOGE: 4,
  /** Thinning weight (number of real particles this record represents). */
  W: 5,
  /** Direction of motion, unit vector components (z is negative: downward). */
  DX: 6, DY: 7, DZ: 8,
} as const;
export const GND_STRIDE = 9;

export interface LongitudinalProfile {
  /** Bin width in slant depth along the shower axis, g/cm^2. */
  step: number;
  /** Number of bins; bin i is centred at (i + 0.5) * step. */
  bins: number;
  /** Weighted particle counts crossing the bin-centre plane, per class. */
  byClass: Float64Array[];
  /** Charged particles (e+-, mu, charged hadrons). */
  charged: Float64Array;
}

export interface GaisserHillasFit {
  nmax: number;
  xmax: number;
  x0: number;
  lambda: number;
  /** Reduced chi-square-like residual measure of the fit (log space). */
  residual: number;
}

export interface ShowerStats {
  firstInteractionDepth: number;
  /** Slant depth of the ground along the axis, g/cm^2. */
  groundSlantDepth: number;
  gh: GaisserHillasFit | null;
  /** Weighted ground counts per RClass (above the cuts). */
  groundCounts: number[];
  /** Weighted electromagnetic energy reaching ground, GeV. */
  particlesTracked: number;
  interactions: number;
  cpuMs: number;
  /** True when maxSegments was reached and later segments were dropped. */
  truncated: boolean;
  /** Time window of the recorded segments, ns. */
  tMin: number;
  tMax: number;
  /** Time the core of a plane front moving at c reaches the ground, ns. */
  tCore: number;
  /** Unit vector of the primary's direction of motion. */
  axis: [number, number, number];
  /** Point where the primary would have started (top of the drawn path). */
  start: [number, number, number];
}

export interface ShowerResult {
  params: ShowerParams;
  segments: Float32Array;
  segmentCount: number;
  ground: Float32Array;
  groundCount: number;
  profile: LongitudinalProfile;
  stats: ShowerStats;
}

/** Messages to and from the simulation worker. */
export type WorkerRequest =
  | { kind: 'run'; id: number; params: ShowerParams };

export type WorkerResponse =
  | { kind: 'progress'; id: number; fraction: number; tracked: number }
  | { kind: 'done'; id: number; result: ShowerResult }
  | { kind: 'error'; id: number; message: string };
