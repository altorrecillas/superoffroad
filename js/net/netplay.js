// The connections of a game on several phones (up to three players: player 1's phone
// is the host, players 2 and 3 join it). Pairing: a room code through the PeerJS cloud,
// or QR codes with no internet at all (one per phone that joins). A hello checks that
// every phone runs the same version, a ping every second watches each link, and the
// race traffic: the host packs the race 60 times a second for each guest and takes
// their controls; a guest keeps the host's clock and the last snapshots to draw the
// race a few hundredths of a second in the past.

import { CloudSignal, ROOM_PREFIX } from './signal.js';
import { Link, ICE_ONLINE } from './link.js';
import { packSDP, unpackSDP } from './sdp.js';
import { packState, unpackState, packInput, unpackInput, kindOf, KIND_STATE, KIND_INPUT } from './state.js';
import { VERSION } from '../version.js';

export const NET_PROTO = 1;
export const MAX_PLAYERS = 3;
const params = new URLSearchParams(location.search);
const sigURL = () => params.get('sig') || undefined; // tests: a local stand-in for the cloud server
const rid = () => Math.random().toString(36).slice(2, 12);

// The host's clock seen from a guest: offset = host time - local time, taken from the
// fastest packets of the last seconds; the race is drawn `delay` ms behind it, a delay
// that grows with the WiFi's jitter (and shrinks back when it calms down)
export class HostClock {
  constructor() { this.samples = []; this.off = null; this.delay = 70; }
  sample(ht, lt) {
    this.samples.push([lt, ht - lt]);
    while (this.samples.length > 8 && lt - this.samples[0][0] > 3000) this.samples.shift();
    let best = -Infinity;
    for (const s of this.samples) if (s[1] > best) best = s[1];
    const lags = this.samples.map((s) => best - s[1]).sort((a, b) => a - b);
    const jitter = lags[Math.floor(lags.length * 0.95)] || 0;
    const want = Math.min(170, Math.max(36, 22 + jitter * 1.3));
    this.delay += (want - this.delay) * (want > this.delay ? 0.2 : 0.02);
    this.off = this.off == null ? best : this.off + (best - this.off) * 0.08;
  }
  now(lt) { return lt + (this.off ?? 0); }
  render(lt) { return this.now(lt) - this.delay; }
}

// One link to another phone (a guest has one, to the host; the host one per guest)
class Peer {
  constructor(net, offerer, ice) {
    this.net = net;
    this.player = null;      // the championship player on the other phone (known after the hello)
    this.open = false;       // connected and greeted
    this.rtt = 0; this.pongs = 0;
    this.heard = performance.now();
    this.stalled = false;
    this.quietTill = 0;      // that phone is building a circuit: silence expected until it says 'loaded'
    this.src = null; this.cid = null; // the room server's ids for this attempt
    // host: this guest's controls (nitro arrives as a count of presses)
    this.rin = { steer: 0, throttle: 0, brake: 0, nitro: false, latch: false, analog: true };
    this.rseq = 0; this.rnitro = -1;
    this.prefs = {};
    const L = (this.link = new Link(offerer, ice));
    L.onopen = () => {
      this.heard = performance.now();
      if (net.role === 'guest') L.send({ t: 'hello', proto: NET_PROTO, version: VERSION, prefs: net.prefs, rejoin: net.token });
      this._pt = setInterval(() => this._ping(), 1000);
    };
    L.onclose = () => this._down();
    L.onmessage = (m) => { this._heard(); net._message(this, m); };
    L.onfast = (buf) => { this._heard(); net._fast(this, buf); };
  }
  send(m) { if (this.link.isOpen) this.link.send(m); }
  _heard() {
    this.heard = performance.now();
    if (this.stalled) { this.stalled = false; this.net._stall(this, false); }
  }
  // a word every second; four seconds of silence is a stall (the other phone in the
  // background, the WiFi dropping out). A loss: the link closing, or ten seconds of
  // silence while the connection itself says the other end is gone (a phone that is only
  // busy still answers at the network level; one without WiFi does not), rather than
  // the half minute a browser waits before giving up: a guest can come back at once
  _ping() {
    const L = this.link;
    if (!L.isOpen) return;
    if (L.rel && L.rel.readyState === 'closed') { L._lost('channel rel closed (seen by the ping)'); return; }
    L.send({ t: 'ping', ts: performance.now() });
    const now = performance.now();
    // this page frozen for a while (a busy phone, a tab coming back): that silence was
    // ours, not the other phone's; its messages are still waiting to be read
    if (this._tick && now - this._tick > 2500) this.heard = Math.max(this.heard, now - 1000);
    this._tick = now;
    const quiet = now - this.heard;
    if (!this.open || now < this.quietTill) return;
    if (!this.stalled && quiet > 4000) { this.stalled = true; this.net._stall(this, true); }
    const ice = L.pc.iceConnectionState;
    if (quiet > 10000 && ice !== 'connected' && ice !== 'completed') L._lost(`${Math.round(quiet / 1000)} s without a word, connection ${ice}`);
  }
  _down() {
    clearInterval(this._pt);
    const was = this.open;
    this.open = false;
    this.net._down(this, was);
  }
  close() { clearInterval(this._pt); this.link.onclose = null; this.link.close(); this.open = false; }
}

