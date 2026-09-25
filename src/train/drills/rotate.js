// Mental rotation (Shepard and Metzler's): two shapes made of cubes, side by side; is the right one the
// left one turned round, or its mirror image turned round? Turning one in the mind's eye until it
// lines up with the other is the exercise (spatial reasoning). Harder levels: from turns in the
// picture's own plane (like turning a photo) to turns round the upright axis, then round any axis at
// all; bigger angles, less time.

import * as THREE from 'three';
import { pick, rand, shuffle, speedScore, style } from '../util.js';

const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
// the turn and its range of angles (degrees) at each level
const TURN = [['plane', 40, 100], ['plane', 40, 140], ['plane', 40, 180], ['upright', 40, 100], ['upright', 40, 140],
  ['upright', 60, 180], ['any', 60, 120], ['any', 60, 150], ['any', 80, 180], ['any', 90, 180]];
const rad = (d) => d * Math.PI / 180;

// the 24 ways to turn a cube onto itself (signed permutations with determinant 1)
const CUBE_TURNS = [];
for (const [a, b, c, even] of [[0, 1, 2, 1], [1, 2, 0, 1], [2, 0, 1, 1], [0, 2, 1, -1], [2, 1, 0, -1], [1, 0, 2, -1]]) {
  for (const sx of [1, -1]) for (const sy of [1, -1]) for (const sz of [1, -1]) {
    if (even * sx * sy * sz === 1) CUBE_TURNS.push((p) => [sx * p[a], sy * p[b], sz * p[c]]);
  }
}

// the same text for a set of cubes however it's turned (the least of its 24 turns, moved to the origin)
function canon(cubes) {
  let best = null;
  for (const t of CUBE_TURNS) {
    const q = cubes.map(t), m = [0, 1, 2].map((i) => Math.min(...q.map((p) => p[i])));
    const s = q.map((p) => `${p[0] - m[0]},${p[1] - m[1]},${p[2] - m[2]}`).sort().join(' ');
    if (best === null || s < best) best = s;
  }
  return best;
}

const mirror = (cubes) => cubes.map(([x, y, z]) => [-x, y, z]);

// A bent arm of cubes joined face to face: four straight runs with a right-angle bend between each,
// going all three ways (a flat one would be its own mirror image), never touching itself, and not the
// same as its mirror image however it's turned (so "mirrored" is never secretly "same").
function arm() {
  for (;;) {
    const lens = shuffle([3, 2, 2, 2 + (Math.random() < 0.35 ? 1 : 0)]);
    let d = pick(DIRS), p = [0, 0, 0];
    const cubes = [p], dirs = [];
    for (let k = 0; k < 4; k++) {
      if (k) d = pick(DIRS.filter((q) => q[0] * d[0] + q[1] * d[1] + q[2] * d[2] === 0));
      dirs.push(d);
      for (let s = 0; s < lens[k]; s++) { p = [p[0] + d[0], p[1] + d[1], p[2] + d[2]]; cubes.push(p); }
    }
    if (new Set(dirs.map((q) => q.findIndex((v) => v !== 0))).size < 3) continue;
    let ok = true;
    for (let i = 0; i < cubes.length && ok; i++) {
      for (let j = i + 3; j < cubes.length && ok; j++) {
        if (Math.max(...[0, 1, 2].map((a) => Math.abs(cubes[i][a] - cubes[j][a]))) < 2) ok = false;
      }
    }
    if (!ok || canon(cubes) === canon(mirror(cubes))) continue;
    return { cubes, dirs };
  }
}

// a turn of the level's kind, by `deg` degrees
function turn(kind, deg) {
  const q = new THREE.Quaternion(), a = rad(deg) * pick([-1, 1]);
  if (kind === 'plane') return q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), a);
  if (kind === 'upright') {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a);
    return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), rad(rand(-12, 12))).multiply(q);
  }
  return q.setFromAxisAngle(new THREE.Vector3().randomDirection(), a);
}

// (no run of the arm pointing straight at you, where it would hide its own length)
const readable = (dirs, q) => dirs.every((d) => Math.abs(new THREE.Vector3(...d).applyQuaternion(q).z) < 0.72);

