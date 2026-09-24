// One WebRTC link between the host and a client, with two data channels:
//   'unrel'  unordered, never retransmitted: inputs and snapshots (a late one is useless anyway)
//   'rel'    reliable and ordered: events (join, leave, kill, match end)
// ICE candidates are gathered before the offer/answer is sent (no trickle), so the handshake is
// one message each way. Only the one STUN server from the join reply is used; there is no relay,
// so a network that blocks direct connections fails, and says so, instead of hanging.

export const CONNECT_TIMEOUT = 15000;

export class Peer {
  constructor(id, iceServers, lane) {
    this.id = id;
    this.lane = lane;
    this.pc = new RTCPeerConnection({ iceServers });
    this.ch = { unrel: null, rel: null };
    this.open = false;
    this.closed = false;
    this.onopen = null;
    this.onclose = null;          // (reason)
    this.onmessage = null;        // (kind, data)
    this.pc.onconnectionstatechange = () => {
      const s = this.pc.connectionState;
      if (s === 'failed') this.close(this.open ? 'lost' : 'unreachable');
      else if (s === 'disconnected') {
        // often comes back by itself within a few seconds
        clearTimeout(this.dropTimer);
        this.dropTimer = setTimeout(() => { if (this.pc.connectionState === 'disconnected') this.close('lost'); }, 5000);
      }
    };
  }

  // no connection within the time limit: this network can't reach the other side directly
  arm() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { if (!this.open) this.close('unreachable'); }, CONNECT_TIMEOUT);
  }

  channels(create) {
    if (create) {
      this.attach(this.pc.createDataChannel('unrel', { ordered: false, maxRetransmits: 0 }));
      this.attach(this.pc.createDataChannel('rel', { ordered: true }));
    } else {
      this.pc.ondatachannel = (e) => this.attach(e.channel);
    }
  }

  attach(c) {
    if (!(c.label in this.ch)) return;
    this.ch[c.label] = c;
    c.onopen = () => {
      if (this.open || this.ch.unrel?.readyState !== 'open' || this.ch.rel?.readyState !== 'open') return;
      this.open = true;
      clearTimeout(this.timer);
      this.onopen?.();
    };
    c.onclose = () => this.close(this.open ? 'left' : 'unreachable');
    c.onmessage = (e) => this.lane.receive(c.label, e.data, (d) => { if (!this.closed) this.onmessage?.(c.label, d); });
  }

  // client side: make the offer (the clock starts once the host has answered)
  async offer() {
    this.channels(true);
    await this.pc.setLocalDescription(await this.pc.createOffer());
    await gathered(this.pc);
    return this.pc.localDescription.sdp;
  }

  // host side: answer a client's offer
  async answer(sdp) {
    this.channels(false);
    this.arm();
    await this.pc.setRemoteDescription({ type: 'offer', sdp });
    await this.pc.setLocalDescription(await this.pc.createAnswer());
    await gathered(this.pc);
    return this.pc.localDescription.sdp;
  }

  // client side: the host's answer arrived; the clock for connecting starts again from here
  async accept(sdp) {
    this.arm();
    await this.pc.setRemoteDescription({ type: 'answer', sdp });
  }

  send(kind, data) {
    const c = this.ch[kind];
    if (!this.open || !c || c.readyState !== 'open') return false;
    this.lane.send(kind, data, (d) => { if (c.readyState === 'open') c.send(d); });
    return true;
  }

  close(reason = 'closed') {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.timer);
    clearTimeout(this.dropTimer);
    try { this.pc.close(); } catch { /* already gone */ }
    this.onclose?.(reason);
  }
}

// wait until the candidates are gathered (with a cap: a slow STUN server shouldn't stall joining)
function gathered(pc, timeout = 3500) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { clearTimeout(t); pc.removeEventListener('icegatheringstatechange', check); resolve(); };
    const check = () => { if (pc.iceGatheringState === 'complete') done(); };
    const t = setTimeout(done, timeout);
    pc.addEventListener('icegatheringstatechange', check);
  });
}
