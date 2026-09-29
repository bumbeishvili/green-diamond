import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { pointInPoly } from '../world/geom.js';
import { DEFS, groundGun } from './weapons.js';

// Loot lying around the complex: ammo cans, first-aid kits, bundles of lari and now and then a gun.
// They float over a glowing ring; walk (or drive) over one to take it. More turn up away from you
// every wave, and every half a minute or so during one, a few of them on the roofs (take the
// stairs). A gun you don't have is yours; one you have, its ammo. Each new one goes where it's
// furthest from the rest, so they spread over the whole complex. A player who dies drops the guns
// they'd bought or found, for anyone to take. In PvP the guns are at four armories, one in each
// quarter of the complex: eighteen in a grid at each, every kind, each back a few seconds after
// it's taken.
const MAX = { ammo: 7, health: 6, cash: 10, gun: 3, word: 3 };
const PVP_MAX = { ammo: 10, health: 8, cash: 5, gun: 0, word: 0 };
// an armory's eighteen: every kind once, and the everyday ones twice (6 across, 3 deep, 1.7 m apart)
const ARMORY = ['rifle', 'm4', 'aug', 'shotgun', 'deagle', 'mg', 'sniper', 'msr', 'autosniper', 'bow', 'launcher', 'laser', 'chainsaw', 'rifle', 'm4', 'shotgun', 'aug', 'deagle'];
const ARMORY_COLS = 6, ARMORY_GAP = 1.7, ARMORY_BACK = 8;
export const PICKUP_COLORS = { ammo: '#9bd35a', health: '#ff6b6b', cash: '#ffe066', gun: '#ff9f43', word: '#b98cff' };
const RING = { ammo: 0x7fd13a, health: 0xff4a4a, cash: 0xffc93a, gun: 0xff8a2a, word: 0x9d6bff };
// (puzzle crates only where the brain training is on: the host's, or yours alone)
// the guns that lie around (the cheaper ones more often) and their models
// (the rest only turn up dropped by a player, or in PvP; the order is the wire format: add at the end)
const GUNS = [['deagle', 0.2], ['shotgun', 0.18], ['m4', 0.16], ['autosniper', 0.08], ['mg', 0.08], ['bow', 0.12], ['aug', 0.1], ['msr', 0.05], ['chainsaw', 0.03],
  ['rifle', 0], ['sniper', 0], ['launcher', 0], ['laser', 0], ['pistol', 0]];
// PvP: anything, the big guns a little rarer
const PVP_GUNS = [['rifle', 0.13], ['m4', 0.12], ['aug', 0.1], ['shotgun', 0.12], ['deagle', 0.08], ['sniper', 0.08], ['msr', 0.06], ['autosniper', 0.06], ['mg', 0.08],
  ['bow', 0.04], ['launcher', 0.05], ['chainsaw', 0.04], ['laser', 0.04]];
const GUN_MODEL = { deagle: 'deagle', shotgun: 'shotgun_mossberg', m4: 'm4', autosniper: 'autosniper', mg: 'mg', bow: 'bow', aug: 'aug', msr: 'msr', chainsaw: 'chainsaw', launcher: 'launcher' };
const pick = (table) => { let r = Math.random(); for (const [k, p] of table) { if (r < p) return k; r -= p; } return table[0][0]; };
const pickGun = () => pick(GUNS);
const gunIndex = (key) => Math.max(0, GUNS.findIndex(([k]) => k === key));

function normalize(g, size) {
  g.computeBoundingBox();
  const b = g.boundingBox;
  const s = size / Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z);
  g.translate(-(b.min.x + b.max.x) / 2, -(b.min.y + b.max.y) / 2, -(b.min.z + b.max.z) / 2);
  g.scale(s, s, s);
  return g;
}

