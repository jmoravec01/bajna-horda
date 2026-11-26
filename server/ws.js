// Minimal RFC 6455 WebSocket server side (text frames only), zero dependencies.
import { createHash } from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAGMENTS = 8;

// Takes over an HTTP upgrade request. Returns a connection object or null (after answering with an error).
export function upgrade(req, socket, { maxPayload = 2048 } = {}) {
  const key = req.headers['sec-websocket-key'];
  if (String(req.headers.upgrade).toLowerCase() !== 'websocket' || !key || req.headers['sec-websocket-version'] !== '13' || Buffer.from(String(key), 'base64').length !== 16) {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); return null;
  }
  const accept = createHash('sha1').update(key + GUID).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.setNoDelay(true);

  const conn = { onmessage: null, onclose: null, alive: true, lastSeen: Date.now(), closed: false,
    send(text) { if (conn.closed) return false; write(socket, 0x1, Buffer.from(text)); return true; },
    backlog() { return socket.writableLength; },
    ping() { write(socket, 0x9, Buffer.alloc(0)); },
    close(code = 1000) { if (conn.closed) return; conn.closed = true; const b = Buffer.alloc(2); b.writeUInt16BE(code); write(socket, 0x8, b); socket.end(); fire(); },
  };
  let closedFired = false;
  const fire = () => { if (!closedFired) { closedFired = true; conn.closed = true; conn.onclose?.(); } };

  let buf = Buffer.alloc(0), frags = [], fragSize = 0, fragType = 0;
  socket.on('data', (chunk) => {
    conn.lastSeen = Date.now();
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    if (buf.length > maxPayload * 2 + 64) { conn.close(1009); return; }
    for (;;) {
      if (buf.length < 2) return;
      const b0 = buf[0], b1 = buf[1], fin = !!(b0 & 0x80), op = b0 & 0x0f, masked = !!(b1 & 0x80);
      let len = b1 & 0x7f, off = 2;
      if (b0 & 0x70 || !masked) { conn.close(1002); return; }                // reserved bits / unmasked client frame
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; const hi = buf.readUInt32BE(2); if (hi) { conn.close(1009); return; } len = buf.readUInt32BE(6); off = 10; }
      if (len > maxPayload) { conn.close(1009); return; }
      if (op >= 8 && (!fin || len > 125)) { conn.close(1002); return; }
      if (buf.length < off + 4 + len) return;
      const mask = buf.subarray(off, off + 4), data = Buffer.from(buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
      buf = buf.subarray(off + 4 + len);
      if (op === 0x8) { conn.close(1000); return; }
      if (op === 0x9) { write(socket, 0xA, data); continue; }
      if (op === 0xA) continue;
      if (op === 0x1 || op === 0x0) {
        if (op === 0x1) { frags = []; fragSize = 0; fragType = 1; } else if (!fragType) { conn.close(1002); return; }
        frags.push(data); fragSize += data.length;
        if (fragSize > maxPayload || frags.length > MAX_FRAGMENTS) { conn.close(1009); return; }
        if (fin) { const msg = Buffer.concat(frags).toString('utf8'); frags = []; fragSize = 0; fragType = 0; try { conn.onmessage?.(msg); } catch (e) { console.error('ws handler', e); } }
      } else { conn.close(1003); return; }
    }
  });
  socket.on('close', fire); socket.on('error', () => { socket.destroy(); fire(); });
  return conn;
}

function write(socket, op, payload) {
  if (socket.destroyed || !socket.writable) return;
  const n = payload.length;
  const head = n < 126 ? Buffer.from([0x80 | op, n]) : n < 65536 ? Buffer.from([0x80 | op, 126, n >> 8, n & 255]) : (() => { const h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 127; h.writeUInt32BE(n, 6); return h; })();
  socket.write(Buffer.concat([head, payload]));
}
