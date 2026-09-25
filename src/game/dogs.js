// Zombie dogs: the stock dog and wolf made into something to run from. Mangy, rotting fur with raw
// wounds, a flank torn open and blood round the mouth (a shader on the coat); ribs through the torn
// flank and the spine through the back; fangs; a torn ear and a stump of a tail; eyes that burn.
// The extra bits ride the model's own skeleton: two more draws a dog.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// the models' materials, by what they are
const PARTS = {
  dog: { Material: 'fur', 'Material.001': 'pale', 'Material.006': 'nose', 'Material.003': 'eye', 'Material.002': 'pupil' },
  wolf: { Main: 'fur', Main_Light: 'pale', Nose: 'nose', Eyes_Black: 'eye' },
};
// three of each: the rot falls differently and the coat is a little different
const LOOKS = [
  { seed: [0, 0, 0], fur: 0x3f3a2d, pale: 0x6d6552 },
  { seed: [17.3, 5.1, 9.7], fur: 0x34332e, pale: 0x5f5d52 },
  { seed: [41.9, 23.4, 3.3], fur: 0x4a3828, pale: 0x70604a },
];
const SHRINK = [['Ear2R', 0.35], ['Tail3', 0.12]];   // (a torn ear, a stump)

const NOISE = /* glsl */`
float dogHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float dogNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(dogHash(i), dogHash(i + vec3(1, 0, 0)), f.x), mix(dogHash(i + vec3(0, 1, 0)), dogHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(dogHash(i + vec3(0, 0, 1)), dogHash(i + vec3(1, 0, 1)), f.x), mix(dogHash(i + vec3(0, 1, 1)), dogHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}`;

// The coat: dirty and uneven, caked with mud and old blood low down, bald patches of sick bruised
// skin, scabs, and raw wounds (dark meat, black in the cracks, wet); always open at the torn
// flanks; bloody round the mouth. Worked out in the model's own space, so it stays put on the body
// as it moves.
function rot(mat, U) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDogP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDogP = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vDogP;
uniform float uDogF, uDogLowW;
uniform vec3 uDogSeed, uDogHole, uDogHole2, uDogMouth, uDogR, uDogRaw, uDogScab, uDogSkin;
uniform vec4 uDogUp;
${NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
vec3 dq = vDogP * uDogF + uDogSeed;
dq += (vec3(dogNoise(dq * 0.7 + 3.1), dogNoise(dq * 0.7 + 11.7), dogNoise(dq * 0.7 + 23.9)) - 0.5) * 1.3;
float dn1 = dogNoise(dq), dn2 = dogNoise(dq * 2.3 + 7.1), dn3 = dogNoise(dq * 5.3 + 3.7), dn4 = dogNoise(dq * 11.0 + 1.3);
float dW = dn1 * 0.55 + dn2 * 0.3 + dn3 * 0.15;
float dHole = max(1.0 - smoothstep(uDogR.x * 0.55, uDogR.x, distance(vDogP, uDogHole)), 1.0 - smoothstep(uDogR.y * 0.5, uDogR.y, distance(vDogP, uDogHole2)));
dW = max(dW, 0.52 + dHole * 0.3);
float dWound = smoothstep(0.61, 0.69, dW);
float dScab = smoothstep(0.5, 0.61, dW) * (1.0 - dWound);
float dMange = smoothstep(0.45, 0.65, dogNoise(dq * 1.7 + 19.3)) * (1.0 - dWound);
vec3 dc = diffuseColor.rgb * (0.55 + 0.6 * dn3) * (0.8 + 0.4 * dn4);
float dLow = smoothstep(uDogUp.w, uDogUp.w - uDogLowW, dot(vDogP, uDogUp.xyz));
dc = mix(dc, vec3(0.045, 0.022, 0.012) * (0.7 + 0.6 * dn3), dLow * 0.75);
vec3 dSkin = mix(uDogSkin, vec3(0.16, 0.08, 0.13), smoothstep(0.5, 0.8, dn2)) * (0.75 + 0.5 * dn4);
dc = mix(dc, dSkin, dMange * 0.85);
dc = mix(dc, uDogScab * (0.6 + 0.8 * dn4), dScab * 0.9);
vec3 dMeat = mix(uDogRaw * 0.5, uDogRaw * 1.3, dn4);
dMeat = mix(dMeat, vec3(0.02, 0.0, 0.0), smoothstep(0.25, 0.1, dn3));
dc = mix(dc, dMeat, dWound);
float dMouth = (1.0 - smoothstep(uDogR.z * 0.35, uDogR.z, distance(vDogP, uDogMouth))) * smoothstep(0.25, 0.55, dn3);
dc = mix(dc, uDogRaw * 0.7, dMouth);
diffuseColor.rgb = dc;
float dWet = max(dWound, dMouth);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.25, dWet);');
  };
  return mat;
}