// One geometry + material from a GLB: a single textured mesh keeps its texture, anything else
// gets its material colours baked into vertex colours.
function bake(scene, size) {
  scene.updateMatrixWorld(true);
  const meshes = [];
  scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
  if (!meshes.length) return null;
  const m0 = meshes[0].material;
  if (meshes.length === 1 && !Array.isArray(m0) && m0.map) {
    const g = normalize(meshes[0].geometry.clone().applyMatrix4(meshes[0].matrixWorld), size);
    const m = m0.clone();
    m.metalness = 0; m.roughness = Math.max(0.45, m.roughness ?? 0.6);
    return { geometry: g, material: m };
  }
  const parts = [];
  for (const o of meshes) {
    let g = o.geometry.clone().applyMatrix4(o.matrixWorld);
    if (g.index) g = g.toNonIndexed();
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const n = g.attributes.position.count, col = new Float32Array(n * 3);
    const groups = g.groups.length ? g.groups : [{ start: 0, count: n, materialIndex: 0 }];
    for (const gr of groups) {
      const c = (mats[gr.materialIndex] || mats[0]).color || new THREE.Color(0xffffff);
      for (let i = gr.start; i < gr.start + gr.count; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    }
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.clearGroups();
    parts.push(g);
  }
  return { geometry: normalize(mergeGeometries(parts), size), material: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 }) };
}

function colouredBoxes(list) {
  const parts = list.map(([w, h, d, x, y, z, hex]) => {
    const g = new THREE.BoxGeometry(w, h, d).toNonIndexed().translate(x, y, z);
    const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    g.deleteAttribute('uv');
    return g;
  });
  return { geometry: mergeGeometries(parts), material: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }) };
}

// A 50-lari note for the top of each bundle, paper edges for the sides.
function noteTextures() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const x = c.getContext('2d');
  const gr = x.createLinearGradient(0, 0, 256, 0);
  gr.addColorStop(0, '#b9c79a'); gr.addColorStop(0.5, '#d9dcb4'); gr.addColorStop(1, '#a9bf93');
  x.fillStyle = gr; x.fillRect(0, 0, 256, 128);
  x.strokeStyle = 'rgba(60,90,60,0.35)';
  for (let i = 0; i < 26; i++) { x.beginPath(); x.ellipse(70, 64, 10 + i * 3, 6 + i * 2, 0, 0, Math.PI * 2); x.stroke(); }
  x.fillStyle = 'rgba(70,100,70,0.55)'; x.beginPath(); x.ellipse(196, 62, 30, 38, 0, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#35523a'; x.font = 'bold 30px Arial'; x.fillText('50', 10, 34); x.fillText('50', 206, 118);
  x.font = 'bold 22px Arial'; x.fillText('₾', 58, 72);
  x.font = '600 12px Arial, sans-serif'; x.fillText('ლარი · LARI', 30, 112);
  x.fillStyle = '#f4f1e6'; x.fillRect(116, 0, 26, 128);       // paper band
  x.fillStyle = '#2c4d8a'; x.font = 'bold 11px Arial'; x.save(); x.translate(133, 64); x.rotate(-Math.PI / 2); x.fillText('100 × 50', -24, 0); x.restore();
  const top = new THREE.CanvasTexture(c); top.colorSpace = THREE.SRGBColorSpace; top.anisotropy = 4;
  const e = document.createElement('canvas'); e.width = 64; e.height = 16;
  const y = e.getContext('2d');
  y.fillStyle = '#e9e6d6'; y.fillRect(0, 0, 64, 16);
  y.strokeStyle = 'rgba(120,140,110,0.6)';
  for (let r = 1; r < 16; r += 2) { y.beginPath(); y.moveTo(0, r); y.lineTo(64, r); y.stroke(); }
  const side = new THREE.CanvasTexture(e); side.colorSpace = THREE.SRGBColorSpace;
  return { top, side };
}