export default {
  how: 'Two shapes made of cubes. Is the right one the <b>same</b> shape turned round, or its <b>mirror image</b> turned round?',

  async run(ctx) {
    style('rotate', `
      #train .d-rotate .pair { position: relative; width: 100%; height: 252px; margin-top: 14px; }
      #train .d-rotate .pair::before, #train .d-rotate .pair::after { content: ''; position: absolute; top: 0; bottom: 0; width: calc(50% - 4px);
        background: #171a20; border: 1px solid #2c3036; border-radius: 8px; }
      #train .d-rotate .pair::before { left: 0; }
      #train .d-rotate .pair::after { right: 0; }
      #train .d-rotate canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; z-index: 1; }
      #train .d-rotate .slot { width: 100%; }
      #train .d-rotate .answers button { min-height: 58px; font-size: 19px; }
      @media (max-height: 520px) { #train .d-rotate .pair { height: 178px; margin-top: 12px; } #train .d-rotate .answers button { min-height: 50px; } }`);
    ctx.stage.classList.add('d-rotate');
    const lv = ctx.level, n = 8;
    const [kind, a0, a1] = TURN[lv - 1];
    const secs = Math.round((10 - (lv - 1) * 5 / 9) * 10) / 10;
    const count = ctx.el('div', 't-score');
    const pair = ctx.el('div', 'pair');
    const canvas = ctx.el('canvas', '', pair);
    const slot = ctx.el('div', 'slot');

    // one small renderer for the round, the two shapes in the two halves of its canvas
    const W = pair.clientWidth || 600, H = pair.clientHeight || 250;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(W, H, false);
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x2a2e36, 1.5));
    const sun = new THREE.DirectionalLight(0xffffff, 2.3);
    sun.position.set(-1.5, 5, 3);
    scene.add(sun);
    const camera = new THREE.PerspectiveCamera(30, W / 2 / H, 0.5, 100);
    const box = new THREE.BoxGeometry(1, 1, 1), edges = new THREE.EdgesGeometry(box);
    const mat = new THREE.MeshLambertMaterial({ color: 0xe9e3d6, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    const lineMat = new THREE.LineBasicMaterial({ color: 0x1d2026 });
    let figs = [];
    // a shape turned by q, centred in its half; returns its corners as they're seen
    const shape = (cubes, q) => {
      const g = new THREE.Group(), pts = [];
      for (const p of cubes) {
        const m = new THREE.Mesh(box, mat);
        m.position.set(...p);
        const l = new THREE.LineSegments(edges, lineMat);
        l.position.copy(m.position);
        g.add(m, l);
        for (let c = 0; c < 8; c++) pts.push(new THREE.Vector3(p[0] + (c & 1) - 0.5, p[1] + (c >> 1 & 1) - 0.5, p[2] + (c >> 2) - 0.5).applyQuaternion(q));
      }
      const lo = new THREE.Vector3(Infinity, Infinity, Infinity), hi = lo.clone().negate();
      for (const v of pts) { lo.min(v); hi.max(v); }
      const mid = lo.add(hi).multiplyScalar(0.5);
      g.quaternion.copy(q);
      g.position.copy(mid).negate();
      scene.add(g);
      figs.push(g);
      return pts.map((v) => v.sub(mid));
    };
    // (the camera as close as it can be with both shapes still in their halves)
    const frame = (pts) => {
      const t = Math.tan(rad(15)) * 0.86;
      camera.position.set(0, 0, Math.max(...pts.map((v) => v.z + Math.max(Math.abs(v.y) / t, Math.abs(v.x) / (t * camera.aspect)))));
      camera.lookAt(0, 0, 0);
    };
    const clear = () => { for (const g of figs) scene.remove(g); figs = []; };
    const draw = () => {
      renderer.setScissorTest(true);
      for (let side = 0; side < 2; side++) {
        figs.forEach((g, i) => { g.visible = i === side; });
        renderer.setViewport(side * W / 2, 0, W / 2, H);
        renderer.setScissor(side * W / 2, 0, W / 2, H);
        renderer.render(scene, camera);
      }
    };

    const F = new THREE.Matrix4().makeScale(-1, 1, 1);
    const same = shuffle(Array.from({ length: n }, (_, i) => i % 2 === 0));
    let right = 0;
    const times = [];
    try {
      for (let k = 0; k < n && !ctx.aborted; k++) {
        count.textContent = `${k + 1} / ${n}`;
        const { cubes, dirs } = arm();
        // the left one at an easy slant from above; the right one turned from it (or from its mirror
        // image, taken as the left one seen in a mirror at its side)
        let q0, q1, tries = 0;
        do {
          q0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(rad(rand(16, 34)), rad(pick([-1, 1]) * rand(22, 62)), 0));
          const q = turn(kind, rand(a0, a1));
          if (same[k]) q1 = q.multiply(q0);
          else {
            // (the mirror image's own turn: the left one's, seen in the mirror, then q; the last mirror
            // undoes the one that made its cubes)
            const m = new THREE.Matrix4().makeRotationFromQuaternion(q).multiply(F).multiply(new THREE.Matrix4().makeRotationFromQuaternion(q0)).multiply(F);
            q1 = new THREE.Quaternion().setFromRotationMatrix(m);
          }
        } while (++tries < 200 && !(readable(dirs, q0) && readable(same[k] ? dirs : mirror(dirs), q1)));
        frame([...shape(cubes, q0), ...shape(same[k] ? cubes : mirror(cubes), q1)]);
        draw();
        ctx.clock(secs);
        const r = await ctx.choose(['Same', 'Mirrored'], { right: same[k] ? 0 : 1, keys: ['KeyF', 'KeyJ'], cols: 2, limit: secs * 1000, hold: 420, parent: slot });
        if (ctx.aborted) break;
        if (r.ok) { right++; times.push(r.ms / 1000); }
        ctx.flash(r.ok);
        clear();
        draw();
        await ctx.sleep(240);
      }
    } finally {
      clear();
      box.dispose(); edges.dispose(); mat.dispose(); lineMat.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    }
    // (with two answers, guessing gets half of them right: the score counts from a little above that)
    return { score: speedScore(Math.max(0, right - 0.35 * n) / 0.65, n, times, 2.0, 6.0), right, total: n };
  },
};
