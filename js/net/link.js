// The connection between the two phones: WebRTC data channels, straight from one
// browser to the other over the WiFi (or a phone's hotspot). Two channels: 'rel'
// (reliable and in order: menus, results, race events) and 'fast' (unordered, never
// resent: the 60-a-second race state and the controls, where only the newest counts).

// with internet: STUN finds the public address and the PeerJS TURN relay helps when
// the two networks do not let a direct connection through
export const ICE_ONLINE = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
];

export class Link {
  // offerer: the side that creates the offer (and the channels)
  constructor(offerer, iceServers = []) {
    this.offerer = offerer;
    this.pc = new RTCPeerConnection({ iceServers });
    this.rel = null;
    this.fast = null;
    this.isOpen = false;
    this.closed = false;
    this.onopen = null; this.onclose = null; this.onmessage = null; this.onfast = null; this.oncandidate = null;
    this._pending = []; // candidates that came before the remote description
    if (offerer) {
      this._channel(this.pc.createDataChannel('rel', { ordered: true }));
      this._channel(this.pc.createDataChannel('fast', { ordered: false, maxRetransmits: 0 }));
    } else this.pc.ondatachannel = (e) => this._channel(e.channel);
    this.pc.onicecandidate = (e) => { if (e.candidate && e.candidate.candidate && this.oncandidate) this.oncandidate(e.candidate.toJSON()); };
    this.pc.onconnectionstatechange = () => {
      const s = this.pc.connectionState;
      if (s === 'failed' || s === 'closed') this._lost('connection ' + s);
    };
  }

  _channel(ch) {
    ch.binaryType = 'arraybuffer';
    if (ch.label === 'rel') this.rel = ch; else if (ch.label === 'fast') this.fast = ch; else return;
    ch.onopen = () => {
      if (this.isOpen || !this.rel || !this.fast || this.rel.readyState !== 'open' || this.fast.readyState !== 'open') return;
      this.isOpen = true;
      if (this.onopen) this.onopen();
    };
    ch.onclose = () => this._lost(`channel ${ch.label} closed`);
    // a channel's own errors (Safari reports a send that a closing channel could not
    // finish): the close that follows is what counts
    ch.onerror = () => {};
    ch.onmessage = (e) => {
      if (ch === this.rel) {
        let m;
        try { m = JSON.parse(e.data); } catch (err) { return; }
        if (this.onmessage) this.onmessage(m);
      } else if (this.onfast) this.onfast(e.data);
    };
  }

  // waitAll: wait until every network candidate is in the description (no trickle:
  // the QR carries everything in one go)
  async offer(waitAll = false) {
    await this.pc.setLocalDescription(await this.pc.createOffer());
    if (waitAll) await this._gathered();
    return this.pc.localDescription.toJSON();
  }
  async answer(remote, waitAll = false) {
    await this._remote(remote);
    await this.pc.setLocalDescription(await this.pc.createAnswer());
    if (waitAll) await this._gathered();
    return this.pc.localDescription.toJSON();
  }
  accept(remote) { return this._remote(remote); }
  async _remote(desc) {
    await this.pc.setRemoteDescription(desc);
    for (const c of this._pending.splice(0)) this.pc.addIceCandidate(c).catch(() => {});
  }
  addCandidate(c) {
    if (!c) return;
    if (!this.pc.remoteDescription) { this._pending.push(c); return; }
    this.pc.addIceCandidate(c).catch(() => {});
  }
  _gathered(timeout = 5000) {
    return new Promise((resolve) => {
      if (this.pc.iceGatheringState === 'complete') { resolve(); return; }
      const t = setTimeout(done, timeout);
      function done() { clearTimeout(t); resolve(); }
      this.pc.addEventListener('icegatheringstatechange', () => { if (this.pc.iceGatheringState === 'complete') done(); });
    });
  }

  // (nothing once the link is going: Safari complains about a send it could not finish
  // even when the error is caught)
  send(m) { if (!this.closed && !this.quiet && this.rel && this.rel.readyState === 'open') { try { this.rel.send(JSON.stringify(m)); } catch (e) { /* closing */ } } }
  // the newest state is all that matters: skip a packet rather than queue them up
  sendFast(buf) { if (!this.closed && !this.quiet && this.fast && this.fast.readyState === 'open' && this.fast.bufferedAmount < 64000) { try { this.fast.send(buf); } catch (e) { /* closing */ } } }
  // the last word said (a goodbye): from now on this side only listens until it closes
  hush() { this.quiet = true; }

  _lost(why = '') {
    if (this.closed) return;
    this.closed = true;
    if (this.isOpen && why) console.warn('[net] link lost:', why); // (what a phone can tell when a game drops)
    const was = this.isOpen;
    this.isOpen = false;
    try { this.pc.close(); } catch (e) { /* already */ }
    if (this.onclose) this.onclose(was);
  }
  close() {
    this.onclose = null;
    this._lost();
  }
}