// eyes: a glow round each, brightest face on
const GLOW = () => new THREE.ShaderMaterial({
  uniforms: { uCol: { value: new THREE.Color(0xff3a14) } },
  vertexShader: /* glsl */`
    #include <common>
    #include <skinning_pars_vertex>
    varying float vGlow;
    void main() {
      #include <skinbase_vertex>
      #include <beginnormal_vertex>
      #include <skinnormal_vertex>
      #include <defaultnormal_vertex>
      #include <begin_vertex>
      #include <skinning_vertex>
      #include <project_vertex>
      vGlow = pow(max(dot(normalize(transformedNormal), normalize(-mvPosition.xyz)), 0.0), 4.0);
    }`,
  fragmentShader: /* glsl */`
    uniform vec3 uCol;
    varying float vGlow;
    void main() {
      gl_FragColor = vec4(uCol * vGlow, 1.0);
      #include <colorspace_fragment>
    }`,
  transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
});

// a piece of the extra geometry, coloured by `tint` (vertex i, the positions, the colour to set),
// then taken from the model's space into the skin's, all of it on one bone
function piece(geo, M, bone, tint) {
  geo.deleteAttribute('uv');
  const n = geo.attributes.position.count, col = new Float32Array(n * 3), c = new THREE.Color();
  for (let i = 0; i < n; i++) { tint(i, geo.attributes.position, c); c.toArray(col, i * 3); }
  geo.applyMatrix4(M);
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(n * 4).fill(0).map((_, k) => (k % 4 ? 0 : bone)), 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Array(n * 4).fill(0).map((_, k) => (k % 4 ? 0 : 1)), 4));
  return geo;
}

const BONE = new THREE.Color(0xd9cfae), BLOOD = new THREE.Color(0x4a0806), TOOTH = new THREE.Color(0xe6dcb4);

// The coat's triangles at rest, in the model's space (x across, y up, z ahead), nine numbers each;
// and a cut through them, the outline where a plane across the body (z = z0) meets them
function restTris(meshes) {
  const out = [], v = new THREE.Vector3();
  for (const o of meshes) {
    const n = o.geometry.attributes.position.count, P = new Float32Array(n * 3), idx = o.geometry.index;
    for (let i = 0; i < n; i++) o.getVertexPosition(i, v).applyMatrix4(o.matrixWorld).toArray(P, i * 3);
    for (let k = 0, m = idx ? idx.count : n; k < m; k++) { const i = idx ? idx.getX(k) : k; out.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); }
  }
  return out;
}
function cut(tris, z0) {
  const segs = [];
  for (let t = 0; t < tris.length; t += 9) {
    const s = [];
    for (let e = 0; e < 3; e++) {
      const a = t + e * 3, b = t + ((e + 1) % 3) * 3, za = tris[a + 2] - z0, zb = tris[b + 2] - z0;
      if (za * zb < 0) { const k = za / (za - zb); s.push(tris[a] + (tris[b] - tris[a]) * k, tris[a + 1] + (tris[b + 1] - tris[a + 1]) * k); }
    }
    if (s.length === 4) segs.push(s);
  }
  return segs;
}
// how far from (ox, oy) along (dx, dy) the outline is: where it's first crossed, or last (far)
function reach(segs, ox, oy, dx, dy, far = false) {
  let best = far ? 0 : Infinity;
  for (const [x1, y1, x2, y2] of segs) {
    const ex = x2 - x1, ey = y2 - y1, den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((x1 - ox) * ey - (y1 - oy) * ex) / den, u = ((x1 - ox) * dy - (y1 - oy) * dx) / den;
    if (t > 1e-6 && u >= 0 && u <= 1) best = far ? Math.max(best, t) : Math.min(best, t);
  }
  return Number.isFinite(best) ? best : 0;
}

