// Brass, steel, walnut and enamel. Wood is a small procedural shader worked in object space, so a
// turned moulding shows the grain a lathe would cut through; the balls and the deck use canvas
// textures drawn at start-up.
import * as THREE from 'three';
import { type MaterialId } from '../../core/machine/parts';
import { deckTextures, deskTexture, earthTexture, jupiterTexture, saturnTexture, stoneTexture } from './textures';

const WOOD_GLSL = /* glsl */ `
uniform vec3 uWoodDark;
uniform vec3 uWoodLight;
uniform float uWoodScale;
uniform vec3 uWoodAxis;
float wwHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float wwNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(wwHash(i), wwHash(i + vec3(1,0,0)), f.x), mix(wwHash(i + vec3(0,1,0)), wwHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(wwHash(i + vec3(0,0,1)), wwHash(i + vec3(1,0,1)), f.x), mix(wwHash(i + vec3(0,1,1)), wwHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float wwFbm(vec3 p) { float s = 0.0; float a = 0.5; for (int i = 0; i < 4; i++) { s += a * wwNoise(p); p *= 2.03; a *= 0.5; } return s; }
// x: tone 0..1, y: fibre (for roughness)
vec2 wwWood(vec3 pos) {
  // Coordinates with the log's axis along X.
  vec3 a = normalize(uWoodAxis);
  vec3 b = normalize(cross(a, abs(a.z) < 0.9 ? vec3(0,0,1) : vec3(1,0,0)));
  vec3 c = cross(a, b);
  vec3 q = vec3(dot(pos, a), dot(pos, b), dot(pos, c)) * uWoodScale;
  vec2 warp = 5.0 * vec2(wwFbm(q * vec3(0.05, 0.16, 0.16)), wwFbm(q * vec3(0.05, 0.16, 0.16) + 11.7));
  float r = length(q.yz + warp + vec2(31.0, 17.0));
  float rings = 0.5 + 0.5 * sin(r * 1.35 + 2.5 * wwFbm(q * vec3(0.03, 0.5, 0.5)));
  float fibre = wwFbm(q * vec3(0.35, 9.0, 9.0));
  float pores = smoothstep(0.62, 0.9, wwNoise(q * vec3(1.2, 28.0, 28.0)));
  float tone = clamp(pow(rings, 1.3) * 0.34 + fibre * 0.62 - pores * 0.2 + 0.08, 0.0, 1.0);
  return vec2(tone, fibre);
}
`;

interface WoodOptions {
  dark: number;
  light: number;
  scale: number;
  axis: [number, number, number];
  roughness: number;
  clearcoat: number;
}

function woodMaterial(o: WoodOptions): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: o.roughness, metalness: 0, clearcoat: o.clearcoat, clearcoatRoughness: 0.22 });
  const uniforms = {
    uWoodDark: { value: new THREE.Color(o.dark) },
    uWoodLight: { value: new THREE.Color(o.light) },
    uWoodScale: { value: o.scale },
    uWoodAxis: { value: new THREE.Vector3(...o.axis) },
  };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWoodPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWoodPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWoodPos;\n${WOOD_GLSL}`)
      .replace('#include <color_fragment>', '#include <color_fragment>\nvec2 wwW = wwWood(vWoodPos);\ndiffuseColor.rgb = mix(uWoodDark, uWoodLight, wwW.x);')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor + (wwW.y - 0.5) * 0.25, 0.05, 1.0);');
  };
  m.customProgramCacheKey = () => `wood-${o.scale}-${o.axis.join(',')}`;
  return m;
}

export class Materials {
  private map = new Map<MaterialId, THREE.Material>();
  readonly desk: THREE.Material;
  readonly sun: THREE.MeshPhysicalMaterial;
  private textures: THREE.Texture[] = [];

  constructor(deckSize: number) {
    const metal = (color: number, roughness: number, extra: THREE.MeshPhysicalMaterialParameters = {}) =>
      new THREE.MeshPhysicalMaterial({ color, metalness: 1, roughness, ...extra });
    this.map.set('brass', metal(0xcda04c, 0.2));
    this.map.set('brassWheel', metal(0xd4a650, 0.27));
    this.map.set('brassDark', metal(0x94713a, 0.4));
    this.map.set('steel', metal(0xc2c7cf, 0.28));
    this.sun = metal(0xffd47e, 0.16, { emissive: 0xffb548, emissiveIntensity: 0 });
    this.map.set('gilt', this.sun);
    const deck = deckTextures(deckSize);
    this.textures.push(deck.map, deck.bump);
    this.map.set('deck', metal(0xd2a654, 0.36, { map: deck.map, bumpMap: deck.bump, bumpScale: 1.6 }));
    this.map.set('walnut', woodMaterial({ dark: 0x1e1008, light: 0x5c351b, scale: 0.3, axis: [1, 0.2, 0.06], roughness: 0.4, clearcoat: 0.6 }));
    this.map.set('ebony', new THREE.MeshPhysicalMaterial({ color: 0x15100d, roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.2 }));
    this.map.set('ivory', new THREE.MeshPhysicalMaterial({ color: 0xe9e0cb, roughness: 0.4, clearcoat: 0.3 }));
    const ball = (tex: THREE.Texture, roughness = 0.34, clearcoat = 0.7) => {
      this.textures.push(tex);
      return new THREE.MeshPhysicalMaterial({ map: tex, roughness, clearcoat, clearcoatRoughness: 0.15 });
    };
    this.map.set('mercury', ball(stoneTexture([150, 142, 132], [96, 90, 86], 9, 1.6), 0.45, 0.35));
    this.map.set('venus', ball(stoneTexture([236, 218, 170], [206, 172, 112], 26, 1.3)));
    this.map.set('earth', ball(earthTexture(), 0.3, 0.85));
    this.map.set('mars', ball(stoneTexture([188, 92, 58], [120, 52, 38], 12, 1.7), 0.42, 0.45));
    this.map.set('jupiter', ball(jupiterTexture()));
    this.map.set('saturn', ball(saturnTexture()));
    this.map.set('moon', ball(stoneTexture([232, 226, 210], [176, 170, 158], 7, 1.5), 0.5, 0.25));
    const pool = deskTexture();
    this.textures.push(pool);
    this.desk = new THREE.MeshStandardMaterial({ map: pool, roughness: 0.92, metalness: 0 });
  }

  get(id: MaterialId): THREE.Material {
    return this.map.get(id)!;
  }

  all(): THREE.Material[] {
    return [...this.map.values(), this.desk];
  }

  setEnvIntensity(v: number): void {
    for (const m of this.all()) {
      (m as THREE.MeshPhysicalMaterial).envMapIntensity = v;
    }
  }
}
