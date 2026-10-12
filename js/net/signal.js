// Room codes: the PeerJS cloud server (free and public) only introduces the two phones.
// Each one registers an id on a WebSocket and the server passes small JSON messages
// between ids: the WebRTC offer, the answer and the network candidates. The race
// itself then goes straight from phone to phone. Same protocol and message shapes as
// the PeerJS client (https://github.com/peers/peerjs-server), without the library: the
// cloud server only passes on offers, answers and candidates shaped like the ones the
// PeerJS DataConnection sends.

const CLOUD = 'wss://0.peerjs.com:443/peerjs';
export const ROOM_PREFIX = 'sor-remastered-';

export class CloudSignal {
  constructor(id, url) {
    this.id = id;
    this.url = url || CLOUD;
    this.ws = null;
    this.onmessage = null; // ({type, src, payload})
    this.onclose = null;
    this._hb = 0;
  }

  // registered: resolves; the id in use ('taken'), no network or no answer: rejects
  open(timeout = 15000) {
    return new Promise((resolve, reject) => {
      const token = Math.random().toString(36).slice(2);
      let ws, done = false;
      const fail = (why) => { if (done) return; done = true; clearTimeout(t); this.close(); reject(new Error(why)); };
      const t = setTimeout(() => fail('timeout'), timeout);
      try { ws = new WebSocket(`${this.url}?key=peerjs&id=${encodeURIComponent(this.id)}&token=${token}&version=1.5.5`); } catch (e) { fail('network'); return; }
      this.ws = ws;
      ws.onmessage = (e) => {
        let m;
        try { m = JSON.parse(e.data); } catch (err) { return; }
        if (m.type === 'OPEN') {
          if (done) return;
          done = true; clearTimeout(t);
          this._hb = setInterval(() => this._raw({ type: 'HEARTBEAT' }), 5000);
          resolve();
        } else if (m.type === 'ID-TAKEN') fail('taken');
        else if (m.type === 'ERROR' || m.type === 'INVALID-KEY') fail('error');
        else if (this.onmessage) this.onmessage(m);
      };
      ws.onerror = () => fail('network');
      ws.onclose = () => {
        clearInterval(this._hb);
        if (!done) { fail('closed'); return; }
        if (this.ws === ws) { this.ws = null; if (this.onclose) this.onclose(); }
      };
    });
  }

  get ready() { return !!this.ws && this.ws.readyState === 1; }
  // cid: the connection's id (one per attempt); meta: anything that travels with the offer
  offer(dst, sdp, cid, meta) { this._raw({ type: 'OFFER', payload: { sdp, type: 'data', connectionId: cid, label: cid, reliable: true, serialization: 'json', metadata: meta }, dst }); }
  answer(dst, sdp, cid, meta) { this._raw({ type: 'ANSWER', payload: { sdp, type: 'data', connectionId: cid, ...(meta ? { metadata: meta } : {}) }, dst }); }
  candidate(dst, candidate, cid) { this._raw({ type: 'CANDIDATE', payload: { candidate, type: 'data', connectionId: cid }, dst }); }
  _raw(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  close() {
    clearInterval(this._hb);
    const ws = this.ws;
    this.ws = null;
    if (ws) { ws.onclose = ws.onmessage = ws.onerror = null; try { ws.close(); } catch (e) { /* already closed */ } }
  }
}