// Once a model: measure it at rest (the body's cross-sections, the eyes, the snout), then make the
// coats, the eyes and the bony bits for it.
function prep(model, key) {
  if (model.ugly !== undefined) return model.ugly;
  const roles = PARTS[key] || PARTS.dog;
  const sc = model.scene;
  sc.updateMatrixWorld(true);
  let skin = null;
  const coat = [], eyes = [], v = new THREE.Vector3();
  sc.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const role = roles[o.material.name];
    if (role === 'fur') skin = o;
    if (role === 'fur' || role === 'pale' || role === 'nose') coat.push(o);
    if (role === 'eye') for (let i = 0; i < o.geometry.attributes.position.count; i++) eyes.push(o.getVertexPosition(i, v).applyMatrix4(o.matrixWorld).clone());
  });
  const bones = skin?.skeleton.bones, at = (name) => bones?.findIndex((b) => b.name === name) ?? -1;
  const need = ['Back', 'Torso', 'Torso2', 'Torso3', 'Head'].map(at);
  if (!skin || need.some((i) => i < 0) || !eyes.length) return (model.ugly = null);
  const [iBack, iTorso, iTorso2, iTorso3, iHead] = need;
  // from the model's space (at rest) to the skin's, riding bone i
  const toSkin = (i) => new THREE.Matrix4().multiplyMatrices(bones[i].matrixWorld, skin.skeleton.boneInverses[i]).multiply(skin.bindMatrix).invert();
  const zOf = (i) => new THREE.Vector3().setFromMatrixPosition(bones[i].matrixWorld).z;
  const zBack = zOf(iBack), zT = zOf(iTorso), zT3 = zOf(iTorso3), span = zT3 - zBack;
  const tris = restTris(coat);
  let yLo = Infinity, yHi = -Infinity, front = -Infinity;
  for (let i = 0; i < tris.length; i += 3) { yLo = Math.min(yLo, tris[i + 1]); yHi = Math.max(yHi, tris[i + 1]); front = Math.max(front, tris[i + 2]); }
  yLo -= 1; yHi += 1;
  // a cross-section: the top and bottom down the middle, and how wide it is halfway up
  const section = (z0) => {
    const segs = cut(tris, z0);
    const top = yLo + reach(segs, 0.001, yLo, 0, 1, true), bot = yHi - reach(segs, 0.001, yHi, 0, -1, true), mid = (top + bot) / 2;
    return { segs, top, bot, mid, h: (top - bot) / 2, w: reach(segs, 0, mid, 1, 0) };
  };
  const nearest = (z) => [[iBack, zBack], [iTorso, zT], [iTorso2, zOf(iTorso2)], [iTorso3, zT3]].reduce((a, b) => (Math.abs(b[1] - z) < Math.abs(a[1] - z) ? b : a))[0];
  const parts = [];

  // ribs through the flanks, following the body round: five on the left, three on the right;
  // sloping back towards the belly
  const ribZ = [0.25, 0.41, 0.57, 0.73, 0.9].map((k) => zT + (zT3 - zT) * k);
  const mid0 = section(ribZ[2]);
  const ribR = mid0.w * 0.08;
  const rib = (z, s, a0, a1) => {
    const S = section(z), pts = [];
    for (let k = 0; k <= 6; k++) {
      const a = THREE.MathUtils.degToRad(a0 + (a1 - a0) * (k / 6)), dx = s * Math.cos(a), dy = Math.sin(a);
      const r = reach(S.segs, 0, S.mid, dx, dy);
      if (r > 0) pts.push(new THREE.Vector3(dx * (r + ribR * 0.4), S.mid + dy * (r + ribR * 0.4), z + span * 0.05 * dy));
    }
    if (pts.length < 3) return;
    const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, ribR, 5, false);
    parts.push(piece(geo, toSkin(nearest(z)), nearest(z), (i, pos, c) => {
      const t = Math.floor(i / 6) / 10;   // (along the rib: 11 rings of 6)
      c.copy(BONE).lerp(BLOOD, THREE.MathUtils.smoothstep(Math.min(t, 1 - t), 0.25, 0) * 0.8);
    }));
  };
  for (const z of ribZ) rib(z, 1, -62, 50);
  for (const z of ribZ.slice(1, 4)) rib(z, -1, -42, 32);

  // the spine: knobs and spikes along the top of the back
  for (let k = 0; k < 7; k++) {
    const z = zBack + span * (0.05 + k * 0.14), S = section(z), b = nearest(z), w = mid0.w;
    const cone = new THREE.ConeGeometry(w * 0.1, w * 0.28, 5).rotateX(-0.35).translate(0, S.top + w * 0.06, z);
    const knob = new THREE.SphereGeometry(w * 0.13, 6, 4).scale(1, 0.55, 1.3).translate(0, S.top - w * 0.02, z);
    for (const geo of [cone, knob]) {
      const y0 = S.top - w * 0.05, y1 = S.top + w * 0.2;
      parts.push(piece(geo, toSkin(b), b, (i, pos, c) => c.copy(BLOOD).lerp(BONE, THREE.MathUtils.clamp((pos.getY(i) - y0) / (y1 - y0), 0, 1))));
    }
  }

  // the eyes (their middles and size), and the snout in front of them
  const eyeAt = (s) => {
    const e = eyes.filter((p) => Math.sign(p.x) === s), c = new THREE.Vector3();
    for (const p of e) c.add(p);
    c.divideScalar(e.length || 1);
    let r = 0;
    for (const p of e) r = Math.max(r, p.distanceTo(c));
    return { c, r };
  };
  const eyeL = eyeAt(1), eyeR = eyeAt(-1), eyeZ = (eyeL.c.z + eyeR.c.z) / 2;
  const zf = front - (front - eyeZ) * 0.35, SN = section(zf);
  if (!(SN.h > 0)) return (model.ugly = null);
  const sh = SN.h * 2, mouthY = SN.bot + sh * 0.3, sW = (s) => reach(SN.segs, 0, mouthY, s, 0) || SN.w;

  // fangs: two over the lip from above, two up from below
  for (const s of [1, -1]) {
    const upper = new THREE.ConeGeometry(sh * 0.07, sh * 0.42, 5).rotateX(Math.PI).translate(s * sW(s) * 0.86, mouthY - sh * 0.12, zf);
    const lower = new THREE.ConeGeometry(sh * 0.055, sh * 0.3, 5).translate(s * sW(s) * 0.8, mouthY + sh * 0.02, zf - span * 0.08);
    for (const geo of [upper, lower]) parts.push(piece(geo, toSkin(iHead), iHead, (i, pos, c) => c.copy(TOOTH).lerp(BLOOD, 0.15)));
  }
  const bonesGeo = mergeGeometries(parts);

  // the glow round each eye
  const glowGeo = mergeGeometries([eyeL, eyeR].map((e) => piece(new THREE.IcosahedronGeometry(e.r * 1.45, 1).translate(e.c.x, e.c.y, e.c.z + e.r * 0.4),
    toSkin(iHead), iHead, (i, pos, c) => c.setRGB(1, 1, 1))));

  // the coats, a set for each look; the eyes, the nose
  const W = toSkin(iTorso), unit = new THREE.Vector3().setFromMatrixScale(W).x;   // (the skin's units per model unit)
  const inSkin = (p, i) => p.clone().applyMatrix4(toSkin(i));
  const hole = inSkin(new THREE.Vector3(mid0.w, mid0.mid, ribZ[2]), iTorso2), hole2 = inSkin(new THREE.Vector3(-mid0.w, mid0.mid, ribZ[2]), iTorso2);
  const mouth = inSkin(new THREE.Vector3(0, mouthY, zf + (front - zf) * 0.3), iHead);
  // (which way is up in the skin, and how high the mud comes: to just under the belly)
  const up = new THREE.Vector3(0, 1, 0).transformDirection(W), lowY = mid0.bot + mid0.h * 0.35;
  const upW = new THREE.Vector4(up.x, up.y, up.z, inSkin(new THREE.Vector3(0, lowY, 0), iTorso).dot(up));
  const orig = {};
  sc.traverse((o) => { if (o.isSkinnedMesh) orig[roles[o.material.name]] = o.material; });
  const looks = LOOKS.map((L) => {
    const U = {
      uDogF: { value: (2.2 / span) / unit }, uDogSeed: { value: new THREE.Vector3(...L.seed) },
      uDogHole: { value: hole }, uDogHole2: { value: hole2 }, uDogMouth: { value: mouth },
      uDogR: { value: new THREE.Vector3((ribZ[4] - ribZ[0]) * 0.75 * unit, (ribZ[3] - ribZ[1]) * 0.8 * unit, sh * 0.9 * unit) },
      uDogRaw: { value: new THREE.Color(0x8c1a14) }, uDogScab: { value: new THREE.Color(0x2a100b) }, uDogSkin: { value: new THREE.Color(0x857d68) },
      uDogUp: { value: upW }, uDogLowW: { value: mid0.h * 0.9 * unit },
    };
    const coat = (m, hex) => { const c = rot(m.clone(), U); c.color.set(hex); c.roughness = 0.95; c.metalness = 0; return c; };
    return { fur: coat(orig.fur, L.fur), pale: orig.pale ? coat(orig.pale, L.pale) : null };
  });
  const mats = {
    nose: new THREE.MeshStandardMaterial({ color: 0x3a0e0b, roughness: 0.3 }),
    eye: new THREE.MeshBasicMaterial({ color: 0xff2a0c, toneMapped: false }),
    pupil: new THREE.MeshBasicMaterial({ color: 0xffd040, toneMapped: false }),
  };
  const extras = [[bonesGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 })], [glowGeo, GLOW()]];
  return (model.ugly = { roles, looks, mats, extras });
}

// Make one (a fresh copy of the model) ugly.
export function uglyDog(inst, model, key) {
  const U = prep(model, key);
  if (!U) return false;
  const look = U.looks[Math.floor(Math.random() * U.looks.length)];
  let skin = null;
  inst.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const role = U.roles[o.material.name];
    if (role === 'fur') skin = o;
    const m = look[role] || U.mats[role];
    if (m) o.material = m;
  });
  if (!skin) return false;
  for (const [geo, mat] of U.extras) {
    const x = new THREE.SkinnedMesh(geo, mat);
    x.bind(skin.skeleton, skin.bindMatrix);
    x.frustumCulled = false;
    skin.parent.add(x);
  }
  for (const [name, s] of SHRINK) inst.getObjectByName(name)?.scale.setScalar(s);
  return true;
}
