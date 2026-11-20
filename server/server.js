/* Studio server: serves the board and keeps every workout in a SQLite database,
   so a trainee's performance can be compared from one workout to the next.

   Run:  node server/server.js
   Env:  PORT   (default 5173)
         HOST   (default 127.0.0.1. Use 0.0.0.0 to let other devices in the studio reach it)
         HR_TOKEN  when set, every /api call must send "Authorization: Bearer <token>"
         HR_DB  database file (default data/hr.db)

   Needs Node 22.5+ (built-in node:sqlite). No npm packages. */
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..');
const PORT = parseInt(process.env.PORT, 10) || 5173;
const HOST = process.env.HOST || '127.0.0.1';
const TOKEN = process.env.HR_TOKEN || '';
const DB_FILE = path.resolve(ROOT, process.env.HR_DB || 'data/hr.db');
const MAX_BODY = 8 * 1024 * 1024;

fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
const db = new DatabaseSync(DB_FILE);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS athletes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    age INTEGER, weight REAL, sex TEXT,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    started_at INTEGER NOT NULL,
    duration_s INTEGER NOT NULL,
    saved_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS results (
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
    name TEXT NOT NULL, age INTEGER, weight REAL, sex TEXT,
    max_hr INTEGER, avg_hr INTEGER, peak_hr INTEGER,
    kcal REAL, points REAL,
    z0 REAL, z1 REAL, z2 REAL, z3 REAL, z4 REAL, z5 REAL,
    series TEXT,
    PRIMARY KEY (session_id, athlete_id)
  );
  CREATE INDEX IF NOT EXISTS results_by_athlete ON results(athlete_id);
`);

const q = {
  upsertAthlete: db.prepare(`
    INSERT INTO athletes (id, name, age, weight, sex, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, age = excluded.age, weight = excluded.weight,
      sex = excluded.sex, updated_at = excluded.updated_at`),
  upsertSession: db.prepare(`
    INSERT INTO sessions (id, started_at, duration_s, saved_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET duration_s = excluded.duration_s, saved_at = excluded.saved_at`),
  clearResults: db.prepare('DELETE FROM results WHERE session_id = ?'),
  insertResult: db.prepare(`
    INSERT INTO results (session_id, athlete_id, name, age, weight, sex, max_hr, avg_hr, peak_hr, kcal, points,
      z0, z1, z2, z3, z4, z5, series) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  athletes: db.prepare(`
    SELECT a.id, a.name, a.age, a.weight, a.sex, COUNT(r.session_id) AS sessions, MAX(s.started_at) AS lastAt
    FROM athletes a
    LEFT JOIN results r ON r.athlete_id = a.id
    LEFT JOIN sessions s ON s.id = r.session_id
    GROUP BY a.id ORDER BY lastAt DESC, a.name`),
  athlete: db.prepare('SELECT id, name, age, weight, sex FROM athletes WHERE id = ?'),
  history: db.prepare(`
    SELECT s.id AS sessionId, s.started_at AS startedAt, s.duration_s AS durationS,
           r.max_hr AS maxHr, r.avg_hr AS avgHr, r.peak_hr AS peakHr, r.kcal, r.points,
           r.z0, r.z1, r.z2, r.z3, r.z4, r.z5
    FROM results r JOIN sessions s ON s.id = r.session_id
    WHERE r.athlete_id = ? ORDER BY s.started_at DESC LIMIT 300`),
  deleteAthlete: db.prepare('DELETE FROM athletes WHERE id = ?')
};

/* ---------- validation ---------- */
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const num = (v, lo, hi, d = 0) => { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
const str = (v, n, d = '') => (typeof v === 'string' ? v.trim().slice(0, n) : d);

function saveSession(body) {
  if (!body || !ID.test(body.id || '')) throw httpError(400, 'bad session id');
  if (!Array.isArray(body.results) || body.results.length === 0 || body.results.length > 200) throw httpError(400, 'no results');
  const now = Date.now();
  const startedAt = Math.floor(num(body.startedAt, 0, now + 86400000, now));
  const durationS = Math.round(num(body.durationS, 0, 86400, 0));
  db.exec('BEGIN');
  try {
    q.upsertSession.run(body.id, startedAt, durationS, now);
    q.clearResults.run(body.id);
    for (const r of body.results) {
      if (!r || !ID.test(r.id || '')) throw httpError(400, 'bad athlete id');
      const name = str(r.name, 40, 'מתאמן');
      const age = Math.round(num(r.age, 5, 110, 30)), weight = num(r.weight, 20, 300, 70);
      const sex = r.sex === 'm' ? 'm' : 'f';
      q.upsertAthlete.run(r.id, name, age, weight, sex, now, now);
      const z = Array.isArray(r.zoneSecs) ? r.zoneSecs : [];
      const series = Array.isArray(r.series) ? r.series.slice(0, 2000).map(v => Math.round(num(v, 0, 255))) : [];
      q.insertResult.run(
        body.id, r.id, name, age, weight, sex,
        Math.round(num(r.maxHr, 0, 255)), Math.round(num(r.avgHr, 0, 255)), Math.round(num(r.peakHr, 0, 255)),
        num(r.kcal, 0, 20000), num(r.points, 0, 100000),
        ...[0, 1, 2, 3, 4, 5].map(i => num(z[i], 0, 86400)),
        JSON.stringify(series)
      );
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { ok: true, id: body.id, athletes: body.results.length };
}

/* ---------- http ---------- */
function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

function send(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(httpError(413, 'too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null')); }
      catch (e) { reject(httpError(400, 'bad json')); }
    });
    req.on('error', reject);
  });
}