export class NetPlay {
  constructor(role) {
    this.role = role;                         // 'host' (player 1) or 'guest'
    this.local = role === 'host' ? 0 : null;  // the championship player on this phone (a guest learns it in the welcome)
    this.mode = null;                         // 'code' or 'qr'
    this.code = null;
    this.sig = null;
    this.peers = [];                          // host: one per guest; guest: the host
    this.max = MAX_PLAYERS;                   // host: players in the room, itself included (2 or 3)
    this.locked = false;                      // host: no new players (the game is about to start or has)
    this.started = false;                     // host: the championship is on (only a known player may come back)
    this.gameId = role === 'host' ? rid() : null;
    this.token = null;                        // guest: what lets it back into the same seat
    this.seats = {};                          // host: token -> player
    this.prefs = {};                          // guest: its options the host needs (steering assist)
    this.handlers = {};
    // events for the game, with the player concerned
    this.onjoin = null; this.onlost = null; this.onstall = null; this.onrejoin = null;
    this.seq = 0;
    // guest: the host's race
    this.snaps = []; this.evq = []; this.clock = new HostClock(); this.iseq = 0; this.nitros = 0;
    this._waiters = [];
  }

  on(type, fn) { this.handlers[type] = fn; }
  log(...a) { if (this.debug) console.info('[net]', ...a); }
  get host() { return this.role === 'guest' ? this.peers[0] : null; }
  get open() { return this.role === 'guest' ? !!(this.peers[0] && this.peers[0].open) : this.peers.some((p) => p.open); }
  get rtt() { const o = this.peers.filter((p) => p.open); return o.length ? Math.max(...o.map((p) => p.rtt)) : 0; }
  get stalled() { return this.peers.some((p) => p.open && p.stalled); }
  // host: the guests in the game, by player
  get guests() { return this.peers.filter((p) => p.open && p.player != null).sort((a, b) => a.player - b.player); }
  peerOf(player) { return this.peers.find((p) => p.player === player && p.open); }
  // to everyone (host) or to the host (guest); `except`: players left out
  send(m, except = null) { for (const p of this.peers) if (p.open && !(except && except.includes(p.player))) p.send(m); }
  sendTo(player, m) { const p = this.peerOf(player); if (p) p.send(m); }
  // a phone building a circuit (and drawing its first frames) is frozen for a while:
  // its silence is expected until it says it is done
  hushPeer(player, ms) {
    const p = this.peers.find((x) => x.player === player);
    if (p) { p.quietTill = ms ? performance.now() + ms : 0; p.heard = performance.now(); }
  }