export class Pickups {
  constructor(game) {
    this.g = game;
    this.list = [];
    this.t = 0;
    this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler();
    this.v = new THREE.Vector3(); this.s = new THREE.Vector3(1, 1, 1); this.c = new THREE.Color();
    const p = game.level.play.outer;
    this.bounds = p.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [Infinity, Infinity, -Infinity, -Infinity]);
  }

  setup(models) {
    const props = (models && models.props) || {};
    const ammo = props.ammo_can ? bake(props.ammo_can, 0.44) : colouredBoxes([
      [0.44, 0.24, 0.2, 0, 0, 0, 0x4f5a36], [0.46, 0.04, 0.22, 0, 0.13, 0, 0x3f4a2a], [0.2, 0.03, 0.04, 0, 0.165, 0, 0x2a2a2a], [0.12, 0.06, 0.005, 0.1, 0, 0.101, 0xe0c341],
    ]);
    const health = props.medkit ? bake(props.medkit, 0.56) : colouredBoxes([
      [0.44, 0.3, 0.16, 0, 0, 0, 0xf2f2ef], [0.2, 0.06, 0.005, 0, 0, 0.081, 0xd81f26], [0.06, 0.2, 0.005, 0, 0, 0.081, 0xd81f26], [0.14, 0.03, 0.04, 0, 0.165, 0, 0x333333],
    ]);
    const tex = noteTextures();
    const sideM = new THREE.MeshStandardMaterial({ map: tex.side, roughness: 0.9 }), topM = new THREE.MeshStandardMaterial({ map: tex.top, roughness: 0.8 });
    const bundle = { geometry: new THREE.BoxGeometry(0.17, 0.028, 0.078).scale(1.9, 1.9, 1.9), material: [sideM, sideM, topM, topM, sideM, sideM] };
    const make = ({ geometry, material }, n) => {
      const im = new THREE.InstancedMesh(geometry, material, n);
      im.count = 0; im.castShadow = true; im.frustumCulled = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.g.scene.add(im);
      return im;
    };
    // a puzzle crate: violet, with a ? on its sides
    const wc = document.createElement('canvas'); wc.width = 128; wc.height = 96;
    const x = wc.getContext('2d');
    x.fillStyle = '#5b3aa8'; x.fillRect(0, 0, 128, 96);
    x.strokeStyle = '#2d1b5c'; x.lineWidth = 8; x.strokeRect(4, 4, 120, 88);
    x.fillStyle = '#fff'; x.font = 'bold 60px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('?', 64, 52);
    const wt = new THREE.CanvasTexture(wc); wt.colorSpace = THREE.SRGBColorSpace;
    const wm = new THREE.MeshStandardMaterial({ map: wt, roughness: 0.6, emissive: 0x2a1060, emissiveIntensity: 0.6 });
    const word = { geometry: new THREE.BoxGeometry(0.42, 0.32, 0.32), material: wm };
    this.meshes = { ammo: make(ammo, MAX.ammo + 4), health: make(health, MAX.health + 4), cash: make(bundle, (MAX.cash + 4) * 3), word: make(word, MAX.word + 4) };
    this.weaponModels = (models && models.weapons) || {};
    const ring = new THREE.RingGeometry(0.42, 0.58, 40).rotateX(-Math.PI / 2);
    this.rings = new THREE.InstancedMesh(ring, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }), 200);
    this.rings.count = 0; this.rings.frustumCulled = false;
    this.rings.setColorAt(0, this.c.set(0xffffff));
    this.g.scene.add(this.rings);
  }

  count(kind) { let n = 0; for (const it of this.list) if (it.kind === kind && !it.dropped) n++; return n; }
  get pvp() { return !!(this.g.pvp && this.g.pvp.on); }
  max(kind) { return (this.pvp ? PVP_MAX : MAX)[kind] || 0; }

  // A free spot on the ground inside the complex (or, sometimes, on a roof with stairs).
  randomSpot(minFromPlayer, roofChance = 0.18, kind = null) {
    const g = this.g, p = g.player.pos, [x0, y0, x1, y1] = this.bounds;
    const far = (x, z) => (g.players || [g.player]).every((q) => Math.hypot(x - q.pos.x, z - q.pos.z) >= minFromPlayer);
    if (Math.random() < roofChance && g.stairs && g.stairs.list.length) {
      const s = g.stairs.list[Math.floor(Math.random() * g.stairs.list.length)];
      for (let k = 0; k < 20; k++) {
        const a = Math.random() * Math.PI * 2, d = 3 + Math.random() * 5;
        const x = s.roof.x + Math.cos(a) * d, z = s.roof.z + Math.sin(a) * d;
        const r = g.player.roofObj(x, z);
        if (!r || r.stair !== s) continue;
        const q = { x, z };
        if (g.colliders.resolve(q, 0.9, s.top + 0.1, s.top + 1.2, 1)) continue;
        if (this.list.some((it) => Math.hypot(it.x - x, it.z - z) < (it.kind === kind ? 20 : 6))) continue;
        return { x, z, y: s.top };
      }
    }
    if (Math.random() < 0.12 && g.underground) {
      const spot = g.underground.randomSpot(this.list);
      if (spot && Math.hypot(spot.x - p.x, spot.z - p.z) >= minFromPlayer && far(spot.x, spot.z)
        && !this.list.some((it) => it.kind === kind && Math.hypot(it.x - spot.x, it.z - spot.z) < 20)) return spot;
    }
    // (the best of a dozen good spots: the one furthest from what's lying about already, those of
    // its own kind most, so they spread evenly over the complex instead of bunching up)
    let best = null, bestScore = -1, found = 0;
    for (let k = 0; k < 400 && found < 14; k++) {
      const mx = x0 + Math.random() * (x1 - x0), my = y0 + Math.random() * (y1 - y0);
      if (!pointInPoly(mx, my, g.level.play.outer)) continue;
      const x = mx, z = -my;
      const nav = g.nav;
      if (!nav.walkable(x, z) || !nav.walkable(x + 1, z) || !nav.walkable(x - 1, z) || !nav.walkable(x, z + 1) || !nav.walkable(x, z - 1)) continue;
      if (Math.hypot(x - p.x, z - p.z) < minFromPlayer || !far(x, z)) continue;
      if (this.list.some((it) => Math.hypot(it.x - x, it.z - z) < 8)) continue;
      if (g.director && g.director.stations.some((st) => Math.hypot(st.x - x, st.z - z) < 5)) continue;
      const y = g.hm.atWorld(x, z);
      if (y < -0.5) continue; // ramps, pools
      found++;
      let mine = 200, any = 200;
      for (const it of this.list) {
        const d = Math.hypot(it.x - x, it.z - z);
        any = Math.min(any, d);
        if (it.kind === kind) mine = Math.min(mine, d);
      }
      const score = mine + any * 0.5;
      if (score > bestScore) { bestScore = score; best = { x, z, y }; }
    }
    return best;
  }

  spawn(kind, spot, gun = null, extra = null) {
    const tough = this.g.director ? this.g.director.toughness() : 1;
    const amount = kind === 'cash' ? 50 * Math.round((2 + Math.floor(Math.random() * Math.random() * 5)) * tough)
      : kind === 'gun' ? gunIndex(gun || (this.pvp ? pick(PVP_GUNS) : pickGun())) : 0;
    const it = { id: this.seq = (this.seq || 0) + 1, kind, x: spot.x, y: spot.y, z: spot.z, phase: Math.random() * 6.28, amount, t: 0, ...extra };
    this.list.push(it);
    if (this.g.mode === 'host') this.g.net.pickupAdd(it);
    return it;
  }

  // a player died here: the guns they'd bought or found, in a ring round the spot, for anyone
  // (for two minutes; the host's, or told of a client's)
  drop(pos, keys) {
    const g = this.g;
    keys.forEach((key, i) => {
      const a = (i / keys.length) * Math.PI * 2 + Math.random() * 0.5, r = keys.length > 1 ? 1.3 : 0.4;
      const q = { x: pos.x + Math.cos(a) * r, z: pos.z + Math.sin(a) * r };
      g.colliders.resolve(q, 0.4, pos.y + 0.1, pos.y + 1.2, 2);
      const it = this.spawn('gun', { x: q.x, y: pos.y, z: q.z }, key);
      it.dropped = true; it.ttl = 120;
    });
  }

  // PvP: the armories (made once a match), each gun back in its place a few seconds after it's
  // taken; ammo and first aid about the place, topped up (away from everyone)
  stock(dt) {
    if (!this.pvp || this.g.mode === 'client') return;
    if (!this.armories) this.buildArmories();
    this.armories.forEach((a, arm) => {
      for (const s of a.slots) {
        if (s.item || this.t < s.back) continue;
        s.item = this.spawn('gun', { x: s.x, y: a.y, z: s.z }, s.gun, { yaw: a.yaw, arm });
        s.item.slot = s;
      }
    });
    this.stockT = (this.stockT ?? 0) - dt;
    if (this.stockT > 0) return;
    this.stockT = 4;
    for (const kind of ['ammo', 'health']) {
      if (this.count(kind) >= this.max(kind)) continue;
      const spot = this.randomSpot(18, 0.18, kind);
      if (spot) this.spawn(kind, spot);
    }
  }

  // Four armories, one in each quarter of the complex: the open, flat piece of ground nearest the
  // middle of the quarter with room for the whole grid (either way round), clear of buildings,
  // walls, shops and the rest.
  buildArmories() {
    const g = this.g, [x0, y0, x1, y1] = this.bounds, rows = Math.ceil(ARMORY.length / ARMORY_COLS);
    const w = (ARMORY_COLS - 1) * ARMORY_GAP, d = (rows - 1) * ARMORY_GAP;
    this.armories = [];
    const cells = (cx, cz, yaw) => {
      const c = Math.cos(yaw), s = Math.sin(yaw), out = [];
      for (let i = 0; i < ARMORY.length; i++) {
        const u = (i % ARMORY_COLS) * ARMORY_GAP - w / 2, v = Math.floor(i / ARMORY_COLS) * ARMORY_GAP - d / 2;
        out.push({ x: cx + u * c - v * s, z: cz + u * s + v * c, gun: ARMORY[i] });
      }
      return out;
    };
    const fits = (cx, cz, yaw) => {
      const y = g.hm.atWorld(cx, cz);
      if (y < -0.5) return null;
      const pad = cells(cx, cz, yaw);
      // (the grid and a metre and a half round it: walkable, level, nothing in the way)
      for (const q of [...pad, ...cells(cx, cz, yaw).map((q) => ({ x: cx + (q.x - cx) * 1.45, z: cz + (q.z - cz) * 1.45 }))]) {
        if (!pointInPoly(q.x, -q.z, g.level.play.outer) || !g.nav.walkable(q.x, q.z) || Math.abs(g.hm.atWorld(q.x, q.z) - y) > 0.35) return null;
        if (g.colliders.resolve({ x: q.x, z: q.z }, 0.7, y + 0.1, y + 1.6, 1)) return null;
      }
      if (g.director && g.director.stations.some((st) => Math.hypot(st.x - cx, st.z - cz) < 9)) return null;
      return { y, slots: pad };
    };
    for (const [qx, qz] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
      const mx = x0 + (x1 - x0) * qx, mz = -(y0 + (y1 - y0) * qz);
      let best = null;
      for (let k = 0; k < 900 && !(best && k > 300); k++) {
        const r = 4 + Math.sqrt(k) * 3.2, a = k * 2.399;   // (a spiral out from the middle of the quarter)
        const cx = mx + Math.cos(a) * r, cz = mz + Math.sin(a) * r;
        for (const yaw of [0, Math.PI / 2]) {
          const f = fits(cx, cz, yaw);
          if (f && (!best || r < best.r) && !this.armories.some((o) => Math.hypot(o.x - cx, o.z - cz) < 60)) best = { r, x: cx, z: cz, yaw, ...f };
        }
      }
      if (best) this.armories.push({ x: best.x, z: best.z, y: best.y, yaw: best.yaw, slots: best.slots.map((q) => ({ ...q, item: null, back: 0 })) });
    }
  }

  // co-op client: the host's loot, [id, kind, x, y, z, amount]
  add([id, kind, x, y, z, amount, yaw = null, arm = null]) {
    if (this.list.some((it) => it.id === id)) return;
    this.list.push({ id, kind, x, y, z, amount, phase: Math.random() * 6.28, t: 0, yaw, arm });
  }
  // (on the wire: [id, kind, x, y, z, amount, yaw, armory])
  static wire(it) { return [it.id, it.kind, +it.x.toFixed(2), +it.y.toFixed(2), +it.z.toFixed(2), it.amount, it.yaw ?? null, it.arm ?? null]; }

  // a gun on the ground: its own model, laid flat (made the first time it's drawn)
  gunMesh(it) {
    if (it.mesh) return it.mesh;
    const key = GUNS[it.amount] ? GUNS[it.amount][0] : 'deagle';
    const src = this.weaponModels[GUN_MODEL[key]];
    const holder = new THREE.Group();
    const built = !src && groundGun(key);   // (the ones made in code: the AK, the Makarov, the SVD, the laser)
    if (src || built) {
      const m = src ? src.scene.clone(true) : built;
      m.traverse((o) => { if (o.isMesh) { o.castShadow = true; if (o.isSkinnedMesh) o.frustumCulled = false; } });
      // laid on its side: its thinnest way up
      const lay = new THREE.Group();
      lay.add(m);
      const s0 = new THREE.Box3().setFromObject(m).getSize(new THREE.Vector3());
      if (s0.x <= s0.y && s0.x <= s0.z) lay.rotation.z = Math.PI / 2;
      else if (s0.z <= s0.y) lay.rotation.x = Math.PI / 2;
      lay.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(lay), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
      const k = (key === 'mg' || key === 'autosniper' || key === 'msr' || key === 'sniper' || key === 'launcher' ? 1.05 : key === 'bow' ? 1.0 : key === 'deagle' || key === 'pistol' ? 0.42 : 0.85) / Math.max(size.x, size.y, size.z);
      lay.scale.setScalar(k);
      lay.position.copy(c).multiplyScalar(-k);
      holder.add(lay);
    } else holder.add(new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.12, 0.08), new THREE.MeshStandardMaterial({ color: 0x2a2a2a })));
    this.g.scene.add(holder);
    it.mesh = holder;
    it.gun = key;
    return holder;
  }

  dropMesh(it) { if (it.mesh) { it.mesh.removeFromParent(); it.mesh = null; } }

  // what a gun on the ground gives: the gun, or (if you have it) its ammo
  takeGun(key) {
    const g = this.g, w = g.weapons, def = DEFS[key];
    if (!def) return;
    if (!w.owned[key]) { w.give(key); g.hud.notice(`Found a ${def.name}!`); g.audio.play('buy', { vol: 0.9 }); return; }
    const a = w.owned[key];
    a.mag = def.mag; a.reserve = w.reserveCap(key);
    w.hudWeapon();
    g.hud.notice(`${def.short}: full of ammo again`);
    g.audio.play('pickup', { vol: 0.9 });
  }

  // co-op client: someone took one (if it was us: the ammo goes in our pockets)
  taken(id, mine, kind, amount) {
    const i = this.list.findIndex((it) => it.id === id);
    if (i >= 0) { this.dropMesh(this.list[i]); this.list.splice(i, 1); }
    if (!mine) return;
    const g = this.g;
    if (kind === 'ammo') { g.weapons.topUp(); g.hud.notice('Ammo can: spare magazines and a grenade'); g.audio.play('pickup', { vol: 0.9 }); }
    else if (kind === 'health') { g.hud.notice('First aid kit: +50 health'); g.audio.play('heal', { vol: 0.9 }); }
    else if (kind === 'gun') this.takeGun(GUNS[amount] ? GUNS[amount][0] : 'deagle');
    else if (kind === 'word') g.training?.crate();
    else { g.hud.notice(`${amount} lari (+${amount} points)`); g.audio.play('cash', { vol: 0.9 }); }
  }

  // co-op host: a client's player walked over one
  collectRemote(it, p) {
    const g = this.g;
    if (it.kind === 'health') {
      if (p.health >= p.maxHealth - 0.5) return false;
      p.health = Math.min(p.maxHealth, p.health + 50);
    } else if (it.kind === 'cash') g.director.addPoints(it.amount, false, p.slot);
    return true;
  }

  // top every kind back up to its count, away from the player
  replenish(minFromPlayer = 25) {
    for (const kind of Object.keys(MAX)) {
      if (kind === 'word' && !(this.g.training && this.g.training.on && !this.g.pvp?.on)) continue;
      for (let n = this.count(kind); n < this.max(kind); n++) {
        const spot = this.randomSpot(minFromPlayer, 0.18, kind);
        if (!spot) break;
        this.spawn(kind, spot);
      }
    }
  }

  clear() { for (const it of this.list) this.dropMesh(it); this.list.length = 0; this.armories = null; }

  // during a wave, every half a minute or so: one more thing somewhere (where the loot is real)
  trickle(dt) {
    const g = this.g;
    if (g.mode === 'client' || !g.director || g.director.state !== 'active') return;
    this.trickleT = (this.trickleT ?? 30) - dt;
    if (this.trickleT > 0) return;
    this.trickleT = 30 + Math.random() * 20;
    // (with the brain training on, one in five is a puzzle crate; the rest as ever)
    let r = Math.random(), kind = null;
    if (this.g.training && this.g.training.on && !this.g.pvp?.on) { if (r < 0.2) kind = 'word'; else r = (r - 0.2) / 0.8; }
    kind = kind || (r < 0.35 ? 'cash' : r < 0.65 ? 'ammo' : r < 0.8 ? 'health' : this.pvp ? 'ammo' : 'gun');   // (PvP's guns are at the armories)
    const spot = this.count(kind) < this.max(kind) + 3 && this.randomSpot(20, 0.18, kind);
    if (!spot) return;
    this.spawn(kind, spot);
    if (kind === 'gun') { g.hud.notice('A gun turned up somewhere: check the map (M)'); g.net?.notice?.('A gun turned up somewhere: check the map (M)'); }
  }

  collect(it) {
    const g = this.g, pl = g.player;
    if (it.kind === 'word') {
      if (g.training && g.training.open) return false;   // (one at a time)
      g.training?.crate();
      g.audio.play('pickup', { vol: 0.8, rate: 1.2 });
      return true;
    }
    if (it.kind === 'ammo') {
      if (!g.weapons.topUp()) return false;
      g.hud.notice('Ammo can: spare magazines and a grenade');
      g.audio.play('pickup', { vol: 0.9 });
    } else if (it.kind === 'health') {
      if (pl.health >= pl.maxHealth - 0.5) return false;
      pl.health = Math.min(pl.maxHealth, pl.health + 50);
      g.hud.notice('First aid kit: +50 health');
      g.audio.play('heal', { vol: 0.9 });
    } else if (it.kind === 'gun') {
      this.takeGun(GUNS[it.amount] ? GUNS[it.amount][0] : 'deagle');
    } else {
      g.director.addPoints(it.amount);
      g.hud.notice(`${it.amount} lari (+${it.amount} points)`);
      g.audio.play('cash', { vol: 0.9 });
    }
    return true;
  }

  update(dt) {
    if (!this.meshes) return;
    const g = this.g;
    this.t += dt;
    const counts = { ammo: 0, health: 0, cash: 0, word: 0 };
    let rings = 0;
    this.trickle(dt);
    this.stock(dt);
    // (a co-op client only draws them: the host says who took what)
    const players = g.mode === 'client' ? [] : g.players || [g.player];
    for (let i = this.list.length - 1; i >= 0; i--) {
      const it = this.list[i];
      it.t += dt;
      // (a dropped gun nobody took goes after a while)
      if (it.ttl && it.t > it.ttl && g.mode !== 'client') {
        this.list.splice(i, 1); this.dropMesh(it);
        if (g.mode === 'host') g.net.pickupGone(it, -1);
        continue;
      }
      for (const p of players) {
        if (p.dead || Math.abs(it.x - p.pos.x) >= 1.25 || Math.abs(it.z - p.pos.z) >= 1.25 || Math.abs(it.y - p.pos.y) >= 1.7) continue;
        if (!(p === g.player ? this.collect(it) : this.collectRemote(it, p))) continue;
        if (it.slot) { it.slot.item = null; it.slot.back = this.t + ARMORY_BACK; }   // (an armory's: back soon)
        this.list.splice(i, 1);
        this.dropMesh(it);
        if (g.mode === 'host') g.net.pickupGone(it, p === g.player ? g.localSlot ?? 0 : p.slot);
        break;
      }
    }
    for (const it of this.list) {
      const spin = this.t * 1.1 + it.phase, y = it.y + 0.45 + Math.sin(this.t * 2.2 + it.phase) * 0.05;
      const im = this.meshes[it.kind];
      if (it.kind === 'gun') {
        // lying across the ring, turning slowly
        const m = this.gunMesh(it);
        m.position.set(it.x, y + 0.05, it.z);
        m.rotation.set(0, it.yaw != null ? it.yaw : spin * 0.6, 0);   // (an armory's lie in rows)
        // (only the near ones drawn: an armory's eighteen are a lot of guns)
        const cam = g.camera.position;
        m.visible = Math.abs(cam.x - it.x) + Math.abs(cam.z - it.z) < 110;
      } else if (it.kind === 'cash') {
        // three bundles: two side by side and one across the top
        const layout = [[-0.085, 0, 0], [0.085, 0, 0], [0, 0.056, Math.PI / 2]];
        for (const [ox, oy, r] of layout) {
          const c = Math.cos(spin), s = Math.sin(spin);
          this.e.set(0, spin + r + Math.PI / 2, 0);
          this.q.setFromEuler(this.e);
          this.m4.compose(this.v.set(it.x + ox * c, y + oy, it.z - ox * s), this.q, this.s.set(1, 1, 1));
          im.setMatrixAt(counts.cash++, this.m4);
        }
      } else {
        this.e.set(0, spin, 0);
        this.q.setFromEuler(this.e);
        this.m4.compose(this.v.set(it.x, y, it.z), this.q, this.s.set(1, 1, 1));
        im.setMatrixAt(counts[it.kind]++, this.m4);
      }
      const pulse = 1 + Math.sin(this.t * 3 + it.phase) * 0.08;
      this.q.identity();
      this.m4.compose(this.v.set(it.x, it.y + 0.06, it.z), this.q, this.s.set(pulse, 1, pulse));
      this.rings.setMatrixAt(rings, this.m4);
      this.rings.setColorAt(rings, this.c.setHex(RING[it.kind]));
      rings++;
    }
    for (const [k, im] of Object.entries(this.meshes)) { im.count = counts[k]; im.instanceMatrix.needsUpdate = true; }
    this.rings.count = rings;
    this.rings.instanceMatrix.needsUpdate = true;
    if (this.rings.instanceColor) this.rings.instanceColor.needsUpdate = true;
  }

  // (an armory is one mark on the map, not eighteen)
  markers() {
    const m = [], arms = new Map();
    for (const it of this.list) {
      if (it.arm == null) { m.push({ x: it.x, z: it.z, color: PICKUP_COLORS[it.kind], size: 0.8, icon: it.kind }); continue; }
      const a = arms.get(it.arm) || { x: 0, z: 0, n: 0 };
      a.x += it.x; a.z += it.z; a.n++; arms.set(it.arm, a);
    }
    for (const a of arms.values()) m.push({ x: a.x / a.n, z: a.z / a.n, color: PICKUP_COLORS.gun, icon: 'gun', station: true, label: 'Armory' });
    return m;
  }
}
