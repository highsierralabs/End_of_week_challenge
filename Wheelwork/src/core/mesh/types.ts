// Shared geometry types. Units are millimetres; the frame is right-handed with Z up.

/** A point or vector in a plane. */
export type Vec2 = readonly [number, number];

/** A point or vector in space. */
export type Vec3 = readonly [number, number, number];

/** A closed polygon without a repeated last point. Outer boundaries run counter-clockwise. */
export type Ring = Vec2[];

/** A planar region: one outer ring and any number of holes inside it. */
export interface Region {
  outer: Ring;
  holes: Ring[];
}

/**
 * An indexed triangle mesh. Triangles are counter-clockwise seen from outside, so a closed mesh
 * has positive signed volume.
 */
export interface Mesh {
  positions: Float64Array;
  indices: Uint32Array;
}
