'use strict';
// Servidor do Cronômetro de Dominação.
// Sem dependências: usa só o que já vem no Node. Envia o estado em tempo real por SSE.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createGame, ID_RE } = require('./game');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const MAX_CLIENTS = 300;
const TOKEN_TTL_MS = 24 * 3600 * 1000;

let ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
  ADMIN_PASSWORD = crypto.randomBytes(5).toString('hex');
  console.log(`ADMIN_PASSWORD não definida. Senha temporária desta execução: ${ADMIN_PASSWORD}`);
}
const sha = (s) => crypto.createHash('sha256').update(s).digest();
const SECRET = sha('dominacao-token:' + ADMIN_PASSWORD);
const PASSWORD_HASH = sha(ADMIN_PASSWORD);

/* Acesso do admin */
function signToken() {
  const exp = String(Date.now() + TOKEN_TTL_MS);
  return exp + '.' + crypto.createHmac('sha256', SECRET).update(exp).digest('hex');
}
function validToken(t) {
  if (typeof t !== 'string') return false;
  const [exp, sig] = t.split('.');
  if (!exp || !sig || !(Number(exp) > Date.now())) return false;
  const want = crypto.createHmac('sha256', SECRET).update(exp).digest('hex');
  return sig.length === want.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want));
}
function bearer(req, url) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  return url ? url.searchParams.get('token') : null;
}
const loginFails = new Map(); // ip -> { n, until }
function clientIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
  return xff.length ? xff[xff.length - 1] : req.socket.remoteAddress || '?';
}

/* Jogo e conexões */
const clients = new Set(); // { res, role, deviceId }
const onlineCount = new Map();
const isOnline = (id) => (onlineCount.get(id) || 0) > 0;

function sse(res, event, data) {
  try { res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n'); } catch (e) { /* conexão caiu */ }
}
function broadcastEvent(ev) {
  for (const c of clients) sse(c.res, 'game', ev);
}

let saved = null;
try { saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) { /* primeira execução */ }
const game = createGame({ saved, emit: broadcastEvent, isOnline });

function pushSnapshots() {
  const pub = game.publicView();
  let adm = null;
  for (const c of clients) {
    if (c.role === 'admin') sse(c.res, 'snapshot', adm || (adm = game.adminView()));
    else if (c.role === 'device') sse(c.res, 'snapshot', game.deviceView(c.deviceId));
    else sse(c.res, 'snapshot', pub);
  }
}

let persistTimer = null;
function saveNow() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = STATE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(game.serialize()));
    fs.renameSync(tmp, STATE_FILE);
  } catch (e) {
    console.error('Não foi possível salvar o estado:', e.message);
  }
}
function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => { persistTimer = null; saveNow(); }, 1000);
}

setInterval(() => {
  if (game.advance()) { pushSnapshots(); schedulePersist(); }
}, 250);
setInterval(() => {
  pushSnapshots();
  if (game.status() === 'running') schedulePersist();
}, 5000);

/* Respostas */
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; " +
    "img-src 'self' data:; media-src 'self' data: blob:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};
function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 8192) { reject(new Error('too_big')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(new Error('bad_json')); }
    });
    req.on('error', reject);
  });
}
const ERROR_STATUS = { unknown_device: 404, unknown_point: 404 };
function result(res, r, snapshot) {
  if (r.error) return json(res, ERROR_STATUS[r.error] || 400, { error: r.error });
  return json(res, 200, { ...r, snapshot: snapshot() });
}

