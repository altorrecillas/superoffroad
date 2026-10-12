// A stand-in for the PeerJS cloud server in the tests (no internet needed): ids
// register on a WebSocket (OPEN, or ID-TAKEN) and OFFER, ANSWER and CANDIDATE messages
// are passed to `dst` with the sender as `src`. A minimal WebSocket server on Node's
// own http module. Usage: const sig = await mockSignal(); page URL ...&sig=<sig.url>
import http from 'http';
import crypto from 'crypto';

export function mockSignal() {
  const clients = new Map();
  const log = [];
  const server = http.createServer((req, res) => { res.writeHead(404); res.end(); });
  server.on('upgrade', (req, socket) => {
    const id = new URL(req.url, 'http://x').searchParams.get('id');
    const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const send = (obj) => {
      const data = Buffer.from(JSON.stringify(obj));
      let head;
      if (data.length < 126) head = Buffer.from([0x81, data.length]);
      else if (data.length < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 126; head.writeUInt16BE(data.length, 2); } else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 127; head.writeBigUInt64BE(BigInt(data.length), 2); }
      if (!socket.destroyed) socket.write(Buffer.concat([head, data]));
    };
    if (clients.has(id)) { send({ type: 'ID-TAKEN' }); socket.end(); return; }
    clients.set(id, send);
    send({ type: 'OPEN' });
    let buf = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 2) {
        const op = buf[0] & 0x0f, masked = buf[1] & 0x80;
        let len = buf[1] & 0x7f, off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; } else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        const mask = masked ? buf.subarray(off, off + 4) : null;
        if (masked) off += 4;
        if (buf.length < off + len) return;
        const payload = Buffer.from(buf.subarray(off, off + len));
        if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
        buf = buf.subarray(off + len);
        if (op === 8) { socket.end(); return; }
        if (op !== 1) continue;
        let m;
        try { m = JSON.parse(payload.toString()); } catch (e) { continue; }
        if (m.type === 'HEARTBEAT') continue;
        log.push(`${id} -> ${m.dst}: ${m.type}`);
        const dst = clients.get(m.dst);
        if (dst && ['OFFER', 'ANSWER', 'CANDIDATE', 'LEAVE'].includes(m.type)) dst({ ...m, src: id });
      }
    });
    const gone = () => { if (clients.get(id) === send) clients.delete(id); };
    socket.on('close', gone);
    socket.on('error', gone);
  });
  return new Promise((resolve) => server.listen(0, () => resolve({
    url: `ws://localhost:${server.address().port}/peerjs`, clients, log,
    close: () => server.close(),
  })));
}