async function api(req, res, url) {
  if (TOKEN && req.headers.authorization !== 'Bearer ' + TOKEN) return send(res, 401, { error: 'unauthorized' });
  const parts = url.pathname.split('/').filter(Boolean).slice(1).map(decodeURIComponent);   // after "api"
  const m = req.method;

  if (m === 'GET' && parts[0] === 'health') return send(res, 200, { ok: true });

  if (m === 'POST' && parts[0] === 'sessions' && parts.length === 1) return send(res, 200, saveSession(await readBody(req)));

  if (parts[0] === 'athletes') {
    if (m === 'GET' && parts.length === 1) return send(res, 200, q.athletes.all());
    if (parts.length >= 2 && ID.test(parts[1])) {
      const a = q.athlete.get(parts[1]);
      if (m === 'GET' && parts[2] === 'history') {
        if (!a) return send(res, 200, { athlete: null, sessions: [] });
        return send(res, 200, {
          athlete: a,
          sessions: q.history.all(parts[1]).map(r => ({
            sessionId: r.sessionId, startedAt: r.startedAt, durationS: r.durationS, maxHr: r.maxHr,
            avgHr: r.avgHr, peakHr: r.peakHr, kcal: r.kcal, points: r.points,
            zoneSecs: [r.z0, r.z1, r.z2, r.z3, r.z4, r.z5]
          }))
        });
      }
      if (m === 'DELETE' && parts.length === 2) { q.deleteAthlete.run(parts[1]); return send(res, 200, { ok: true }); }
    }
  }
  return send(res, 404, { error: 'not found' });
}

/* Only the board itself is public: never the database, the server code or the repo. */
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8' };
function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method not allowed' });
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.resolve(ROOT, '.' + rel);
  const top = path.relative(ROOT, file).split(path.sep)[0];
  const ok = file.startsWith(ROOT + path.sep) && (rel === '/index.html' || top === 'css' || top === 'js');
  if (!ok || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, { error: 'not found' });
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) await api(req, res, url);
    else serveStatic(req, res, url);
  } catch (e) {
    if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'server error' });
    if (!e.status) console.error(e);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Board:    http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`Database: ${DB_FILE}`);
  if (HOST !== '127.0.0.1' && !TOKEN) console.warn('Warning: reachable from the network and HR_TOKEN is not set. Anyone on the network can read the workouts.');
});
