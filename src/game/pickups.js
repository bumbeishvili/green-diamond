import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { pointInPoly } from '../world/geom.js';

// Loot lying around the complex: ammo cans, first-aid kits and bundles of lari. They float over a
// glowing ring; walk (or drive) over one to take it. More turn up away from you every wave,
// a few of them on the roofs (take the stairs).
const MAX = { ammo: 7, health: 6, cash: 9 };
export const PICKUP_COLORS = { ammo: '#9bd35a', health: '#ff6b6b', cash: '#ffe066' };
const RING = { ammo: 0x7fd13a, health: 0xff4a4a, cash: 0xffc93a };

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
    this.meshes = { ammo: make(ammo, MAX.ammo + 4), health: make(health, MAX.health + 4), cash: make(bundle, (MAX.cash + 4) * 3) };
    const ring = new THREE.RingGeometry(0.42, 0.58, 40).rotateX(-Math.PI / 2);
    this.rings = new THREE.InstancedMesh(ring, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }), MAX.ammo + MAX.health + MAX.cash + 12);
    this.rings.count = 0; this.rings.frustumCulled = false;
    this.rings.setColorAt(0, this.c.set(0xffffff));
    this.g.scene.add(this.rings);
  }

  count(kind) { let n = 0; for (const it of this.list) if (it.kind === kind) n++; return n; }

  // A free spot on the ground inside the complex (or, sometimes, on a roof with stairs).
  randomSpot(minFromPlayer, roofChance = 0.18) {
    const g = this.g, p = g.player.pos, [x0, y0, x1, y1] = this.bounds;
    if (Math.random() < roofChance && g.stairs && g.stairs.list.length) {
      const s = g.stairs.list[Math.floor(Math.random() * g.stairs.list.length)];
      for (let k = 0; k < 20; k++) {
        const a = Math.random() * Math.PI * 2, d = 3 + Math.random() * 5;
        const x = s.roof.x + Math.cos(a) * d, z = s.roof.z + Math.sin(a) * d;
        const r = g.player.roofObj(x, z);
        if (!r || r.stair !== s) continue;
        const q = { x, z };
        if (g.colliders.resolve(q, 0.9, s.top + 0.1, s.top + 1.2, 1)) continue;
        if (this.list.some((it) => Math.hypot(it.x - x, it.z - z) < 6)) continue;
        return { x, z, y: s.top };
      }
    }
    if (Math.random() < 0.12 && g.underground) {
      const spot = g.underground.randomSpot(this.list);
      if (spot && Math.hypot(spot.x - p.x, spot.z - p.z) >= minFromPlayer) return spot;
    }
    for (let k = 0; k < 300; k++) {
      const mx = x0 + Math.random() * (x1 - x0), my = y0 + Math.random() * (y1 - y0);
      if (!pointInPoly(mx, my, g.level.play.outer)) continue;
      const x = mx, z = -my;
      const nav = g.nav;
      if (!nav.walkable(x, z) || !nav.walkable(x + 1, z) || !nav.walkable(x - 1, z) || !nav.walkable(x, z + 1) || !nav.walkable(x, z - 1)) continue;
      if (Math.hypot(x - p.x, z - p.z) < minFromPlayer) continue;
      if (this.list.some((it) => Math.hypot(it.x - x, it.z - z) < 14)) continue;
      if (g.director && g.director.stations.some((st) => Math.hypot(st.x - x, st.z - z) < 5)) continue;
      const y = g.hm.atWorld(x, z);
      if (y < -0.5) continue; // ramps, pools
      return { x, z, y };
    }
    return null;
  }

  spawn(kind, spot) {
    const amount = kind === 'cash' ? 50 * (2 + Math.floor(Math.random() * Math.random() * 5)) : 0;
    this.list.push({ kind, x: spot.x, y: spot.y, z: spot.z, phase: Math.random() * 6.28, amount, t: 0 });
  }

  // top every kind back up to its count, away from the player
  replenish(minFromPlayer = 25) {
    for (const kind of Object.keys(MAX)) {
      for (let n = this.count(kind); n < MAX[kind]; n++) {
        const spot = this.randomSpot(minFromPlayer);
        if (!spot) break;
        this.spawn(kind, spot);
      }
    }
  }

  clear() { this.list.length = 0; }

  collect(it) {
    const g = this.g, pl = g.player;
    if (it.kind === 'ammo') {
      if (!g.weapons.topUp()) return false;
      g.hud.notice('Ammo can: spare magazines and a grenade');
      g.audio.play('pickup', { vol: 0.9 });
    } else if (it.kind === 'health') {
      if (pl.health >= pl.maxHealth - 0.5) return false;
      pl.health = Math.min(pl.maxHealth, pl.health + 50);
      g.hud.notice('First aid kit: +50 health');
      g.audio.play('heal', { vol: 0.9 });
    } else {
      g.director.addPoints(it.amount);
      g.hud.notice(`${it.amount} lari (+${it.amount} points)`);
      g.audio.play('cash', { vol: 0.9 });
    }
    return true;
  }

  update(dt) {
    if (!this.meshes) return;
    const g = this.g, p = g.player;
    this.t += dt;
    const counts = { ammo: 0, health: 0, cash: 0 };
    let rings = 0;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const it = this.list[i];
      it.t += dt;
      if (!p.dead && Math.abs(it.x - p.pos.x) < 1.25 && Math.abs(it.z - p.pos.z) < 1.25 && Math.abs(it.y - p.pos.y) < 1.7 && this.collect(it)) {
        this.list.splice(i, 1);
        continue;
      }
    }
    for (const it of this.list) {
      const spin = this.t * 1.1 + it.phase, y = it.y + 0.45 + Math.sin(this.t * 2.2 + it.phase) * 0.05;
      const im = this.meshes[it.kind];
      if (it.kind === 'cash') {
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

  markers() { return this.list.map((it) => ({ x: it.x, z: it.z, color: PICKUP_COLORS[it.kind], size: 0.8 })); }
}