/* Tempo real */
function handleStream(req, res, url) {
  const role = url.searchParams.get('role');
  let deviceId = null;
  if (clients.size >= MAX_CLIENTS) return json(res, 503, { error: 'busy' });
  if (role === 'admin') {
    if (!validToken(bearer(req, url))) return json(res, 401, { error: 'unauthorized' });
  } else if (role === 'device') {
    deviceId = url.searchParams.get('device');
    if (!ID_RE.test(deviceId || '') || !game.hello(deviceId)) return json(res, 400, { error: 'bad_device' });
    schedulePersist();
  } else if (role !== 'view') {
    return json(res, 400, { error: 'bad_role' });
  }
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 2000\n\n');
  const c = { res, role, deviceId };
  clients.add(c);
  if (deviceId) onlineCount.set(deviceId, (onlineCount.get(deviceId) || 0) + 1);
  pushSnapshots();
  req.on('close', () => {
    clients.delete(c);
    if (deviceId) {
      const n = (onlineCount.get(deviceId) || 1) - 1;
      if (n <= 0) onlineCount.delete(deviceId); else onlineCount.set(deviceId, n);
      pushSnapshots();
    }
  });
}

/* Arquivos do site */
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon',
};
const PAGES = { '/': 'index.html', '/admin': 'admin.html', '/placar': 'placar.html' };
function serveStatic(req, res, pathname) {
  let rel = PAGES[pathname] || pathname;
  try { rel = decodeURIComponent(rel); } catch (e) { return json(res, 400, { error: 'bad_path' }); }
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep) || rel.split('/').some((s) => s.startsWith('.'))) return json(res, 404, { error: 'not_found' });
  fs.stat(file, (e, st) => {
    const type = TYPES[path.extname(file).toLowerCase()];
    if (e || !st.isFile() || !type) return json(res, 404, { error: 'not_found' });
    const code = type.startsWith('text/html') || type.startsWith('text/javascript') || type.startsWith('text/css');
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': code ? 'no-cache' : 'public, max-age=86400' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

/* Rotas */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  try {
    if (p === '/healthz') return json(res, 200, { ok: true });
    if (req.method === 'GET' && p === '/api/stream') return handleStream(req, res, url);

    if (req.method === 'POST' && p.startsWith('/api/')) {
      const body = await readJson(req);

      if (p === '/api/admin/login') {
        const ip = clientIp(req);
        const f = loginFails.get(ip);
        if (f && f.until > Date.now()) return json(res, 429, { error: 'too_many_attempts' });
        const given = typeof body.password === 'string' ? sha(body.password) : sha('');
        if (crypto.timingSafeEqual(given, PASSWORD_HASH)) {
          loginFails.delete(ip);
          return json(res, 200, { token: signToken() });
        }
        const n = ((f && f.n) || 0) + 1;
        loginFails.set(ip, { n, until: n >= 5 ? Date.now() + 60000 : 0 });
        await new Promise((r) => setTimeout(r, 400));
        return json(res, 401, { error: 'wrong_password' });
      }

      if (p === '/api/admin') {
        if (!validToken(bearer(req))) return json(res, 401, { error: 'unauthorized' });
        const r = game.act(String(body.action || ''), body);
        if (!r.error) { pushSnapshots(); schedulePersist(); }
        return result(res, r, () => game.adminView());
      }

      if (p === '/api/capture') {
        if (!ID_RE.test(body.deviceId || '')) return json(res, 400, { error: 'bad_device' });
        const r = game.capture(body.deviceId, body.team);
        if (!r.error) { pushSnapshots(); schedulePersist(); }
        return result(res, r, () => game.deviceView(body.deviceId));
      }

      if (p === '/api/device/player') {
        if (!ID_RE.test(body.deviceId || '')) return json(res, 400, { error: 'bad_device' });
        const r = game.setPlayer(body.deviceId, body.player);
        if (!r.error) { pushSnapshots(); schedulePersist(); }
        return result(res, r, () => game.deviceView(body.deviceId));
      }
      return json(res, 404, { error: 'not_found' });
    }

    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, p);
    return json(res, 405, { error: 'method_not_allowed' });
  } catch (e) {
    if (res.headersSent) return res.end();
    return json(res, e.message === 'too_big' ? 413 : 400, { error: e.message === 'too_big' ? 'too_big' : 'bad_request' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Cronômetro de Dominação em http://localhost:${PORT}  (admin: /admin  placar: /placar)`);
});

function shutdown() {
  saveNow();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
