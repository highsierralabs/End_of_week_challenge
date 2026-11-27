// Small vector, quaternion and affine helpers. Affine maps are 3x4 row-major arrays
// [r00 r01 r02 tx, r10 r11 r12 ty, r20 r21 r22 tz].

export type Vec3 = [number, number, number];
export type Affine = number[];

export const v3 = (x = 0, y = 0, z = 0): Vec3 => [x, y, z];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const mulv = (a: Vec3, b: Vec3): Vec3 => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: Vec3): Vec3 => {
  const l = len(a);
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
};
export const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

const RAD = Math.PI / 180;

/** Rotation matrix (row-major 3x3) from Euler angles in degrees, applied X then Y then Z. */
export function eulerToMat3(deg: Vec3): number[] {
  const [cx, sx] = [Math.cos(deg[0] * RAD), Math.sin(deg[0] * RAD)];
  const [cy, sy] = [Math.cos(deg[1] * RAD), Math.sin(deg[1] * RAD)];
  const [cz, sz] = [Math.cos(deg[2] * RAD), Math.sin(deg[2] * RAD)];
  // R = Rz * Ry * Rx
  return [
    cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx,
    sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx,
    -sy, cy * sx, cy * cx,
  ];
}

/** Euler angles in degrees (X then Y then Z order) of a rotation matrix. Inverse of eulerToMat3. */
export function mat3ToEuler(m: number[]): Vec3 {
  const sy = -m[6]!;
  if (Math.abs(sy) < 0.999999) {
    return [Math.atan2(m[7]!, m[8]!) / RAD, Math.asin(sy) / RAD, Math.atan2(m[3]!, m[0]!) / RAD];
  }
  // Gimbal lock: fold everything into X.
  return [Math.atan2(-m[5]!, m[4]!) / RAD, sy > 0 ? 90 : -90, 0];
}

export function mat3Mul(a: number[], b: number[]): number[] {
  const o = new Array<number>(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      o[r * 3 + c] = a[r * 3]! * b[c]! + a[r * 3 + 1]! * b[3 + c]! + a[r * 3 + 2]! * b[6 + c]!;
    }
  }
  return o;
}

/** Rotation by `deg` degrees about a unit axis. */
export function axisAngleMat3(axis: Vec3, deg: number): number[] {
  const [x, y, z] = norm(axis);
  const c = Math.cos(deg * RAD);
  const s = Math.sin(deg * RAD);
  const t = 1 - c;
  return [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c,
  ];
}

/** Object-to-world affine: rotate, scale per axis (in object space), then translate. */
export function compose(pos: Vec3, rotDeg: Vec3, scale: Vec3): Affine {
  const r = eulerToMat3(rotDeg);
  return [
    r[0]! * scale[0], r[1]! * scale[1], r[2]! * scale[2], pos[0],
    r[3]! * scale[0], r[4]! * scale[1], r[5]! * scale[2], pos[1],
    r[6]! * scale[0], r[7]! * scale[1], r[8]! * scale[2], pos[2],
  ];
}

export function invertAffine(m: Affine): Affine {
  const [a, b, c, tx, d, e, f, ty, g, h, i, tz] = m as [number, number, number, number, number, number, number, number, number, number, number, number];
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const id = 1 / det;
  const r = [
    A * id, (c * h - b * i) * id, (b * f - c * e) * id,
    B * id, (a * i - c * g) * id, (c * d - a * f) * id,
    C * id, (b * g - a * h) * id, (a * e - b * d) * id,
  ];
  return [
    r[0]!, r[1]!, r[2]!, -(r[0]! * tx + r[1]! * ty + r[2]! * tz),
    r[3]!, r[4]!, r[5]!, -(r[3]! * tx + r[4]! * ty + r[5]! * tz),
    r[6]!, r[7]!, r[8]!, -(r[6]! * tx + r[7]! * ty + r[8]! * tz),
  ];
}

export const xformPoint = (m: Affine, p: Vec3): Vec3 => [
  m[0]! * p[0] + m[1]! * p[1] + m[2]! * p[2] + m[3]!,
  m[4]! * p[0] + m[5]! * p[1] + m[6]! * p[2] + m[7]!,
  m[8]! * p[0] + m[9]! * p[1] + m[10]! * p[2] + m[11]!,
];
export const xformDir = (m: Affine, p: Vec3): Vec3 => [
  m[0]! * p[0] + m[1]! * p[1] + m[2]! * p[2],
  m[4]! * p[0] + m[5]! * p[1] + m[6]! * p[2],
  m[8]! * p[0] + m[9]! * p[1] + m[10]! * p[2],
];
/** Transform a normal by the transpose of the given (inverse) affine's linear part. */
export const xformNormalByInverse = (inv: Affine, n: Vec3): Vec3 => norm([
  inv[0]! * n[0] + inv[4]! * n[1] + inv[8]! * n[2],
  inv[1]! * n[0] + inv[5]! * n[1] + inv[9]! * n[2],
  inv[2]! * n[0] + inv[6]! * n[1] + inv[10]! * n[2],
]);

/** An orthonormal pair perpendicular to unit vector n (Duff et al. 2017). */
export function basis(n: Vec3): [Vec3, Vec3] {
  const s = n[2] >= 0 ? 1 : -1;
  const a = -1 / (s + n[2]);
  const b = n[0] * n[1] * a;
  return [
    [1 + s * n[0] * n[0] * a, s * b, -s * n[0]],
    [b, s + n[1] * n[1] * a, -n[1]],
  ];
}

export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
