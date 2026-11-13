/**
 * The admin panel's server, played by the browser: demo build only (`npm run demo`).
 *
 * It answers the same requests as server/server.mjs, the same way: content is checked with
 * the same rules, only the differences from the defaults are kept, every save keeps the
 * previous version (the last 30), and a short activity list is written. Everything stays in
 * this browser's storage; nothing is sent anywhere. There are no accounts and no passwords.
 */
import { defaultContent, mergeContent } from '../content';
import { diffContent, validateContent } from '../content/rules';
import { DEMO_IMAGE, DEMO_KEYS, storageGet, storageRemove, storageSet } from '../lib/demo';
import { ApiError, type AuditEntry, type SavedContent, type SessionInfo, type VersionMeta } from './api';

interface Saved extends VersionMeta {
  content: unknown;
}
interface State {
  current: Saved;
  versions: Saved[];
  audit: AuditEntry[];
}
interface Request {
  method?: string;
  json?: unknown;
  file?: Blob;
}

const KEEP_VERSIONS = 30;
const KEEP_AUDIT = 150;
const EMPTY: Saved = { version: 0, savedAt: null, user: null, note: '', content: {} };

/** Does this browser keep anything? If not, the demo still works until the page is closed. */
let persist: boolean | null = null;
export function demoKeepsChanges(): boolean {
  if (persist === null) {
    const probe = `${DEMO_KEYS.state}:probe`;
    persist = storageSet('local', probe, '1');
    storageRemove('local', probe);
  }
  return persist;
}
let memory: State = { current: EMPTY, versions: [], audit: [] };
let memorySession: string | null = null;

function load(): State {
  if (!demoKeepsChanges()) return memory;
  try {
    const s = JSON.parse(storageGet('local', DEMO_KEYS.state) ?? 'null');
    if (typeof s?.current?.version === 'number') {
      return { current: s.current, versions: Array.isArray(s.versions) ? s.versions : [], audit: Array.isArray(s.audit) ? s.audit : [] };
    }
  } catch {
    /* damaged: start again */
  }
  return { current: EMPTY, versions: [], audit: [] };
}

function store(s: State) {
  memory = s;
  if (demoKeepsChanges() && !storageSet('local', DEMO_KEYS.state, JSON.stringify(s))) {
    throw new ApiError(507, 'This browser has no room left for the demo. Go back to the original texts (Settings → Earlier versions), then try again.');
  }
}

const meta = (v: Saved): VersionMeta => ({ version: v.version, savedAt: v.savedAt, user: v.user, note: v.note || '' });

function audit(s: State, action: string, extra: Partial<AuditEntry> = {}) {
  s.audit = [{ at: new Date().toISOString(), action, ...extra }, ...s.audit].slice(0, KEEP_AUDIT);
}

function save(s: State, content: unknown, user: string, note = ''): Saved {
  if (s.current.version > 0) s.versions = [s.current, ...s.versions].slice(0, KEEP_VERSIONS);
  s.current = { version: s.current.version + 1, savedAt: new Date().toISOString(), user, note, content: content ?? {} };
  pruneImages(s);
  return s.current;
}

/** Uploaded images that no kept version uses any more are removed, so storage does not fill up. */
function pruneImages(s: State) {
  if (!demoKeepsChanges()) return;
  const used = JSON.stringify([s.current, ...s.versions]);
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(DEMO_KEYS.imagePrefix) && !used.includes(key.slice(DEMO_KEYS.imagePrefix.length))) localStorage.removeItem(key);
    }
  } catch {
    /* storage not readable: nothing to tidy */
  }
}

const session = () => (demoKeepsChanges() ? storageGet('session', DEMO_KEYS.session) : memorySession);
function setSession(user: string | null) {
  memorySession = user;
  if (user) storageSet('session', DEMO_KEYS.session, user);
  else storageRemove('session', DEMO_KEYS.session);
}

/** A short, stable name for an uploaded image (two 32-bit FNV-1a hashes). */
function hashId(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

/** The image made smaller (at most 1600 px) and kept in this browser as a data address. */
async function storeImage(file: Blob): Promise<string> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new ApiError(415, 'Use a PNG, JPG or WebP image.');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new ApiError(415, 'This file is not a real PNG, JPG or WebP image.');
  }
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  let data = canvas.toDataURL('image/webp', 0.86);
  const ext = data.startsWith('data:image/webp') ? 'webp' : 'png';
  if (ext === 'png') data = canvas.toDataURL('image/png');
  const id = `demo-${hashId(data)}`;
  if (!storageSet('local', DEMO_KEYS.imagePrefix + id, data)) {
    throw new ApiError(507, 'This browser has no room left for more demo images. Use a smaller image, or a link that starts with https://.');
  }
  const url = `/uploads/${id}.${ext}`;
  if (!DEMO_IMAGE.test(url)) throw new ApiError(500, 'The image could not be kept. Try again.');
  return url;
}

