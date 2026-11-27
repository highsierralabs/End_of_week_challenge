// The two tracers. Both walk a path one ray per loop iteration, so the scene intersection
// code is inlined exactly once per shader (this keeps compile times sane on Direct3D).
//
// Path tracer (PT): camera paths with next-event estimation and multiple importance sampling.
// Light tracer (LT): photons from the lights through specular objects, connected to the lens
// at the first non-specular surface they reach.
//
// The two split the work without overlap. The LT carries exactly the paths
//     light -> one or more specular bounces -> surface seen directly by the camera
// (the caustics), which the PT finds only by luck; the PT carries everything else and gives
// zero weight to that one class when the LT is on. With the LT off the PT counts them itself.
import { COMMON } from './common';

const SHARED = /* glsl */ `
uniform vec2 uRes;
uniform vec3 uCamPos;
uniform vec3 uCamR;
uniform vec3 uCamU;
uniform vec3 uCamF;
uniform float uTanHalf;
uniform float uLensR;
uniform float uFocus;
uniform int uBlades;
uniform uint uFrame;
uniform int uVignette;

vec2 sampleAperture(vec2 u) {
  if (uBlades < 3) return sampleDisk(u);
  float n = float(uBlades);
  float k = floor(min(u.x, 0.999999) * n);
  float ux = min(u.x, 0.999999) * n - k;
  float a0 = 2.0 * PI * k / n;
  float a1 = 2.0 * PI * (k + 1.0) / n;
  float su = sqrt(ux);
  return vec2(cos(a0), sin(a0)) * (su * (1.0 - u.y)) + vec2(cos(a1), sin(a1)) * (su * u.y);
}

// Scattering at a surface that deflects light in one direction only (or, for glass, one of
// two): glass, a mirror, polished metal, a grating. Updates the ray, its weight and the
// absorbing medium it travels in.
void scatterDelta(int mt, vec4 m0, vec4 m1, int obj, vec3 p, vec3 ng, vec3 ns, bool back,
                  inout vec3 ro, inout vec3 rd, inout float w, inout int absRow) {
  float cosi = dot(-rd, ns);
  if (cosi <= 0.0) { ns = ng; cosi = dot(-rd, ng); }
  if (mt == M_GLASS) {
    float n = spec(int(m0.y));
    float eta = back ? n : 1.0 / n;
    float sin2t = eta * eta * (1.0 - cosi * cosi);
    float F = 1.0;
    float cost = 0.0;
    if (sin2t < 1.0) {
      cost = sqrt(1.0 - sin2t);
      F = back ? fresnelDielectric(cosi, cost, n, 1.0) : fresnelDielectric(cosi, cost, 1.0, n);
    }
    if (rnd() < F) {
      rd = reflect(rd, ns);
      if (dot(rd, ng) <= 0.0) rd = reflect(rd, ng);
      ro = p + ng * EPS;
    } else {
      rd = normalize(eta * rd + (eta * cosi - cost) * ns);
      ro = p - ng * EPS;
      absRow = back ? -1 : int(m0.z);
    }
  } else if (mt == M_GRATING) {
    // Thin transmission grating: the direction component across the grooves shifts by
    // m * lambda / d. Orders 0 and +-1 carry 40% and 30% each (an idealised grating).
    vec3 g = normalize(objTexel(obj, 0).xyz);
    float u = rnd();
    float m = u < 0.4 ? 0.0 : (u < 0.7 ? 1.0 : -1.0);
    float kg = dot(rd, g) + m * gLambda / m1.y;
    vec3 gz = cross(ng, g);
    float kz = dot(rd, gz);
    float kn2 = 1.0 - kg * kg - kz * kz;
    if (kn2 > 0.0) rd = normalize(g * kg + gz * kz - ng * sqrt(kn2));
    ro = p - ng * EPS;
  } else {
    if (mt == M_METAL) w *= fresnelConductor(cosi, spec(int(m0.y)), spec(int(m0.z)));
    rd = reflect(rd, ns);
    if (dot(rd, ng) <= 0.0) rd = reflect(rd, ng);
    ro = p + ng * EPS;
  }
}

bool isDeltaMat(int mt, vec4 m0) {
  return mt == M_GLASS || mt == M_MIRROR || mt == M_GRATING || (mt == M_METAL && m0.w <= 0.0);
}
`;

