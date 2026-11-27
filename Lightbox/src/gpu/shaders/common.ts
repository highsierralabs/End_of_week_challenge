// GLSL shared by the path tracer and the light tracer: scene access, ray intersection,
// Fresnel, BSDF evaluation and light sampling. Every path carries a single wavelength, so
// all radiometric quantities here are scalars.
//
// Scene layout in textures (see pack.ts, which writes them):
//   uObj    RGBA32F, 8 texels per object row:
//             0..2 world-to-object rows, 3 (type, material, light index, 0),
//             4 shape parameters, 5 world bounding sphere (xyz, r), 6 world position
//   uMat    RGBA32F, 2 texels per material row: (type, spectrum A, spectrum B, roughness),
//             (emission scale, p1, p2, p3); for a beam p1..p3 are the cosine, 1 - cosine and
//             squared sine of its half-angle
//   uPlanes RGBA32F, 256 wide: polytope planes (n, d) in object space
//   uSpec   R32F, NS wide: one spectrum per row, linear in wavelength from LAM0 to LAM1
//   uLam    R32F, (NL + 1) x 1: inverse CDF of the wavelength sampler
//   uLights RGBA32F, 4 texels per light row: (object, spectrum row, share of the flux, area), then the
//             object-to-world rows
//   uBvh    RGBA32F, 2048 wide, 2 texels per node; uTri RGBA32F, 2048 wide, 6 texels per triangle
//   uTargets RGBA32F, one bounding sphere per row: the specular objects photons are aimed at

export const COMMON = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2D;

const float PI = 3.14159265358979;
const float INF = 1.0e30;
const float EPS = 2.0e-5;
const float LAM0 = 380.0;
const float LAM1 = 750.0;
const int NS = 1024;
const int NL = 2048;

const int T_SPHERE = 0;
const int T_BOX = 1;
const int T_CYL = 2;
const int T_QUAD = 3;
const int T_DISC = 4;
const int T_POLY = 5;
const int T_LENS = 6;
const int T_MESH = 7;

const int M_DIFFUSE = 0;
const int M_PLASTIC = 1;
const int M_METAL = 2;
const int M_MIRROR = 3;
const int M_GLASS = 4;
const int M_LIGHT = 5;
const int M_BEAM = 6;
const int M_GRATING = 7;

uniform sampler2D uObj;
uniform sampler2D uMat;
uniform sampler2D uPlanes;
uniform sampler2D uSpec;
uniform sampler2D uLam;
uniform sampler2D uLights;
uniform sampler2D uBvh;
uniform sampler2D uTri;
uniform sampler2D uTargets;
uniform int uNumObj;
uniform int uNumLights;
uniform int uNumTargets;
uniform int uMaxBounces;
// Loop limits arrive as uniforms so that no compiler tries to unroll the path loop or the BVH
// walk (some desktop OpenGL drivers do, and take minutes or lose the context).
uniform int uPathIters;
uniform int uBvhIters;
uniform float uEnvScale;
uniform int uEnvRow;

