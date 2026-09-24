// WebAudio: sample playback with 3D panning for zombies, plus synthesized fallbacks so the
// game still sounds right if a sample is missing.
import { settings } from '../config.js';

// Logical sound -> files in assets/audio (several = random variants).
const n = (base, count) => Array.from({ length: count }, (_, i) => `${base}_${String(i + 1).padStart(2, '0')}`);
const BANK = {
  pistol: ['guns/pistol_shot'], rifle: ['guns/rifle_shot'], shotgun: ['guns/shotgun_shot'],
  reload: ['guns/reload_mag_in'], rack: ['guns/reload_rack'], reloadPistol: ['guns/reload_pistol'],
  pump: ['guns/shotgun_pump'], shellIn: ['guns/shotgun_shell_insert'], empty: ['guns/dry_fire'],
  shell: ['guns/shell_casing_01', 'guns/shell_casing_02'], knife: [],
  groan: n('zombies/zombie_groan', 7), attack: n('zombies/zombie_attack', 3), zdeath: n('zombies/zombie_death', 3),
  bite: n('zombies/zombie_bite', 2), hurt: n('player/player_hurt', 3), step: n('player/footstep_concrete', 4),
  heartbeat: ['player/heartbeat_fast_loop'],
  flesh: n('impacts/bullet_flesh', 3), concrete: n('impacts/bullet_concrete', 3), metal: n('impacts/bullet_metal', 3),
  waveStart: ['ui/wave_start_siren'], waveEnd: ['ui/wave_complete'], pickup: ['ui/pickup'], hit: ['ui/hit_marker'], buy: ['ui/buy'],
  ambience: ['ambience/suburb_distant_traffic_loop'], sirens: ['ambience/distant_siren_loop'],
};
const EXT = ['.ogg', '.mp3', '.wav'];

export class Audio {
  constructor() {
    this.ctx = null;
    this.buffers = {};
    this.master = null;
    this.ready = false;
    this.listenerPos = { x: 0, y: 0, z: 0 };
  }

