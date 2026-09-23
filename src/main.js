import * as THREE from 'three';
import { URLFLAGS, QUALITY, settings, saveSettings } from './config.js';
import { Heightmap } from './world/heightmap.js';
import { Atmosphere } from './world/sky.js';
import { buildGround } from './world/ground.js';
import { buildBuildings, buildBackdropBuildings } from './world/buildings.js';
import { buildSurroundings } from './world/surroundings.js';
import { buildProps } from './world/props.js';
import { setAnisotropy } from './world/textures.js';
import { loadModels } from './assets.js';
import { Colliders } from './game/collision.js';
import { Input } from './game/input.js';
import { Player } from './game/player.js';
import { NavGrid } from './game/navgrid.js';
import { Audio } from './game/audio.js';
import { Effects } from './game/effects.js';
import { Zombies } from './game/zombies.js';
import { Weapons } from './game/weapons.js';
import { HUD } from './game/hud.js';
import { Director } from './game/director.js';

const $ = (id) => document.getElementById(id);
const START_HOUR = 17.25;       // wave 1 starts at 17:15; each wave pushes the clock ~12 minutes
const HOURS_PER_WAVE = 0.2;

class Game {
  constructor() {
    this.canvas = $('game');
    this.quality = QUALITY[settings.quality] || QUALITY.high;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.quality.pixelRatio));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    setAnisotropy(Math.min(this.quality.anisotropy, this.renderer.capabilities.getMaxAnisotropy()));

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.1, 20000);
    this.scene.add(this.camera);
    this.timer = new THREE.Timer();
    this.timer.connect(document);
    this.time = 0;
    this.state = 'loading';
    this.systems = [];
    this.input = new Input(this.canvas);
    this.audio = new Audio();
    this.stats = { fps: 0, frames: 0, acc: 0 };
    this.hour = URLFLAGS.time ?? START_HOUR;
    this.frozen = URLFLAGS.freeze;
    addEventListener('resize', () => this.resize());
  }

  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    this.effects?.setViewport(innerHeight);
  }

  progress(frac, text) {
    $('load-fill').style.width = `${Math.round(frac * 100)}%`;
    if (text) $('load-text').textContent = text;
  }

  async load() {
    this.progress(0.02, 'Reading the map of Green Diamond…');
    this.level = await (await fetch('data/level.json')).json();
    this.hm = await Heightmap.load(this.level.heightmap);
    this.colliders = new Colliders();

    this.progress(0.08, 'Setting the sun over Dighomi…');
    this.atmo = new Atmosphere(this.renderer, this.scene, this.quality);
    this.atmo.setHour(this.hour);

    const modelsP = loadModels((f) => this.progress(0.1 + f * 0.35, 'Waking the neighbours…'));

    this.progress(0.12, 'Paving the courtyards…');
    this.ground = await buildGround(this.level, this.scene, this.colliders);
    this.systems.push(this.ground);
    this.buildings = buildBuildings(this.level, this.scene, this.colliders, this.atmo);
    this.systems.push(this.buildings);
    this.backdrop = buildBackdropBuildings(this.level, this.scene, this.colliders, this.atmo);
    this.surroundings = await buildSurroundings(this.level, this.scene, this.atmo, this.backdrop.sites);
    this.systems.push(this.surroundings);

    this.models = await modelsP;
    this.progress(0.5, 'Parking the cars, planting the trees…');
    this.props = buildProps(this.level, this.scene, this.colliders, this.hm, this.atmo, this.quality, this.models);
    this.systems.push(this.props);

    // invisible walls across the gates and fence breaches: zombies pass, the player stays in
    for (const [x1, y1, x2, y2] of this.level.gaps) this.colliders.addSegment(x1, -y1, x2, -y2, { height: 50, kind: 'playerOnly', shoot: false });
    this.colliders.addSegment(139.0, -36.9, 138.9, -41.1, { height: 50, kind: 'playerOnly', shoot: false });

    this.progress(0.6, 'Mapping every way in…');
    this.nav = new NavGrid(this.colliders);

    this.effects = new Effects(this.scene);
    this.effects.setViewport(innerHeight);
    this.player = new Player(this.camera, this.hm, this.colliders);
    this.player.pools = this.level.pools.map((pl) => ({ pts: pl.poly.outer, water: pl.rim - 0.13 }));
    this.player.onStep = () => this.audio.play('step', { vol: 0.25, jitter: 0.2 });
    this.hud = new HUD(this.level);
    this.zombies = new Zombies(this.scene, { colliders: this.colliders, hm: this.hm, nav: this.nav, effects: this.effects, audio: this.audio, player: this.player, models: this.models });
    this.weapons = new Weapons(this);
    this.weapons.setup(this.models);
    this.director = new Director(this);
    this.zombies.onKill = (zb, head, weapon) => this.director.onKill(zb, head, weapon);
    this.weapons.onHit = (zb, killed, head) => this.director.onHit(zb, killed, head);
    this.zombies.onPlayerHit = () => { this.hud.damage(); this.audio.play('hurt', { vol: 0.8 }); };

    // flashlight (always in the scene so shaders never recompile)
    this.flashlight = new THREE.SpotLight(0xfff2dd, 0, 38, 0.42, 0.45, 1.4);
    this.flashlight.position.set(0.25, -0.2, 0);
    this.flashlight.target.position.set(0, -0.6, -8);
    this.camera.add(this.flashlight, this.flashlight.target);
    this.flashOn = false;

    this.spawnPlayer();
    this.credits();
    this.progress(1, 'Ready');
    this.ready = true;
  }

  spawnPlayer() {
    // start in the middle courtyard by the pool, facing east towards the gates
    this.player.spawn(4, 10, -Math.PI / 2);
    this.player.maxHealth = 100;
    this.player.speedMul = 1;
  }

  credits() {
    $('credits').textContent = 'Map data © OpenStreetMap contributors (ODbL) · Terrain: AWS Terrain Tiles · Imagery: Sentinel-2 cloudless 2024 by EOX (CC BY-NC-SA 4.0) · '
      + 'Models: Quaternius, Kenney, J-Toastie, Rikindle3D, dogchicken, bachosoftdesign & others (see assets/models/CREDITS.md) · Textures: ambientCG, Poly Haven · three.js';
  }

  start() {
    $('loading').classList.add('hidden');
    this.bindUI();
    if (URLFLAGS.autostart) this.beginPlay();
    else { $('menu').classList.remove('hidden'); this.state = 'menu'; }
    this.renderer.setAnimationLoop(() => this.frame());
  }

  bindUI() {
    const sens = $('sens'), vol = $('vol'), q = $('quality');
    sens.value = settings.sens; vol.value = settings.vol; q.value = settings.quality;
    sens.oninput = () => { settings.sens = +sens.value; saveSettings(); };
    vol.oninput = () => { settings.vol = +vol.value; this.audio.setVolume(settings.vol); saveSettings(); };
    q.onchange = () => { settings.quality = q.value; saveSettings(); location.reload(); };
    $('play').onclick = () => this.beginPlay();
    $('resume').onclick = () => { $('pause').classList.add('hidden'); this.input.lock(); this.state = 'playing'; };
    $('quit').onclick = () => location.reload();
    $('retry').onclick = () => location.reload();
    $('go-menu').onclick = () => location.reload();
    this.input.onLockChange = (locked) => {
      if (!locked && this.state === 'playing' && !URLFLAGS.autostart) { this.state = 'paused'; $('pause').classList.remove('hidden'); }
    };
  }

  async beginPlay() {
    $('menu').classList.add('hidden');
    if (!URLFLAGS.autostart) this.input.lock();
    this.state = 'playing';
    this.hud.show(!URLFLAGS.nohud);
    this.hud.points(this.director.points);
    this.hud.wave(0, false);
    this.hud.weapon(this.weapons.def, this.weapons.ammo);
    const hh = Math.floor(this.hour), mm = String(Math.round((this.hour - hh) * 60)).padStart(2, '0');
    this.hud.banner('Green Diamond', `Bob Walsh St 32 · Dighomi · ${hh}:${mm}`);
    this.hud.slots(this.weapons.owned, this.weapons.current);
    if (URLFLAGS.wave) { this.director.wave = URLFLAGS.wave - 1; this.director.timer = 0.5; }
    if (URLFLAGS.nozombies) { this.director.timer = Infinity; }
    const q = new URLSearchParams(location.search);
    if (q.get('weapon') && q.get('weapon') !== 'pistol') this.weapons.give(q.get('weapon'));
    if (q.has('ads')) this.forceAds = true;
    try { await this.audio.init(); this.audio.resume(); this.audio.play('ambience', { vol: 0.35, loop: true, jitter: 0 }); } catch (e) { /* audio is optional */ }
  }

  onWave(w) {
    if (w <= 2) this.hud.flashKeys(6);
    // the evening goes on: 17:15 at wave 1, sunset around wave 8, night after wave 11
    if (URLFLAGS.time == null) this.targetHour = START_HOUR + (w - 1) * HOURS_PER_WAVE;
  }

  gameOver() {
    this.state = 'dead';
    this.input.unlock();
    const d = this.director, w = this.weapons.stats;
    $('go-stats').innerHTML = `<span>Waves survived</span><span>${Math.max(0, d.wave - 1)}</span><span>Zombies killed</span><span>${d.kills}</span>`
      + `<span>Headshots</span><span>${d.headshots}</span><span>Accuracy</span><span>${w.shots ? Math.round((w.hits / w.shots) * 100) : 0}%</span><span>Points</span><span>${d.points}</span>`;
    setTimeout(() => $('gameover').classList.remove('hidden'), 1400);
  }

  applyDebugCamera() {
    if (!URLFLAGS.cam) return false;
    const [x, y, z, yaw, pitch] = URLFLAGS.cam.split(',').map(Number);
    this.camera.position.set(x, y, z);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(THREE.MathUtils.degToRad(pitch || 0), THREE.MathUtils.degToRad(yaw || 0), 0);
    return true;
  }

  // Keep the frame rate up on laptops: trade render resolution for smoothness.
  adaptResolution(fps) {
    if (this.state !== 'playing' || URLFLAGS.cam) return;
    const cap = Math.min(devicePixelRatio, this.quality.pixelRatio);
    const cur = this.renderer.getPixelRatio();
    let next = cur;
    if (fps < 50) next = Math.max(0.6, cur - 0.1);
    else if (fps > 58 && cur < cap) next = Math.min(cap, cur + 0.05);
    if (Math.abs(next - cur) > 0.001) this.renderer.setPixelRatio(next);
  }

  frame() {
    this.timer.update();
    const dt = Math.min(0.05, this.timer.getDelta());
    this.time += dt;
    const playing = this.state === 'playing';
    const debugCam = this.applyDebugCamera();

    // the clock drifts towards the current wave's hour
    if (this.targetHour != null && Math.abs(this.targetHour - this.hour) > 0.001) {
      this.hour += Math.sign(this.targetHour - this.hour) * Math.min(Math.abs(this.targetHour - this.hour), dt * 0.02);
      this.atmo.setHour(this.hour);
    }

    if (!debugCam) {
      this.player.update(dt, this.input, playing);
      if (URLFLAGS.god) { this.player.health = this.player.maxHealth; this.player.dead = false; }
      if (playing && this.player.dead) this.gameOver();
    }
    if (playing) {
      // flow field towards the player, time-sliced
      this.navT = (this.navT || 0) - dt;
      if (this.navT <= 0 && !this.nav.busy) { this.nav.request(this.player.pos.x, this.player.pos.z); this.navT = 0.3; }
      this.nav.step(this.quality === QUALITY.low ? 9000 : 16000);
      this.zombies.frozen = this.frozen;
      this.zombies.update(dt, this.time);
      this.weapons.update(dt, this.input, !debugCam);
      if (this.forceAds) this.player.ads = 1;
      this.director.update(dt);
      if (this.input.hit('KeyM')) this.hud.toggleMap();
      if (this.input.hit('KeyH')) this.hud.toggleKeys();
      if (this.input.hit('KeyG')) this.flashOn = !this.flashOn;
    }
    // flashlight: on by itself once it's dark, G toggles
    const wantLight = this.flashOn !== (this.atmo.lampLevel > 0.6);
    this.flashlight.intensity = THREE.MathUtils.damp(this.flashlight.intensity, wantLight ? 60 : 0, 12, dt);

    for (const s of this.systems) s.update?.(dt, this.time, this.camera);
    this.effects.update(dt);
    this.hud.update(dt);
    this.hud.health(this.player.health, this.player.maxHealth);
    if ((this.frameCount || 0) % 2 === 0) this.hud.drawMap(this.player, this.zombies.list, this.director.markers());
    this.atmo.follow(debugCam ? (this.camera.position.y > 30 ? new THREE.Vector3(0, 0, 0) : this.camera.position) : this.player.pos);
    if (this.audio.ctx) this.audio.setListener(this.camera.position, this.player.forward(new THREE.Vector3()));

    this.renderer.render(this.scene, this.camera);
    if (!debugCam) this.weapons.render(this.renderer, this.atmo);
    this.input.endFrame();

    const st = this.stats;
    st.frames++; st.acc += dt;
    if (st.acc > 0.5) {
      st.fps = st.frames / st.acc; st.frames = 0; st.acc = 0;
      this.adaptResolution(st.fps);
      if (URLFLAGS.debug) {
        const info = this.renderer.info.render;
        this.hud.setStats(`${st.fps.toFixed(0)} fps  ${info.calls} calls  ${(info.triangles / 1000).toFixed(0)}k tris\nzombies ${this.zombies.alive}  wave ${this.director.wave}  ${this.hour.toFixed(2)}h  dpr ${this.renderer.getPixelRatio().toFixed(2)}`);
      }
    }
    this.frameCount = (this.frameCount || 0) + 1;
  }

  debugInfo() {
    return { zombies: this.zombies?.alive, wave: this.director?.wave, hour: +this.hour.toFixed(2), dpr: this.renderer.getPixelRatio(), hp: this.player?.health };
  }
}

const game = new Game();
window.__game = game;
game.load().then(() => game.start()).catch((e) => {
  console.error(e);
  $('load-text').textContent = 'Failed to load: ' + e.message;
});