export async function demoApi<T>(path: string, req: Request = {}): Promise<T> {
  const method = req.method ?? 'GET';
  const user = session();
  const s = load();

  if (method === 'GET' && path === '/api/session') {
    if (!user) throw new ApiError(401, 'Not signed in.');
    return { user, csrf: 'demo', idleMinutes: 0 } satisfies SessionInfo as T;
  }
  if (method === 'POST' && path === '/api/login') {
    setSession('demo');
    audit(s, 'login.ok', { user: 'demo' });
    store(s);
    return { user: 'demo', csrf: 'demo', idleMinutes: 0 } satisfies SessionInfo as T;
  }
  if (method === 'POST' && path === '/api/logout') {
    if (user) {
      audit(s, 'logout', { user });
      store(s);
    }
    setSession(null);
    return { ok: true } as T;
  }

  if (!path.startsWith('/api/admin/')) throw new ApiError(404, 'Unknown address.');
  if (!user) throw new ApiError(401, 'Not signed in.');
  const route = `${method} ${path.slice('/api/admin'.length)}`;

  if (route === 'GET /content') return { ...meta(s.current), content: s.current.content } satisfies SavedContent as T;

  if (route === 'PUT /content') {
    const body = (req.json ?? {}) as { baseVersion?: unknown; content?: unknown };
    if (body.baseVersion !== s.current.version) {
      throw new ApiError(409, 'Other changes were saved in another tab while you were editing. Copy what you changed, reload the panel, then make your changes again.');
    }
    const checked = validateContent(body.content, defaultContent);
    if (!checked.ok) throw new ApiError(422, 'Some fields need fixing before saving.', { issues: checked.issues.slice(0, 50) });
    const diff = diffContent(defaultContent, checked.content) ?? {};
    if (JSON.stringify(diff) === JSON.stringify(s.current.content)) {
      return { ...meta(s.current), content: s.current.content, unchanged: true } satisfies SavedContent as T;
    }
    const saved = save(s, diff, user);
    audit(s, 'content.save', { user, version: saved.version });
    store(s);
    return { ...meta(saved), content: saved.content } satisfies SavedContent as T;
  }

  if (route === 'GET /versions') return { current: meta(s.current), versions: s.versions.map(meta) } as T;

  const restore = /^POST \/versions\/(\d{1,9})\/restore$/.exec(route);
  if (restore) {
    const n = Number(restore[1]);
    let content: unknown = {};
    if (n > 0) {
      const snap = s.versions.find((v) => v.version === n);
      if (!snap) throw new ApiError(404, 'That version is no longer kept (only the last 30 are).');
      // Older versions may not match today's fields: keep what still fits.
      const checked = validateContent(mergeContent(defaultContent, snap.content), defaultContent, { lenient: true });
      content = diffContent(defaultContent, checked.content) ?? {};
    }
    const saved = save(s, content, user, n > 0 ? `Restored version ${n}` : 'Restored the original texts');
    audit(s, 'content.restore', { user, from: n, version: saved.version });
    store(s);
    return { ...meta(saved), content: saved.content } satisfies SavedContent as T;
  }

  if (route === 'POST /password') throw new ApiError(400, 'The demo has no passwords. On the real site you change yours here.');

  if (route === 'GET /audit') return { entries: s.audit } as T;

  if (route === 'POST /upload') {
    if (!req.file) throw new ApiError(400, 'Choose an image first.');
    if (req.file.type.startsWith('video/'))
      throw new ApiError(415, 'The demo can’t keep videos in this browser. Paste a link that starts with https://, or a file of the site such as /media/dubai-loop.mp4. On the real site the upload works.');
    const url = await storeImage(req.file);
    const now = load(); // the image took a moment: add to the latest state
    audit(now, 'upload', { user, file: url.slice('/uploads/'.length) });
    store(now);
    return { url } as T;
  }

  throw new ApiError(404, 'Unknown address.');
}