  // ---------------------------------------------------------------- pairing
  // host, with internet: a free 4-digit room on the cloud server
  async hostCode() {
    this.mode = 'code';
    let last = null;
    for (let i = 0; i < 6; i++) {
      const code = String(1000 + Math.floor(Math.random() * 9000));
      const sig = new CloudSignal(ROOM_PREFIX + code, sigURL());
      try { await sig.open(); } catch (e) { last = e; if (e.message === 'taken') continue; throw e; }
      this.sig = sig; this.code = code;
      sig.onmessage = (m) => this._hostSignal(m);
      sig.onclose = () => { if (this.sig === sig) this.sig = null; };
      return code;
    }
    throw last || new Error('taken');
  }
  _hostSignal(m) {
    const p = m.payload || {};
    if (m.type === 'OFFER') {
      const meta = p.metadata || {};
      if (meta.probe) return; // (a search for games on the WiFi, sent to a beacon)
      // a full or started game only lets a known player back in
      const known = meta.rejoin && this.seats[meta.rejoin] != null;
      this.log('offer from', m.src, { guests: this.guests.length, max: this.max, locked: this.locked, known: !!known });
      if ((this.locked || this.guests.length >= this.max - 1) && !known) return;
      const old = this.peers.find((x) => x.src === m.src && !x.open);
      if (old) { this.peers.splice(this.peers.indexOf(old), 1); old.close(); }
      const peer = new Peer(this, false, ICE_ONLINE);
      peer.src = m.src; peer.cid = p.connectionId;
      this.peers.push(peer);
      peer.link.oncandidate = (c) => { if (this.sig) this.sig.candidate(m.src, c, p.connectionId); };
      peer.link.answer(p.sdp).then((ans) => { if (this.sig && this.peers.includes(peer)) this.sig.answer(m.src, ans, p.connectionId); }).catch(() => {});
    } else if (m.type === 'CANDIDATE') {
      const peer = this.peers.find((x) => x.src === m.src && x.cid === p.connectionId);
      if (peer) peer.link.addCandidate(p.candidate);
    }
  }

  // guest, with internet: knock on the room; resolves once connected and greeted
  async joinCode(code) {
    this.mode = 'code'; this.code = code;
    if (!this.sig) {
      const sig = new CloudSignal(ROOM_PREFIX + 'g' + rid(), sigURL());
      await sig.open();
      this.sig = sig;
      sig.onclose = () => { if (this.sig === sig) this.sig = null; };
    }
    const sig = this.sig, dst = ROOM_PREFIX + code, cid = 'dc_' + rid();
    const peer = this._guestPeer(true, ICE_ONLINE);
    let answered = false;
    peer.link.oncandidate = (c) => sig.candidate(dst, c, cid);
    sig.onmessage = (m) => {
      if (m.src !== dst || !m.payload || m.payload.connectionId !== cid) return;
      if (m.type === 'ANSWER') { answered = true; peer.link.accept(m.payload.sdp).catch(() => {}); } else if (m.type === 'CANDIDATE') peer.link.addCandidate(m.payload.candidate);
    };
    sig.offer(dst, await peer.link.offer(false), cid, { game: 'sor', proto: NET_PROTO, version: VERSION, rejoin: this.token || undefined });
    // twelve seconds for the room to answer (no answer: no such game); once it has, time
    // for the connection itself (a slow WiFi, a relay through the internet)
    await new Promise((resolve, reject) => {
      const w = { peer: null, resolve, reject, t: setTimeout(() => this._settle(w, new Error('nolink')), 45000) };
      this._waiters.push(w);
      setTimeout(() => { if (!answered) this._settle(w, new Error('notfound')); }, 12000);
    });
    // the room's server is not needed any more (a new knock opens it again)
    sig.close(); this.sig = null;
  }
  _guestPeer(offerer, ice) {
    for (const p of this.peers) p.close();
    const peer = new Peer(this, offerer, ice);
    this.peers = [peer];
    return peer;
  }

  // QR, no internet, host: a code to show (a whole offer, for one phone)
  async hostQR() {
    this.mode = 'qr';
    for (const p of this.peers.filter((x) => x.qr && !x.open)) { this.peers.splice(this.peers.indexOf(p), 1); p.close(); }
    const peer = new Peer(this, true, []);
    peer.qr = true;
    this.peers.push(peer);
    return packSDP(await peer.link.offer(true), VERSION);
  }
  // host: the answer read with the camera from the phone that read our code
  async acceptQR(text) {
    const u = unpackSDP(text);
    if (!u || u.type !== 'answer') throw new Error('notours');
    if (u.version !== VERSION) throw new Error('version:' + u.version);
    const peer = this.peers.find((p) => p.qr && !p.open && !p.answered);
    if (!peer) throw new Error('nolink');
    peer.answered = true;
    await peer.link.accept({ type: 'answer', sdp: u.sdp });
    await this.waitOpen(15000, 'nolink', peer);
  }
  // guest: the host's code read with the camera -> the answer to show back
  async joinQR(text) {
    const u = unpackSDP(text);
    if (!u || u.type !== 'offer') throw new Error('notours');
    if (u.version !== VERSION) throw new Error('version:' + u.version);
    this.mode = 'qr';
    const peer = this._guestPeer(false, []);
    return packSDP(await peer.link.answer({ type: 'offer', sdp: u.sdp }, true), VERSION);
  }