export const PT_FRAG = /* glsl */ `#version 300 es
${COMMON}
${SHARED}
uniform sampler2D uPrev;
uniform uint uAlpha[8];
uniform int uLT;
uniform float uClamp;
out vec4 outColor;

// Low-discrepancy sample for dimension d: a Kronecker sequence over frames with a per-pixel
// random shift, in exact integer arithmetic.
float ld(int d, uint pix) {
  return float((pcg(pix + uint(d) * 0x9E3779B9u) + uFrame * uAlpha[d]) >> 8) * (1.0 / 16777216.0);
}

void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  uint pix = pcg(uint(px.x) + pcg(uint(px.y) + 0x1234567u));
  gSeed = pcg(pix ^ pcg(uFrame + 0x9E3779B9u));
  float invPdfLam = sampleWavelength(ld(0, pix));
  initLights();

  vec2 uv = (vec2(px) + vec2(ld(1, pix), ld(2, pix)) - 0.5 * uRes) * (2.0 * uTanHalf / uRes.y);
  vec3 dirP = uCamF + uv.x * uCamR + uv.y * uCamU;
  vec3 ro = uCamPos;
  vec3 rd = normalize(dirP);
  if (uLensR > 0.0) {
    vec2 l = sampleAperture(vec2(ld(3, pix), ld(4, pix))) * uLensR;
    ro = uCamPos + uCamR * l.x + uCamU * l.y;
    rd = normalize(uCamPos + dirP * uFocus - ro);
  }
  float vig = 1.0;
  if (uVignette == 1) { float c = dot(rd, uCamF); vig = c * c * c * c; }

  float thr = 1.0;
  float L = 0.0;
  int bounce = 0;
  int nDiff = 0;
  bool sawDelta = false;
  bool primaryDiffuse = false;
  bool chain = false;
  bool chainOk = true;
  bool lastDelta = true;
  float bsdfPdf = 0.0;
  int absRow = -1;
  bool alive = true;
  bool shadow = false;
  vec3 sro = vec3(0.0);
  vec3 srd = vec3(0.0, 1.0, 0.0);
  float smax = 0.0;
  float scontrib = 0.0;

  for (int it = 0; it < 160; it++) {
    bool isShadow = shadow;
    if (!isShadow && !alive) break;
    Hit h;
    bool found = intersectScene(isShadow ? sro : ro, isShadow ? srd : rd, isShadow ? smax : INF, isShadow, h);
    if (isShadow) {
      if (!found) L += scontrib;
      shadow = false;
      continue;
    }
    if (!found) {
      if (uEnvScale > 0.0) L += thr * uEnvScale * spec(uEnvRow);
      break;
    }
    if (absRow >= 0) thr *= exp(-spec(absRow) * h.t);
    vec3 p = ro + rd * h.t;
    vec4 info = objTexel(h.obj, 3);
    int mi = int(info.y);
    vec4 m0 = matTexel(mi, 0);
    vec4 m1 = matTexel(mi, 1);
    int mt = int(m0.x);
    bool back = dot(rd, h.n) > 0.0;
    vec3 ng = back ? -h.n : h.n;
    vec3 ns = back ? -h.ns : h.ns;
    vec3 wo = -rd;

    if (mt == M_LIGHT || mt == M_BEAM) {
      float Le = emitted(mt, m0, m1, h.n, wo);
      if (Le > 0.0) {
        int li = int(info.z);
        float w = 1.0;
        if (!lastDelta) {
          if (li >= 0) {
            if (mt == M_BEAM) w = 0.0;
            else {
              float lp = lightPdf(li, int(info.x), ro, p, h.n);
              w = bsdfPdf * bsdfPdf / (bsdfPdf * bsdfPdf + lp * lp);
            }
          }
        } else if (uLT == 1 && li >= 0 && primaryDiffuse && nDiff == 1 && chain && chainOk) {
          w = 0.0;
        }
        float c = thr * Le * w;
        L += nDiff > 0 ? min(c, uClamp) : c;
      }
      break;
    }
    if (bounce >= uMaxBounces) break;
    bounce++;

    if (isDeltaMat(mt, m0)) {
      scatterDelta(mt, m0, m1, h.obj, p, ng, ns, back, ro, rd, thr, absRow);
      if (nDiff == 0) sawDelta = true; else chain = true;
      lastDelta = true;
    } else {
      if (dot(wo, ns) <= 0.0) ns = ng;
      // ---- next-event estimation: one light, one shadow ray
      if (gLightSum > 0.0) {
        float pick;
        int l = pickLight(rnd(), pick);
        vec4 L0 = lightTexel(l, 0);
        int lo = int(L0.x);
        vec4 linfo = objTexel(lo, 3);
        int lot = int(linfo.x);
        vec4 lm0 = matTexel(int(linfo.y), 0);
        vec4 lm1 = matTexel(int(linfo.y), 1);
        bool beam = int(lm0.x) == M_BEAM;
        vec3 wi = vec3(0.0, 1.0, 0.0);
        float dist = 0.0;
        float lpdf = 0.0;
        if (beam) {
          // The light shines only within a cone about its normal: draw the emission direction
          // from that cone and find the point on the aperture it must have left from.
          vec3 ln = normalize(vec3(lightTexel(l, 1).y, lightTexel(l, 2).y, lightTexel(l, 3).y));
          vec3 e = coneDir(ln, lm1.y, vec2(rnd(), rnd()));
          vec3 lc = objTexel(lo, 6).xyz;
          float s = dot(p - lc, ln) / dot(e, ln);
          if (s > 4.0 * EPS) {
            vec3 y = p - e * s;
            vec4 r0 = objTexel(lo, 0);
            vec4 r2 = objTexel(lo, 2);
            vec2 q = vec2(dot(r0.xyz, y) + r0.w, dot(r2.xyz, y) + r2.w);
            if (lot == T_DISC ? dot(q, q) <= 1.0 : (abs(q.x) <= 1.0 && abs(q.y) <= 1.0)) {
              wi = -e;
              dist = s;
              lpdf = pick / (2.0 * PI * (1.0 - lm1.y));
            }
          }
        } else if (lot == T_SPHERE) {
          vec3 oc = objTexel(lo, 6).xyz - p;
          float dc2 = dot(oc, oc);
          float r2 = L0.w / (4.0 * PI);
          if (dc2 > r2 * 1.0001) {
            float cosMax = sqrt(max(0.0, 1.0 - r2 / dc2));
            wi = coneDir(oc * inversesqrt(dc2), cosMax, vec2(rnd(), rnd()));
            float b = dot(oc, wi);
            dist = b - sqrt(max(0.0, b * b - (dc2 - r2)));
            lpdf = pick / (2.0 * PI * (1.0 - cosMax));
          }
        } else {
          vec3 lp;
          vec3 ln;
          lightPoint(l, lot, vec3(rnd(), rnd(), rnd()), lp, ln);
          vec3 dv = lp - p;
          float d2 = dot(dv, dv);
          dist = sqrt(d2);
          wi = dv / dist;
          float cl = dot(ln, -wi);
          if (cl > 1.0e-6) lpdf = pick * d2 / (cl * L0.w);
        }
        if (lpdf > 0.0 && dot(wi, ng) > 0.0) {
          float fcos;
          float bpdf;
          evalBsdf(mt, m0, ns, wo, wi, fcos, bpdf);
          if (fcos > 0.0) {
            float w = beam ? 1.0 : lpdf * lpdf / (lpdf * lpdf + bpdf * bpdf);
            scontrib = thr * fcos * lm1.x * spec(int(lm0.y)) * w / lpdf;
            if (nDiff > 0) scontrib = min(scontrib, uClamp);
            shadow = true;
            sro = p + ng * EPS;
            srd = wi;
            smax = dist - 4.0 * EPS;
          }
        }
      }
      // ---- sample the BSDF for the next direction
      vec2 u2 = nDiff == 0 ? vec2(ld(5, pix), ld(6, pix)) : vec2(rnd(), rnd());
      bool deltaCoat = false;
      vec3 wi = vec3(0.0, 1.0, 0.0);
      if (mt == M_DIFFUSE) {
        wi = cosineDir(ns, u2);
        thr *= spec(int(m0.y));
        bsdfPdf = dot(wi, ns) / PI;
      } else {
        float a = m0.w * m0.w;
        float Fo = mt == M_PLASTIC ? fresnelCoat(dot(wo, ns), COAT_IOR) : 1.0;
        if (mt == M_PLASTIC && rnd() >= Fo) {
          wi = cosineDir(ns, u2);
        } else if (a <= 0.0) {
          // Polished coat of a plastic: a mirror reflection.
          wi = reflect(rd, ns);
          deltaCoat = true;
        } else {
          vec3 t;
          vec3 b;
          basis(ns, t, b);
          vec3 hl = ggxVndf(vec3(dot(wo, t), dot(wo, b), dot(wo, ns)), a, u2);
          vec3 hw = normalize(t * hl.x + b * hl.y + ns * hl.z);
          wi = reflect(rd, hw);
        }
        if (!deltaCoat) {
          float fcos;
          float pdf;
          evalBsdf(mt, m0, ns, wo, wi, fcos, pdf);
          if (!(pdf > 0.0) || !(fcos > 0.0)) alive = false;
          else { thr *= fcos / pdf; bsdfPdf = pdf; }
        }
      }
      if (dot(wi, ng) <= 0.0) alive = false;
      ro = p + ng * EPS;
      rd = wi;
      if (deltaCoat) {
        if (nDiff == 0) sawDelta = true; else chainOk = false;
        lastDelta = true;
      } else {
        nDiff++;
        if (nDiff == 1) primaryDiffuse = !sawDelta;
        lastDelta = false;
      }
    }
    // Russian roulette on the throughput.
    if (bounce > 3) {
      float q = clamp(thr, 0.05, 1.0);
      if (rnd() > q) alive = false;
      thr /= q;
    }
  }

  vec3 xyz = cmf() * (L * invPdfLam * vig);
  if (!(xyz.x >= 0.0 || xyz.x < 0.0) || !(xyz.y >= 0.0) || !(xyz.z >= 0.0 || xyz.z < 0.0) || xyz.y > 1.0e20) xyz = vec3(0.0);
  outColor = texelFetch(uPrev, px, 0) + vec4(xyz, 1.0);
}
`;

