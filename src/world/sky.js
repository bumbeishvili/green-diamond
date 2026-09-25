import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

const LAT = 41.7958, LON = 44.7798, TZ = 4; // Tbilisi, UTC+4, no DST
const UP = new THREE.Vector3(0, 1, 0), NIGHT_DIR = new THREE.Vector3(-0.3, 0.8, 0.2).normalize();
const _off = new THREE.Vector3(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _p = new THREE.Vector3();

// NOAA solar position. hour = local clock time (e.g. 18.5). Returns radians.
export function solarPosition(date, hour) {
  const start = Date.UTC(date.getFullYear(), 0, 0);
  const doy = Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - start) / 864e5);
  const g = (2 * Math.PI / 365) * (doy - 1 + (hour - 12) / 24);
  const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g)
    + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const tst = hour * 60 + eqt + 4 * LON - 60 * TZ;
  const ha = THREE.MathUtils.degToRad(tst / 4 - 180);
  const phi = THREE.MathUtils.degToRad(LAT);
  const cosZ = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(ha);
  const elevation = Math.PI / 2 - Math.acos(THREE.MathUtils.clamp(cosZ, -1, 1));
  const azimuth = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi)) + Math.PI; // from north, clockwise
  return { elevation, azimuth };
}

// Direction towards the sun in three.js coords (x east, y up, z south).
export function sunVector(elevation, azimuth, out = new THREE.Vector3()) {
  return out.set(Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), -Math.cos(azimuth) * Math.cos(elevation));
}

const lerp = THREE.MathUtils.lerp;
// Light balance (overridable from the URL for tuning: ?sun=&env=&hemi=&exp=)
const Q = new URLSearchParams(location.search);
const TUNE = {
  sun: Q.has('sun') ? +Q.get('sun') : 4.6,
  env: Q.has('env') ? +Q.get('env') : 0.18,
  hemi: Q.has('hemi') ? +Q.get('hemi') : 0.35,
  hsky: Q.has('hsky') ? parseInt(Q.get('hsky'), 16) : 0xd6e2f2,
  hgnd: Q.has('hgnd') ? parseInt(Q.get('hgnd'), 16) : 0xa89878,
  exp: Q.has('exp') ? +Q.get('exp') : 0.9,
};
const smooth = THREE.MathUtils.smoothstep;

export class Atmosphere {
  constructor(renderer, scene, quality) {
    this.renderer = renderer;
    this.scene = scene;
    this.quality = quality;
    this.date = new Date();
    this.hour = 17.25;
    this.envHour = -99;

    this.sky = new Sky();
    this.sky.scale.setScalar(20000);
    this.sky.material.uniforms.turbidity.value = 7.5;
    this.sky.material.uniforms.rayleigh.value = 1.6;
    this.sky.material.uniforms.mieCoefficient.value = 0.006;
    this.sky.material.uniforms.mieDirectionalG.value = 0.82;
    this.sky.material.uniforms.cloudCoverage.value = 0.32;
    scene.add(this.sky);

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    const s = this.sun.shadow;
    s.mapSize.set(quality.shadowMap, quality.shadowMap);
    const r = quality.shadowRange;
    Object.assign(s.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 900 });
    s.camera.updateProjectionMatrix();
    s.bias = -0.00025;
    // (a texel's worth or near it: less, and surfaces the sun grazes get striped with their own shadow)
    s.normalBias = Math.max(0.045, (2 * r / quality.shadowMap) * 0.8);
    scene.add(this.sun, this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xbcd2ff, 0x5b5040, 0.6);
    scene.add(this.hemi);

