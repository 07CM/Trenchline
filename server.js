// Trenchline co-op relay server.
// The host's browser runs the simulation; this server only groups players into
// rooms and relays messages between the host and the other players.
const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 8000;
const MAX_PLAYERS = 4;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const rooms = new Map(); // code -> { code, host, peers: Map<id, ws>, nextId }

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
});
const wss = new WebSocketServer({ server, maxPayload: 256 * 1024 });

function makeCode() {
  for (let k = 0; k < 200; k++) {
    let c = ''; for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
  return null;
}
const send = (ws, obj) => { if (ws && ws.readyState === 1) ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj)); };
const cleanName = (n) => String(n || '').replace(/[^\p{L}\p{N} ._'-]/gu, '').trim().slice(0, 16) || 'Soldier';

function leave(ws) {
  const room = ws.room; if (!room) return;
  ws.room = null;
  if (ws.pid === 0) {
    for (const [id, p] of room.peers) if (id !== 0) { send(p, { t: 'closed', reason: 'The host left the game.' }); p.room = null; }
    rooms.delete(room.code);
  } else {
    room.peers.delete(ws.pid);
    send(room.peers.get(0), { t: 'peer_leave', id: ws.pid });
  }
}

wss.on('connection', (ws) => {
  ws.isAlive = true; ws.room = null; ws.pid = -1;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'create') {
      if (ws.room) leave(ws);
      const code = makeCode(); if (!code) return send(ws, { t: 'error', msg: 'No rooms available right now.' });
      const room = { code, peers: new Map([[0, ws]]), nextId: 1 };
      rooms.set(code, room); ws.room = room; ws.pid = 0; ws.name = cleanName(m.name);
      return send(ws, { t: 'created', code, id: 0 });
    }
    if (m.t === 'join') {
      if (ws.room) leave(ws);
      const code = String(m.code || '').toUpperCase().replace(/[^A-Z]/g, '');
      const room = rooms.get(code);
      if (!room) return send(ws, { t: 'error', msg: `No room with code ${code || '—'}.` });
      if (room.peers.size >= MAX_PLAYERS) return send(ws, { t: 'error', msg: 'That room is full (4 players).' });
      const id = room.nextId++; ws.room = room; ws.pid = id; ws.name = cleanName(m.name);
      room.peers.set(id, ws);
      send(ws, { t: 'joined', code, id });
      return send(room.peers.get(0), { t: 'peer_join', id, name: ws.name });
    }
    if (m.t === 'leave') return leave(ws);
    if (m.t === 'to') {
      const room = ws.room; if (!room) return;
      if (ws.pid === 0) {
        // host -> one peer or everyone
        if (m.to === 'all') { const s = JSON.stringify({ t: 'msg', from: 0, d: m.d }); for (const [id, p] of room.peers) if (id !== 0) send(p, s); }
        else send(room.peers.get(Number(m.to)), { t: 'msg', from: 0, d: m.d });
      } else send(room.peers.get(0), { t: 'msg', from: ws.pid, d: m.d });
    }
  });
  ws.on('close', () => leave(ws));
  ws.on('error', () => leave(ws));
});

setInterval(() => {
  for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; try { ws.ping(); } catch {} }
}, 15000);

server.listen(PORT, '0.0.0.0', () => console.log(`Trenchline relay on :${PORT}`));
