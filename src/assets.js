import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Loads the downloaded GLB models and normalises them: size in metres, facing, clean clips.
// Anything missing is simply skipped; the game has procedural stand-ins for all of it.

const loader = new GLTFLoader();

function load(url) {
  return new Promise((resolve) => loader.load(url, resolve, undefined, () => resolve(null)));
}

// Remove horizontal root motion so walk cycles play in place (we move zombies ourselves).
function stripRootMotion(clip) {
  for (const t of clip.tracks) {
    if (!/\.position$/.test(t.name)) continue;
    const node = t.name.split('.')[0].toLowerCase();
    if (!/(hips|root|pelvis)/.test(node)) continue;
    const v = t.values;
    const x0 = v[0], z0 = v[2];
    for (let i = 0; i < v.length; i += 3) { v[i] = x0; v[i + 2] = z0; }
  }
  return clip;
}

function measure(scene) {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3();
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    const b = g.boundingBox.clone().applyMatrix4(o.matrixWorld);
    box.union(b);
  });
  return box;
}

const ZOMBIES = [
  { file: 'zombie_city_male.glb', height: 1.8 },
  { file: 'zombie_thin.glb', height: 1.78 },
  { file: 'zombie_office.glb', height: 1.8, strip: true },
  { file: 'zombie_hazmat.glb', height: 1.82, walkerOnly: true },
];
// car model -> real length in metres (the files come in assorted units)
const CARS = { car_sedan: 4.5, car_hatchback: 4.1, car_suv: 4.5, car_taxi: 4.5, car_van: 5.1, car_suv_terrano: 4.3 };
const PAINT = /^(blue|white|lightblue|bodywork|color_m05|frontcolor|_color_m05_1|red|silver)$/i;

// One geometry per car: meshes merged, material colours baked into vertex colours, plus a
// 'paint' attribute marking the body panels so each parked car can get its own colour.
function mergeCar(scene) {
  scene.updateMatrixWorld(true);
  const parts = [];
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    let g = o.geometry.clone().applyMatrix4(o.matrixWorld);
    if (g.index) g = g.toNonIndexed();
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3), paint = new Float32Array(n);
    const groups = g.groups.length ? g.groups : [{ start: 0, count: n, materialIndex: 0 }];
    for (const gr of groups) {
      const m = mats[gr.materialIndex] || mats[0];
      const c = m.color ? m.color.clone() : new THREE.Color(0x888888);
      const isPaint = PAINT.test(m.name || '');
      const glassy = /window|glass/i.test(m.name || '');
      for (let i = gr.start; i < gr.start + gr.count; i++) {
        col[i * 3] = glassy ? 0.05 : c.r; col[i * 3 + 1] = glassy ? 0.06 : c.g; col[i * 3 + 2] = glassy ? 0.07 : c.b;
        paint[i] = isPaint ? 1 : 0;
      }
    }
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aPaint', new THREE.BufferAttribute(paint, 1));
    g.clearGroups();
    parts.push(g);
  });
  return parts.length ? mergeGeometries(parts) : null;
}

export async function loadModels(onProgress = () => {}) {
  const out = { zombies: [], cars: [], wrecked: null, weapons: {} };
  let done = 0;
  const total = ZOMBIES.length + Object.keys(CARS).length + 4;
  const tick = () => onProgress(++done / total);

  await Promise.all(ZOMBIES.map(async (z) => {
    const g = await load(`assets/models/zombies/${z.file}`);
    tick();
    if (!g || !g.animations.length) return;
    const anims = g.animations.map((a) => stripRootMotion(a));
    // measure the posed, skinned body (some rigs hide a 1/100 unit scale inside the skeleton)
    const mixer = new THREE.AnimationMixer(g.scene);
    const pose = anims.find((a) => /walk|forward|idle/i.test(a.name)) || anims[0];
    mixer.clipAction(pose).play();
    mixer.update(0.1);
    g.scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(g.scene, true);
    mixer.stopAllAction();
    const h = box.max.y - box.min.y;
    g.scene.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) { if (m.map) m.map.anisotropy = 4; m.envMapIntensity = 0.8; }
      }
    });
    out.zombies.push({ name: z.file, scene: g.scene, animations: anims, scale: z.height / (h || 1), yaw: 0, walkerOnly: !!z.walkerOnly });
  }));

  await Promise.all(Object.entries(CARS).map(async ([name, length]) => {
    const g = await load(`assets/models/cars/${name}.glb`);
    tick();
    if (!g) return;
    const geo = mergeCar(g.scene);
    if (!geo) return;
    geo.computeBoundingBox();
    const b = geo.boundingBox;
    const sx = b.max.x - b.min.x, sz = b.max.z - b.min.z;
    // length along local +x, centred, wheels on the ground, real size
    if (sz > sx) geo.rotateY(Math.PI / 2);
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    geo.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
    const k = length / Math.max(sx, sz);
    geo.scale(k, k, k);
    out.cars.push({ name, geometry: geo });
  }));

  const wr = await load('assets/models/cars/car_wrecked.glb');
  tick();
  if (wr) out.wrecked = wr.scene;

  for (const name of ['fps_arms_akm', 'fps_arms_pistol', 'shotgun_mossberg']) {
    const g = await load(`assets/models/weapons/${name}.glb`);
    tick();
    if (g) out.weapons[name] = g;
  }
  return out;
}
