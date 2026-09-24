import { MSG } from './protocol.js';

// Voice chat between the players: hold T to talk (or leave the mic open), and everyone else in the
// match hears you.
//
// The game carries it itself, over the same link as everything else (direct, or the relay), so it
// works wherever the game does. The browser's Opus encoder packs 60 ms of microphone into ~180
// bytes; clients send theirs to the host, and the host plays it and passes it on to the others.
// Each voice goes through a small jitter buffer (~120 ms) and its own gain (muted: silent).
//
//   packet: [u8 MSG.VOICE][u8 speaker's slot][u32 seq][opus]

const RATE = 48000, FRAME_MS = 60, FRAME = (RATE * FRAME_MS) / 1000;   // 2880 samples a packet
// the microphone, 128 samples at a time, from the audio thread
const WORKLET = `registerProcessor('gd-mic', class extends AudioWorkletProcessor {
  process(inputs) { const c = inputs[0] && inputs[0][0]; if (c) this.port.postMessage(c.slice(0)); return true; }
});`;

export class Voice {
  constructor(game) {
    this.g = game;
    let mode = 'ptt';
    try { mode = localStorage.getItem('gd-voice') || 'ptt'; } catch { /* no storage */ }
    this.mode = mode;                 // 'ptt' (hold T) | 'open' (always on) | 'off' (no mic, hear no one)
    this.muted = new Set();           // players' slots we don't want to hear
    this.speakers = new Map();        // slot -> { dec, gain, t, last, talkT }
    this.talking = false;             // we're sending right now
    this.state = typeof AudioEncoder === 'undefined' || typeof AudioDecoder === 'undefined' ? 'unsupported' : 'idle';
    this.send = null;                 // (packet) the net layer's way out
    this.seq = 0; this.ts = 0;
    this.pcm = new Float32Array(FRAME); this.fill = 0; this.phase = 0; this.lastIn = 0;
  }

  setMode(m) {
    this.mode = m;
    try { localStorage.setItem('gd-voice', m); } catch { /* no storage */ }
    if (m === 'off') for (const sp of this.speakers.values()) sp.gain.gain.value = 0;
    else for (const [slot, sp] of this.speakers) sp.gain.gain.value = this.muted.has(slot) ? 0 : 1.3;
  }

  toggleMute(slot) {
    if (this.muted.has(slot)) this.muted.delete(slot); else this.muted.add(slot);
    const sp = this.speakers.get(slot);
    if (sp) sp.gain.gain.value = this.muted.has(slot) || this.mode === 'off' ? 0 : 1.3;
  }

