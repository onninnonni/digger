#!/usr/bin/env node
// Digger leaderboard backend. Zero dependencies: Node's http + fs + crypto only.
// Verifies Google ID tokens (from Google Identity Services on the client) and keeps
// one best score per Google account in a JSON file.
//
// Config (env or config.json next to this file):
//   PORT            127.0.0.1 port to listen on (default 8796)
//   CLIENT_IDS      comma-separated Google OAuth client IDs accepted as token audience
//   DATA_DIR        where scores.json lives (default ~/digger-data)
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const cfgPath = path.join(__dirname, 'config.json');
const fileCfg = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, 'utf8')) : {};
const PORT = Number(process.env.PORT || fileCfg.port || 8796);
const CLIENT_IDS = String(process.env.CLIENT_IDS || fileCfg.clientIds || '').split(',').map((s) => s.trim()).filter(Boolean);
const DATA_DIR = process.env.DATA_DIR || fileCfg.dataDir || path.join(os.homedir(), 'digger-data');
const DATA_FILE = path.join(DATA_DIR, 'scores.json');
const MAX_SCORE = 500000, MAX_DEPTH = 13000, MAX_LEVEL = 60;

fs.mkdirSync(DATA_DIR, { recursive: true });
let scores = {};
try { scores = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { scores = {}; }

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(scores));
    fs.renameSync(tmp, DATA_FILE);
  }, 200);
}

function publicRow(sub, r, rank) {
  return { rank, id: crypto.createHash('sha256').update(sub).digest('hex').slice(0, 12), name: r.name, picture: r.picture || '', score: r.score, depthKm: r.depthKm, level: r.level, won: !!r.won, at: r.at };
}
function ranked() {
  return Object.entries(scores).sort((a, b) => b[1].score - a[1].score || a[1].at - b[1].at);
}

// ---- Google ID token verification via tokeninfo endpoint, with a small cache ----
const tokenCache = new Map();
async function verifyIdToken(idToken) {
  if (typeof idToken !== 'string' || idToken.length < 20 || idToken.length > 4096) throw new Error('bad token');
  const key = crypto.createHash('sha256').update(idToken).digest('hex');
  const cached = tokenCache.get(key);
  const now = Date.now() / 1000;
  if (cached && cached.exp > now + 30) return cached;
  const res = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken));
  if (!res.ok) throw new Error('token rejected');
  const info = await res.json();
  if (!CLIENT_IDS.includes(info.aud)) throw new Error('wrong audience');
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(info.iss)) throw new Error('bad issuer');
  if (Number(info.exp) < now) throw new Error('expired');
  const user = { sub: info.sub, name: info.name || info.given_name || 'Anonymous digger', picture: info.picture || '', exp: Number(info.exp) };
  tokenCache.set(key, user);
  if (tokenCache.size > 2000) tokenCache.delete(tokenCache.keys().next().value);
  return user;
}

// ---- tiny per-IP rate limiter ----
const buckets = new Map();
function allow(ip, cost = 1, limit = 60) {
  const now = Date.now();
  const b = buckets.get(ip) || { tokens: limit, t: now };
  b.tokens = Math.min(limit, b.tokens + ((now - b.t) / 60000) * limit);
  b.t = now;
  if (b.tokens < cost) { buckets.set(ip, b); return false; }
  b.tokens -= cost; buckets.set(ip, b); return true;
}

function send(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(data) });
  res.end(data);
}
function readJson(req, limit = 8192) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname.replace(/\/+$/, '') || '/';
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
  try {
    if (req.method === 'GET' && (p === '/config' || p === '/')) {
      return send(res, 200, { configured: CLIENT_IDS.length > 0, clientId: CLIENT_IDS[0] || null, players: Object.keys(scores).length });
    }
    if (req.method === 'GET' && p === '/scores') {
      const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit')) || 20));
      const rows = ranked().slice(0, limit).map(([sub, r], i) => publicRow(sub, r, i + 1));
      return send(res, 200, { scores: rows, players: Object.keys(scores).length });
    }
    if (req.method === 'POST' && p === '/scores') {
      if (!allow(ip, 5, 60)) return send(res, 429, { error: 'slow down' });
      const body = await readJson(req);
      const user = await verifyIdToken(body.idToken);
      const score = Math.floor(Number(body.score)), depthKm = Math.floor(Number(body.depthKm)), level = Math.floor(Number(body.level));
      if (!Number.isFinite(score) || score < 0 || score > MAX_SCORE || !Number.isFinite(depthKm) || depthKm < 0 || depthKm > MAX_DEPTH || !Number.isFinite(level) || level < 1 || level > MAX_LEVEL) {
        return send(res, 400, { error: 'invalid score' });
      }
      const prev = scores[user.sub];
      const improved = !prev || score > prev.score;
      if (improved) {
        scores[user.sub] = { name: user.name, picture: user.picture, score, depthKm, level, won: !!body.won, at: Date.now() };
        save();
      } else if (prev && (prev.name !== user.name || prev.picture !== user.picture)) {
        prev.name = user.name; prev.picture = user.picture; save();
      }
      const rank = ranked().findIndex(([sub]) => sub === user.sub) + 1;
      return send(res, 200, { ok: true, improved, rank, best: scores[user.sub].score, players: Object.keys(scores).length });
    }
    if (req.method === 'GET' && p === '/me') {
      const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const user = await verifyIdToken(token);
      const rank = ranked().findIndex(([sub]) => sub === user.sub) + 1;
      return send(res, 200, { name: user.name, picture: user.picture, best: scores[user.sub] ? publicRow(user.sub, scores[user.sub], rank) : null });
    }
    send(res, 404, { error: 'not found' });
  } catch (err) {
    const msg = String(err && err.message || err);
    const code = /token|audience|issuer|expired/.test(msg) ? 401 : /too large|JSON/.test(msg) ? 400 : 500;
    send(res, code, { error: msg });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`digger backend listening on 127.0.0.1:${PORT}, data in ${DATA_FILE}, client ids: ${CLIENT_IDS.length}`);
});