export const LT_FRAG = /* glsl */ `#version 300 es
${COMMON}
${SHARED}
uniform float uPixArea;
layout(location = 0) out vec4 outPos;
layout(location = 1) out vec4 outVal;

void main() {
  outPos = vec4(0.0);
  outVal = vec4(0.0);
  ivec2 px = ivec2(gl_FragCoord.xy);
  gSeed = pcg(uint(px.x) + pcg(uint(px.y) + pcg(uFrame ^ 0xABCDEF1u)));
  float invPdfLam = sampleWavelength(rnd());
  initLights();
  if (uNumTargets == 0 || !(gLightSum > 0.0)) return;

  // ---- emit a photon
  float pick;
  int l = pickLight(rnd(), pick);
  vec4 L0 = lightTexel(l, 0);
  int lo = int(L0.x);
  vec4 linfo = objTexel(lo, 3);
  int lot = int(linfo.x);
  vec4 lm0 = matTexel(int(linfo.y), 0);
  vec4 lm1 = matTexel(int(linfo.y), 1);
  vec3 lp;
  vec3 ln;
  lightPoint(l, lot, vec3(rnd(), rnd(), rnd()), lp, ln);
  vec3 rd;
  float alpha;
  float Le = lm1.x * spec(int(lm0.y));
  if (int(lm0.x) == M_BEAM) {
    rd = coneDir(ln, lm1.y, vec2(rnd(), rnd()));
    alpha = Le * dot(rd, ln) * L0.w * 2.0 * PI * (1.0 - lm1.y) / pick;
  } else {
    // Aim at the bounding sphere of one specular object; the density is the mixture over all.
    int k = min(int(rnd() * float(uNumTargets)), uNumTargets - 1);
    vec4 tg = texelFetch(uTargets, ivec2(0, k), 0);
    vec3 oc = tg.xyz - lp;
    float dc2 = dot(oc, oc);
    vec2 u = vec2(rnd(), rnd());
    if (dc2 > tg.w * tg.w) rd = coneDir(oc * inversesqrt(dc2), sqrt(1.0 - tg.w * tg.w / dc2), u);
    else rd = cosineDir(ln, u);
    float cl = dot(rd, ln);
    if (cl <= 0.0) return;
    float pdfW = 0.0;
    for (int j = 0; j < uNumTargets; j++) {
      vec4 tj = texelFetch(uTargets, ivec2(0, j), 0);
      vec3 oj = tj.xyz - lp;
      float dj2 = dot(oj, oj);
      if (dj2 > tj.w * tj.w) {
        float cm = sqrt(1.0 - tj.w * tj.w / dj2);
        if (dot(rd, oj) * inversesqrt(dj2) >= cm) pdfW += 1.0 / (2.0 * PI * (1.0 - cm));
      } else {
        pdfW += cl / PI;
      }
    }
    pdfW /= float(uNumTargets);
    if (!(pdfW > 0.0)) return;
    alpha = Le * cl * L0.w / (pick * pdfW);
  }

  // ---- follow it through the specular objects
  vec3 ro = lp + ln * EPS;
  int absRow = -1;
  int specCount = 0;
  bool connect = false;
  vec3 cro = vec3(0.0);
  vec3 crd = vec3(0.0, 1.0, 0.0);
  float cmax = 0.0;
  vec3 cval = vec3(0.0);
  vec2 cpix = vec2(0.0);
  for (int it = 0; it < 100; it++) {
    Hit h;
    bool found = intersectScene(connect ? cro : ro, connect ? crd : rd, connect ? cmax : INF, connect, h);
    if (connect) {
      if (!found) { outPos = vec4(cpix, 1.0, 0.0); outVal = vec4(cval, 0.0); }
      return;
    }
    if (!found) return;
    if (absRow >= 0) alpha *= exp(-spec(absRow) * h.t);
    vec3 p = ro + rd * h.t;
    vec4 info = objTexel(h.obj, 3);
    int mi = int(info.y);
    vec4 m0 = matTexel(mi, 0);
    vec4 m1 = matTexel(mi, 1);
    int mt = int(m0.x);
    if (mt == M_LIGHT || mt == M_BEAM) return;
    bool back = dot(rd, h.n) > 0.0;
    vec3 ng = back ? -h.n : h.n;
    vec3 ns = back ? -h.ns : h.ns;
    if (isDeltaMat(mt, m0)) {
      if (specCount >= uMaxBounces) return;
      specCount++;
      scatterDelta(mt, m0, m1, h.obj, p, ng, ns, back, ro, rd, alpha, absRow);
      continue;
    }
    if (specCount == 0) return;
    // ---- first non-specular surface: connect to the lens
    vec3 lensP = uCamPos;
    if (uLensR > 0.0) {
      vec2 a = sampleAperture(vec2(rnd(), rnd())) * uLensR;
      lensP += uCamR * a.x + uCamU * a.y;
    }
    vec3 v = p - lensP;
    float zf = dot(v, uCamF);
    if (zf <= 1.0e-4) return;
    float d2 = dot(v, v);
    float dist = sqrt(d2);
    vec3 wc = -v / dist;
    float cosL = zf / dist;
    vec3 rel = lensP + v * (uFocus / zf) - uCamPos;
    vec2 pixf = vec2(dot(rel, uCamR), dot(rel, uCamU)) / uFocus / (2.0 * uTanHalf / uRes.y) + 0.5 * uRes;
    if (pixf.x < 0.0 || pixf.y < 0.0 || pixf.x >= uRes.x || pixf.y >= uRes.y) return;
    if (dot(-rd, ns) <= 0.0) ns = ng;
    if (dot(wc, ng) <= 0.0) return;
    float fcos;
    float pdf;
    evalBsdf(mt, m0, ns, -rd, wc, fcos, pdf);
    if (!(fcos > 0.0)) return;
    float c = alpha * fcos / (d2 * uPixArea * cosL * cosL * cosL);
    if (uVignette == 1) c *= cosL * cosL * cosL * cosL;
    cval = cmf() * (c * invPdfLam);
    if (!(cval.y >= 0.0) || cval.y > 1.0e20) return;
    cpix = pixf;
    connect = true;
    cro = p + ng * EPS;
    crd = wc;
    cmax = dist;
  }
}
`;

/** Draws one point per photon, at the pixel it landed on. */
export const SPLAT_VERT = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uPhotPos;
uniform sampler2D uPhotVal;
uniform int uPhotW;
uniform vec2 uRes;
uniform float uScale;
out vec3 vVal;
void main() {
  ivec2 c = ivec2(gl_VertexID % uPhotW, gl_VertexID / uPhotW);
  vec4 a = texelFetch(uPhotPos, c, 0);
  vVal = texelFetch(uPhotVal, c, 0).rgb * uScale;
  gl_PointSize = 1.0;
  if (a.z < 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  gl_Position = vec4((floor(a.xy) + 0.5) / uRes * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const SPLAT_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec3 vVal;
out vec4 outColor;
void main() { outColor = vec4(vVal, 0.0); }
`;

export const FULLSCREEN_VERT = /* glsl */ `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

/** Adds the splat buffer into the photon accumulation (used where float blending is missing). */
export const ADD_FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uA;
uniform sampler2D uB;
uniform float uScaleB;
out vec4 outColor;
void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  outColor = texelFetch(uA, px, 0) + texelFetch(uB, px, 0) * uScaleB;
}
`;
