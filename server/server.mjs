#!/usr/bin/env node
/**
 * Small web server for the site and its admin panel. Node only, no npm packages.
 *
 *   npm run build && npm run serve
 *
 * Settings (argument or environment variable):
 *   --port / PORT                     default 8787
 *   --host / HOST                     default 127.0.0.1 (use 0.0.0.0 behind a reverse proxy or on a server)
 *   --data / DATA_DIR                 default ./data   (never served)
 *   --dist / DIST_DIR                 default ./dist   (the only folder that is served)
 *   --origin / PUBLIC_ORIGIN          e.g. https://easyfirst-ae.com — the only origin allowed to make changes
 *   --trust-proxy / TRUST_PROXY       1 when behind nginx/Caddy (client IP and https from X-Forwarded-*)
 *   --cookie-secure / COOKIE_SECURE   auto (default), 1 or 0
 *   --session-idle / SESSION_IDLE_MINUTES   sign-out after this long without activity (default 180)
 *   --session-max / SESSION_MAX_HOURS       sign-out after this long in any case (default 12)
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import zlib from 'node:zlib';
import {
  audit,
  DATA_DIR,
  dataPath,
  ensureDataDirs,
  loadUsers,
  PROJECT_DIR,
  readAudit,
  readJson,
  saveUsers,
  setting,
  writeAtomic,
  writeJson,
} from './lib/store.mjs';
import { dummyHash, hashPassword, passwordProblem, verifyPassword } from './lib/passwords.mjs';

const PORT = Number(setting('port', 'PORT', '8787'));
const HOST = setting('host', 'HOST', '127.0.0.1');
const DIST_DIR = path.resolve(PROJECT_DIR, setting('dist', 'DIST_DIR', 'dist'));
const PUBLIC_ORIGIN = setting('origin', 'PUBLIC_ORIGIN', '').replace(/\/+$/, '');
const TRUST_PROXY = /^(1|true|yes)$/i.test(setting('trust-proxy', 'TRUST_PROXY', '0'));
const COOKIE_SECURE = setting('cookie-secure', 'COOKIE_SECURE', 'auto');
const IDLE_MS = Math.max(5, Number(setting('session-idle', 'SESSION_IDLE_MINUTES', '180'))) * 60_000;
const MAX_MS = Math.max(1, Number(setting('session-max', 'SESSION_MAX_HOURS', '12'))) * 3_600_000;
const KEEP_VERSIONS = 30;
const LOCK_AFTER = 5;
const LOCK_BASE_MS = 60_000;
const LOCK_MAX_MS = 24 * 3_600_000;
const COOKIE = 'efc_admin';

/* ---------- The site's own content code (built by `npm run build`) ---------- */

const ENTRY = path.join(PROJECT_DIR, 'server', 'build', 'entry.js');
if (!fs.existsSync(ENTRY) || !fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
  console.error('The site is not built yet. Run:  npm run build   then  npm run serve');
  process.exit(1);
}
const site = await import(pathToFileURL(ENTRY).href);
const DEFAULTS = site.defaultContent;

ensureDataDirs();

/* ---------- Saved content and versions ---------- */

const CONTENT_FILE = dataPath('content.json');
const EMPTY = { version: 0, savedAt: null, user: null, note: '', content: {} };
let current = readJson(CONTENT_FILE, EMPTY);
if (typeof current.version !== 'number') current = EMPTY;

const meta = (v) => ({ version: v.version, savedAt: v.savedAt, user: v.user, note: v.note || '' });

function saveContent(diff, user, note = '') {
  const prev = current;
  if (prev.version > 0) writeJson(dataPath('versions', `${prev.version}.json`), prev);
  const next = { version: prev.version + 1, savedAt: new Date().toISOString(), user, note, content: diff ?? {} };
  writeJson(CONTENT_FILE, next);
  current = next;
  pruneVersions();
  return next;
}

