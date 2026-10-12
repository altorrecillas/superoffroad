// Games on the same WiFi, found without typing anything. A web page cannot look around
// the local network (no broadcast, no mDNS), but phones on the same WiFi reach the
// internet through the same public address. Each phone asks a STUN server for it (the
// same one WebRTC uses) and turns it into a short key; a host announces its room on a
// "beacon" id built from that key on the PeerJS cloud, and the other phones of the
// network ask those ids every few seconds who is there. Needs internet (the QR codes do
// not); a network whose phones show different addresses simply finds nothing.

import { CloudSignal, ROOM_PREFIX } from './signal.js';
import { VERSION } from '../version.js';

export const LAN_SLOTS = 4; // rooms announced at once on one network
const params = new URLSearchParams(location.search);
const sigURL = () => params.get('sig') || undefined;
const rid = () => Math.random().toString(36).slice(2, 12);
// a probe or a beacon's reply carries no real connection (the cloud wants a description)
export const PROBE_SDP = { type: 'offer', sdp: 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n' };
const beaconId = (key, slot) => `${ROOM_PREFIX}lan-${key}-${slot}`;

// a short, fixed hash (the address itself never travels)
function hash36(s) {
  let a = 0x811c9dc5, b = 0x9747b28c;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995); b ^= b >>> 13;
  }
  return ((a >>> 0).toString(36) + (b >>> 0).toString(36)).slice(0, 12);
}

// this network's key: from the public IPv4 address, or the /64 network of an IPv6 one
// (null without internet). Tests: ?lankey=…
let cached = null;
export async function lanKey(timeout = 2500) {
  if (params.get('lankey')) return params.get('lankey');
  if (cached && performance.now() - cached.t < 30000) return cached.key;
  if (!window.RTCPeerConnection) return null;
  const found = new Set();
  let pc;
  try {
    pc = new RTCPeerConnection({ iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }] });
    pc.createDataChannel('lan');
    await new Promise((resolve) => {
      const t = setTimeout(resolve, timeout);
      const done = () => { clearTimeout(t); resolve(); };
      pc.onicecandidate = (e) => {
        const m = e.candidate && / (\S+) \d+ typ srflx/.exec(e.candidate.candidate || '');
        if (m) found.add(m[1]);
        if (m && /^\d+\.\d+\.\d+\.\d+$/.test(m[1])) done(); // an IPv4 address: enough
      };
      pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === 'complete') done(); };
      pc.createOffer().then((o) => pc.setLocalDescription(o)).catch(done);
    });
  } catch (e) { /* no WebRTC here */ }
  if (pc) pc.close();
  const v4 = [...found].find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a));
  const v6 = [...found].filter((a) => a.includes(':')).map((a) => a.split(':').slice(0, 4).join(':')).sort()[0];
  const net = v4 || v6;
  const key = net ? hash36('sor-lan|' + net) : null;
  cached = { key, t: performance.now() };
  return key;
}

// host: announce a room on this network (until close)
export class LanBeacon {
  constructor(info) { this.info = info; this.sig = null; } // info(): { code, n, max }
  async start(key) {
    for (let s = 1; s <= LAN_SLOTS && !this.closed; s++) {
      const sig = new CloudSignal(beaconId(key, s), sigURL());
      try { await sig.open(); } catch (e) { if (e.message === 'taken') continue; return false; }
      if (this.closed) { sig.close(); return false; }
      this.sig = sig;
      sig.onmessage = (m) => {
        const p = m.payload || {};
        if (m.type !== 'OFFER' || !p.metadata || !p.metadata.probe) return;
        const i = this.info();
        if (i) sig.answer(m.src, { ...PROBE_SDP, type: 'answer' }, p.connectionId, { lan: { ...i, v: VERSION } });
      };
      return true;
    }
    return false;
  }
  close() { this.closed = true; if (this.sig) this.sig.close(); this.sig = null; }
}

// the other phones: who is announcing a room on this network (onlist(list) on changes)
export class LanFinder {
  // alive(): false once the screen showing the list is gone (the search stops)
  constructor(onlist, alive = () => true) { this.onlist = onlist; this.alive = alive; this.games = new Map(); this.sig = null; }
  async start(key) {
    this.key = key;
    const sig = new CloudSignal(ROOM_PREFIX + 'f' + rid(), sigURL());
    await sig.open();
    if (this.closed) { sig.close(); return; }
    this.sig = sig;
    sig.onmessage = (m) => {
      const lan = m.type === 'ANSWER' && m.payload && m.payload.metadata && m.payload.metadata.lan;
      if (!lan || !/^\d{4}$/.test(String(lan.code))) return;
      this.games.set(m.src, { code: String(lan.code), n: lan.n | 0, max: lan.max | 0, v: String(lan.v || ''), seen: performance.now() });
      this._emit();
    };
    this._probe();
    this.t = setInterval(() => this._probe(), 2500);
  }
  _probe() {
    if (!this.sig) return;
    if (!this.alive()) { this.stop(); return; }
    const now = performance.now();
    for (const [k, g] of this.games) if (now - g.seen > 6500) this.games.delete(k); // gone (or started)
    this._emit();
    for (let s = 1; s <= LAN_SLOTS; s++) this.sig.offer(beaconId(this.key, s), PROBE_SDP, 'dc_' + rid(), { probe: 1 });
  }
  _emit() {
    const list = [...this.games.values()].sort((a, b) => a.code.localeCompare(b.code));
    const sig = JSON.stringify(list.map((g) => [g.code, g.n, g.max, g.v]));
    if (sig === this._last) return;
    this._last = sig;
    if (this.onlist) this.onlist(list);
  }
  stop() { this.closed = true; clearInterval(this.t); if (this.sig) this.sig.close(); this.sig = null; }
}
