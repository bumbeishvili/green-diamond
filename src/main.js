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
import { Vehicles } from './game/vehicles.js';
import { Stairs } from './game/stairs.js';
import { Pickups } from './game/pickups.js';
import { Underground } from './world/underground.js';
import { NetUI } from './net/ui.js';
import { Voice } from './net/voice.js';
import { Host, Client } from './net/netgame.js';
import { PvP, isPvp, teamOf, TEAM_NAMES, TEAM_CSS } from './game/pvp.js';
import { SLOT_CSS } from './net/avatars.js';
import { Touch } from './game/touch.js';
import { Practice } from './learn/practice.js';
import { ticker } from './net/session.js';
import { DEFS } from './game/weapons.js';

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
    // (near at 15 cm: half again the depth precision of 10 cm, and still inside the body's 34 cm radius)
    this.camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.15, 20000);
    this.scene.add(this.camera);
    this.timer = new THREE.Timer();
    this.timer.connect(document);
    this.time = 0;
    this.state = 'loading';
    this.systems = [];
    this.input = new Input(this.canvas);
    // phones and tablets: touch controls over the game
    if (URLFLAGS.touch) { this.input.touch = true; this.touch = new Touch(this); document.body.classList.add('touch'); }
    this.audio = new Audio();
    this.stats = { fps: 0, frames: 0, acc: 0 };
    this.hour = URLFLAGS.time ?? START_HOUR;
    this.frozen = URLFLAGS.freeze;
    // co-op: 'solo', or 'host' / 'client' of a match (net: the Host or Client from net/netgame.js)
    this.mode = 'solo';
    this.net = null;
    this.localSlot = 0;
    this.players = null;       // host: everyone the horde is after (our player + the clients')
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
    this.progress(0.55, 'Opening the underground car parks…');
    this.underground = new Underground(this.level);
    await this.underground.build(this.scene, this.colliders);

    // invisible walls across the gates and fence breaches: zombies pass, the player stays in
    for (const [x1, y1, x2, y2] of this.level.gaps) this.colliders.addSegment(x1, -y1, x2, -y2, { height: 50, kind: 'playerOnly', shoot: false });
    this.colliders.addSegment(139.0, -36.9, 138.9, -41.1, { height: 50, kind: 'playerOnly', shoot: false });

    this.progress(0.6, 'Mapping every way in…');
    this.nav = new NavGrid(this.colliders);
    // the car-park level gets its own flow field: only its own walls, columns and parked cars
    if (this.underground.list.length) {
      const [x0, y0, x1, y1] = this.underground.bounds(), floor = this.underground.list[0].floor;
      this.unav = new NavGrid(this.colliders, {
        minX: x0 - 2, minZ: -y1 - 2, size: Math.max(x1 - x0, y1 - y0) + 4, cell: 1,
        filter: (o) => o.walk && o.minY < 0 && o.maxY < 0 && o.maxY > floor + 0.3,
        inside: (x, z) => !!this.underground.at(x, z, floor + 0.2),
        pad: 0.35,
      });
    }

    this.effects = new Effects(this.scene);
    this.effects.setViewport(innerHeight);
    this.player = new Player(this.camera, this.hm, this.colliders);
    this.player.underground = this.underground;
    this.player.pools = this.level.pools.map((pl) => ({ pts: pl.poly.outer, water: pl.rim - 0.13 }));
    this.player.onStep = () => this.audio.play('step', { vol: 0.25, jitter: 0.2 });
    this.player.onFall = () => { this.hud.damage(); this.audio.play('hurt', { vol: 0.9 }); };
    // stairwells, and the flat roofs you can stand on (each knows its stairwell, if it has one)
    this.stairs = new Stairs(this, this.buildings.stairs);
    this.player.roofs = this.buildings.heights.map((h) => ({ id: h.id, pts: h.pts, top: h.roof, stair: this.stairs.byId.get(h.id) || null }));
    this.hud = new HUD(this.level);
    this.hud.touch = !!this.touch;   // (on a phone the prompts name the buttons, not the keys)
    this.zombies = new Zombies(this.scene, { colliders: this.colliders, hm: this.hm, nav: this.nav, effects: this.effects, audio: this.audio, player: this.player, models: this.models });
    this.zombies.stairs = this.stairs.list;
    this.zombies.underground = this.underground;
    this.zombies.unav = this.unav || null;
    this.zombies.groundFn = (x, z, y) => this.groundAt(x, z, y);
    this.weapons = new Weapons(this);
    this.weapons.setup(this.models);
    this.director = new Director(this);
    // players against players (the rules come from the host's lobby; solo: none)
    this.rules = null;
    this.pvp = new PvP(this);
    this.zombies.pvp = this.pvp;
    this.pickups = new Pickups(this);
    this.practice = new Practice(this);   // English practice (off unless you switch it on)
    this.pickups.setup(this.models);
    this.vehicles = new Vehicles(this);
    this.vehicles.setup(this.models);
    this.zombies.onKill = (zb, head, weapon, by) => this.director.onKill(zb, head, weapon, by);
    this.weapons.onHit = (zb, killed, head, by) => this.director.onHit(zb, killed, head, by);
    this.zombies.onBlastHit = (zb, killed, by) => this.director.onHit(zb, killed, false, by);
    this.zombies.onPlayerHit = (zb, pl, amount, x, z) => {
      if (!pl || pl === this.player) { this.hud.damage(); this.audio.play('hurt', { vol: 0.8 }); }
      else this.net?.hurt?.(pl, amount, x, z);
    };
    this.zombies.onFx = (kind, p, d) => this.net?.blood?.(kind, p, d);
    this.zombies.onExplode = (x, y, z, r, src) => {
      const p = new THREE.Vector3(x, y, z);
      this.effects.explosion(p, r, src === 'bloater' ? 'bile' : 'fire');
      this.audio.play(src === 'bloater' ? 'burst' : 'explosion', { pos: p, vol: 1.3, ref: 10 });
      this.net?.boom?.(x, y, z, r, src);
    };
    // (and every car and bike near a blast takes it: dents, glass, parts, a shove)
    this.zombies.onBlastVehicles = (x, y, z, r, power) => this.vehicles?.blast(x, y, z, r, power);
    // (and they claw at the car you're sitting in)
    this.zombies.onClawCar = (v, zb) => this.vehicles.clawHit(v, zb);
    // (spitters' acid: the others draw the globs and puddles)
    this.zombies.onSpit = (id, o, v) => this.net?.spit?.(id, o, v);
    this.zombies.onSplat = (id, p, r) => this.net?.splat?.(id, p, r);

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

  // The floor under a point at height y: the car-park floor if it's down there, else the terrain.
  groundAt(x, z, y = 1e9) {
    const u = this.underground.at(x, z, y);
    return u ? u.floor : this.hm.atWorld(x, z);
  }

  spawnPlayer() {
    // start in the middle courtyard by the pool, facing east towards the gates
    this.player.spawn(4, 10, -Math.PI / 2);
    this.player.maxHealth = 100;
    this.player.speedMul = 1;
  }

  // The title plays while the game loads; the first time, it stays a moment more (a click, a key or
  // a tap skips it). Then it fades into the menu. (Straight through when you come back from a game,
  // or arrive with an invite link.)
  intro(then) {
    const el = $('loading');
    let seen = 0;
    try { seen = +sessionStorage.getItem('gd-intro') || 0; sessionStorage.setItem('gd-intro', String(Date.now())); } catch { /* no storage */ }
    const quick = Date.now() - seen < 30 * 60e3 || !!this.netui?.invite || !!URLFLAGS.mp || matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.classList.add('done');   // (loaded: just the title for the moment left)
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      clearTimeout(t);
      removeEventListener('pointerdown', go, true); removeEventListener('keydown', go, true);
      el.classList.add('out');
      setTimeout(() => el.classList.add('hidden'), 650);
      then();
    };
    const t = setTimeout(go, quick ? 0 : Math.max(0, 3200 - performance.now()));
    addEventListener('pointerdown', go, true); addEventListener('keydown', go, true);
  }

  credits() {
    $('credits').textContent = 'Map data © OpenStreetMap contributors (ODbL) · Terrain: AWS Terrain Tiles · Imagery: Sentinel-2 cloudless 2024 by EOX (CC BY-NC-SA 4.0) · '
      + 'Models: Quaternius, Kenney, J-Toastie, Rikindle3D, dogchicken, bachosoftdesign, Benjinsmith, mightydinosaurcol, jeremy, SirDraco65, Pichuliru, LonesomeDucky, Lucian Pavel, Isidor Goo (Prius), Franz Albers (Leaf), Aldios (Civic), Kirigami (Lamborghini), TastyTony (AUG), Kaan (MSR), loafbrr_1 (chainsaw) & others (see assets/models/CREDITS.md) · Textures: ambientCG, Poly Haven · three.js';
  }

  start() {
    this.bindUI();
    // A hidden tab gets no animation frames: a co-op host keeps the match going for everyone on a
    // worker timer until it's back (nothing is drawn meanwhile).
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && !this.bgTick) {
        let last = performance.now();
        this.bgTick = ticker.every(1000 / 60, () => {
          const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000);
          last = now;
          if (this.mode === 'host' && this.net && this.net.inMatch) { this.player.update(dt, this.input, false); this.net.frame(dt); }
        });
      } else if (!document.hidden && this.bgTick) { ticker.stop(this.bgTick); this.bgTick = null; this.timer.update(); }
    });
    if (URLFLAGS.autostart) { $('loading').classList.add('hidden'); this.beginPlay(); }
    else this.intro(() => { $('menu').classList.remove('hidden'); this.state = 'menu'; });
    this.renderer.setAnimationLoop(() => this.frame());
    // joined a room while loading: now's the time to say hello
    if (this.netui) this.attachSession(this.netui.session);
    // co-op testing: the host starts by itself once enough players are in
    if (URLFLAGS.mpstart) {
      const t = setInterval(() => {
        const s = this.netui.session;
        if (this.net && this.net.role === 'host' && !this.net.inMatch && this.net.ready.size + 1 >= URLFLAGS.mpstart) { clearInterval(t); this.net.start(); }
      }, 250);
    }
  }

  bindUI() {
    const sens = $('sens'), vol = $('vol'), q = $('quality');
    sens.value = settings.sens; vol.value = settings.vol; q.value = settings.quality;
    sens.oninput = () => { settings.sens = +sens.value; saveSettings(); };
    vol.oninput = () => { settings.vol = +vol.value; this.audio.setVolume(settings.vol); saveSettings(); };
    q.onchange = () => { settings.quality = q.value; if (this.touch) settings.touchChosen = true; saveSettings(); this.reload(); };
    $('play').onclick = () => this.beginPlay();
    $('resume').onclick = () => { $('pause').classList.add('hidden'); $('settings').classList.add('hidden'); this.input.lock(); this.state = 'playing'; };
    // the settings: a screen of their own, from the menu or the pause screen (Done or Esc closes it)
    for (const id of ['settings-open', 'settings-open2']) $(id).onclick = () => $('settings').classList.remove('hidden');
    $('settings-close').onclick = () => $('settings').classList.add('hidden');
    addEventListener('keydown', (e) => { if (e.code === 'Escape' && !$('settings').classList.contains('hidden')) $('settings').classList.add('hidden'); });
    // leaving a co-op match: tell the others (the host leaving ends it for everyone)
    const leave = () => { this.netui?.session.leave(); this.reload(); };
    $('quit').onclick = () => (this.mode === 'solo' ? this.reload() : leave());
    $('retry').onclick = () => (this.mode === 'host' && this.net ? this.net.start() : this.reload());
    $('go-menu').onclick = () => (this.mode === 'solo' ? this.reload() : leave());
    $('clicktoplay').onclick = () => this.input.lock();
    for (const id of ['fs', 'fs2']) $(id).onclick = () => this.toggleFullscreen();
    // the credits: a line on the menu, the lot behind it
    $('credits-btn').onclick = (e) => { e.stopPropagation(); $('credits').classList.toggle('hidden'); };
    addEventListener('pointerdown', (e) => { if (!e.target.closest?.('#credits, #credits-btn')) $('credits').classList.add('hidden'); });
    this.input.onLockChange = (locked) => {
      if (!locked && this.state === 'playing' && !this.practice?.open && !URLFLAGS.autostart && !URLFLAGS.nolock) { this.state = 'paused'; $('pause').classList.remove('hidden'); }
      if (locked && this.mode === 'solo') $('clicktoplay').classList.add('hidden');
    };
    // English practice: how much, Georgian hints, and your progress
    const lm = $('learn'), lk = $('learnka');
    lm.value = this.practice.mode; lk.checked = settings.learnHints !== false;
    lm.onchange = lk.onchange = () => this.practice.setMode(lm.value, lk.checked);
    $('learnme').onclick = () => this.practice.panel();
  }

  // (touch: the pause button; with a mouse, Esc does it by letting go of the pointer)
  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.touch?.reset();
    $('pause').classList.remove('hidden');
  }

  // Full screen, from the menu, the pause screen or the touch controls (on a phone: landscape too).
  // An iPhone only plays full screen from the home screen (Share, Add to Home Screen).
  toggleFullscreen() {
    const d = document, el = d.documentElement;
    if (d.fullscreenElement || d.webkitFullscreenElement) { (d.exitFullscreen || d.webkitExitFullscreen)?.call(d); return; }
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    const note = 'On iPhone: tap Share, then Add to Home Screen, and play from there for full screen';
    if (!req) { for (const id of ['fs-note', 'fs2-note']) $(id).textContent = note; this.hud.notice(note); return; }
    Promise.resolve(req.call(el, { navigationUI: 'hide' }))
      .then(() => screen.orientation?.lock?.('landscape'))
      .catch(() => {});
  }

  async beginPlay() {
    $('menu').classList.add('hidden');
    $('settings').classList.add('hidden');
    if (!URLFLAGS.autostart) this.input.lock();
    this.state = 'playing';
    this.hud.show(!URLFLAGS.nohud);
    this.hud.points(this.director.points);
    this.hud.wave(0, false);
    this.weapons.hudWeapon();
    const hh = Math.floor(this.hour), mm = String(Math.round((this.hour - hh) * 60)).padStart(2, '0');
    this.hud.banner('Green Diamond', `Bob Walsh St 32 · Dighomi · ${hh}:${mm}`);
    this.hud.slots(this.weapons.owned, this.weapons.current);
    this.hud.grenades(this.weapons.grenades);
    this.pickups.replenish(8);
    if (URLFLAGS.wave) { this.director.wave = URLFLAGS.wave - 1; this.director.timer = 0.5; }
    if (URLFLAGS.nozombies) { this.director.timer = Infinity; }
    const q = new URLSearchParams(location.search);
    if (q.get('weapon') && q.get('weapon') !== 'pistol') this.weapons.give(q.get('weapon'));
    if (q.has('ads')) this.forceAds = true;
    try { await this.audio.init(); this.audio.resume(); this.audio.play('ambience', { vol: 0.35, loop: true, jitter: 0 }); } catch (e) { /* audio is optional */ }
  }

  // ---------------------------------------------------------------- co-op
  // the lobby connected us to a room (or we left it): the match controller for our role
  // (our own reloads: no "leave the game?" question for those)
  reload() { this.leaving = true; location.reload(); }

  attachSession(s) {
    // (not before the game has loaded: the controller says hello to the host when it's ready)
    if (!this.ready) return;
    if (s.state === 'connected' && (!this.net || this.net.role !== s.role)) {
      const was = this.net;
      this.net = s.role === 'host' ? new Host(this, s) : new Client(this, s);
      if (s.role === 'host') this.net.names.set('host', this.playerName || '');
      s.onEnded = (msg) => this.netEnded(msg);
      if (was && was.inMatch) this.netEnded(s.message);
    } else if ((s.state === 'idle' || s.state === 'ended') && this.net) {
      const inMatch = this.net.inMatch;
      this.net = null;
      this.voice?.reset();
      if (inMatch && s.state === 'ended') this.netEnded(s.message);
    }
  }

  beginMatch(mode, m = null) {
    this.mode = mode;
    this.zombies.puppets = mode === 'client';
    this.player.slot = this.localSlot;
    for (const id of ['menu', 'gameover', 'pause', 'settings']) $(id).classList.add('hidden');
    this.state = 'playing';
    if (!URLFLAGS.nolock) this.input.lock();
    this.hud.show(!URLFLAGS.nohud);
    this.hud.coop(true);
    this.hud.points(this.director.points);
    this.hud.wave(this.director.wave, false);
    this.weapons.hudWeapon();
    this.hud.slots(this.weapons.owned, this.weapons.current);
    this.hud.grenades(this.weapons.grenades);
    const rules = this.rules, pvp = isPvp(rules);
    this.hud.pvpMode(rules);
    this.killedBy = null;
    if (mode === 'host') {
      this.players = this.players && this.players[0] === this.player ? this.players : [this.player];
      this.zombies.targets = this.players;
      this.director.state = 'intermission';
      // (PvP: the zombies a little later, or not at all)
      this.director.timer = URLFLAGS.nozombies || (pvp && !rules.zombies) ? Infinity : pvp ? 12 : 6;
      if (URLFLAGS.wave) { this.director.wave = URLFLAGS.wave - 1; this.director.timer = 1; }
      this.pickups.replenish(8);
    } else {
      this.players = null;
      this.zombies.targets = null;
      if (m) { this.hour = m.hour; this.atmo.setHour(this.hour); this.targetHour = m.targetHour ?? null; }
      if (m && m.wave) this.hud.wave(m.wave, false);
    }
    const mins = (rules && rules.minutes) || 15, team = teamOf(rules, this.localSlot ?? 0);
    this.hud.banner(!pvp ? 'Green Diamond' : rules.mode === 'teams' ? `${TEAM_NAMES[team]} team` : 'Everyone for themselves',
      !pvp ? `Co-op: hold out for ${mins} minutes`
        : `${rules.kills ? `First ${rules.mode === 'teams' ? 'team ' : ''}to ${rules.kills} kills` : `Most kills in ${mins} minutes`}${rules.zombies ? ', and the zombies are about' : ''}`);
    $('quit').textContent = 'Leave match';
    $('resume').textContent = 'Back to the fight';
    this.audio.init().then(() => { this.audio.resume(); if (!this.ambience) { this.ambience = true; this.audio.play('ambience', { vol: 0.35, loop: true, jitter: 0 }); } }).catch(() => {});
  }

  // the host says it's over (or the host is gone): the team's numbers
  endMatch(m) {
    this.state = 'over';
    this.input.unlock();
    this.hud.down(0);
    $('clicktoplay').classList.add('hidden');
    const mins = Math.round(((this.rules && this.rules.minutes) || 15));
    $('go-title').textContent = m.win ? 'You held Green Diamond' : 'Overrun';
    $('go-title').classList.toggle('win', !!m.win);
    $('go-sub').textContent = m.win ? `${mins} minutes, ${m.wave} wave${m.wave === 1 ? '' : 's'}, and you're still standing.` : `Everyone went down in wave ${m.wave}.`;
    const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
    const st = $('go-stats');
    st.className = 'table';
    const me = this.localSlot ?? 0, who = (q) => `${esc(q.name || `P${q.slot + 1}`)}${q.slot === me ? ' (you)' : ''}`;
    if (m.pvp) {
      // PvP: who won, and everyone by kills
      const teams = m.pvp === 'teams', myTeam = teamOf(this.rules, me);
      const winnerName = teams ? `${TEAM_NAMES[m.winner]} team` : m.winner === me ? 'You' : esc((m.stats.find((q) => q.slot === m.winner) || {}).name || `P${m.winner + 1}`);
      const won = m.winner >= 0 && (teams ? m.winner === myTeam : m.winner === me);
      $('go-title').textContent = m.winner < 0 ? 'A draw' : `${winnerName} win${!teams && m.winner !== me ? 's' : ''}`;
      $('go-title').classList.toggle('win', won);
      const top = Math.max(0, ...m.stats.map((q) => q.frags));
      $('go-sub').textContent = teams ? `Red ${m.teams[0]} · Blue ${m.teams[1]}` : m.winner < 0 ? `Level on ${top} kills` : `${top} kill${top === 1 ? '' : 's'}`;
      st.innerHTML = '<span class="h"></span><span class="h">Kills</span><span class="h">Deaths</span><span class="h">Zombies</span><span class="h">Points</span>'
        + [...m.stats].sort((a, b) => b.frags - a.frags || a.deaths - b.deaths).map((q) => `<span class="n" style="color:${teams ? TEAM_CSS[q.team] : SLOT_CSS[q.slot % 4]}">${who(q)}</span>`
          + `<span>${q.frags}</span><span>${q.deaths}</span><span>${q.kills}</span><span>${q.points}</span>`).join('');
    } else {
      st.innerHTML = '<span class="h"></span><span class="h">Kills</span><span class="h">Headshots</span><span class="h">Downs</span><span class="h">Points</span>'
        + m.stats.map((q) => `<span class="n" style="color:${SLOT_CSS[q.slot % 4]}">${who(q)}</span>`
          + `<span>${q.kills}</span><span>${q.heads}</span><span>${q.deaths}</span><span>${q.points}</span>`).join('');
    }
    $('retry').textContent = this.mode === 'host' ? 'New match' : 'Waiting for the host…';
    $('retry').disabled = this.mode !== 'host';
    $('go-menu').textContent = 'Leave';
    setTimeout(() => $('gameover').classList.remove('hidden'), 1200);
  }

  // the connection is gone in the middle of a match
  netEnded(message) {
    if (this.mode === 'solo' || this.state === 'over') return;
    this.endMatch({ win: false, wave: this.director.wave, stats: [] });
    $('go-title').textContent = 'Match over';
    $('go-title').classList.remove('win');
    $('go-sub').textContent = message || 'The connection to the match was lost.';
    $('retry').textContent = 'Back to the menu';
    $('retry').disabled = false;
    $('retry').onclick = () => this.reload();
    this.mode = 'solo';
  }

  // everything back to the start, for the next match
  resetMatch() {
    const d = this.director, w = this.weapons, p = this.player;
    this.vehicles.clearDrivers();
    this.vehicles.repairAll();
    this.zombies.clear();
    for (const q of d.drops) d.dropGroup.remove(q.mesh);
    Object.assign(d, { drops: [], wave: 0, state: 'intermission', timer: 8, toSpawn: 0, total: 0, spawnT: 0, points: 500, kills: 0, headshots: 0, deaths: 0, frags: 0, double: 0, packs: [], roofT: 0, crowT: 0 });
    p.shieldT = 0; p.lastHit = null;
    this.pvp.hist.clear();
    this.hud.killFeed(null);
    d.team.clear();
    this.pickups.clear();
    for (const a of w.arrows) this.scene.remove(a.mesh);
    for (const n of w.nades) this.scene.remove(n.mesh);
    w.arrows = []; w.nades = [];
    w.owned = { pistol: { mag: DEFS.pistol.mag, reserve: DEFS.pistol.reserve }, rifle: { mag: DEFS.rifle.mag, reserve: 90 }, knife: { mag: 0, reserve: 0 } };
    w.grenades = 2; w.instaKill = 0; w.stats = { shots: 0, hits: 0, heads: 0 };
    w.levels = {}; w.slotLevels.clear();   // (upgrades and armour start over too)
    w.equip('pistol', true);
    p.setArmour(0); p.dead = false; p.speedMul = 1;
    this.hour = URLFLAGS.time ?? START_HOUR; this.targetHour = null; this.atmo.setHour(this.hour);
    this.hud.points(500); this.hud.wave(0, false); this.hud.grenades(2);
    $('go-stats').className = '';
  }

  clientWave(w, note) {
    this.director.wave = w;
    this.hud.wave(w);
    this.hud.banner(`Wave ${w}`, note || '');
    if (w === 1) this.audio.play('waveStart', { vol: 0.3, lowpass: 1300, fade: 5, jitter: 0 });
    else this.audio.play('waveSoft', { vol: 0.8 });
    this.onWave(w);
  }

  clientBoom(m) {
    const p = new THREE.Vector3(m.x, m.y, m.z);
    if (m.src === 'missile') this.weapons.removeMissileNear(p);
    this.effects.explosion(p, m.r, m.src === 'bloater' ? 'bile' : 'fire');
    this.audio.play(m.src === 'bloater' ? 'burst' : 'explosion', { pos: p, vol: 1.3, ref: 10 });
    if (m.src === 'grenade') {
      const w = this.weapons;
      let best = -1, bd = 4;
      w.nades.forEach((n, i) => { const d = n.pos.distanceTo(p); if (n.visual && d < bd) { bd = d; best = i; } });
      if (best >= 0) { this.scene.remove(w.nades[best].mesh); w.nades.splice(best, 1); }
    }
    const d = this.player.pos.distanceTo(p);
    if (d < m.r * 4) this.player.shake = Math.min(1, this.player.shake + 0.6 * (1 - d / (m.r * 4)));
  }

  onTeamDown(slot) {
    if (slot === this.localSlot) this.audio.play('hurt', { vol: 1 });
    else if (!this.pvp.on) this.hud.notice(`${this.hud.nameOf(slot)} is down`);
  }

  onTeamUp(slot) {
    if (slot === this.localSlot) { this.hud.notice(this.pvp.on ? 'Back in' : 'Back on your feet'); this.killedBy = null; }
    else if (!this.pvp.on) this.hud.notice(`${this.hud.nameOf(slot)} is back`);
  }

  // PvP: a kill (k: the killer's slot, -1 for the zombies or yourself), for the feed and the notices
  onFrag(k, v, how) {
    const me = this.localSlot ?? 0;
    this.hud.killFeed(k, v, how, me);
    if (v === me) {
      this.killedBy = k >= 0 ? `Killed by ${this.hud.nameOf(k)}` : how === 'self' ? 'You got yourself' : 'The zombies got you';
      if (this.mode === 'client') this.audio.play('hurt', { vol: 1 });   // (the host hears its own in onTeamDown)
    }
    else if (k === me) { this.hud.notice(`You killed ${this.hud.nameOf(v)}`); this.audio.play('hit', { vol: 0.8, rate: 0.7, jitter: 0 }); }
  }

  // co-op bits of the HUD, every frame
  coopFrame(dt) {
    const n = this.net;
    this.hud.matchClock(n.role === 'host' ? n.msLeft() : n.msLeft);
    this.teamT = (this.teamT || 0) - dt;
    if (this.teamT <= 0) { this.teamT = 0.2; this.hud.teamPanel(n.teamStates(), this.voice ? this.voice.talkingSlots(this.localSlot ?? 0) : null); }
    this.hud.down(this.player.dead && this.state !== 'over' ? Math.max(1, n.localRespawnLeft) : 0, this.pvp.on ? this.killedBy || 'You died' : null);
    this.hud.el.hud.classList.toggle('down-state', this.player.dead);
    $('clicktoplay').classList.toggle('hidden', this.state !== 'playing' || this.input.locked || !!URLFLAGS.nolock || !!this.touch || this.practice.open);
  }

  // The world for one step: the horde's flow fields (towards every player), the zombies, the
  // waves, the loot. Every frame on your own; on the host every 60 Hz tick.
  worldStep(dt) {
    const players = this.players || [this.player];
    const living = players.filter((p) => !p.dead);
    const ps = living.length ? living : players;
    // each player pulls the horde: straight to them, or to their stairwell's lobby doors if
    // they're up on a roof, or to the ramps of the car park they're down in
    this.navT = (this.navT || 0) - dt;
    if (this.navT <= 0 && !this.nav.busy) {
      const goals = [];
      for (const p of ps) {
        const st = p.roof && p.roof.stair;
        const pU = this.underground.at(p.pos.x, p.pos.z, p.pos.y + 0.1);
        if (st) goals.push(...st.doors);
        else if (pU) goals.push(...pU.doors.map((d) => d.out));
        else goals.push({ x: p.pos.x, z: p.pos.z });
      }
      this.nav.request(goals[0].x, goals[0].z, goals.slice(1));
      this.navT = 0.3;
    }
    this.nav.step(this.quality === QUALITY.low ? 9000 : 16000);
    // car-park flow field: to the players down there, else to the ramp doors (only worth running
    // while someone is actually down there)
    if (this.unav) {
      const down = ps.filter((p) => this.underground.at(p.pos.x, p.pos.z, p.pos.y + 0.1));
      const anyone = down.length || this.zombies.list.some((z) => z.state !== 'dead' && z.pos.y < -1.5);
      const goal = down.length ? down.map((p) => this.unav.idx(p.pos.x, p.pos.z)).join(',') : 'doors';
      this.unavT = (this.unavT || 0) - dt;
      if (anyone && this.unavT <= 0 && !this.unav.busy && (goal !== this.unavGoal || down.length)) {
        if (down.length) this.unav.request(down[0].pos.x, down[0].pos.z, down.slice(1).map((p) => ({ x: p.pos.x, z: p.pos.z })));
        else { const ins = this.underground.doorIns; this.unav.request(ins[0].x, ins[0].z, ins.slice(1)); }
        this.unavGoal = goal;
        this.unavT = 0.35;
      }
      if (anyone) this.unav.step(5000);
    }
    this.zombies.frozen = this.frozen;
    this.zombies.update(dt, this.time);
    this.director.update(dt);
    this.pickups.update(dt);
  }

  // a wave survived: an English round, if you practise
  onWaveEnd(w) { this.practice?.waveEnd(w); }

  onWave(w) {
    if (w <= 2) this.hud.flashKeys(6);
    // the evening goes on: 17:15 at wave 1, sunset around wave 8, night after wave 11
    if (URLFLAGS.time == null) this.targetHour = START_HOUR + (w - 1) * HOURS_PER_WAVE;
  }

  gameOver() {
    if (this.mode !== 'solo') return;
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
    // (answering an English question: no moving or shooting; alone, the world waits too)
    const playing = this.state === 'playing' && !this.practice?.open;
    if (this.practice?.open && this.player.dead) this.practice.quiz.finish(true);
    const debugCam = this.applyDebugCamera();

    // the clock drifts towards the current wave's hour
    if (this.targetHour != null && Math.abs(this.targetHour - this.hour) > 0.001) {
      this.hour += Math.sign(this.targetHour - this.hour) * Math.min(Math.abs(this.targetHour - this.hour), dt * 0.02);
      this.atmo.setHour(this.hour);
    }

    // (a co-op client's player moves in net.frame: ticks, predicted, corrected by the host)
    if (!debugCam && this.mode !== 'client') {
      this.player.update(dt, this.input, playing);
      if (URLFLAGS.god) { this.player.health = this.player.maxHealth; this.player.dead = false; }
      if (playing && this.player.dead) this.gameOver();
    }
    // (a co-op client moves its vehicle in its ticks: the view follows after them)
    if (this.mode !== 'client') this.vehicles.update(dt, this.input, playing && !debugCam);
    this.stairs.update(dt, this.input, playing && !debugCam);
    // in a co-op match the world goes on while you're in the menu
    const coop = this.mode !== 'solo' && this.net && this.net.inMatch;
    if (coop) this.net.frame(dt);
    if (this.mode === 'client') this.vehicles.update(dt, this.input, playing && !debugCam);
    // voice chat: hold T (in a room, playing)
    if (this.voice) this.voice.update(this.input, playing && !!this.net);
    if (playing || coop) {
      if (this.mode === 'solo') this.worldStep(dt);
      const armed = !this.vehicles.hidesWeapons;   // guns away while you drive a car or ride a bike
      this.hud.driving(!armed);
      this.weapons.update(dt, this.input, playing && !debugCam && armed);
      if (this.forceAds) this.player.ads = 1;
      if (this.mode === 'host') this.director.shops(dt);
      if (this.mode === 'client') { this.director.update(dt); this.pickups.update(dt); }
      if (coop) this.coopFrame(dt);
      if (playing && this.input.hit('KeyM')) this.hud.toggleMap();
      if (playing && this.input.hit('KeyH')) this.hud.toggleKeys();
      if (playing && this.input.hit('KeyL')) this.flashOn = !this.flashOn;
    }
    // flashlight: on by itself once it's dark, L toggles
    const underground = !!this.underground.at(this.player.pos.x, this.player.pos.z, this.player.pos.y + 0.1);
    const wantLight = this.flashOn !== (this.atmo.lampLevel > 0.6 || underground);
    this.flashlight.intensity = THREE.MathUtils.damp(this.flashlight.intensity, wantLight ? 60 : 0, 12, dt);

    for (const s of this.systems) s.update?.(dt, this.time, this.camera);
    this.effects.update(dt);
    this.hud.update(dt);
    this.touch?.update(playing, this.hud.el.prompt.classList.contains('on'), !!(this.net && this.net.inMatch));
    this.hud.health(this.player.health, this.player.maxHealth, this.player.armour);
    this.hud.boss(this.zombies.bossHealth());
    // (PvP: your foes aren't on your map)
    if ((this.frameCount || 0) % 2 === 0) this.hud.drawMap(this.player, this.zombies.list, [...this.stairs.markers(), ...this.pickups.markers(), ...this.director.markers()], this.net && this.net.inMatch ? this.net.teamStates().filter((q) => q.me || !this.pvp.foes(this.localSlot ?? 0, q.slot)) : []);
    this.atmo.follow(debugCam ? (this.camera.position.y > 30 ? new THREE.Vector3(0, 0, 0) : this.camera.position) : this.player.pos);
    if (this.audio.ctx) this.audio.setListener(this.camera.position, this.player.forward(new THREE.Vector3()));

    // (screenshot tests: a spectator's view of the world going on, {pos: [x,y,z], look: [x,y,z]})
    if (this.specCam) { this.camera.position.fromArray(this.specCam.pos); this.camera.up.set(0, 1, 0); this.camera.lookAt(...this.specCam.look); }
    this.renderer.render(this.scene, this.camera);
    if (!debugCam && !this.specCam && !this.vehicles.hidesWeapons && !this.player.dead) this.weapons.render(this.renderer, this.atmo);
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
// co-op: voice chat, the lobby in the menu and the network overlay
game.voice = new Voice(game);
// Crouch is Ctrl, and on Windows Ctrl+W closes the tab, which no page can stop: one careless W while
// crouched. So while you're in a game, the browser asks before the page goes.
addEventListener('beforeunload', (e) => {
  if (game.leaving || !(game.state === 'playing' || game.state === 'quiz' || (game.net && game.net.inMatch))) return;
  e.preventDefault();
  e.returnValue = '';
});
game.netui = new NetUI(game);
window.__net = game.netui.session;
game.load().then(() => game.start()).catch((e) => {
  console.error(e);
  $('load-text').textContent = 'Failed to load: ' + e.message;
});