function versionNumbers() {
  return fs
    .readdirSync(dataPath('versions'))
    .map((f) => /^(\d+)\.json$/.exec(f)?.[1])
    .filter(Boolean)
    .map(Number)
    .sort((a, b) => b - a);
}

function pruneVersions() {
  for (const n of versionNumbers().slice(KEEP_VERSIONS)) fs.rmSync(dataPath('versions', `${n}.json`), { force: true });
}

/* ---------- Sessions (only a hash of each token is kept) ---------- */

const sessions = new Map();
const tokenHash = (t) => createHash('sha256').update(t).digest('hex');

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function isHttps(req) {
  if (COOKIE_SECURE === '1') return true;
  if (COOKIE_SECURE === '0') return false;
  if (req.socket.encrypted) return true;
  if (TRUST_PROXY) return String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
  return false;
}

function setSessionCookie(req, res, token, clear = false) {
  const parts = [`${COOKIE}=${clear ? '' : token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict'];
  if (isHttps(req)) parts.push('Secure');
  if (clear) parts.push('Max-Age=0');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function startSession(req, res, username) {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  const s = { user: username, csrf: randomBytes(24).toString('base64url'), created: now, seen: now, ip: clientIp(req) };
  sessions.set(tokenHash(token), s);
  setSessionCookie(req, res, token);
  return s;
}

function getSession(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token || token.length > 100) return null;
  const key = tokenHash(token);
  const s = sessions.get(key);
  if (!s) return null;
  const now = Date.now();
  const user = loadUsers().find((u) => u.username === s.user);
  // Expired, account removed, or password changed after this session started
  if (now - s.seen > IDLE_MS || now - s.created > MAX_MS || !user || Date.parse(user.changed) > s.created) {
    sessions.delete(key);
    return null;
  }
  s.seen = now;
  s.key = key;
  return s;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, s] of sessions) if (now - s.seen > IDLE_MS || now - s.created > MAX_MS) sessions.delete(k);
  for (const [k, l] of locks) if (l.until < now && now - l.last > LOCK_MAX_MS) locks.delete(k);
}, 10 * 60_000).unref();

/* ---------- Blocking after wrong passwords ---------- */

const LOCK_FILE = dataPath('lockouts.json');
const locks = new Map(Object.entries(readJson(LOCK_FILE, {})));
let lockTimer = null;
const saveLocks = () => {
  clearTimeout(lockTimer);
  lockTimer = setTimeout(() => writeJson(LOCK_FILE, Object.fromEntries(locks)), 200);
};

const lockLeft = (key) => Math.max(0, (locks.get(key)?.until ?? 0) - Date.now());

/** 5 wrong passwords → blocked 1 minute; every further one doubles it (2, 4, 8 … up to 24 h). */
function registerFailure(key) {
  const l = locks.get(key) ?? { fails: 0, until: 0, last: 0 };
  l.fails += 1;
  l.last = Date.now();
  if (l.fails >= LOCK_AFTER) l.until = Date.now() + Math.min(LOCK_BASE_MS * 2 ** (l.fails - LOCK_AFTER), LOCK_MAX_MS);
  locks.set(key, l);
  saveLocks();
  return l;
}

function clearFailures(...keys) {
  let changed = false;
  for (const k of keys) changed = locks.delete(k) || changed;
  if (changed) saveLocks();
}

function humanWait(ms) {
  const s = Math.ceil(ms / 1000);
  if (s < 90) return `${s} seconds`;
  const m = Math.ceil(s / 60);
  if (m < 90) return `${m} minutes`;
  return `${Math.ceil(m / 60)} hours`;
}

/* ---------- Request helpers ---------- */

function clientIp(req) {
  if (TRUST_PROXY) {
    const chain = String(req.headers['x-forwarded-for'] || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (chain.length) return chain[chain.length - 1];
  }
  return req.socket.remoteAddress || 'unknown';
}

/** Changes are only accepted from pages of this same site. */
function sameOrigin(req) {
  const fetchSite = req.headers['sec-fetch-site'];
  if (fetchSite && fetchSite !== 'same-origin') return false;
  const origin = req.headers.origin;
  if (!origin) return fetchSite === 'same-origin';
  if (PUBLIC_ORIGIN) return origin === PUBLIC_ORIGIN;
  const host = req.headers.host;
  if (!host) return false;
  const proto = isHttps(req) ? 'https' : 'http';
  return origin === `${proto}://${host}`;
}

function csrfOk(req, s) {
  const a = Buffer.from(String(req.headers['x-csrf-token'] || ''));
  const b = Buffer.from(s.csrf);
  return a.length === b.length && timingSafeEqual(a, b);
}

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > limit) {
      reject(new HttpError(413, `Too large: at most ${Math.round(limit / 1024)} KB.`));
      req.resume();
      return;
    }
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, `Too large: at most ${Math.round(limit / 1024)} KB.`));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJsonBody(req, limit = 16 * 1024) {
  if (!/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) throw new HttpError(415, 'The request must be JSON.');
  const buf = await readBody(req, limit);
  try {
    const v = JSON.parse(buf.toString('utf8'));
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
    return v;
  } catch {
    throw new HttpError(400, 'The request could not be read.');
  }
}

