// A WebRTC offer or answer squeezed into a short text for a QR code, and back.
// A data-channel description only needs: the ICE user and password, the DTLS
// certificate fingerprint and the network candidates (address, port, kind). The rest
// is the same for every browser, so it is rebuilt here. Both Chrome and Safari write
// the offer with 'setup:actpass' and the answer with 'setup:active'.
// Packed: SOR<proto>|<game version>|o or a|ufrag|pwd|fingerprint (base64)|candidates
// candidates: "address port kind" joined by ','; kind h host, s srflx, r relay;
// an mDNS name (<uuid>.local) travels as '=' + its 16 bytes in base64.

export const QR_PROTO = 1;
const TYPES = { host: 'h', srflx: 's', prflx: 's', relay: 'r' };
const TYPE_NAME = { h: 'host', s: 'srflx', r: 'relay' };
const PREF = { h: 126, s: 100, r: 0 };

const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function packSDP(desc, version) {
  const sdp = desc.sdp;
  const get = (k) => { const m = new RegExp(`^a=${k}:(.+)$`, 'm').exec(sdp); return m ? m[1].trim() : ''; };
  const fp = get('fingerprint').split(' ')[1] || '';
  const cands = [];
  for (const m of sdp.matchAll(/^a=candidate:\S+ (\d) (\w+) \d+ (\S+) (\d+) typ (\w+)/gm)) {
    const [, comp, proto, addr, port, type] = m;
    if (comp !== '1' || proto.toLowerCase() !== 'udp' || !TYPES[type]) continue;
    const mdns = /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})\.local$/i.exec(addr);
    const a = mdns ? '=' + b64(mdns.slice(1).join('').match(/../g).map((h) => parseInt(h, 16))) : addr;
    const c = `${a} ${port} ${TYPES[type]}`;
    if (!cands.includes(c)) cands.push(c);
  }
  return [`SOR${QR_PROTO}`, version, desc.type === 'offer' ? 'o' : 'a', get('ice-ufrag'), get('ice-pwd'),
    b64(fp.split(':').map((h) => parseInt(h, 16))), cands.slice(0, 6).join(',')].join('|');
}

// { type, sdp, version } from a packed text; null if it is not one of ours
export function unpackSDP(text) {
  const f = String(text || '').split('|');
  if (f.length !== 7 || f[0] !== `SOR${QR_PROTO}` || (f[2] !== 'o' && f[2] !== 'a')) return null;
  const [, version, kind, ufrag, pwd, fp64, cl] = f;
  let fp;
  try { fp = [...unb64(fp64)].map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(':'); } catch (e) { return null; }
  if (!ufrag || !pwd || fp.length !== 95) return null;
  const lines = [];
  (cl ? cl.split(',') : []).forEach((c, i) => {
    const [a, port, t] = c.split(' ');
    if (!a || !port || !TYPE_NAME[t]) return;
    let addr = a;
    if (a[0] === '=') {
      try { const h = [...unb64(a.slice(1))].map((b) => b.toString(16).padStart(2, '0')).join(''); addr = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}.local`; } catch (e) { return; }
    }
    const prio = PREF[t] * 2 ** 24 + (65535 - i) * 2 ** 8 + 255;
    lines.push(`a=candidate:${i + 1} 1 udp ${prio} ${addr} ${port} typ ${TYPE_NAME[t]}${t === 'h' ? '' : ' raddr 0.0.0.0 rport 0'} generation 0`);
  });
  const sdp = ['v=0', `o=- ${Date.now()} 2 IN IP4 127.0.0.1`, 's=-', 't=0 0', 'a=group:BUNDLE 0', 'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0', ...lines,
    `a=ice-ufrag:${ufrag}`, `a=ice-pwd:${pwd}`, 'a=ice-options:trickle', `a=fingerprint:sha-256 ${fp}`,
    `a=setup:${kind === 'o' ? 'actpass' : 'active'}`, 'a=mid:0', 'a=sctp-port:5000', 'a=max-message-size:262144', ''].join('\r\n');
  return { type: kind === 'o' ? 'offer' : 'answer', sdp, version };
}
