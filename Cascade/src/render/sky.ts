// Night sky: a camera-centred dome drawn first, without depth test or depth write,
// with a procedural TSL starfield, a faint Milky Way band, a blue-black gradient to
// a slightly lighter horizon and a weak sodium glow from the city to the SSE.
//
// The dome's clip-space position is generated in the vertex stage (vertexNode) with
// z = 0.5 w, so it is never clipped by the near or far plane whatever the camera's
// range, on either backend (WebGL [-w, w] and WebGPU [0, w] both contain 0.5 w).
// It never touches the depth buffer, so it cannot occlude tracks. Add it to the scene
// root untransformed.
import * as THREE from 'three/webgpu';
import {
  abs,
  cameraProjectionMatrix,
  cameraViewMatrix,
  dot,
  exp,
  float,
  floor,
  fract,
  fwidth,
  length,
  max,
  mix,
  mx_fractal_noise_float,
  normalize,
  positionGeometry,
  pow,
  smoothstep,
  vec3,
  vec4,
} from 'three/tsl';

type V3 = THREE.Node<'vec3'>;
type F = THREE.Node<'float'>;

/** Dave Hoskins' hash33 (no sin, stable on both backends). Returns [0,1)^3. */
export function hash33(p: V3): V3 {
  const a = fract(p.mul(vec3(0.1031, 0.103, 0.0973)));
  const p3 = a.add(dot(a, a.yxz.add(33.33)));
  return fract(p3.xxy.add(p3.yxx).mul(p3.zyx));
}

/** Zenith, horizon and below-horizon colours (linear). */
const ZENITH = vec3(0.0016, 0.0024, 0.0065);
const HORIZON = vec3(0.012, 0.016, 0.028);
const BELOW = vec3(0.007, 0.009, 0.015);
/** Unit vector toward the Reno-Sparks light dome in the render frame (east +X, south +Z). */
const CITY_DIR = vec3(0.39, 0.0, 0.92).normalize();
const CITY_GLOW = vec3(0.03, 0.016, 0.006);

/**
 * Sky background colour (no stars) for a unit view direction in the render frame.
 * Exported so the terrain's distance haze can fade into exactly the same colour.
 */
export function skyGradient(dir: V3): V3 {
  const h = dir.y;
  const up = pow(smoothstep(0.0, 0.6, h), float(0.55));
  const above = mix(HORIZON, ZENITH, up);
  // Below the horizon: the horizon colour (the terrain hazes into it), darkening only
  // when looking steeply down past the patch edge from high up.
  const below = mix(HORIZON, BELOW, smoothstep(-0.25, -0.7, h));
  const base = mix(below, above, smoothstep(-0.002, 0.002, h));
  const flat = normalize(vec3(dir.x, 0.0, dir.z));
  const az = pow(max(dot(flat, CITY_DIR), 0.0), float(3.0));
  const glow = az.mul(exp(abs(h).mul(-9.0)));
  return base.add(CITY_GLOW.mul(glow));
}

/** One layer of hashed stars on a 3D cell grid around the unit sphere. */
function starLayer(dir: V3, scale: number, seed: number, threshold: F, sizePx: number, gain: number): V3 {
  const p = dir.mul(scale);
  const cell = floor(p);
  const h = hash33(cell.add(seed));
  const h2 = hash33(cell.add(seed + 17.0));
  // Each occupied cell holds a star point in its interior; the unit sphere (scaled)
  // passes near some of them. The 3D distance makes the apparent brightness vary with
  // how close the shell passes, and the interior offset keeps spots inside the cell.
  const starPos = cell.add(h.mul(0.5).add(0.25));
  const d = length(p.sub(starPos));
  const px = max(length(fwidth(p)), 1e-4);
  const r = d.div(px.mul(sizePx));
  const present = smoothstep(threshold, threshold.add(0.002), h2.x);
  // Steep power law: many faint stars, a few bright ones.
  const bright = pow(h2.y, float(9.0)).mul(3.0).add(0.15).mul(gain);
  const core = exp(r.mul(r).negate());
  // Temperature: mostly white, some blue-white, some orange.
  const tint = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.78, 0.55), smoothstep(0.55, 1.0, h2.z));
  return tint.mul(core.mul(bright).mul(present));
}

export function createSky(): THREE.Object3D {
  const dir = normalize(positionGeometry);

  // Clip position: direction rotated into view space, placed at unit distance, z = 0.5 w.
  const viewDir = cameraViewMatrix.mul(vec4(positionGeometry, 0.0)).xyz;
  const clip = cameraProjectionMatrix.mul(vec4(viewDir, 1.0));
  const vertexNode = vec4(clip.x, clip.y, clip.w.mul(0.5), clip.w);

  // Milky Way: a tilted great circle with mottling and a dark rift.
  const galN = vec3(-0.42, 0.52, -0.74).normalize();
  const g = dot(dir, galN);
  const band = exp(g.mul(g).mul(-1.0 / (0.16 * 0.16)));
  const mottle = mx_fractal_noise_float(dir.mul(5.0), 4, 2.0, 0.55).mul(0.5).add(0.5).clamp(0.0, 1.0);
  const rift = exp(g.add(0.02).mul(g.add(0.02)).mul(-1.0 / (0.035 * 0.035)))
    .mul(smoothstep(0.35, 0.7, mx_fractal_noise_float(dir.mul(9.0).add(3.1), 3, 2.0, 0.5).add(0.5)));
  const milky = band.mul(mottle).mul(float(1.0).sub(rift.mul(0.8)));
  const milkyCol = vec3(0.028, 0.03, 0.04).mul(milky);

  // Stars: denser inside the band, fading with airmass toward the horizon.
  const horizonFade = smoothstep(0.0, 0.18, dir.y);
  const thr1 = float(0.6).sub(band.mul(0.25));
  const thr2 = float(0.8).sub(band.mul(0.1));
  const stars = starLayer(dir, 160.0, 11.0, thr1, 0.6, 0.45)
    .add(starLayer(dir, 60.0, 47.0, thr2, 0.9, 1.6))
    .add(starLayer(dir, 300.0, 83.0, float(0.62).sub(band.mul(0.45)), 0.45, 0.2));

  const sky = skyGradient(dir).add(milkyCol.add(stars).mul(horizonFade));

  const material = new THREE.MeshBasicNodeMaterial({
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
    fog: false,
  });
  material.vertexNode = vertexNode;
  material.colorNode = sky;

  const geometry = new THREE.SphereGeometry(1, 96, 48);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'sky';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.matrixAutoUpdate = false;
  return mesh;
}