/* ---------- Responses ---------- */

const CSP = [
  "default-src 'self'",
  // 'wasm-unsafe-eval' lets the page compile WebAssembly (the decoder that unpacks the compressed ground model)
  // without allowing eval() of JavaScript.
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https:",
  "frame-src 'self'",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self' mailto:",
  "object-src 'none'",
].join('; ');

function baseHeaders(req) {
  const h = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'SAMEORIGIN',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Content-Security-Policy': CSP,
  };
  if (isHttps(req)) h['Strict-Transport-Security'] = 'max-age=15552000';
  return h;
}

function sendJson(req, res, status, body, extra = {}) {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    ...baseHeaders(req),
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': buf.length,
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow',
    ...extra,
  });
  res.end(req.method === 'HEAD' ? undefined : buf);
}

/**
 * The compression the browser asked for: br or gzip, whichever it weighs higher (br on a tie), never one it refused
 * with q=0 ("gzip;q=0", or "*;q=0" without naming it). Null: send the file as it is.
 */
function pickEncoding(req) {
  const q = new Map();
  for (const part of String(req.headers['accept-encoding'] || '').toLowerCase().split(',')) {
    const [name, ...params] = part.split(';').map((s) => s.trim());
    if (!name) continue;
    const qp = params.find((s) => s.startsWith('q='));
    const v = qp ? Number(qp.slice(2)) : 1;
    q.set(name, Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
  }
  const weight = (name) => q.get(name) ?? (name === 'gzip' ? q.get('x-gzip') : undefined) ?? q.get('*') ?? 0;
  const br = weight('br');
  const gz = weight('gzip');
  if (br > 0 && br >= gz) return 'br';
  return gz > 0 ? 'gzip' : null;
}

function sendBuffer(req, res, status, entry, headers) {
  const enc = entry.compressible ? pickEncoding(req) : null;
  const body = enc === 'br' ? entry.br() : enc === 'gzip' ? entry.gz() : entry.buf;
  const h = { ...baseHeaders(req), ...headers, 'Content-Length': body.length };
  if (entry.compressible) h.Vary = 'Accept-Encoding';
  if (enc) h['Content-Encoding'] = enc;
  res.writeHead(status, h);
  res.end(req.method === 'HEAD' ? undefined : body);
}

function packed(buf, compressible) {
  let gz = null;
  let br = null;
  return {
    buf,
    compressible,
    gz: () => (gz ??= zlib.gzipSync(buf, { level: 9 })),
    // Quality 10 costs about 1 s per MB, once (the result is cached); large files take 9, ten times faster and
    // about 5% bigger, so the first visitor after a restart does not wait for it.
    br: () =>
      (br ??= zlib.brotliCompressSync(buf, {
        params: { [zlib.constants.BROTLI_PARAM_QUALITY]: buf.length > 256 * 1024 ? 9 : 10 },
      })),
  };
}

/* ---------- index.html with the saved content ---------- */

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const scriptJson = (v) =>
  JSON.stringify(v)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .split(String.fromCharCode(0x2028)).join('\\u2028')
    .split(String.fromCharCode(0x2029)).join('\\u2029');

let indexCache = { key: '', page: null };
function renderIndex() {
  const file = path.join(DIST_DIR, 'index.html');
  const key = `${fs.statSync(file).mtimeMs}:${current.version}`;
  if (indexCache.key === key) return indexCache.page;
  const full = site.mergeContent(DEFAULTS, current.content);
  // Functions as replacements: "$" in the texts must never be read as a pattern.
  const html = fs
    .readFileSync(file, 'utf8')
    .replace(/<!--seo-head-->[\s\S]*?<!--\/seo-head-->/, () => `<!--seo-head-->${site.renderSeoHead(full)}<!--/seo-head-->`)
    .replace(/<!--seo-body-->[\s\S]*?<!--\/seo-body-->/, () => `<!--seo-body-->${site.renderStaticBody(full)}<!--/seo-body-->`)
    .replace('<!--SITE_CONTENT-->', () => `<script id="site-content" type="application/json">${scriptJson(current.content ?? {})}</script>`)
    .replace('<img src="/logo.png"', () => `<img src="${esc(full.company.logo)}"`);
  indexCache = { key, page: packed(Buffer.from(html), true) };
  return indexCache.page;
}

function sendIndex(req, res, status = 200) {
  sendBuffer(req, res, status, renderIndex(), { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
}

/* ---------- Static files (dist/ only) ---------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.glb': 'model/gltf-binary',
  '.webm': 'video/webm',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};
// Sent compressed: text, and the 3D models (the ground's mesh halves under gzip; its pictures are already packed).
const TEXT = /^(text\/|application\/(json|xml|manifest)|image\/svg|model\/gltf)/;
/**
 * Files this big are streamed from disk like the videos (with byte ranges), neither kept in memory nor compressed:
 * compressing them for every request would stall the server.
 */
const BIG_FILE = 8 * 1024 * 1024;
/**
 * The files read so far, with their compressed copies: at most 64 MB in all; the ones not asked for the longest go
 * first (a Map keeps the order things were put in, so each hit moves its file to the end).
 */
const fileCache = new Map();
const CACHE_BYTES = 64 * 1024 * 1024;
let cacheBytes = 0;
function cacheDrop(file) {
  const old = fileCache.get(file);
  if (!old) return;
  fileCache.delete(file);
  cacheBytes -= old.bytes;
}
/** The cached copy of a file, if it is still the one on disk (a changed file's old copy is dropped). */
function cacheGet(file, st) {
  const entry = fileCache.get(file);
  if (!entry) return null;
  cacheDrop(file);
  if (entry.mtime !== st.mtimeMs || entry.buf.length !== st.size) return null;
  fileCache.set(file, entry);
  cacheBytes += entry.bytes;
  return entry;
}
function cachePut(file, entry) {
  cacheDrop(file);
  // Room for the file and its two compressed copies, made later on demand. Those are much smaller for text, but
  // about as big as the file for a model whose data is already packed.
  entry.bytes = entry.buf.length * (entry.compressible ? 3 : 1);
  fileCache.set(file, entry);
  cacheBytes += entry.bytes;
  for (const [key, e] of fileCache) {
    if (cacheBytes <= CACHE_BYTES) break;
    fileCache.delete(key);
    cacheBytes -= e.bytes;
  }
}

const realRoots = new Map();
/**
 * The file a URL names under root, or null. Only plain names: no hidden files or folders, no "..", no back slashes,
 * no ":" (a Windows stream such as "admin.html::$DATA" is the file itself under another name) and, on Windows, no
 * name ending in "." or " " (Windows drops those, so "admin.html." would open admin.html). The file must also be
 * spelled exactly as it is on disk: Windows opens "ADMIN.HTML" or a short 8.3 name as the same file, and each
 * spelling would get its own copy in the cache and slip past the checks on the name.
 */
function safeFile(root, urlPath) {
  let p;
  try {
    p = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (p.includes('\0') || p.includes('\\') || p.includes(':')) return null;
  const segments = p.split('/').filter(Boolean);
  if (!segments.length || segments.some((s) => s.startsWith('.'))) return null;
  if (process.platform === 'win32' && segments.some((s) => /[. ]$/.test(s))) return null;
  const file = path.resolve(root, ...segments);
  if (!file.startsWith(root + path.sep)) return null;
  try {
    if (!fs.statSync(file).isFile()) return null;
    let realRoot = realRoots.get(root);
    if (!realRoot) realRoots.set(root, (realRoot = fs.realpathSync.native(root)));
    return fs.realpathSync.native(file) === path.join(realRoot, ...segments) ? file : null;
  } catch {
    return null;
  }
}

function sendFile(req, res, file, cache) {
  const st = fs.statSync(file);
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const compressible = TEXT.test(type) && st.size > 1024 && st.size < BIG_FILE;
  const etag = `W/"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
  if (req.headers['if-none-match'] === etag) {
    // The same Vary as the full answer, so a shared cache keeps one copy per compression here too.
    const h = { ...baseHeaders(req), ETag: etag, 'Cache-Control': cache };
    if (compressible) h.Vary = 'Accept-Encoding';
    res.writeHead(304, h);
    return res.end();
  }
  if (type.startsWith('video/') || st.size >= BIG_FILE) {
    cacheDrop(file);
    return sendMedia(req, res, file, st.size, { 'Content-Type': type, 'Cache-Control': cache, ETag: etag });
  }
  let entry = cacheGet(file, st);
  if (!entry) {
    entry = { mtime: st.mtimeMs, ...packed(fs.readFileSync(file), compressible) };
    cachePut(file, entry);
  }
  sendBuffer(req, res, 200, entry, { 'Content-Type': type, 'Cache-Control': cache, ETag: etag });
}

/**
 * Videos are streamed from disk and answer byte-range requests (206): Safari on iPhone and Mac
 * plays a video only from a server that can send parts of the file.
 */
function sendMedia(req, res, file, size, headers) {
  const h = { ...baseHeaders(req), ...headers, 'Accept-Ranges': 'bytes' };
  const ifRange = req.headers['if-range'];
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || '').trim());
  let start = 0;
  let end = size - 1;
  let status = 200;
  if (m && (!ifRange || ifRange === headers.ETag) && (m[1] || m[2])) {
    if (m[1]) {
      start = Number(m[1]);
      if (m[2]) end = Math.min(Number(m[2]), size - 1);
    } else {
      start = Math.max(0, size - Number(m[2]));
    }
    if (start >= size || start > end) {
      res.writeHead(416, { ...h, 'Content-Range': `bytes */${size}` });
      return res.end();
    }
    status = 206;
    h['Content-Range'] = `bytes ${start}-${end}/${size}`;
  }
  h['Content-Length'] = end - start + 1;
  res.writeHead(status, h);
  if (req.method === 'HEAD' || size === 0) return res.end();
  // A visitor who leaves mid-video (or a file that vanished) just ends the response.
  pipeline(fs.createReadStream(file, { start, end }), res).catch(() => res.destroy());
}

/* ---------- Admin API ---------- */

function requireAdmin(req) {
  const s = getSession(req);
  if (!s) throw new HttpError(401, 'You are signed out (after a few hours without activity, or on another device). Sign in again.');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    if (!sameOrigin(req)) throw new HttpError(403, 'Changes can only be made from the admin page of this site.');
    if (!csrfOk(req, s)) throw new HttpError(403, 'The page is out of date. Reload the admin panel and try again.');
  }
  return s;
}

const IMAGE_TYPES = {
  'image/png': { ext: 'png', ok: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/jpeg': { ext: 'jpg', ok: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/webp': { ext: 'webp', ok: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
};
/** Background videos: MP4 (an "ftyp" box first) or WebM (an EBML header). */
const VIDEO_TYPES = {
  'video/mp4': { ext: 'mp4', ok: (b) => b.subarray(4, 8).toString('latin1') === 'ftyp' },
  'video/webm': { ext: 'webm', ok: (b) => b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) },
};
const IMAGE_MAX = 5 * 1024 * 1024;
const VIDEO_MAX = 40 * 1024 * 1024;

async function api(req, res, p) {
  const ip = clientIp(req);
  const send = (status, body, extra) => sendJson(req, res, status, body, extra);

  // Public: the saved changes (the dev server and the 2D/3D site read them)
  if (p === '/api/content' && req.method === 'GET') return send(200, { version: current.version, content: current.content });

  if (p === '/api/login' && req.method === 'POST') {
    if (!sameOrigin(req)) throw new HttpError(403, 'Sign in from the admin page of this site.');
    const body = await readJsonBody(req);
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!username || !password) return send(400, { error: 'Enter your user name and your password.' });
    if (username.length > 40 || password.length > 200) return send(400, { error: 'Wrong user name or password.' });
    const userKey = `user:${username.toLowerCase()}`;
    const ipKey = `ip:${ip}`;
    // A name that is not an account is never written to the log: people sometimes type
    // their password into the user name box by mistake.
    const logName = (name) => (loadUsers().some((u) => u.username.toLowerCase() === name.toLowerCase()) ? name : '(unknown name)');
    const wait = Math.max(lockLeft(userKey), lockLeft(ipKey));
    if (wait) {
      audit('login.blocked', { user: logName(username), ip });
      return send(429, { error: `Too many wrong passwords. Sign-in is blocked for ${humanWait(wait)}.` }, { 'Retry-After': String(Math.ceil(wait / 1000)) });
    }
    const users = loadUsers();
    if (!users.length) return send(503, { error: 'There is no admin account yet. Create one in the terminal: npm run admin:create' });
    const user = users.find((u) => u.username.toLowerCase() === username.toLowerCase());
    const valid = await verifyPassword(password, user ? user.hash : await dummyHash());
    if (!user || !valid) {
      const a = registerFailure(userKey);
      const b = registerFailure(ipKey);
      audit('login.fail', { user: user ? user.username : '(unknown name)', ip });
      const blocked = Math.max(lockLeft(userKey), lockLeft(ipKey));
      const left = LOCK_AFTER - Math.max(a.fails, b.fails);
      const error = blocked
        ? `Wrong user name or password. Sign-in is now blocked for ${humanWait(blocked)}.`
        : left <= 2
          ? `Wrong user name or password. After ${left} more wrong ${left === 1 ? 'try' : 'tries'}, sign-in is blocked for a while.`
          : 'Wrong user name or password.';
      return send(401, { error });
    }
    clearFailures(userKey, ipKey);
    const s = startSession(req, res, user.username);
    audit('login.ok', { user: user.username, ip });
    return send(200, { user: user.username, csrf: s.csrf, idleMinutes: IDLE_MS / 60_000 });
  }

  if (p === '/api/session' && req.method === 'GET') {
    const s = getSession(req);
    if (!s) return send(401, { error: 'Not signed in.' });
    return send(200, { user: s.user, csrf: s.csrf, idleMinutes: IDLE_MS / 60_000 });
  }

  if (p === '/api/logout' && req.method === 'POST') {
    const s = getSession(req);
    if (s) {
      if (!sameOrigin(req) || !csrfOk(req, s)) throw new HttpError(403, 'The page is out of date. Reload it.');
      sessions.delete(s.key);
      audit('logout', { user: s.user, ip });
    }
    setSessionCookie(req, res, '', true);
    return send(200, { ok: true });
  }

  if (!p.startsWith('/api/admin/')) throw new HttpError(404, 'Unknown address.');
  const s = requireAdmin(req);
  const route = `${req.method} ${p.slice('/api/admin'.length)}`;

  if (route === 'GET /content') return send(200, { ...meta(current), content: current.content });

  if (route === 'PUT /content') {
    const body = await readJsonBody(req, 1024 * 1024);
    if (body.baseVersion !== current.version) {
      const when = current.savedAt ? new Date(current.savedAt).toLocaleString('en-GB', { timeZone: 'Asia/Dubai' }) : '';
      return send(409, {
        error: `Someone${current.user ? ` (${current.user})` : ''} saved other changes${when ? ` on ${when} Dubai time` : ''} while you were editing. Copy what you changed, reload the panel, then make your changes again.`,
        conflict: true,
      });
    }
    const checked = site.validateContent(body.content, DEFAULTS);
    if (!checked.ok) return send(422, { error: 'Some fields need fixing before saving.', issues: checked.issues.slice(0, 50) });
    const diff = site.diffContent(DEFAULTS, checked.content) ?? {};
    if (JSON.stringify(diff) === JSON.stringify(current.content)) return send(200, { ...meta(current), content: current.content, unchanged: true });
    const saved = saveContent(diff, s.user);
    audit('content.save', { user: s.user, ip, version: saved.version, parts: Object.keys(diff) });
    return send(200, { ...meta(saved), content: saved.content });
  }

  if (route === 'GET /versions') {
    const versions = versionNumbers().map((n) => meta(readJson(dataPath('versions', `${n}.json`), { version: n })));
    return send(200, { current: meta(current), versions });
  }

  const restore = /^POST \/versions\/(\d{1,9})\/restore$/.exec(route);
  if (restore) {
    const n = Number(restore[1]);
    let content = {};
    if (n > 0) {
      const snap = readJson(dataPath('versions', `${n}.json`), null);
      if (!snap) return send(404, { error: 'That version is no longer kept (only the last 30 are).' });
      // Older versions may not match today's fields: keep what still fits.
      const checked = site.validateContent(site.mergeContent(DEFAULTS, snap.content), DEFAULTS, { lenient: true });
      content = site.diffContent(DEFAULTS, checked.content) ?? {};
    }
    const saved = saveContent(content, s.user, n > 0 ? `Restored version ${n}` : 'Restored the original texts');
    audit('content.restore', { user: s.user, ip, from: n, version: saved.version });
    return send(200, { ...meta(saved), content: saved.content });
  }

  if (route === 'POST /password') {
    const body = await readJsonBody(req);
    const users = loadUsers();
    const user = users.find((u) => u.username === s.user);
    const userKey = `user:${s.user.toLowerCase()}`;
    const wait = Math.max(lockLeft(userKey), lockLeft(`ip:${ip}`));
    if (wait) return send(429, { error: `Too many wrong passwords. Try again in ${humanWait(wait)}.` });
    if (!user || typeof body.current !== 'string' || !(await verifyPassword(body.current, user.hash))) {
      registerFailure(userKey);
      registerFailure(`ip:${ip}`);
      audit('password.change.fail', { user: s.user, ip });
      return send(400, { error: 'Your current password is not right.', field: 'current' });
    }
    const problem = passwordProblem(body.next, s.user);
    if (problem) return send(400, { error: problem, field: 'next' });
    user.hash = await hashPassword(body.next);
    user.changed = new Date(Date.now() - 1).toISOString();
    saveUsers(users);
    // Every other session of this account ends; this one continues with a fresh token.
    for (const [k, other] of sessions) if (other.user === s.user) sessions.delete(k);
    const fresh = startSession(req, res, s.user);
    audit('password.change', { user: s.user, ip });
    return send(200, { ok: true, csrf: fresh.csrf });
  }

  if (route === 'GET /audit') return send(200, { entries: readAudit(150) });

  if (route === 'POST /upload') {
    const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const video = VIDEO_TYPES[mime];
    const type = IMAGE_TYPES[mime] || video;
    if (!type) return send(415, { error: 'Use a PNG, JPG or WebP image, or an MP4 or WebM video.' });
    const buf = await readBody(req, video ? VIDEO_MAX : IMAGE_MAX);
    if (buf.length < 16 || !type.ok(buf))
      return send(415, { error: video ? 'This file is not a real MP4 or WebM video.' : 'This file is not a real PNG, JPG or WebP image.' });
    const name = `${createHash('sha256').update(buf).digest('hex').slice(0, 24)}.${type.ext}`;
    const target = dataPath('uploads', name);
    if (!fs.existsSync(target)) writeAtomic(target, buf);
    audit('upload', { user: s.user, ip, file: name, bytes: buf.length });
    return send(200, { url: `/uploads/${name}` });
  }

  throw new HttpError(404, 'Unknown address.');
}

/* ---------- Router ---------- */

const UPLOAD_NAME = /^[a-f0-9]{24}\.(png|jpg|webp|mp4|webm)$/;

async function handle(req, res) {
  const url = new URL(req.url || '/', 'http://localhost');
  const p = url.pathname;
  if (p.startsWith('/api/')) return api(req, res, p);
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { ...baseHeaders(req), Allow: 'GET, HEAD' });
    return res.end();
  }
  if (p === '/' || p === '/index.html') return sendIndex(req, res);
  if (p === '/admin') {
    // Not linked anywhere and never indexed (also not listed in robots.txt, which would advertise it).
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    return sendFile(req, res, path.join(DIST_DIR, 'admin.html'), 'no-store');
  }
  if (p === '/admin/' || p === '/admin.html') {
    res.writeHead(301, { ...baseHeaders(req), Location: '/admin' });
    return res.end();
  }
  if (p.startsWith('/uploads/')) {
    const name = p.slice('/uploads/'.length);
    const file = UPLOAD_NAME.test(name) ? safeFile(dataPath('uploads'), name) : null;
    if (file) return sendFile(req, res, file, 'public, max-age=31536000, immutable');
  } else {
    const file = safeFile(DIST_DIR, p);
    // Other spellings of the home page ("/index.html/", "/index%2Ehtml") get the page with the saved content too,
    // never the bare build template.
    if (file && file === path.join(DIST_DIR, 'index.html')) return sendIndex(req, res);
    if (file && path.basename(file) !== 'admin.html') {
      const cache = p.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600';
      return sendFile(req, res, file, cache);
    }
  }
  if (!path.extname(p)) return sendIndex(req, res, 404);
  const body = 'Not found';
  res.writeHead(404, { ...baseHeaders(req), 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': body.length });
  res.end(req.method === 'HEAD' ? undefined : body);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    if (res.headersSent) return res.destroy();
    if (err instanceof HttpError) return sendJson(req, res, err.status, { error: err.message, ...err.extra });
    console.error(err);
    sendJson(req, res, 500, { error: 'Something went wrong on the server. Try again; if it keeps happening, look at the server log.' });
  });
});
server.requestTimeout = 30_000;
server.headersTimeout = 15_000;

server.on('error', (err) => {
  console.error(err.code === 'EADDRINUSE' ? `Port ${PORT} is already in use. Start with another one: PORT=8788 npm run serve` : err.message);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const base = `http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`;
  const accounts = loadUsers().length;
  console.log(`Easy First – site server
  Site:   ${base}/
  Admin:  ${base}/admin${accounts ? '' : '   (no account yet: npm run admin:create)'}
  Data:   ${DATA_DIR}`);
});
