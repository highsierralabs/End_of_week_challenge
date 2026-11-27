// From accumulated light to a picture: develop (average the samples, white balance, exposure),
// glare (a mip-chain blur of the bright parts), and print (tone curve, gamut, sRGB, dither).

/** Averages the tracers' buffers into linear, white-balanced, exposed RGB. */
export const DEVELOP_FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uPT;
uniform sampler2D uLT;
uniform float uPhotons;
uniform vec2 uSrcRes;
uniform vec2 uDstRes;
uniform mat3 uCam;
uniform float uExposure;
out vec4 outColor;
vec3 xyzAt(ivec2 p) {
  p = clamp(p, ivec2(0), ivec2(uSrcRes) - 1);
  vec4 a = texelFetch(uPT, p, 0);
  vec3 c = a.rgb / max(a.a, 1.0);
  if (uPhotons > 0.0) c += texelFetch(uLT, p, 0).rgb / uPhotons;
  return c;
}
void main() {
  vec2 s = gl_FragCoord.xy / uDstRes * uSrcRes - 0.5;
  ivec2 i = ivec2(floor(s));
  vec2 f = s - vec2(i);
  vec3 xyz = uSrcRes == uDstRes ? xyzAt(ivec2(gl_FragCoord.xy))
    : mix(mix(xyzAt(i), xyzAt(i + ivec2(1, 0)), f.x), mix(xyzAt(i + ivec2(0, 1)), xyzAt(i + ivec2(1, 1)), f.x), f.y);
  vec3 rgb = uCam * xyz * uExposure;
  outColor = vec4(clamp(rgb, vec3(-6.0e4), vec3(6.0e4)), 1.0);
}
`;

/** Log-luminance of the picture on a coarse grid, for the exposure meter. */
export const METER_FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uPT;
uniform sampler2D uLT;
uniform float uPhotons;
uniform vec2 uSrcRes;
uniform vec2 uDstRes;
out vec4 outColor;
void main() {
  vec2 cell = uSrcRes / uDstRes;
  float lin = 0.0;
  for (int j = 0; j < 4; j++) {
    for (int i = 0; i < 4; i++) {
      ivec2 p = ivec2((floor(gl_FragCoord.xy) + (vec2(float(i), float(j)) + 0.5) / 4.0) * cell);
      p = clamp(p, ivec2(0), ivec2(uSrcRes) - 1);
      vec4 a = texelFetch(uPT, p, 0);
      float y = a.g / max(a.a, 1.0);
      if (uPhotons > 0.0) y += texelFetch(uLT, p, 0).g / uPhotons;
      lin += y;
    }
  }
  outColor = vec4(log(max(lin / 16.0, 1.0e-3)), lin / 16.0, 0.0, 1.0);
}
`;

/** 13-tap downsample (Jimenez 2014). */
export const DOWN_FRAG = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uThreshold;
out vec4 outColor;
vec3 tap(vec2 uv) {
  vec3 c = max(texture(uSrc, uv).rgb, vec3(0.0));
  if (uThreshold > 0.0) {
    // Only what is brighter than paper white makes glare.
    float m = max(c.r, max(c.g, c.b));
    c *= max(0.0, m - uThreshold) / max(m, 1.0e-4);
  }
  return c;
}
void main() {
  vec2 uv = gl_FragCoord.xy * uTexel * 0.5;
  vec2 t = uTexel;
  vec3 a = tap(uv + t * vec2(-2.0, 2.0));
  vec3 b = tap(uv + t * vec2(0.0, 2.0));
  vec3 c = tap(uv + t * vec2(2.0, 2.0));
  vec3 d = tap(uv + t * vec2(-2.0, 0.0));
  vec3 e = tap(uv);
  vec3 f = tap(uv + t * vec2(2.0, 0.0));
  vec3 g = tap(uv + t * vec2(-2.0, -2.0));
  vec3 h = tap(uv + t * vec2(0.0, -2.0));
  vec3 i = tap(uv + t * vec2(2.0, -2.0));
  vec3 j = tap(uv + t * vec2(-1.0, 1.0));
  vec3 k = tap(uv + t * vec2(1.0, 1.0));
  vec3 l = tap(uv + t * vec2(-1.0, -1.0));
  vec3 m = tap(uv + t * vec2(1.0, -1.0));
  vec3 o = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  outColor = vec4(o, 1.0);
}
`;

/** 3x3 tent upsample, blended additively onto the next larger level. */
export const UP_FRAG = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform vec2 uDstRes;
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uDstRes;
  vec2 t = uTexel;
  vec3 o = texture(uSrc, uv).rgb * 4.0;
  o += (texture(uSrc, uv + vec2(t.x, 0.0)).rgb + texture(uSrc, uv - vec2(t.x, 0.0)).rgb + texture(uSrc, uv + vec2(0.0, t.y)).rgb + texture(uSrc, uv - vec2(0.0, t.y)).rgb) * 2.0;
  o += texture(uSrc, uv + t).rgb + texture(uSrc, uv - t).rgb + texture(uSrc, uv + vec2(t.x, -t.y)).rgb + texture(uSrc, uv + vec2(-t.x, t.y)).rgb;
  outColor = vec4(o / 16.0, 1.0);
}
`;

export const PRINT_FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uHdr;
uniform sampler2D uBloom;
uniform float uBloomAmount;
uniform vec2 uRes;
uniform int uTone;
uniform float uGrain;
out vec4 outColor;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
// Filmic shoulder and toe (the fit of Narkowicz 2015).
vec3 film(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
vec3 srgb(vec3 c) { return mix(12.92 * c, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 c = texelFetch(uHdr, ivec2(gl_FragCoord.xy), 0).rgb;
  if (uBloomAmount > 0.0) c += texture(uBloom, uv).rgb * uBloomAmount;
  // Colours outside the display's gamut (a spectral line is far outside it) are pulled toward
  // grey of the same luminance until they fit.
  float y = dot(c, vec3(0.2126729, 0.7151522, 0.072175));
  float lo = min(c.r, min(c.g, c.b));
  if (lo < 0.0) {
    if (y <= 0.0) c = vec3(0.0);
    else c = y + (c - y) * (y / (y - lo));
  }
  if (uTone == 0) c = film(c * 1.6);
  else if (uTone == 2) { c = film(c * 1.6); c = c * c * (3.0 - 2.0 * c); }
  else if (uTone == 3) { float g = dot(c, vec3(0.2126729, 0.7151522, 0.072175)); c = film(vec3(g * 1.6)); }
  else c = clamp(c, 0.0, 1.0);
  c = srgb(c);
  c += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
  outColor = vec4(c, 1.0);
}
`;