  async init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = settings.vol;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp).connect(this.ctx.destination);
    this.noise = this.makeNoise();
    await Promise.all(Object.entries(BANK).map(async ([key, names]) => {
      const list = (await Promise.all(names.map((nm) => this.load(`assets/audio/${nm}.ogg`)))).filter(Boolean);
      if (list.length) this.buffers[key] = list;
    }));
    this.ready = true;
  }

  async load(url) {
    try {
      const r = await fetch(url);
      if (!r.ok) return null;
      return await this.ctx.decodeAudioData(await r.arrayBuffer());
    } catch (e) { return null; }
  }

  resume() { if (this.ctx && this.ctx.state !== 'running') this.ctx.resume(); }
  setVolume(v) { if (this.master) this.master.gain.value = v; }

  setListener(pos, forward) {
    if (!this.ctx) return;
    const l = this.ctx.listener, t = this.ctx.currentTime;
    this.listenerPos = pos;
    if (l.positionX) {
      l.positionX.setValueAtTime(pos.x, t); l.positionY.setValueAtTime(pos.y, t); l.positionZ.setValueAtTime(pos.z, t);
      l.forwardX.setValueAtTime(forward.x, t); l.forwardY.setValueAtTime(forward.y, t); l.forwardZ.setValueAtTime(forward.z, t);
      l.upX.setValueAtTime(0, t); l.upY.setValueAtTime(1, t); l.upZ.setValueAtTime(0, t);
    } else {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(forward.x, forward.y, forward.z, 0, 1, 0);
    }
  }

  // Play a sound. opts: {pos: {x,y,z}, vol, rate, loop}
  play(key, opts = {}) {
    if (!this.ctx || this.ctx.state !== 'running') return null;
    const bufs = this.buffers[key];
    const out = this.route(opts);
    if (!bufs) { this.synth(key, out, opts); return null; }
    const src = this.ctx.createBufferSource();
    src.buffer = bufs[Math.floor(Math.random() * bufs.length)];
    src.playbackRate.value = (opts.rate || 1) * (1 + (Math.random() - 0.5) * (opts.jitter ?? 0.08));
    src.loop = !!opts.loop;
    let head = out;
    if (opts.lowpass) {
      // muffled, far-away version (e.g. a siren somewhere across the city)
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = opts.lowpass;
      f.connect(out); head = f;
    }
    if (opts.fade) {
      const g = this.ctx.createGain(), t = this.ctx.currentTime;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(1, t + 0.6);
      g.gain.setValueAtTime(1, t + Math.max(0.7, opts.fade - 1.5));
      g.gain.exponentialRampToValueAtTime(0.0001, t + opts.fade);
      g.connect(head); head = g;
    }
    src.connect(head);
    src.start();
    if (opts.fade) src.stop(this.ctx.currentTime + opts.fade + 0.1);
    return src;
  }

  route(opts) {
    const g = this.ctx.createGain();
    g.gain.value = opts.vol ?? 1;
    if (opts.pos) {
      const p = this.ctx.createPanner();
      p.panningModel = 'HRTF';
      p.distanceModel = 'inverse';
      p.refDistance = opts.ref ?? 3;
      p.rolloffFactor = 1.1;
      p.maxDistance = 120;
      p.positionX ? (p.positionX.value = opts.pos.x, p.positionY.value = opts.pos.y, p.positionZ.value = opts.pos.z)
        : p.setPosition(opts.pos.x, opts.pos.y, opts.pos.z);
      g.connect(p).connect(this.master);
    } else {
      g.connect(this.master);
    }
    return g;
  }

  makeNoise() {
    const len = this.ctx.sampleRate * 1.5;
    const b = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  // Cheap synthesized stand-ins.
  synth(key, out, opts) {
    const c = this.ctx, t = c.currentTime;
    const env = (node, a, peak, d) => {
      const g = c.createGain(); g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + a);
      g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
      node.connect(g).connect(out); return g;
    };
    const noise = (freq, q = 0.7, type = 'lowpass') => {
      const s = c.createBufferSource(); s.buffer = this.noise;
      const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      s.connect(f); s.start(t); s.stop(t + 1.4); return f;
    };
    const tone = (type, f0, f1, dur) => {
      const o = c.createOscillator(); o.type = type;
      o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
      o.start(t); o.stop(t + dur + 0.05); return o;
    };
    switch (key) {
      case 'pistol': env(noise(2600), 0.002, 0.9, 0.18); env(tone('square', 180, 60, 0.12), 0.002, 0.25, 0.12); break;
      case 'rifle': env(noise(3200), 0.002, 1.0, 0.16); env(tone('sawtooth', 140, 45, 0.1), 0.002, 0.35, 0.1); break;
      case 'shotgun': env(noise(1600), 0.003, 1.2, 0.42); env(tone('sawtooth', 90, 30, 0.25), 0.002, 0.5, 0.25); break;
      case 'empty': env(noise(5000, 4, 'bandpass'), 0.001, 0.4, 0.03); break;
      case 'reload': env(noise(3500, 3, 'bandpass'), 0.002, 0.35, 0.06); break;
      case 'knife': env(noise(4200, 1, 'highpass'), 0.01, 0.4, 0.12); break;
      case 'step': env(noise(900, 1.5), 0.004, 0.12, 0.07); break;
      case 'flesh': env(noise(600, 1.2), 0.003, 0.5, 0.12); break;
      case 'concrete': env(noise(3800, 2, 'bandpass'), 0.001, 0.35, 0.05); break;
      case 'groan': {
        const o = tone('sawtooth', 95 + Math.random() * 40, 70, 1.2);
        const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 520;
        const lfo = c.createOscillator(); lfo.frequency.value = 5 + Math.random() * 4;
        const lg = c.createGain(); lg.gain.value = 12; lfo.connect(lg).connect(o.frequency); lfo.start(t); lfo.stop(t + 1.3);
        o.connect(f); env(f, 0.12, 0.45, 1.0); break;
      }
      case 'attack': { const o = tone('sawtooth', 160, 90, 0.5); env(o, 0.03, 0.5, 0.45); env(noise(1400), 0.02, 0.4, 0.4); break; }
      case 'zdeath': { const o = tone('sawtooth', 120, 40, 0.9); env(o, 0.02, 0.5, 0.85); break; }
      case 'bite': env(noise(1100, 2), 0.004, 0.8, 0.2); break;
      case 'hurt': { const o = tone('triangle', 240, 150, 0.25); env(o, 0.01, 0.5, 0.22); break; }
      case 'hit': env(tone('square', 1800, 1700, 0.04), 0.001, 0.15, 0.04); break;
      case 'pickup': case 'buy': env(tone('sine', 660, 990, 0.18), 0.005, 0.35, 0.2); break;
      case 'waveStart': { const o = tone('sawtooth', 55, 50, 2.5); const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 300; o.connect(f); env(f, 0.4, 0.7, 2.2); env(tone('sine', 220, 110, 2.2), 0.3, 0.25, 2.0); break; }
      case 'waveEnd': env(tone('sine', 330, 660, 0.9), 0.05, 0.35, 0.9); break;
      case 'explosion': {
        // a close crack, a deep thump and a long rumbling tail
        env(noise(5200, 0.8), 0.001, 1.2, 0.12);
        env(noise(900, 0.7), 0.002, 1.6, 1.3);
        env(tone('sine', 110, 28, 1.1), 0.002, 1.0, 1.1);
        env(noise(240, 0.6), 0.05, 0.9, 1.35);
        break;
      }
      case 'burst': { env(noise(700, 1.2), 0.002, 1.1, 0.5); env(tone('sine', 90, 35, 0.5), 0.002, 0.8, 0.5); env(noise(2400, 2, 'bandpass'), 0.01, 0.5, 0.35); break; }
      case 'hiss': { const f = noise(3800, 1.5, 'highpass'); env(f, 0.05, 0.35, 0.65); env(tone('sawtooth', 70, 60, 0.7), 0.05, 0.25, 0.65); break; }
      case 'growl': {
        const o = tone('sawtooth', 70 + Math.random() * 25, 55, 0.7);
        const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700;
        const lfo = c.createOscillator(); lfo.frequency.value = 28 + Math.random() * 10;
        const lg = c.createGain(); lg.gain.value = 18; lfo.connect(lg).connect(o.frequency); lfo.start(t); lfo.stop(t + 0.8);
        o.connect(f); env(f, 0.04, 0.55, 0.6); break;
      }
      case 'yelp': { const o = tone('triangle', 900, 380, 0.3); env(o, 0.01, 0.45, 0.28); env(noise(1800, 2, 'bandpass'), 0.01, 0.25, 0.2); break; }
      case 'caw': {
        for (let k = 0; k < 2; k++) {
          const o = c.createOscillator(); o.type = 'sawtooth';
          const t0 = t + k * 0.22;
          o.frequency.setValueAtTime(760, t0); o.frequency.exponentialRampToValueAtTime(520, t0 + 0.16);
          const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1300; f.Q.value = 2;
          const g = c.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.4, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
          o.connect(f).connect(g).connect(out); o.start(t0); o.stop(t0 + 0.2);
        }
        break;
      }
      case 'scream': {
        const o = tone('sawtooth', 520, 900, 1.3);
        const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1600; f.Q.value = 1.2;
        const lfo = c.createOscillator(); lfo.frequency.value = 9;
        const lg = c.createGain(); lg.gain.value = 60; lfo.connect(lg).connect(o.frequency); lfo.start(t); lfo.stop(t + 1.4);
        o.connect(f); env(f, 0.06, 0.8, 1.2); env(noise(2600, 1, 'bandpass'), 0.05, 0.35, 1.1); break;
      }
      case 'bow': { env(noise(900, 1.5, 'bandpass'), 0.001, 0.8, 0.09); env(tone('sine', 180, 90, 0.18), 0.001, 0.5, 0.16); env(noise(3000, 1, 'highpass'), 0.002, 0.25, 0.12); break; }
      case 'bowDraw': { const f = noise(420, 3, 'bandpass'); env(f, 0.25, 0.18, 0.45); break; }
      case 'arrowHit': { env(noise(1400, 1.5), 0.001, 0.7, 0.08); env(tone('triangle', 260, 120, 0.12), 0.001, 0.4, 0.12); break; }
      case 'pin': { env(noise(6000, 6, 'bandpass'), 0.001, 0.35, 0.05); env(tone('square', 2400, 2300, 0.03), 0.001, 0.12, 0.03); break; }
      case 'throw': env(noise(1200, 0.8), 0.03, 0.3, 0.18); break;
      case 'clink': env(tone('triangle', 2100 + Math.random() * 400, 1800, 0.08), 0.001, 0.35, 0.08); break;
      case 'heal': env(tone('sine', 520, 880, 0.35), 0.01, 0.3, 0.35); env(tone('sine', 780, 1320, 0.3), 0.06, 0.18, 0.3); break;
      case 'cash': env(tone('square', 1320, 1318, 0.06), 0.002, 0.15, 0.06); env(tone('square', 1760, 1758, 0.12), 0.07, 0.15, 0.12); break;
      case 'waveSoft': {
        env(tone('sine', 70, 38, 1.4), 0.01, 0.55, 1.4);
        const d = tone('sawtooth', 55, 52, 2.2); const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 180; d.connect(f); env(f, 0.35, 0.18, 1.8);
        break;
      }
      default: break;
    }
  }
}
