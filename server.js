// «Последний рейс» — сервер на Railway.
// 1) Раздаёт игру (папка public): её открывают в браузере и ставят на экран «Домой».
// 2) Отдаёт приложение для Android: /last-flight.apk скачивается в любом браузере.
// 3) Связывает игроков для игры вдвоём: /ws?room=<код острова>. Каждое сообщение игрока
//    сервер передаёт остальным в той же комнате. Сам он ничего не хранит и не считает:
//    остров ведёт телефон хозяина, сервер только передаёт сообщения.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = +process.env.PORT || 8080;
const ROOT = path.join(__dirname, 'public');
const MAX_MSG = 64 * 1024;        // одно сообщение игры занимает до 4 КБ; с запасом
const MAX_IN_ROOM = 6;            // игроков двое, остальное — запас на переподключения
const MAX_ROOMS = 2000;
const RATE = 120, BURST = 240;    // сообщений в секунду на одного игрока

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  '.apk': 'application/vnd.android.package-archive', '.zip': 'application/zip'
};

const stats = { started: new Date().toISOString(), connections: 0, messages: 0 };

function send(res, code, body, type, extra) {
  res.writeHead(code, Object.assign({ 'Content-Type': type || 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' }, extra || {}));
  res.end(body);
}

const server = http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { return send(res, 400, 'Bad request'); }
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
  if (p === '/health') return send(res, 200, JSON.stringify({ ok: true, rooms: rooms.size, players: playersOnline(), ...stats }), 'application/json', { 'Cache-Control': 'no-store' });
  if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT + path.sep)) return send(res, 403, 'Forbidden');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Не найдено');
    const ext = path.extname(file).toLowerCase();
    const headers = {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'X-Content-Type-Options': 'nosniff',
      // страницы и service worker всегда свежие, остальное браузер может держать у себя
      'Cache-Control': ext === '.html' || p.endsWith('sw.js') || ext === '.webmanifest' ? 'no-cache' : 'public, max-age=86400'
    };
    if (ext === '.apk') headers['Content-Disposition'] = 'attachment; filename="' + path.basename(file) + '"';
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
});

// ---------- игра вдвоём ----------
const rooms = new Map();   // код комнаты -> Set(сокетов)
const playersOnline = () => { let n = 0; for (const r of rooms.values()) n += r.size; return n; };
const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MSG });

server.on('upgrade', (req, sock, head) => {
  let u;
  try { u = new URL(req.url, 'http://x'); } catch (e) { sock.destroy(); return; }
  const room = u.searchParams.get('room') || '';
  if (u.pathname !== '/ws' || !/^[a-z0-9-]{1,40}$/.test(room)) { sock.write('HTTP/1.1 400 Bad Request\r\n\r\n'); sock.destroy(); return; }
  const r = rooms.get(room);
  if ((r && r.size >= MAX_IN_ROOM) || (!r && rooms.size >= MAX_ROOMS)) { sock.write('HTTP/1.1 503 Service Unavailable\r\n\r\n'); sock.destroy(); return; }
  wss.handleUpgrade(req, sock, head, ws => join(ws, room));
});

function join(ws, room) {
  let r = rooms.get(room);
  if (!r) { r = new Set(); rooms.set(room, r); }
  r.add(ws);
  stats.connections++;
  ws.alive = true;
  ws.tokens = BURST; ws.lastT = Date.now();
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', (data, isBinary) => {
    ws.alive = true;
    if (isBinary) return;
    // ограничение частоты: отправивший слишком много за раз просто теряет лишние сообщения
    const now = Date.now();
    ws.tokens = Math.min(BURST, ws.tokens + (now - ws.lastT) * RATE / 1000); ws.lastT = now;
    if (ws.tokens < 1) return;
    ws.tokens--;
    const text = data.toString();
    if (text === '{"ping":1}') return;
    stats.messages++;
    for (const other of r) if (other !== ws && other.readyState === 1 && other.bufferedAmount < 2 * 1024 * 1024) other.send(text);
  });
  ws.on('close', () => { r.delete(ws); if (!r.size) rooms.delete(room); });
  ws.on('error', () => {});
}

// пропавшие соединения (телефон уснул, ушёл из сети) закрываются через полминуты
setInterval(() => {
  for (const r of rooms.values()) for (const ws of r) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false;
    try { ws.ping(); } catch (e) {}
  }
}, 30000);

server.listen(PORT, () => console.log('Последний рейс: сервер слушает порт ' + PORT));
