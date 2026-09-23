import * as THREE from 'three';

// Shader snippets shared by several materials.
export const NOISE_GLSL = /* glsl */`
float gdHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float gdNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float a = gdHash(i), b = gdHash(i + vec2(1.0, 0.0)), c = gdHash(i + vec2(0.0, 1.0)), d = gdHash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float gdFbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * gdNoise(p); p *= 2.03; a *= 0.5; } return s; }
`;

// Break up texture tiling on big surfaces with low-frequency world-space variation.
// tint: optional second colour mixed in by a second noise (e.g. dry grass patches).
export function addMacroVariation(mat, { freq = 0.08, amount = 0.18, tint = null, tintAmount = 0.35, tintFreq = 0.035 } = {}) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    shader.uniforms.gdFreq = { value: freq };
    shader.uniforms.gdAmount = { value: amount };
    shader.uniforms.gdTint = { value: tint ? new THREE.Color(tint) : new THREE.Color(1, 1, 1) };
    shader.uniforms.gdTintAmount = { value: tint ? tintAmount : 0 };
    shader.uniforms.gdTintFreq = { value: tintFreq };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 gdWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n');
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      #ifdef USE_INSTANCING
        gdWPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
      #else
        gdWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
      #endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 gdWPos;
        uniform float gdFreq, gdAmount, gdTintAmount, gdTintFreq;
        uniform vec3 gdTint;
        ${NOISE_GLSL}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        float gdN = gdFbm(gdWPos.xz * gdFreq);
        diffuseColor.rgb *= 1.0 + (gdN - 0.5) * 2.0 * gdAmount;
        float gdT = smoothstep(0.45, 0.75, gdFbm(gdWPos.xz * gdTintFreq + 17.0));
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * gdTint, gdT * gdTintAmount);`);
  };
  mat.customProgramCacheKey = () => `macro-${freq}-${amount}-${tint}-${tintAmount}`;
  return mat;
}

export function pbrMaterial(set, opts = {}) {
  const m = new THREE.MeshStandardMaterial({
    map: set.map, normalMap: set.normalMap || null, roughnessMap: opts.roughMap === false ? null : (set.roughnessMap || null),
    aoMap: set.aoMap || null, color: opts.color ?? 0xffffff, roughness: opts.roughness ?? 1,
    metalness: opts.metalness ?? 0, side: opts.side ?? THREE.FrontSide,
  });
  if (m.normalMap) m.normalScale.set(opts.normalScale ?? 1, opts.normalScale ?? 1);
  if (opts.envMapIntensity != null) m.envMapIntensity = opts.envMapIntensity;
  if (opts.polygonOffset) { m.polygonOffset = true; m.polygonOffsetFactor = opts.polygonOffset; m.polygonOffsetUnits = opts.polygonOffset; }
  return m;
}
