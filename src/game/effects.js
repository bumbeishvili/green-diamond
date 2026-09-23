import * as THREE from 'three';

// Pooled particles (blood, dust, sparks), decals (blood on the ground, bullet holes on walls),
// tracers and the muzzle-flash light. Everything is preallocated.

function splatTexture(kind) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  if (kind === 'blood') {
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, d = Math.random() * (i < 6 ? 20 : 52);
      const r = i < 6 ? 16 + Math.random() * 16 : 3 + Math.random() * 7;
      ctx.fillStyle = `rgba(${70 + Math.random() * 40},0,0,${0.75 + Math.random() * 0.25})`;
      ctx.beginPath(); ctx.ellipse(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, r, r * (0.6 + Math.random() * 0.4), a, 0, Math.PI * 2); ctx.fill();
    }
  } else {
    const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 30);
    g.addColorStop(0, 'rgba(10,10,10,1)'); g.addColorStop(0.35, 'rgba(25,24,22,0.9)'); g.addColorStop(1, 'rgba(60,58,55,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

class DecalPool {
  constructor(scene, texture, count, size, opts = {}) {
    const g = new THREE.PlaneGeometry(1, 1);
    const m = new THREE.MeshStandardMaterial({ map: texture, transparent: true, depthWrite: false, roughness: opts.rough ?? 0.4,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.mesh = new THREE.InstancedMesh(g, m, count);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.count = 0;
    this.size = size; this.cursor = 0; this.max = count;
    this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.s = new THREE.Vector3(); this.up = new THREE.Vector3(0, 0, 1);
    scene.add(this.mesh);
  }
  add(pos, normal, scale = 1) {
    const i = this.cursor % this.max;
    this.cursor++;
    this.q.setFromUnitVectors(this.up, normal);
    const spin = new THREE.Quaternion().setFromAxisAngle(normal, Math.random() * Math.PI * 2);
    this.q.premultiply(spin);
    const sz = this.size * scale * (0.7 + Math.random() * 0.6);
    this.m4.compose(pos, this.q, this.s.set(sz, sz, sz));
    this.mesh.setMatrixAt(i, this.m4);
    this.mesh.count = Math.min(this.max, this.cursor);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  clear() { this.cursor = 0; this.mesh.count = 0; }
}

export class Effects {
  constructor(scene) {
    this.scene = scene;
    const N = this.N = 700;
    this.pos = new Float32Array(N * 3);
    this.vel = new Float32Array(N * 3);
    this.col = new Float32Array(N * 3);
    this.life = new Float32Array(N);
    this.maxLife = new Float32Array(N);
    this.size = new Float32Array(N);
    this.grav = new Float32Array(N);
    this.cursor = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aLife', new THREE.BufferAttribute(new Float32Array(N), 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, vertexColors: true,
      uniforms: { uScale: { value: 400 } },
      vertexShader: /* glsl */`
        attribute float aLife; attribute float aSize; varying vec3 vCol; varying float vLife;
        uniform float uScale;
        void main() {
          vCol = color; vLife = aLife;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aLife > 0.0 ? aSize * uScale / -mv.z : 0.0;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vCol; varying float vLife;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.15, length(d)) * clamp(vLife * 3.0, 0.0, 1.0);
          if (a < 0.02) discard;
          gl_FragColor = vec4(vCol, a);
        }`,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);

    this.blood = new DecalPool(scene, splatTexture('blood'), 90, 1.3, { rough: 0.25 });
    this.holes = new DecalPool(scene, splatTexture('hole'), 90, 0.18, { rough: 0.9 });

    // tracers
    const TN = this.TN = 24;
    this.tracerPos = new Float32Array(TN * 6);
    this.tracerLife = new Float32Array(TN);
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(this.tracerPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.tracers = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.tracers.frustumCulled = false;
    this.tracerCursor = 0;
    scene.add(this.tracers);

    this.flash = new THREE.PointLight(0xffc27a, 0, 14, 2);
    scene.add(this.flash);
    this.flashT = 0;
  }

  emit(p, n, { color = [0.5, 0, 0], speed = 3, spread = 1, up = 1, life = 0.6, size = 0.08, gravity = 9.8, dir = null } = {}) {
    for (let k = 0; k < n; k++) {
      const i = this.cursor++ % this.N;
      this.pos.set([p.x, p.y, p.z], i * 3);
      let vx = (Math.random() - 0.5) * spread, vy = Math.random() * up, vz = (Math.random() - 0.5) * spread;
      if (dir) { vx += dir.x; vy += dir.y; vz += dir.z; }
      const s = speed * (0.4 + Math.random() * 0.8);
      this.vel.set([vx * s, vy * s, vz * s], i * 3);
      const v = 0.75 + Math.random() * 0.5;
      this.col.set([color[0] * v, color[1] * v, color[2] * v], i * 3);
      this.maxLife[i] = this.life[i] = life * (0.6 + Math.random() * 0.8);
      this.size[i] = size * (0.6 + Math.random() * 0.9);
      this.grav[i] = gravity;
    }
  }

  bloodBurst(p, dir) {
    this.emit(p, 14, { color: [0.45, 0.02, 0.02], speed: 3.2, spread: 1.4, up: 1.2, life: 0.7, size: 0.07, dir });
    this.emit(p, 5, { color: [0.3, 0.0, 0.0], speed: 1.2, spread: 0.6, up: 0.4, life: 1.0, size: 0.16, gravity: 3 });
  }

  impact(p, n, surface = 'concrete') {
    const col = surface === 'metal' ? [1.0, 0.8, 0.45] : [0.62, 0.6, 0.56];
    this.emit(p, surface === 'metal' ? 8 : 10, { color: col, speed: 2.4, spread: 1.2, up: 1, life: 0.45, size: surface === 'metal' ? 0.03 : 0.06, dir: n, gravity: surface === 'metal' ? 12 : 4 });
    if (surface !== 'ground') this.holes.add(p.clone().addScaledVector(n, 0.01), n);
  }

  tracer(a, b) {
    const i = this.tracerCursor++ % this.TN;
    this.tracerPos.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6);
    this.tracerLife[i] = 0.06;
  }

  muzzle(p) {
    this.flash.position.copy(p);
    this.flash.intensity = 6;
    this.flashT = 0.05;
  }

  update(dt) {
    const g = this.points.geometry;
    const life = g.attributes.aLife.array;
    for (let i = 0; i < this.N; i++) {
      if (this.life[i] <= 0) { life[i] = 0; continue; }
      this.life[i] -= dt;
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      life[i] = Math.max(0, this.life[i] / this.maxLife[i]);
    }
    g.attributes.position.needsUpdate = true;
    g.attributes.aLife.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;

    let any = false;
    for (let i = 0; i < this.TN; i++) {
      if (this.tracerLife[i] > 0) {
        this.tracerLife[i] -= dt;
        any = true;
        if (this.tracerLife[i] <= 0) this.tracerPos.fill(0, i * 6, i * 6 + 6);
      }
    }
    if (any) this.tracers.geometry.attributes.position.needsUpdate = true;

    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.flash.intensity = 0; }
  }

  setViewport(h) { this.points.material.uniforms.uScale.value = h * 0.6; }
}