  // resolves when a hello is done (that peer's; for a guest, its link to the host;
  // rejects with `why` after `ms` or with the host's refusal)
  waitOpen(ms, why, peer = null) {
    if (peer ? peer.open : this.role === 'guest' && this.open) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const w = { peer, resolve, reject, t: setTimeout(() => this._settle(w, new Error(why)), ms) };
      this._waiters.push(w);
    });
  }
  _settle(w, err) {
    const i = this._waiters.indexOf(w);
    if (i < 0) return;
    this._waiters.splice(i, 1);
    clearTimeout(w.t);
    if (err) w.reject(err); else w.resolve();
  }
  _opened(peer, err = null) { for (const w of this._waiters.slice()) if (!w.peer || w.peer === peer) this._settle(w, err); }

  _message(peer, m) {
    switch (m.t) {
      case 'hello': {
        if (this.role !== 'host') return;
        if (m.proto !== NET_PROTO || m.version !== VERSION) { peer.send({ t: 'refuse', why: 'version', version: VERSION }); return; }
        // back after losing the link: the same seat; a new phone: the first free one
        let player = m.rejoin != null ? this.seats[m.rejoin] : null;
        const back = player != null;
        if (!back) {
          if (this.locked || this.started) { peer.send({ t: 'refuse', why: 'busy', version: VERSION }); return; }
          const taken = new Set(this.peers.filter((p) => p.open && p !== peer).map((p) => p.player));
          player = [1, 2].find((n) => n < this.max && !taken.has(n));
          if (player == null) { peer.send({ t: 'refuse', why: 'full', version: VERSION }); return; }
        }
        // a seat taken back: the old link of that player goes
        for (const p of this.peers.slice()) if (p !== peer && p.player === player) { this.peers.splice(this.peers.indexOf(p), 1); p.close(); }
        const token = back ? m.rejoin : rid();
        this.seats[token] = player;
        peer.player = player; peer.prefs = m.prefs || {}; peer.open = true;
        peer.send({ t: 'welcome', gameId: this.gameId, player, token, version: VERSION });
        this._opened(peer);
        if (back) { if (this.onrejoin) this.onrejoin(player); } else if (this.onjoin) this.onjoin(player);
        return;
      }
      case 'welcome':
        this.gameId = m.gameId; this.local = m.player; this.token = m.token;
        peer.player = 0; peer.open = true;
        this._opened(peer);
        return;
      case 'refuse': this._opened(peer, new Error(m.why === 'version' ? 'version:' + m.version : m.why)); return;
      case 'ping': peer.send({ t: 'pong', ts: m.ts }); return;
      case 'pong': { const r = performance.now() - m.ts; peer.rtt = peer.rtt ? peer.rtt * 0.7 + r * 0.3 : r; peer.pongs++; return; }
      default: { const fn = this.handlers[m.t]; if (fn) fn(m, this.role === 'host' ? peer.player : 0); }
    }
  }
  _stall(peer, on) { if (peer.player != null && this.onstall) this.onstall(peer.player, on); }
  _down(peer, was) {
    if (!was) { this._opened(peer, new Error('nolink')); return; }
    if (this.onlost) this.onlost(peer.player);
  }

  close() {
    this.onjoin = this.onlost = this.onstall = this.onrejoin = null;
    this.handlers = {};
    if (this.beacon) { this.beacon.close(); this.beacon = null; }
    for (const w of this._waiters.slice()) this._settle(w, new Error('closed'));
    for (const p of this.peers) p.close();
    this.peers = [];
    if (this.sig) { this.sig.close(); this.sig = null; }
  }
  // a goodbye that has a chance to arrive before the links go (nothing is heard meanwhile)
  bye() {
    this.onjoin = this.onlost = this.onstall = this.onrejoin = null;
    this.handlers = {};
    this.send({ t: 'bye' });
    setTimeout(() => this.close(), 250);
  }
  // host: let one player go (the others play on)
  drop(player) {
    const p = this.peers.find((x) => x.player === player);
    if (p) { this.peers.splice(this.peers.indexOf(p), 1); p.send({ t: 'bye' }); setTimeout(() => p.close(), 250); }
    for (const [k, v] of Object.entries(this.seats)) if (v === player) delete this.seats[k];
  }

  // ---------------------------------------------------------------- race traffic
  _fast(peer, buf) {
    if (!(buf instanceof ArrayBuffer)) return;
    const k = kindOf(buf);
    if (k === KIND_INPUT && this.role === 'host') {
      const i = unpackInput(buf);
      if (!i || i.seq <= peer.rseq) return;
      peer.rseq = i.seq;
      peer.rin.steer = i.steer; peer.rin.throttle = i.throttle; peer.rin.brake = i.brake;
      if (peer.rnitro >= 0 && i.nitroCount !== peer.rnitro) peer.rin.latch = true;
      peer.rnitro = i.nitroCount;
    } else if (k === KIND_STATE && this.role === 'guest') {
      const s = unpackState(buf);
      if (!s) return;
      this.clock.sample(s.ht, performance.now());
      const sn = this.snaps;
      if (sn.length && s.seq <= sn[sn.length - 1].seq) {
        // late: slot it in place (or drop it if it is older than all we keep)
        if (s.seq < sn[0].seq) return;
        let j = sn.length - 1;
        while (j > 0 && sn[j - 1].seq > s.seq) j--;
        if (sn[j - 1] && sn[j - 1].seq === s.seq) return;
        sn.splice(j, 0, s);
      } else sn.push(s);
      if (sn.length > 90) sn.splice(0, sn.length - 90);
      this.last = s;
    }
  }

  // host: what player p's truck gets this step (null: nobody on that seat)
  remoteInput(p) {
    const peer = this.peerOf(p);
    if (!peer) return null;
    peer.rin.nitro = peer.rin.latch;
    return peer.rin;
  }
  consumeNitro() { for (const p of this.peers) if (p.rin.nitro) { p.rin.latch = false; p.rin.nitro = false; } }
  // host: the race as it is now (to each guest with its own last controls seen), and
  // what happened in it this frame
  sendRace(race, events, flags = 0) {
    const now = performance.now();
    this.seq++;
    for (const p of this.peers) if (p.open) p.link.sendFast(packState(race, this.seq, now, p.rseq, flags));
    if (events.length) this.send({ t: 'ev', ht: now, e: events });
  }
  // guest: start over for a new race
  resetStream() { this.snaps.length = 0; this.evq.length = 0; }
  // guest: this phone's controls, numbered
  sendInput(steer, throttle, brake, nitroPressed) {
    if (nitroPressed) this.nitros = (this.nitros + 1) & 255;
    const h = this.host;
    if (h) h.link.sendFast(packInput(++this.iseq, { steer, throttle, brake }, this.nitros));
  }
  // guest: the two snapshots around time t (host clock): [a, b, k]
  around(t) {
    const sn = this.snaps;
    if (!sn.length) return null;
    let i = sn.length - 1;
    while (i > 0 && sn[i].ht > t) i--;
    const a = sn[i], b = sn[i + 1];
    if (b) return [a, b, b.ht > a.ht ? Math.max(0, Math.min(1, (t - a.ht) / (b.ht - a.ht))) : 0];
    // past the newest: carry on from the last two for a moment (a late packet)
    const p = sn[i - 1];
    if (p && a.ht > p.ht && t > a.ht) return [p, a, Math.min(1.6, 1 + (t - a.ht) / (a.ht - p.ht))];
    return [a, a, 0];
  }
  // guest: forget what is long past
  trim(t) { const sn = this.snaps; let i = 0; while (i < sn.length - 2 && sn[i + 1].ht < t - 200) i++; if (i) sn.splice(0, i); }
}