    scene.fog = new THREE.FogExp2(0xc0c8d0, 0.00013);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.envSky = new Sky();
    this.envSky.scale.setScalar(1000);
    // no sun disc in the reflection/ambient map: the real sun comes from the shadowed light
    this.envSky.material.uniforms.showSunDisc.value = 0;
    this.envSky.material.uniforms.cloudCoverage.value = 0.0;
    this.envScene.add(this.envSky);
    // and ground under the horizon: reflections of the world below the skyline are ground, not sky
    // (without it every car flank and window at a glancing angle mirrors bright haze)
    this.envGround = new THREE.Mesh(new THREE.CircleGeometry(900, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0, fog: false }));
    this.envGround.position.y = -6;
    this.envScene.add(this.envGround);
    this.envRT = null;

    this.sunDir = new THREE.Vector3();
    this.night = 0;       // 0 = day, 1 = full night
    this.golden = 0;
    this.lampLevel = 0;   // street lamps and lit windows
    this.moon = new THREE.DirectionalLight(0x8fa6d8, 0.0);
    this.moon.position.set(-60, 120, 40);
    scene.add(this.moon);
  }

  setHour(hour) {
    this.hour = hour;
    const { elevation, azimuth } = solarPosition(this.date, hour);
    this.elevation = elevation;
    this.azimuth = azimuth;
    sunVector(elevation, azimuth, this.sunDir);
    const elDeg = THREE.MathUtils.radToDeg(elevation);

    const u = this.sky.material.uniforms;
    u.sunPosition.value.copy(this.sunDir);
    // warmer, denser air as the sun drops
    this.golden = 1 - smooth(elDeg, 2, 18);
    this.night = 1 - smooth(elDeg, -9, -1);
    u.rayleigh.value = lerp(1.4, 2.6, this.golden);
    u.turbidity.value = lerp(6.5, 9.5, this.golden);

    // sun light
    const warm = new THREE.Color().setHSL(lerp(0.12, 0.055, this.golden), lerp(0.25, 0.85, this.golden), lerp(0.97, 0.72, this.golden));
    const sunUp = smooth(elDeg, -1.5, 4);
    this.sun.color.copy(warm);
    this.sun.intensity = sunUp * TUNE.sun * lerp(1.0, 0.78, this.golden);
    this.sun.castShadow = sunUp > 0.05;

    this.moon.intensity = this.night * 0.55;
    this.hemi.intensity = lerp(TUNE.hemi * lerp(1.0, 0.85, this.golden), 0.2, this.night);
    this.hemi.color.set(this.night > 0.5 ? 0x324466 : this.golden > 0.5 ? 0xd0b8a8 : TUNE.hsky);
    this.hemi.groundColor.set(this.night > 0.5 ? 0x141210 : TUNE.hgnd);

    // fog tuned to the horizon
    const dayFog = new THREE.Color(0xbac5cf), goldFog = new THREE.Color(0xcfae8e), nightFog = new THREE.Color(0x0d121c);
    const fog = dayFog.clone().lerp(goldFog, this.golden * (1 - this.night)).lerp(nightFog, this.night);
    this.scene.fog.color.copy(fog);
    this.scene.fog.density = lerp(lerp(0.000105, 0.00016, this.golden), 0.0011, this.night);
    this.lampLevel = 1 - smooth(elDeg, -4, 3);
    this.renderer.toneMappingExposure = lerp(TUNE.exp * lerp(1.0, 1.1, this.golden), 1.25, this.night);

    if (Math.abs(hour - this.envHour) > 0.04) this.updateEnvironment();
  }

  updateEnvironment() {
    this.envHour = this.hour;
    const u = this.envSky.material.uniforms, src = this.sky.material.uniforms;
    for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) u[k].value = src[k].value;
    u.sunPosition.value.copy(this.sunDir);
    const lit = 1 - this.night;
    this.envGround.material.color.setRGB(0.3, 0.31, 0.3).multiplyScalar(0.08 + 0.92 * lit * lerp(1, 0.7, this.golden));
    if (this.envRT) this.envRT.dispose();
    this.envRT = this.pmrem.fromScene(this.envScene, 0, 0.1, 2000);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = lerp(TUNE.env * this.quality.envIntensity, 0.06, this.night);
  }

  // Keep the shadow camera centred on the player, moved in whole shadow-map texels as the light
  // sees them: then the texels stay put on the ground as you walk. (Snapped along the world's own
  // axes they don't, with the sun at an angle, and every shadow edge crawls and shimmers.)
  follow(target) {
    const r = this.quality.shadowRange;
    const texel = (2 * r) / this.quality.shadowMap;
    const dir = this.night > 0.9 ? NIGHT_DIR : this.sunDir;
    const off = _off.set(dir.x * 400, Math.max(40, dir.y * 400), dir.z * 400);
    // the shadow camera's axes: it looks back along off, with the world's up for its up
    const z = _z.copy(off).normalize(), x = _x.crossVectors(UP, z).normalize(), y = _y.crossVectors(z, x);
    const p = _p.set(target.x, 0, target.z), u = p.dot(x), v = p.dot(y);
    p.addScaledVector(x, Math.round(u / texel) * texel - u).addScaledVector(y, Math.round(v / texel) * texel - v);
    this.sun.target.position.copy(p);
    this.sun.position.copy(p).add(off);
    this.sun.target.updateMatrixWorld();
  }
}