  // the microphone (the browser asks the first time)
  async startMic() {
    if (this.mic || this.state === 'asking' || this.state === 'unsupported') return;
    const a = this.g.audio;
    if (!a.ctx) await a.init();
    a.resume();
    const ctx = a.ctx;
    this.state = 'asking';
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
      if (!this.workletAdded) { await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }))); this.workletAdded = true; }
      const src = ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ctx, 'gd-mic', { numberOfInputs: 1, numberOfOutputs: 1 });
      const sink = ctx.createGain(); sink.gain.value = 0;   // (pulled by the graph, heard by no one)
      src.connect(node); node.connect(sink).connect(ctx.destination);
      node.port.onmessage = (e) => this.capture(e.data, ctx.sampleRate);
      this.enc = new AudioEncoder({ output: (chunk) => this.encoded(chunk), error: (e) => console.warn('voice encoder', e.message) });
      this.enc.configure({ codec: 'opus', sampleRate: RATE, numberOfChannels: 1, bitrate: 24000, opus: { frameDuration: FRAME_MS * 1000, complexity: 5, usedtx: true } });
      this.mic = { stream, src, node, sink };
      this.state = 'on';
    } catch (e) {
      this.state = e && e.name === 'NotAllowedError' ? 'denied' : 'failed';
      this.g.hud?.notice(this.state === 'denied' ? 'Microphone blocked: allow it for this site to talk' : 'No microphone found');
    }
  }

  stopMic() {
    if (!this.mic) return;
    for (const t of this.mic.stream.getTracks()) t.stop();
    try { this.mic.src.disconnect(); this.mic.node.disconnect(); } catch { /* gone */ }
    try { this.enc.close(); } catch { /* closed */ }
    this.mic = null; this.enc = null; this.state = 'idle'; this.talking = false;
  }

  // 128 samples from the mic at the context's rate: to 48 kHz, into 60 ms frames, to the encoder
  capture(chunk, rate) {
    if (!this.talking || !this.enc || this.enc.state !== 'configured') { this.fill = 0; return; }
    const step = rate / RATE;
    if (step === 1) this.push(chunk);
    else {
      // (plain linear resampling: speech doesn't mind)
      const out = [];
      let p = this.phase;
      for (; p < chunk.length - 1; p += step) { const i = Math.floor(p), f = p - i; out.push(chunk[i] * (1 - f) + chunk[i + 1] * f); }
      this.phase = p - (chunk.length - 1);
      this.push(out);
    }
  }

  push(samples) {
    for (let k = 0; k < samples.length; k++) {
      this.pcm[this.fill++] = samples[k];
      if (this.fill === FRAME) {
        const ad = new AudioData({ format: 'f32-planar', sampleRate: RATE, numberOfFrames: FRAME, numberOfChannels: 1, timestamp: this.ts, data: this.pcm });
        this.ts += FRAME_MS * 1000;
        try { this.enc.encode(ad); } catch { /* reconfiguring */ }
        ad.close();
        this.fill = 0;
      }
    }
  }

  encoded(chunk) {
    if (!this.talking || !this.send) return;
    const b = new Uint8Array(6 + chunk.byteLength);
    b[0] = MSG.VOICE; b[1] = 255;   // (the slot: filled in by whoever sends it on)
    new DataView(b.buffer).setUint32(2, this.seq++);
    chunk.copyTo(b.subarray(6));
    this.send(b.buffer);
  }

  // a voice packet from someone else
  receive(buf) {
    if (this.mode === 'off' || this.state === 'unsupported') return;
    const a = this.g.audio;
    if (!a.ctx) return;
    const v = new DataView(buf), slot = v.getUint8(1), seq = v.getUint32(2);
    const sp = this.speaker(slot);
    sp.talkT = performance.now();
    if (sp.last >= 0 && seq <= sp.last && sp.last - seq < 5000) return;   // (late, or a repeat)
    sp.last = seq;
    if (this.muted.has(slot)) return;
    try { sp.dec.decode(new EncodedAudioChunk({ type: 'key', timestamp: seq * FRAME_MS * 1000, data: new Uint8Array(buf, 6) })); } catch { /* bad packet */ }
  }

  speaker(slot) {
    let sp = this.speakers.get(slot);
    if (sp) return sp;
    const a = this.g.audio;
    const gain = a.ctx.createGain();
    gain.gain.value = this.muted.has(slot) ? 0 : 1.3;
    gain.connect(a.master);
    sp = { gain, t: 0, last: -1, talkT: 0, dec: null };
    sp.dec = new AudioDecoder({ output: (ad) => this.play(sp, ad), error: (e) => console.warn('voice decoder', e.message) });
    sp.dec.configure({ codec: 'opus', sampleRate: RATE, numberOfChannels: 1 });
    this.speakers.set(slot, sp);
    return sp;
  }

  // one decoded packet, queued right after the last one (a little slack in case the next is late)
  play(sp, ad) {
    const ctx = this.g.audio.ctx, n = ad.numberOfFrames;
    const pcm = new Float32Array(n);
    ad.copyTo(pcm, { planeIndex: 0, format: 'f32-planar' });
    const buf = ctx.createBuffer(1, n, ad.sampleRate);
    ad.close();
    buf.copyToChannel(pcm, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(sp.gain);
    const now = ctx.currentTime;
    if (sp.t < now + 0.02 || sp.t > now + 0.6) sp.t = now + 0.12;   // started, or fell behind: restart the buffer
    src.start(sp.t);
    sp.t += buf.duration;
    this.played = (this.played || 0) + 1;
  }

  // every frame: push-to-talk, and who's talking (for the team panel)
  update(input, playing) {
    const want = this.state !== 'unsupported' && !!this.send && playing && (this.mode === 'open' || (this.mode === 'ptt' && input.down('KeyT')));
    if (want && !this.mic && this.state !== 'asking' && this.state !== 'denied') this.startMic();
    const was = this.talking;
    this.talking = want && this.state === 'on';
    if (was && !this.talking) this.fill = 0;
  }

  // slots heard in the last moment (and ours, while we talk)
  talkingSlots(mySlot) {
    const now = performance.now(), out = new Set();
    for (const [slot, sp] of this.speakers) if (now - sp.talkT < 350) out.add(slot);
    if (this.talking) out.add(mySlot);
    return out;
  }

  reset() {
    for (const sp of this.speakers.values()) { try { sp.dec.close(); } catch { /* closed */ } sp.gain.disconnect(); }
    this.speakers.clear();
    this.send = null;
    this.talking = false;
  }
}
