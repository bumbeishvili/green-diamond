import * as THREE from 'three';

// What a crash leaves behind, and the pieces a car loses.
//  - chips: small bits of paint, plastic and glass (instanced), bouncing and settling
//  - parts: real pieces cut out of the car (bumpers, wheels): they tumble, bounce, roll, lie down
//  - sparks: additive particles where metal meets the wall or scrapes along the road
//  - skid marks: dark strips laid under the tyres while they slide
//  - dents: the body pushed in around the point of impact, creased where it bent
// Everything here is looks only: the physics of the car itself is in vehicles.js.

const UP = new THREE.Vector3(0, 1, 0);
const tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpM = new THREE.Matrix4();

// --- sparks: a small additive particle system (the main one blends, sparks should glow) ---
class Sparks {
  constructor(scene, N = 480) {
    this.N = N; this.cursor = 0;
    this.pos = new Float32Array(N * 3); this.vel = new Float32Array(N * 3);
    this.life = new Float32Array(N); this.maxLife = new Float32Array(N); this.size = new Float32Array(N);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aLife', new THREE.BufferAttribute(new Float32Array(N), 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uScale: { value: 400 } },
      vertexShader: /* glsl */`
        attribute float aLife; attribute float aSize; varying float vLife;
        uniform float uScale;
        void main() {
          vLife = aLife;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aLife > 0.0 ? aSize * uScale / -mv.z : 0.0;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        varying float vLife;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.0, length(d)) * vLife;
          if (a < 0.02) discard;
          // white-hot when fresh, orange as it cools
          vec3 c = mix(vec3(1.0, 0.35, 0.05), vec3(1.0, 0.92, 0.6), vLife);
          gl_FragColor = vec4(c * 1.6, a);
        }`,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  emit(p, n, dir, speed = 6) {
    for (let k = 0; k < n; k++) {
      const i = this.cursor++ % this.N;
      this.pos.set([p.x, p.y, p.z], i * 3);
      const s = speed * (0.35 + Math.random() * 0.9);
      this.vel.set([
        (dir.x + (Math.random() - 0.5) * 1.2) * s,
        (Math.abs(dir.y) + 0.25 + Math.random() * 0.9) * s * 0.6,
        (dir.z + (Math.random() - 0.5) * 1.2) * s,
      ], i * 3);
      this.maxLife[i] = this.life[i] = 0.18 + Math.random() * 0.45;
      this.size[i] = 0.025 + Math.random() * 0.035;
    }
  }

  update(dt, groundAt) {
    const life = this.points.geometry.attributes.aLife.array;
    for (let i = 0; i < this.N; i++) {
      if (this.life[i] <= 0) { life[i] = 0; continue; }
      this.life[i] -= dt;
      const j = i * 3;
      this.vel[j + 1] -= 11 * dt;
      this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
      // skip off the road once
      if (this.vel[j + 1] < 0 && this.pos[j + 1] < groundAt(this.pos[j], this.pos[j + 2], this.pos[j + 1] + 0.3) + 0.02) {
        this.vel[j + 1] *= -0.35; this.vel[j] *= 0.6; this.vel[j + 2] *= 0.6;
      }
      life[i] = Math.max(0, this.life[i] / this.maxLife[i]);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.aLife.needsUpdate = true; g.attributes.aSize.needsUpdate = true;
  }
}

// --- chips: instanced little boxes ---
class Chips {
  constructor(scene, N = 260) {
    this.N = N; this.cursor = 0;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.35 }), N);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.items = Array.from({ length: N }, () => ({ on: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3(), s: new THREE.Vector3(), life: 0, rest: false }));
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < N; i++) { this.mesh.setMatrixAt(i, zero); this.mesh.setColorAt(i, new THREE.Color(0)); }
    scene.add(this.mesh);
  }

  emit(p, n, vel, color, { size = 0.08, speed = 3, glass = false } = {}) {
    const c = new THREE.Color();
    for (let k = 0; k < n; k++) {
      const i = this.cursor++ % this.N, it = this.items[i];
      it.on = true; it.rest = false; it.life = 18 + Math.random() * 10;
      it.pos.set(p.x + (Math.random() - 0.5) * 0.4, p.y + Math.random() * 0.3, p.z + (Math.random() - 0.5) * 0.4);
      it.vel.set(vel.x + (Math.random() - 0.5) * speed * 2, vel.y + Math.random() * speed * 1.2 + 1, vel.z + (Math.random() - 0.5) * speed * 2);
      it.q.setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6));
      it.w.set((Math.random() - 0.5) * 24, (Math.random() - 0.5) * 24, (Math.random() - 0.5) * 24);
      const s = size * (0.5 + Math.random());
      if (glass) it.s.set(s * 0.8, s * 0.12, s * 0.6); else it.s.set(s * (1 + Math.random()), s * 0.3, s * (0.6 + Math.random() * 0.6));
      c.set(color);
      if (!glass) c.multiplyScalar(0.8 + Math.random() * 0.35);
      this.mesh.setColorAt(i, c);
    }
    this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt, groundAt) {
    let any = false;
    for (let i = 0; i < this.N; i++) {
      const it = this.items[i];
      if (!it.on) continue;
      any = true;
      it.life -= dt;
      if (!it.rest) {
        it.vel.y -= 9.8 * dt;
        it.pos.addScaledVector(it.vel, dt);
        tmpQ.setFromAxisAngle(tmpV.copy(it.w).normalize(), it.w.length() * dt);
        it.q.premultiply(tmpQ);
        const gy = groundAt(it.pos.x, it.pos.z, it.pos.y + 0.4) + it.s.y * 0.5;
        if (it.pos.y < gy) {
          it.pos.y = gy;
          if (it.vel.y < -1) { it.vel.y *= -0.3; it.vel.x *= 0.55; it.vel.z *= 0.55; it.w.multiplyScalar(0.5); }
          else {
            it.vel.set(0, 0, 0); it.rest = true;
            // lie flat
            const e = new THREE.Euler().setFromQuaternion(it.q, 'YXZ');
            it.q.setFromEuler(new THREE.Euler(0, e.y, 0, 'YXZ'));
          }
        }
      }
      const fade = it.life < 1 ? Math.max(0, it.life) : 1;
      tmpM.compose(it.pos, it.q, tmpV.copy(it.s).multiplyScalar(fade));
      this.mesh.setMatrixAt(i, tmpM);
      if (it.life <= 0) it.on = false;
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// --- skid marks: a ring of dark strips on the road ---
class Skids {
  constructor(scene, N = 900) {
    this.N = N; this.cursor = 0;
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0x0c0c0c, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.mesh = new THREE.InstancedMesh(geo, mat, N);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < N; i++) this.mesh.setMatrixAt(i, zero);
    scene.add(this.mesh);
    this.e = new THREE.Euler(0, 0, 0, 'YXZ');
  }

  // a strip from a to b (world), width w
  add(a, b, w = 0.22) {
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
    if (len < 0.05) return;
    const i = this.cursor++ % this.N;
    this.e.set(0, Math.atan2(-dz, dx), 0);
    tmpQ.setFromEuler(this.e);
    tmpV.set((a.x + b.x) / 2, Math.max(a.y, b.y) + 0.025, (a.z + b.z) / 2);
    tmpM.compose(tmpV, tmpQ, new THREE.Vector3(len + 0.04, 1, w));
    this.mesh.setMatrixAt(i, tmpM);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// --- the pieces of a car ---

// Triangles of a geometry whose centroid (in the car's frame, via m) passes test(x, y, z, tri).
function classify(geo, m, test) {
  const P = geo.attributes.position, idx = geo.index, n = idx ? idx.count / 3 : P.count / 3;
  const out = new Int8Array(n).fill(-1);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let t = 0; t < n; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3, i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    a.fromBufferAttribute(P, i0); b.fromBufferAttribute(P, i1); c.fromBufferAttribute(P, i2);
    a.add(b).add(c).multiplyScalar(1 / 3);
    if (m) a.applyMatrix4(m);
    out[t] = test(a.x, a.y, a.z, [i0, i1, i2]);
  }
  return out;
}

// A new geometry with only the triangles of geo marked `which` in cls (compact, own buffers).
function subGeometry(geo, cls, which) {
  const idx = geo.index, attrs = Object.keys(geo.attributes);
  const tris = [];
  for (let t = 0; t < cls.length; t++) if (cls[t] === which) tris.push(t);
  if (!tris.length) return null;
  const remap = new Map(), order = [];
  const index = [];
  for (const t of tris) {
    for (let k = 0; k < 3; k++) {
      const vi = idx ? idx.getX(t * 3 + k) : t * 3 + k;
      let ni = remap.get(vi);
      if (ni === undefined) { ni = order.length; remap.set(vi, ni); order.push(vi); }
      index.push(ni);
    }
  }
  const g = new THREE.BufferGeometry();
  for (const k of attrs) {
    const src = geo.attributes[k], size = src.itemSize;
    const arr = new src.array.constructor(order.length * size);
    for (let i = 0; i < order.length; i++) for (let s = 0; s < size; s++) arr[i * size + s] = src.array[order[i] * size + s];
    g.setAttribute(k, new THREE.BufferAttribute(arr, size, src.normalized));
  }
  g.setIndex(index);
  return g;
}

export class Crashes {
  constructor(game) {
    this.g = game;
    const scene = game.scene;
    this.sparks = new Sparks(scene);
    this.chips = new Chips(scene);
    this.skids = new Skids(scene);
    this.parts = [];                  // detached pieces flying about / lying around
    this.loops = new Map();           // vehicle -> {screech, scrape} sound nodes
  }

  groundAt = (x, z, y) => this.g.groundAt(x, z, y);

  // --- cutting a car into its breakable pieces (the first time it takes a real hit) ---
  //
  // Everything in the vehicle's own frame: +x is the model's +x (its nose when fwdSign = 1), y up,
  // z to the right. Bumpers: the last 30 cm at either end, below the bonnet line. Wheels: the
  // detailed cars have their own; the parked cars' come out of the merged mesh (tagged at load).
  prepare(v) {
    if (v.pieces) return v.pieces;
    const pieces = v.pieces = {};
    v.mesh.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(v.mesh.matrixWorld).invert();
    // the car's size along its own axes
    const box = new THREE.Box3();
    v.mesh.traverse((o) => {
      if (!o.isMesh || !o.geometry.attributes.position) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
      box.union(o.geometry.boundingBox.clone().applyMatrix4(m));
    });
    v.box = box;
    const front = v.fwdSign < 0 ? -1 : 1;
    const xF = front > 0 ? box.max.x : box.min.x, xR = front > 0 ? box.min.x : box.max.x;
    const bumperY = box.min.y + (box.max.y - box.min.y) * 0.5;
    const halfW = (box.max.z - box.min.z) / 2, zc = (box.max.z + box.min.z) / 2;
    const L = box.max.x - box.min.x;
    const wheelX = L / 2 - Math.max(0.7, L * 0.2);
    const which = (x, y, z, w) => {
      // (w: this triangle belongs to a wheel; left is -z, or +z on a model that faces backwards)
      if (w) { const left = (z - zc) * front < 0; return x * front > 0 ? (left ? 2 : 3) : (left ? 4 : 5); }
      if (y < bumperY) {
        if ((x - xF) * front > -0.34) return 0;
        if ((x - xR) * front < 0.34) return 1;
      }
      return -1;
    };
    const names = ['bumperF', 'bumperR', 'wheelFL', 'wheelFR', 'wheelRL', 'wheelRR'];

    // the dentable meshes: everything but the wheels and the cabin
    v.dentable = [];
    const cut = (o, isLot) => {
      const geo = o.geometry;
      const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
      const wheelAttr = geo.attributes.aWheel;
      const cls = classify(geo, m, (x, y, z, tri) => {
        let w = false;
        if (isLot) {
          if (wheelAttr) w = wheelAttr.getX(tri[0]) > 0.5;
          else w = y < 0.75 && Math.abs(Math.abs(x) - wheelX) < 0.5 && Math.abs(z - zc) > halfW - 0.42;
        }
        return which(x, y, z, w);
      });
      // the body keeps the rest (its own copy of positions and normals, so dents stay on this car)
      const keep = subGeometry(geo, cls, -1);
      for (let k = 0; k < names.length; k++) {
        const pg = subGeometry(geo, cls, k);
        if (!pg) continue;
        let piece = pieces[names[k]];
        if (!piece) {
          piece = pieces[names[k]] = new THREE.Group();
          piece.name = names[k];
          v.mesh.add(piece);
        }
        const pm = o.isInstancedMesh ? new THREE.InstancedMesh(pg, o.material, 1) : new THREE.Mesh(pg, o.material);
        if (o.isInstancedMesh) { pm.setMatrixAt(0, new THREE.Matrix4()); pm.setColorAt(0, o.instanceColor ? new THREE.Color().fromArray(o.instanceColor.array) : new THREE.Color(1, 1, 1)); pm.frustumCulled = false; }
        pm.castShadow = pm.receiveShadow = true;
        pm.matrixAutoUpdate = false; pm.matrix.copy(m); pm.matrixWorldNeedsUpdate = true;
        piece.add(pm);
        if (!/wheel/.test(names[k])) v.dentable.push(pm);
      }
      if (keep) { o.geometry = keep; v.dentable.push(o); } else o.visible = false;
    };
    if (v.hero) {
      // the detailed cars: their wheels are separate already; bumpers come off the body, lights and plates
      v.wheels.forEach((w) => { const k = { Wheel_FL: 'wheelFL', Wheel_FR: 'wheelFR', Wheel_RL: 'wheelRL', Wheel_RR: 'wheelRR' }[w.name]; if (k) pieces[k] = w; });
      const meshes = [];
      v.mesh.traverse((o) => { if (o.isMesh && !/wheel|interior|glass/i.test(o.name + (o.parent ? o.parent.name : ''))) meshes.push(o); });
      for (const o of meshes) cut(o, false);
      v.mesh.traverse((o) => { if (o.isMesh && /glass/i.test(o.name + (o.parent ? o.parent.name : ''))) { o.geometry = o.geometry.clone(); v.dentable.push(o); } });
    } else if (v.type === 'car') {
      const body = v.mesh.children.find((o) => o.isMesh);
      if (body) cut(body, true);
    }
    // for the dents: the original shape, so no spot is pushed in more than a hand's breadth
    for (const o of v.dentable) o.userData.orig = o.geometry.attributes.position.array.slice();
    return pieces;
  }

  // Push the body in around p (car frame), towards the inside along dir (car frame, unit).
  dent(v, p, dir, depth, radius = null) {
    if (!v.dentable) this.prepare(v);
    const R = radius ?? 0.55 + depth * 1.4, lp = new THREE.Vector3(), ld = new THREE.Vector3(), vtx = new THREE.Vector3();
    v.mesh.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(v.mesh.matrixWorld).invert();
    for (const o of v.dentable) {
      if (!o.parent || o.parent.parent === null) continue;
      const toMesh = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld).invert();   // car frame -> mesh
      lp.copy(p).applyMatrix4(toMesh);
      ld.copy(dir).transformDirection(toMesh);
      const P = o.geometry.attributes.position, orig = o.userData.orig;
      if (!P || !orig) continue;
      const moved = new Uint8Array(P.count);
      let any = false;
      for (let i = 0; i < P.count; i++) {
        vtx.fromBufferAttribute(P, i);
        const d = vtx.distanceTo(lp);
        if (d > R) continue;
        const k = (1 - d / R) ** 2 * depth * (0.75 + Math.random() * 0.5);
        vtx.addScaledVector(ld, k);
        // crumple: a little sideways buckle
        vtx.x += (Math.random() - 0.5) * k * 0.25; vtx.y += (Math.random() - 0.5) * k * 0.25;
        // never more than 35 cm from where it was built
        const ox = orig[i * 3], oy = orig[i * 3 + 1], oz = orig[i * 3 + 2];
        const dx = vtx.x - ox, dy = vtx.y - oy, dz = vtx.z - oz, dl = Math.hypot(dx, dy, dz);
        if (dl > 0.35) vtx.set(ox + dx * 0.35 / dl, oy + dy * 0.35 / dl, oz + dz * 0.35 / dl);
        P.setXYZ(i, vtx.x, vtx.y, vtx.z);
        moved[i] = 1; any = true;
      }
      if (!any) continue;
      P.needsUpdate = true;
      this.renormal(o.geometry, moved);
      o.geometry.computeBoundingSphere();
    }
  }

  // normals again, but only around what moved (a whole car would take too long)
  renormal(geo, moved) {
    const P = geo.attributes.position, N = geo.attributes.normal, idx = geo.index;
    if (!N) return;
    const n = idx ? idx.count / 3 : P.count / 3;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), cb = new THREE.Vector3(), ab = new THREE.Vector3();
    const acc = new Map();
    for (let t = 0; t < n; t++) {
      const i0 = idx ? idx.getX(t * 3) : t * 3, i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      if (!moved[i0] && !moved[i1] && !moved[i2]) continue;
      a.fromBufferAttribute(P, i0); b.fromBufferAttribute(P, i1); c.fromBufferAttribute(P, i2);
      cb.subVectors(c, b); ab.subVectors(a, b); cb.cross(ab);
      for (const i of [i0, i1, i2]) {
        if (!moved[i]) continue;
        const s = acc.get(i) || acc.set(i, [0, 0, 0]).get(i);
        s[0] += cb.x; s[1] += cb.y; s[2] += cb.z;
      }
    }
    for (const [i, s] of acc) {
      const l = Math.hypot(s[0], s[1], s[2]) || 1;
      N.setXYZ(i, s[0] / l, s[1] / l, s[2] / l);
    }
    N.needsUpdate = true;
  }

  // A piece comes off: out of the car, into the world, flying.
  detach(v, name, push) {
    const pieces = this.prepare(v), obj = pieces[name];
    if (!obj || !obj.parent) return false;
    obj.updateMatrixWorld(true);
    // its centre, to spin about
    const box = new THREE.Box3().setFromObject(obj), center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    const holder = new THREE.Group();
    holder.position.copy(center);
    this.g.scene.add(holder);
    holder.attach(obj);
    const wheel = /wheel/.test(name);
    const vel = new THREE.Vector3(v.vel.x, 0, v.vel.z).multiplyScalar(0.55).addScaledVector(push, 1).add(new THREE.Vector3(0, 2.2 + Math.random() * 2.5, 0));
    // a wheel keeps turning about its axle (the car's sideways axis), at the speed it's going
    const hs = Math.hypot(vel.x, vel.z);
    const spin = wheel
      ? new THREE.Vector3(Math.sin(v.heading), 0, Math.cos(v.heading)).multiplyScalar(-(Math.max(hs, 3) / 0.33) * Math.sign((vel.x * Math.cos(v.heading) - vel.z * Math.sin(v.heading)) || 1))
      : new THREE.Vector3((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10);
    const r = Math.max(0.12, Math.min(size.x, size.y, size.z) / 2);
    this.parts.push({ holder, obj, vel, w: spin, r, wheel, life: 90, rest: false, radius: wheel ? 0.34 : r });
    while (this.parts.length > 28) this.drop(this.parts.shift());
    return true;
  }

  // a piece that's already gone (a late joiner's view of an old crash): just not there
  remove(v, name) {
    const obj = this.prepare(v)[name];
    if (obj && obj.parent) obj.removeFromParent();
  }

  drop(pt) {
    pt.holder.removeFromParent();
    pt.holder.traverse((o) => { if (o.isMesh && o.geometry && !o.geometry.userData.shared) o.geometry.dispose(); });
  }

  // --- the cosmetic side of one impact: sparks, bits, a thump, shake ---
  // p world point, n world normal (out of what was hit), j impulse (m/s), v the vehicle
  impactFx(v, p, n, j, { local = false, glass = false } = {}) {
    const g = this.g;
    const k = Math.min(1, j / 14);
    const tang = new THREE.Vector3(v.vel.x, 0, v.vel.z);
    const along = tang.lengthSq() > 0.01 ? tang.normalize() : new THREE.Vector3(n.x, 0, n.z);
    const sd = new THREE.Vector3(n.x, 0.3, n.z).normalize().multiplyScalar(0.4).addScaledVector(along, 0.8);
    this.sparks.emit(p, Math.round(14 + 90 * k), sd, 4 + 8 * k);
    const paint = v.paint ?? 0x888888;
    if (j > 3) {
      const bv = new THREE.Vector3(n.x, 0, n.z).multiplyScalar(1 + j * 0.2).addScaledVector(new THREE.Vector3(v.vel.x, 0, v.vel.z), 0.35);
      this.chips.emit(p, Math.round(4 + 18 * k), bv, paint, { size: 0.17, speed: 1.5 + 3.5 * k });
      this.chips.emit(p, Math.round(3 + 10 * k), bv, 0x141414, { size: 0.13, speed: 1.5 + 3.5 * k });
      if (glass || j > 9) this.chips.emit(p, Math.round(8 + 24 * k), bv, 0xcfeaf5, { size: 0.12, speed: 2 + 3.5 * k, glass: true });
      // dust and a puff of smoke
      g.effects.emit(p, Math.round(4 + 10 * k), { color: [0.55, 0.53, 0.5], speed: 1.5 + 2 * k, spread: 1.6, up: 0.8, life: 1.1, size: 0.7 + k * 0.8, gravity: -0.6 });
    }
    g.audio.play(j > 9 ? 'crashBig' : 'crash', { pos: p, vol: Math.min(1.2, 0.25 + j / 12) });
    if (glass || j > 11) g.audio.play('glass', { pos: p, vol: Math.min(1, 0.3 + j / 20) });
    if (local) {
      const pl = g.player;
      pl.shake = Math.min(1, pl.shake + 0.2 + k * 0.8);
      g.vehicles.kickCamera(new THREE.Vector3(-n.x, 0, -n.z).multiplyScalar(0.25 + k * 1.2));
    }
  }

  // bullets into a car (on the screens that didn't fire them): sparks, flakes of paint, glass
  bulletFx(v, p, n, j, glass) {
    const g = this.g;
    this.sparks.emit(p, 6, new THREE.Vector3(n.x, 0.4, n.z), 4);
    this.chips.emit(p, 2, new THREE.Vector3(n.x, 0.5, n.z), v.paint ?? 0x888888, { size: 0.07, speed: 1.2 });
    if (glass) { this.chips.emit(p, 8, new THREE.Vector3(n.x * 1.5, 0.6, n.z * 1.5), 0xcfeaf5, { size: 0.08, speed: 1.8, glass: true }); g.audio.play('glass', { pos: p, vol: 0.5 }); }
    else g.audio.play('metal', { pos: p, vol: Math.min(0.8, 0.3 + j * 0.05) });
  }

  // grinding along a wall, or on the rims: a few sparks every tick
  scrape(p, dir, amount) {
    this.sparks.emit(p, Math.min(6, 1 + Math.round(amount * 0.6)), dir, 3 + amount * 0.5);
  }

  update(dt) {
    const ga = this.groundAt;
    this.sparks.update(dt, ga);
    this.chips.update(dt, ga);
    const g = this.g;
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const pt = this.parts[i], h = pt.holder;
      pt.life -= dt;
      if (pt.life <= 0) {
        // sink away
        h.position.y -= dt * 0.3;
        if (pt.life < -2) { this.drop(pt); this.parts.splice(i, 1); }
        continue;
      }
      if (pt.rest) continue;
      pt.vel.y -= 9.8 * dt;
      h.position.addScaledVector(pt.vel, dt);
      // off the walls
      const c = { x: h.position.x, z: h.position.z };
      if (g.colliders.resolve(c, pt.radius, h.position.y - 0.2, h.position.y + 0.3, 1)) {
        const nx = c.x - h.position.x, nz = c.z - h.position.z, nl = Math.hypot(nx, nz) || 1;
        const vn = (pt.vel.x * nx + pt.vel.z * nz) / nl;
        if (vn < 0) { pt.vel.x -= 1.4 * vn * nx / nl; pt.vel.z -= 1.4 * vn * nz / nl; }
        h.position.x = c.x; h.position.z = c.z;
      }
      const gy = ga(h.position.x, h.position.z, h.position.y + 0.5) + pt.radius * 0.9;
      const onGround = h.position.y <= gy;
      if (onGround) {
        h.position.y = gy;
        if (pt.vel.y < -1.5) {
          pt.vel.y *= -0.32; pt.vel.x *= 0.7; pt.vel.z *= 0.7;
          if (!pt.wheel) pt.w.multiplyScalar(0.6);
          g.audio.play('clank', { pos: h.position, vol: Math.min(0.8, -pt.vel.y * 0.15 + 0.2) });
        } else pt.vel.y = 0;
        const hs = Math.hypot(pt.vel.x, pt.vel.z);
        if (pt.wheel && pt.w.length() * 0.33 > 1.1) {
          // a wheel rolls on where its spin takes it (centre speed = spin x radius), slowing, and
          // wobbles: its axle swings about the vertical, so it curves as it goes
          const rv = tmpV.crossVectors(pt.w, UP).multiplyScalar(0.33);
          const k = Math.min(1, 6 * dt);
          pt.vel.x += (rv.x - pt.vel.x) * k; pt.vel.z += (rv.z - pt.vel.z) * k;
          pt.w.multiplyScalar(Math.exp(-0.45 * dt));
          tmpQ.setFromAxisAngle(UP, Math.sin(pt.life * 2.3) * 0.7 * dt);
          pt.w.applyQuaternion(tmpQ);
          h.quaternion.premultiply(tmpQ);
        } else {
          const f = Math.max(0, hs - 6 * dt) / Math.max(hs, 1e-6);
          pt.vel.x *= f; pt.vel.z *= f;
          pt.w.multiplyScalar(Math.exp(-4 * dt));
          if (hs < 0.15 && Math.abs(pt.vel.y) < 0.2 && pt.w.length() < 0.4) {
            pt.rest = true;
            this.layFlat(pt);   // down on its thinnest side
          }
        }
      }
      const wl = pt.w.length();
      if (wl > 1e-4) { tmpQ.setFromAxisAngle(tmpV.copy(pt.w).divideScalar(wl), wl * dt); h.quaternion.premultiply(tmpQ); }
    }
  }

  // turn a resting piece so its thinnest side is down, and sit it on the ground
  layFlat(pt) {
    const h = pt.holder;
    // its size in its own frame: measure it unrotated
    const q = h.quaternion.clone();
    h.quaternion.identity(); h.updateMatrixWorld(true);
    const ls = new THREE.Box3().setFromObject(pt.obj).getSize(new THREE.Vector3());
    h.quaternion.copy(q);
    const axis = ls.x <= ls.y && ls.x <= ls.z ? new THREE.Vector3(1, 0, 0) : ls.y <= ls.z ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
    const now = axis.applyQuaternion(q);
    h.quaternion.premultiply(new THREE.Quaternion().setFromUnitVectors(now, now.y >= 0 ? UP : new THREE.Vector3(0, -1, 0)));
    h.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(pt.obj);
    h.position.y += this.groundAt(h.position.x, h.position.z, h.position.y + 0.5) - b.min.y + 0.005;
  }

  // Tyre marks, tyre squeal and the scrape of metal on concrete, for one vehicle this tick.
  // slide: how hard the tyres are sliding (m/s), scraping: grinding against something (m/s)
  tyres(v, slide, scraping, dt) {
    const g = this.g;
    if (v.type === 'drone') return;
    const marks = v.marks || (v.marks = new Map());
    if (slide > 1.4) {
      const cos = Math.cos(v.heading), sin = Math.sin(v.heading);
      const fx = cos, fz = -sin, rx = sin, rz = cos;
      const s = v.spec, half = (s.wheelbase || 2.6) / 2, side = v.type === 'bike' ? 0 : (s.hd || 0.9) - 0.18;
      const wheels = v.type === 'bike' ? [[-half, 0]] : [[-half, -side], [-half, side], [half, -side], [half, side]];
      for (let k = 0; k < wheels.length; k++) {
        const [ox, oz] = wheels[k];
        if (v.lost && v.lost.has(['wheelRL', 'wheelRR', 'wheelFL', 'wheelFR'][k])) continue;
        const x = v.pos.x + fx * ox * v.fwdSign + rx * oz, z = v.pos.z + fz * ox * v.fwdSign + rz * oz;
        const y = g.groundAt(x, z, v.pos.y + 0.6);
        const prev = marks.get(k);
        const cur = { x, y, z };
        if (prev && Math.hypot(x - prev.x, z - prev.z) > 0.25) { if (Math.hypot(x - prev.x, z - prev.z) < 3) this.skids.add(prev, cur, v.type === 'bike' ? 0.14 : 0.22); marks.set(k, cur); }
        else if (!prev) marks.set(k, cur);
      }
    } else marks.clear();
    this.loop(v, 'screech', slide > 2 ? Math.min(1, (slide - 2) / 7) : 0, dt);
    this.loop(v, 'scrape', scraping > 0.8 ? Math.min(1, scraping / 8) : 0, dt);
  }

  // a looping synthesized sound for one vehicle, faded to level
  loop(v, kind, level, dt) {
    const a = this.g.audio;
    if (!a.ctx || a.ctx.state !== 'running') return;
    let L = this.loops.get(v);
    if (!L) this.loops.set(v, L = {});
    let s = L[kind];
    if (!s && level <= 0.01) return;
    if (!s) s = L[kind] = a.loopSound(kind, v.pos);
    if (!s) return;
    s.level = THREE.MathUtils.damp(s.level || 0, level, level > (s.level || 0) ? 14 : 5, dt);
    s.set(s.level, v.pos, Math.hypot(v.vel.x, v.vel.z));
    if (s.level < 0.005 && level <= 0) { s.stop(); delete L[kind]; }
  }

  clear() {
    for (const pt of this.parts) this.drop(pt);
    this.parts.length = 0;
    for (const L of this.loops.values()) for (const s of Object.values(L)) s.stop();
    this.loops.clear();
  }
}