// ---------------------------------------------------------------- random numbers
uint gSeed;
uint pcg(uint v) {
  uint s = v * 747796405u + 2891336453u;
  uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
float rnd() {
  gSeed = pcg(gSeed);
  return float(gSeed >> 8) * (1.0 / 16777216.0);
}

// ---------------------------------------------------------------- spectra
int gLamI;
float gLamF;
float gLambda;
void setWavelength(float lam) {
  gLambda = lam;
  float x = clamp((lam - LAM0) / (LAM1 - LAM0), 0.0, 1.0) * float(NS - 1);
  gLamI = min(int(x), NS - 2);
  gLamF = x - float(gLamI);
}
float spec(int row) {
  return mix(texelFetch(uSpec, ivec2(gLamI, row), 0).r, texelFetch(uSpec, ivec2(gLamI + 1, row), 0).r, gLamF);
}
// Rows 0..2 of uSpec are the CIE 1931 colour matching functions.
vec3 cmf() { return vec3(spec(0), spec(1), spec(2)); }

// Draw a wavelength from the scene's emission-weighted distribution. Returns 1 / pdf.
float sampleWavelength(float u) {
  float x = clamp(u, 0.0, 0.999999) * float(NL);
  int i = int(x);
  float a = texelFetch(uLam, ivec2(i, 0), 0).r;
  float b = texelFetch(uLam, ivec2(i + 1, 0), 0).r;
  setWavelength(mix(a, b, x - float(i)));
  return float(NL) * (b - a);
}

// ---------------------------------------------------------------- small helpers
void basis(vec3 n, out vec3 t, out vec3 b) {
  float s = n.z >= 0.0 ? 1.0 : -1.0;
  float a = -1.0 / (s + n.z);
  float c = n.x * n.y * a;
  t = vec3(1.0 + s * n.x * n.x * a, s * c, -s * n.x);
  b = vec3(c, s + n.y * n.y * a, -n.y);
}
vec2 sampleDisk(vec2 u) {
  // Concentric map (Shirley and Chiu).
  vec2 o = 2.0 * u - 1.0;
  if (o.x == 0.0 && o.y == 0.0) return vec2(0.0);
  float r, th;
  if (abs(o.x) > abs(o.y)) { r = o.x; th = (PI / 4.0) * (o.y / o.x); }
  else { r = o.y; th = PI / 2.0 - (PI / 4.0) * (o.x / o.y); }
  return r * vec2(cos(th), sin(th));
}
vec3 cosineDir(vec3 n, vec2 u) {
  vec2 d = sampleDisk(u);
  vec3 t, b;
  basis(n, t, b);
  return normalize(t * d.x + b * d.y + n * sqrt(max(0.0, 1.0 - dot(d, d))));
}
// Uniform direction in a cone about n. The cone is given as omc = 1 - cos(half-angle), and
// omcOf() gets that from sin^2 without cancellation: lamps and beams are often cones a
// fraction of a degree wide, where 1 - cos computed in single precision is mostly rounding.
float omcOf(float sin2) { return sin2 / (1.0 + sqrt(max(0.0, 1.0 - sin2))); }
vec3 coneDir(vec3 n, float omc, vec2 u) {
  float k = u.x * omc;
  float c = 1.0 - k;
  float s = sqrt(max(0.0, k * (2.0 - k)));
  float ph = 2.0 * PI * u.y;
  vec3 t, b;
  basis(n, t, b);
  return normalize(t * (s * cos(ph)) + b * (s * sin(ph)) + n * c);
}

// ---------------------------------------------------------------- scene access
vec4 objTexel(int i, int k) { return texelFetch(uObj, ivec2(k, i), 0); }
vec4 matTexel(int m, int k) { return texelFetch(uMat, ivec2(k, m), 0); }
vec4 lightTexel(int l, int k) { return texelFetch(uLights, ivec2(k, l), 0); }

struct Hit {
  float t;
  int obj;
  vec3 n;   // geometric normal, world space, unit, pointing out of the object
  vec3 ns;  // shading normal (differs from n on smooth meshes)
};

// ---------------------------------------------------------------- shape intersections
// All in object space with an unnormalised direction, so t is the world-space distance.

// Unit sphere; numerically careful for small spheres seen from far away.
void hitSphere(vec3 o, vec3 d, inout float bt, inout vec3 bn) {
  float a = dot(d, d);
  float b = dot(o, d);
  vec3 l = o - d * (b / a);
  float disc = a * (1.0 - dot(l, l));
  if (disc < 0.0) return;
  float s = sqrt(disc);
  float q = -b - s;
  float t = q / a;
  if (t <= 0.0) t = (-b + s) / a;
  if (t > 0.0 && t < bt) { bt = t; bn = o + d * t; }
}

// 1 / d with zero components nudged, so a slab test never multiplies zero by infinity.
vec3 safeInv(vec3 d) {
  return 1.0 / mix(d, vec3(1.0e-20), lessThan(abs(d), vec3(1.0e-20)));
}

void hitBox(vec3 o, vec3 d, inout float bt, inout vec3 bn) {
  vec3 inv = safeInv(d);
  vec3 ta = (-1.0 - o) * inv;
  vec3 tb = (1.0 - o) * inv;
  vec3 tn = min(ta, tb);
  vec3 tf = max(ta, tb);
  float t0 = max(max(tn.x, tn.y), tn.z);
  float t1 = min(min(tf.x, tf.y), tf.z);
  if (t0 > t1 || t1 <= 0.0) return;
  float t = t0 > 0.0 ? t0 : t1;
  if (t >= bt) return;
  vec3 p = o + d * t;
  vec3 ap = abs(p);
  vec3 n = ap.x > ap.y && ap.x > ap.z ? vec3(sign(p.x), 0.0, 0.0) : (ap.y > ap.z ? vec3(0.0, sign(p.y), 0.0) : vec3(0.0, 0.0, sign(p.z)));
  bt = t;
  bn = n;
}

void hitCylinder(vec3 o, vec3 d, inout float bt, inout vec3 bn) {
  float a = dot(d.xz, d.xz);
  if (a > 1.0e-12) {
    float b = dot(o.xz, d.xz);
    vec2 l = o.xz - d.xz * (b / a);
    float disc = a * (1.0 - dot(l, l));
    if (disc >= 0.0) {
      float s = sqrt(disc);
      float t = (-b - s) / a;
      if (t > 0.0 && t < bt && abs(o.y + d.y * t) <= 1.0) { bt = t; bn = vec3(o.x + d.x * t, 0.0, o.z + d.z * t); }
      t = (-b + s) / a;
      if (t > 0.0 && t < bt && abs(o.y + d.y * t) <= 1.0) { bt = t; bn = vec3(o.x + d.x * t, 0.0, o.z + d.z * t); }
    }
  }
  if (abs(d.y) > 1.0e-12) {
    float t = (1.0 - o.y) / d.y;
    vec2 p = o.xz + d.xz * t;
    if (t > 0.0 && t < bt && dot(p, p) <= 1.0) { bt = t; bn = vec3(0.0, 1.0, 0.0); }
    t = (-1.0 - o.y) / d.y;
    p = o.xz + d.xz * t;
    if (t > 0.0 && t < bt && dot(p, p) <= 1.0) { bt = t; bn = vec3(0.0, -1.0, 0.0); }
  }
}

void hitFlat(vec3 o, vec3 d, bool disc, inout float bt, inout vec3 bn) {
  if (abs(d.y) < 1.0e-12) return;
  float t = -o.y / d.y;
  if (t <= 0.0 || t >= bt) return;
  vec2 p = o.xz + d.xz * t;
  if (disc ? dot(p, p) > 1.0 : (abs(p.x) > 1.0 || abs(p.y) > 1.0)) return;
  bt = t;
  bn = vec3(0.0, 1.0, 0.0);
}

void hitPolytope(vec3 o, vec3 d, int first, int count, inout float bt, inout vec3 bn) {
  float t0 = -INF;
  float t1 = INF;
  vec3 n0 = vec3(0.0);
  vec3 n1 = vec3(0.0);
  for (int k = 0; k < count; k++) {
    int idx = first + k;
    vec4 pl = texelFetch(uPlanes, ivec2(idx & 255, idx >> 8), 0);
    float dn = dot(pl.xyz, d);
    float dist = pl.w - dot(pl.xyz, o);
    if (abs(dn) < 1.0e-12) {
      if (dist < 0.0) return;
      continue;
    }
    float t = dist / dn;
    if (dn < 0.0) { if (t > t0) { t0 = t; n0 = pl.xyz; } }
    else if (t < t1) { t1 = t; n1 = pl.xyz; }
    if (t0 > t1) return;
  }
  if (t0 > 0.0) { if (t0 < bt) { bt = t0; bn = n0; } }
  else if (t1 > 0.0 && t1 < bt) { bt = t1; bn = n1; }
}

// Lens: P = (aperture radius, centre thickness, R1 top, R2 bottom); see shapes.ts hitLens.
bool lensWithin(vec3 p, int skip, vec4 P) {
  if (skip != 0 && dot(p.xz, p.xz) > P.x * P.x * 1.000001) return false;
  if (skip != 1) {
    if (P.z == 0.0) { if (p.y > 0.5 * P.y) return false; }
    else {
      float c1 = 0.5 * P.y - P.z;
      float q = dot(p.xz, p.xz) + (p.y - c1) * (p.y - c1) - P.z * P.z;
      if (P.z > 0.0 ? q > 0.0 : (q < 0.0 || p.y > c1)) return false;
    }
  }
  if (skip != 2) {
    if (P.w == 0.0) { if (p.y < -0.5 * P.y) return false; }
    else {
      float c2 = -0.5 * P.y + P.w;
      float q = dot(p.xz, p.xz) + (p.y - c2) * (p.y - c2) - P.w * P.w;
      if (P.w > 0.0 ? q > 0.0 : (q < 0.0 || p.y < c2)) return false;
    }
  }
  return true;
}
void lensTry(float t, int which, vec3 o, vec3 d, vec4 P, inout float bt, inout vec3 bn) {
  if (!(t > 0.0) || t >= bt) return;
  vec3 p = o + d * t;
  float c1 = 0.5 * P.y - P.z;
  float c2 = -0.5 * P.y + P.w;
  if (which == 1 && P.z != 0.0 && (p.y - c1) * P.z < 0.0) return;
  if (which == 2 && P.w != 0.0 && (p.y - c2) * P.w > 0.0) return;
  if (!lensWithin(p, which, P)) return;
  bt = t;
  if (which == 0) bn = vec3(p.x, 0.0, p.z);
  else if (which == 1) bn = P.z == 0.0 ? vec3(0.0, 1.0, 0.0) : vec3(p.x, p.y - c1, p.z) / P.z;
  else bn = P.w == 0.0 ? vec3(0.0, -1.0, 0.0) : vec3(p.x, p.y - c2, p.z) / P.w;
}
void lensSphere(float cy, float R, int which, vec3 o, vec3 d, vec4 P, inout float bt, inout vec3 bn) {
  vec3 oc = vec3(o.x, o.y - cy, o.z);
  float a = dot(d, d);
  float b = dot(oc, d);
  vec3 l = oc - d * (b / a);
  float disc = a * (R * R - dot(l, l));
  if (disc < 0.0) return;
  float s = sqrt(disc);
  lensTry((-b - s) / a, which, o, d, P, bt, bn);
  lensTry((-b + s) / a, which, o, d, P, bt, bn);
}
void hitLens(vec3 o, vec3 d, vec4 P, inout float bt, inout vec3 bn) {
  float a = dot(d.xz, d.xz);
  if (a > 1.0e-12) {
    float b = dot(o.xz, d.xz);
    vec2 l = o.xz - d.xz * (b / a);
    float disc = a * (P.x * P.x - dot(l, l));
    if (disc >= 0.0) {
      float s = sqrt(disc);
      lensTry((-b - s) / a, 0, o, d, P, bt, bn);
      lensTry((-b + s) / a, 0, o, d, P, bt, bn);
    }
  }
  if (P.z == 0.0) { if (abs(d.y) > 1.0e-12) lensTry((0.5 * P.y - o.y) / d.y, 1, o, d, P, bt, bn); }
  else lensSphere(0.5 * P.y - P.z, P.z, 1, o, d, P, bt, bn);
  if (P.w == 0.0) { if (abs(d.y) > 1.0e-12) lensTry((-0.5 * P.y - o.y) / d.y, 2, o, d, P, bt, bn); }
  else lensSphere(-0.5 * P.y + P.w, P.w, 2, o, d, P, bt, bn);
}

// Triangle mesh behind a BVH. Nodes are stored depth first: the left child follows its
// parent. Node texel A = (bounds min, right child or first triangle), B = (bounds max,
// triangle count, 0 for an inner node).
vec4 bvhTexel(int i) { return texelFetch(uBvh, ivec2(i & 2047, i >> 11), 0); }
vec4 triTexel(int i) { return texelFetch(uTri, ivec2(i & 2047, i >> 11), 0); }
void hitMesh(vec3 o, vec3 d, int root, bool anyHit, inout float bt, inout vec3 bn, inout vec3 bns) {
  vec3 inv = safeInv(d);
  int stack[32];
  int sp = 0;
  int node = root;
  int bestTri = -1;
  vec2 bestUv = vec2(0.0);
  for (int guard = 0; guard < uBvhIters; guard++) {
    vec4 A = bvhTexel(node * 2);
    vec4 B = bvhTexel(node * 2 + 1);
    vec3 ta = (A.xyz - o) * inv;
    vec3 tb = (B.xyz - o) * inv;
    vec3 tn = min(ta, tb);
    vec3 tf = max(ta, tb);
    float t0 = max(max(tn.x, tn.y), max(tn.z, 0.0));
    float t1 = min(min(tf.x, tf.y), min(tf.z, bt));
    bool descend = false;
    if (t0 <= t1) {
      int count = int(B.w);
      if (count > 0) {
        int first = int(A.w);
        for (int k = 0; k < count; k++) {
          int ti = (first + k) * 6;
          vec3 v0 = triTexel(ti).xyz;
          vec3 e1 = triTexel(ti + 1).xyz;
          vec3 e2 = triTexel(ti + 2).xyz;
          vec3 pv = cross(d, e2);
          float det = dot(e1, pv);
          if (abs(det) < 1.0e-20) continue;
          float idet = 1.0 / det;
          vec3 tv = o - v0;
          float u = dot(tv, pv) * idet;
          if (u < 0.0 || u > 1.0) continue;
          vec3 qv = cross(tv, e1);
          float v = dot(d, qv) * idet;
          if (v < 0.0 || u + v > 1.0) continue;
          float t = dot(e2, qv) * idet;
          if (t > 0.0 && t < bt) {
            bt = t;
            bestTri = first + k;
            bestUv = vec2(u, v);
            if (anyHit) { bn = cross(e1, e2); bns = bn; return; }
          }
        }
      } else {
        // Inner node: visit the left child next and remember the right one.
        if (sp < 32) { stack[sp] = int(A.w); sp++; }
        node = node + 1;
        descend = true;
      }
    }
    if (!descend) {
      if (sp == 0) break;
      sp--;
      node = stack[sp];
    }
  }
  if (bestTri >= 0) {
    int ti = bestTri * 6;
    vec3 e1 = triTexel(ti + 1).xyz;
    vec3 e2 = triTexel(ti + 2).xyz;
    bn = cross(e1, e2);
    vec3 n0 = triTexel(ti + 3).xyz;
    vec3 n1 = triTexel(ti + 4).xyz;
    vec3 n2 = triTexel(ti + 5).xyz;
    bns = n0 * (1.0 - bestUv.x - bestUv.y) + n1 * bestUv.x + n2 * bestUv.y;
    if (dot(bns, bn) < 0.0) bns = -bns;
  }
}

// Nearest hit along the ray before tmax (rd must be unit length). With anyHit the search stops
// at the first blocker, which is all a shadow ray needs. Object 'skip' is ignored: a shadow
// ray toward a lamp must not be stopped by rounding on the lamp's own surface (lamps that are
// sampled are convex, so they never truly shade the point aimed at).
bool intersectScene(vec3 ro, vec3 rd, float tmax, bool anyHit, int skip, out Hit hit) {
  hit.t = tmax;
  hit.obj = -1;
  hit.n = vec3(0.0, 1.0, 0.0);
  hit.ns = hit.n;
  for (int i = 0; i < uNumObj; i++) {
    if (i == skip) continue;
    vec4 bs = objTexel(i, 5);
    vec3 oc = ro - bs.xyz;
    float b = dot(oc, rd);
    float c = dot(oc, oc) - bs.w * bs.w;
    if (c > 0.0) {
      if (b > 0.0) continue;
      float disc = b * b - c;
      if (disc < 0.0) continue;
      if (-b - sqrt(disc) > hit.t) continue;
    }
    vec4 r0 = objTexel(i, 0);
    vec4 r1 = objTexel(i, 1);
    vec4 r2 = objTexel(i, 2);
    vec4 info = objTexel(i, 3);
    vec3 o = vec3(dot(r0.xyz, ro) + r0.w, dot(r1.xyz, ro) + r1.w, dot(r2.xyz, ro) + r2.w);
    vec3 d = vec3(dot(r0.xyz, rd), dot(r1.xyz, rd), dot(r2.xyz, rd));
    int type = int(info.x);
    float bt = hit.t;
    vec3 bn = vec3(0.0);
    vec3 bns = vec3(0.0);
    if (type == T_SPHERE) hitSphere(o, d, bt, bn);
    else if (type == T_BOX) hitBox(o, d, bt, bn);
    else if (type == T_CYL) hitCylinder(o, d, bt, bn);
    else if (type == T_QUAD) hitFlat(o, d, false, bt, bn);
    else if (type == T_DISC) hitFlat(o, d, true, bt, bn);
    else {
      vec4 P = objTexel(i, 4);
      if (type == T_POLY) hitPolytope(o, d, int(P.x), int(P.y), bt, bn);
      else if (type == T_LENS) hitLens(o, d, P, bt, bn);
      else hitMesh(o, d, int(P.x), anyHit, bt, bn, bns);
    }
    if (bt < hit.t) {
      hit.t = bt;
      hit.obj = i;
      // Normals transform by the transpose of the world-to-object matrix.
      hit.n = normalize(r0.xyz * bn.x + r1.xyz * bn.y + r2.xyz * bn.z);
      hit.ns = type == T_MESH ? normalize(r0.xyz * bns.x + r1.xyz * bns.y + r2.xyz * bns.z) : hit.n;
      if (anyHit) return true;
    }
  }
  return hit.obj >= 0;
}

// ---------------------------------------------------------------- Fresnel
float fresnelDielectric(float cosi, float cost, float etai, float etat) {
  float rs = (etai * cosi - etat * cost) / (etai * cosi + etat * cost);
  float rp = (etat * cosi - etai * cost) / (etat * cosi + etai * cost);
  return 0.5 * (rs * rs + rp * rp);
}
// Reflectance of an air-to-dielectric surface of index n for unpolarised light.
float fresnelCoat(float cosi, float n) {
  float s2 = (1.0 - cosi * cosi) / (n * n);
  if (s2 >= 1.0) return 1.0;
  return fresnelDielectric(cosi, sqrt(1.0 - s2), 1.0, n);
}
float fresnelConductor(float cosi, float n, float k) {
  float c2 = cosi * cosi;
  float s2 = 1.0 - c2;
  float n2 = n * n;
  float k2 = k * k;
  float t0 = n2 - k2 - s2;
  float a2b2 = sqrt(t0 * t0 + 4.0 * n2 * k2);
  float t1 = a2b2 + c2;
  float a = sqrt(max(0.5 * (a2b2 + t0), 0.0));
  float t2 = 2.0 * a * cosi;
  float rs = (t1 - t2) / (t1 + t2);
  float t3 = c2 * a2b2 + s2 * s2;
  float t4 = t2 * s2;
  float rp = rs * (t3 - t4) / (t3 + t4);
  return 0.5 * (rp + rs);
}

// ---------------------------------------------------------------- microfacets (GGX)
float ggxD(float nh, float a) {
  float a2 = a * a;
  float q = nh * nh * (a2 - 1.0) + 1.0;
  return a2 / (PI * q * q);
}
float ggxLambda(float c, float a) {
  float c2 = c * c;
  float t2 = (1.0 - c2) / max(c2, 1.0e-12);
  return 0.5 * (sqrt(1.0 + a * a * t2) - 1.0);
}
float ggxG1(float c, float a) { return 1.0 / (1.0 + ggxLambda(c, a)); }
float ggxG2(float ci, float co, float a) { return 1.0 / (1.0 + ggxLambda(ci, a) + ggxLambda(co, a)); }
// Sample a visible normal (Heitz 2018). v is the unit view direction in the local frame (z up).
vec3 ggxVndf(vec3 v, float a, vec2 u) {
  vec3 vh = normalize(vec3(a * v.x, a * v.y, v.z));
  float lensq = vh.x * vh.x + vh.y * vh.y;
  vec3 T1 = lensq > 0.0 ? vec3(-vh.y, vh.x, 0.0) * inversesqrt(lensq) : vec3(1.0, 0.0, 0.0);
  vec3 T2 = cross(vh, T1);
  float r = sqrt(u.x);
  float phi = 2.0 * PI * u.y;
  float t1 = r * cos(phi);
  float t2 = r * sin(phi);
  float s = 0.5 * (1.0 + vh.z);
  t2 = (1.0 - s) * sqrt(max(0.0, 1.0 - t1 * t1)) + s * t2;
  vec3 nh = t1 * T1 + t2 * T2 + sqrt(max(0.0, 1.0 - t1 * t1 - t2 * t2)) * vh;
  return normalize(vec3(a * nh.x, a * nh.y, max(0.0, nh.z)));
}

// Internal diffuse reflectance of a clear coat of index 1.5 (hemispherical average of the
// Fresnel reflectance seen from inside).
const float COAT_IOR = 1.5;
const float COAT_RI = 0.596;

// The non-delta part of a material's BSDF for directions wi (toward where the light comes
// from) and wo (toward the viewer), both unit and pointing away from the surface, n the
// facing normal. Returns f * |cos(wi)| in fcos and the solid-angle density with which the
// sampler would have produced wi given wo in pdf. Symmetric in wi and wo apart from the cosine.
void evalBsdf(int mtype, vec4 m0, vec3 n, vec3 wo, vec3 wi, out float fcos, out float pdf) {
  fcos = 0.0;
  pdf = 0.0;
  float ci = dot(n, wi);
  float co = dot(n, wo);
  if (ci <= 0.0 || co <= 0.0) return;
  if (mtype == M_DIFFUSE) {
    fcos = spec(int(m0.y)) * ci / PI;
    pdf = ci / PI;
  } else if (mtype == M_PLASTIC) {
    float rho = spec(int(m0.y));
    float Fo = fresnelCoat(co, COAT_IOR);
    float Fi = fresnelCoat(ci, COAT_IOR);
    float fd = (1.0 - Fi) * (1.0 - Fo) * rho / (PI * (1.0 - rho * COAT_RI));
    fcos = fd * ci;
    pdf = (1.0 - Fo) * ci / PI;
    float a = m0.w * m0.w;
    if (a > 0.0) {
      vec3 h = normalize(wi + wo);
      float nh = dot(n, h);
      float oh = dot(wo, h);
      float D = ggxD(nh, a);
      float F = fresnelCoat(oh, COAT_IOR);
      fcos += F * D * ggxG2(ci, co, a) / (4.0 * co);
      pdf += Fo * ggxG1(co, a) * D / (4.0 * co);
    }
  } else if (mtype == M_METAL) {
    float a = m0.w * m0.w;
    if (a <= 0.0) return;
    vec3 h = normalize(wi + wo);
    float nh = dot(n, h);
    float oh = dot(wo, h);
    float D = ggxD(nh, a);
    float F = fresnelConductor(oh, spec(int(m0.y)), spec(int(m0.z)));
    fcos = F * D * ggxG2(ci, co, a) / (4.0 * co);
    pdf = ggxG1(co, a) * D / (4.0 * co);
  }
}

// ---------------------------------------------------------------- emitters
// Radiance leaving an emitter's surface point along 'dir' (unit, pointing away from it).
// n is the outward geometric normal; flat emitters shine from their +y face only.
float emitted(int mtype, vec4 m0, vec4 m1, vec3 n, vec3 dir) {
  float c = dot(n, dir);
  if (c <= 0.0) return 0.0;
  if (mtype == M_BEAM) {
    // Inside the beam's cone? Compared by sine, which stays exact for narrow beams.
    vec3 cr = cross(n, dir);
    if (dot(cr, cr) > m1.w) return 0.0;
  }
  return m1.x * spec(int(m0.y));
}

// Lights are chosen in proportion to what each emits at this path's wavelength, so a ray of
// neon-red light is connected to the neon tube and not to the softbox beside it.
float gLightSum;
float lightWeight(int l) {
  vec4 L0 = lightTexel(l, 0);
  return L0.z * spec(int(L0.y));
}
void initLights() {
  gLightSum = 0.0;
  for (int i = 0; i < uNumLights; i++) gLightSum += lightWeight(i);
}
// Returns the chosen light's row; pick receives the probability of that choice.
int pickLight(float u, out float pick) {
  float target = u * gLightSum;
  float acc = 0.0;
  int l = 0;
  float w = 0.0;
  for (int i = 0; i < uNumLights; i++) {
    float wi = lightWeight(i);
    if (wi <= 0.0) continue;
    l = i;
    w = wi;
    acc += wi;
    if (acc > target) break;
  }
  pick = w / gLightSum;
  return l;
}

// A point on light l's surface, uniform by area. Returns position and outward normal (world).
void lightPoint(int l, int otype, vec3 u, out vec3 p, out vec3 n) {
  vec3 q;
  vec3 qn;
  if (otype == T_QUAD) { q = vec3(2.0 * u.x - 1.0, 0.0, 2.0 * u.y - 1.0); qn = vec3(0.0, 1.0, 0.0); }
  else if (otype == T_DISC) { vec2 d = sampleDisk(u.xy); q = vec3(d.x, 0.0, d.y); qn = vec3(0.0, 1.0, 0.0); }
  else if (otype == T_SPHERE) {
    float z = 1.0 - 2.0 * u.x;
    float r = sqrt(max(0.0, 1.0 - z * z));
    q = vec3(r * cos(2.0 * PI * u.y), z, r * sin(2.0 * PI * u.y));
    qn = q;
  } else if (otype == T_CYL) {
    // Side area 4 pi r h, caps 2 pi r^2: the light row's 4th texel carries the side fraction.
    float side = lightTexel(l, 3).w;
    if (u.z < side) {
      float ph = 2.0 * PI * u.x;
      q = vec3(cos(ph), 2.0 * u.y - 1.0, sin(ph));
      qn = vec3(q.x, 0.0, q.z);
    } else {
      vec2 d = sampleDisk(u.xy);
      float s = u.z < 0.5 * (1.0 + side) ? 1.0 : -1.0;
      q = vec3(d.x, s, d.y);
      qn = vec3(0.0, s, 0.0);
    }
  } else {
    // Box: faces chosen by area; the fractions for the x and y face pairs ride in texels 1 and 2.
    float fx = lightTexel(l, 1).w;
    float fy = lightTexel(l, 2).w;
    float s = fract(u.z * 7919.0) < 0.5 ? 1.0 : -1.0;
    vec2 a = 2.0 * u.xy - 1.0;
    if (u.z < fx) { q = vec3(s, a.x, a.y); qn = vec3(s, 0.0, 0.0); }
    else if (u.z < fx + fy) { q = vec3(a.x, s, a.y); qn = vec3(0.0, s, 0.0); }
    else { q = vec3(a.x, a.y, s); qn = vec3(0.0, 0.0, s); }
  }
  vec4 f0 = lightTexel(l, 1);
  vec4 f1 = lightTexel(l, 2);
  vec4 f2 = lightTexel(l, 3);
  p = vec3(dot(f0.xyz, q), dot(f1.xyz, q), dot(f2.xyz, q)) + vec3(objTexel(int(lightTexel(l, 0).x), 6).xyz);
  // Lights have a rotation and an axis-aligned scale that is uniform across the directions a
  // normal can mix, so rotating the object-space normal is exact.
  n = normalize(vec3(dot(f0.xyz, qn), dot(f1.xyz, qn), dot(f2.xyz, qn)));
}

// Solid-angle density with which sampleLight would pick the point p (normal n) on light l,
// seen from x. Used both by the sampler and to weight a BSDF ray that happens to hit the light.
float lightPdf(int l, int otype, vec3 x, vec3 p, vec3 n) {
  vec4 L0 = lightTexel(l, 0);
  vec3 d = p - x;
  float d2 = dot(d, d);
  if (otype == T_SPHERE) {
    vec3 oc = objTexel(int(L0.x), 6).xyz - x;
    float dc2 = dot(oc, oc);
    float r2 = L0.w / (4.0 * PI);
    if (dc2 <= r2 * 1.0001) return 0.0;
    return lightWeight(l) / gLightSum / (2.0 * PI * omcOf(r2 / dc2));
  }
  float c = abs(dot(n, d)) / sqrt(d2);
  if (c < 1.0e-6) return 0.0;
  return lightWeight(l) / gLightSum * d2 / (c * L0.w);
}
`;
