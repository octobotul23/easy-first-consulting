/**
 * Files in the data folder. Every write is atomic: a temporary file next to the target,
 * then a rename, so a crash or a full disk never leaves half a file behind.
 *
 *   data/users.json        admin accounts (password hashes only)
 *   data/content.json      the saved changes (only what differs from the defaults)
 *   data/versions/N.json   the previous 30 saves, restorable from Settings
 *   data/uploads/          images uploaded from the panel (served at /uploads/…)
 *   data/audit.log         who signed in, saved, restored or changed a password
 *   data/lockouts.json     temporary blocks after wrong passwords
 */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Reads --name value / --name=value from the command line, then the environment. */
export function setting(argName, envName, fallback) {
  const argv = process.argv;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === `--${argName}` && argv[i + 1] !== undefined) return argv[i + 1];
    if (argv[i].startsWith(`--${argName}=`)) return argv[i].slice(argName.length + 3);
  }
  const env = process.env[envName];
  return env !== undefined && env !== '' ? env : fallback;
}

export const DATA_DIR = path.resolve(PROJECT_DIR, setting('data', 'DATA_DIR', 'data'));

export function dataPath(...parts) {
  return path.join(DATA_DIR, ...parts);
}

export function ensureDataDirs() {
  for (const dir of [DATA_DIR, dataPath('versions'), dataPath('uploads')]) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err && err.code === 'ENOENT') return fallback;
    throw new Error(`Could not read ${path.relative(PROJECT_DIR, file)}: ${err.message}`);
  }
}

export function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  const fd = fs.openSync(tmp, 'w', 0o600);
  try {
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

export function writeJson(file, value) {
  writeAtomic(file, JSON.stringify(value, null, 2) + '\n');
}

/* ---------- Accounts ---------- */

const USERS = () => dataPath('users.json');

export function loadUsers() {
  const data = readJson(USERS(), { users: [] });
  return Array.isArray(data.users) ? data.users : [];
}

export function saveUsers(users) {
  ensureDataDirs();
  writeJson(USERS(), { users });
}

export const USERNAME = /^[A-Za-z0-9._-]{3,40}$/;

/* ---------- Audit log ---------- */

const AUDIT_MAX = 5 * 1024 * 1024;

/** One JSON line per event. The file is rotated once it reaches 5 MB (one old copy kept). */
export function audit(action, details = {}) {
  ensureDataDirs();
  const file = dataPath('audit.log');
  try {
    if (fs.statSync(file).size > AUDIT_MAX) fs.renameSync(file, `${file}.1`);
  } catch {
    /* no log yet */
  }
  const entry = { at: new Date().toISOString(), action, ...details };
  fs.appendFileSync(file, JSON.stringify(entry) + '\n', { mode: 0o600 });
}

export function readAudit(limit = 100) {
  try {
    const lines = fs.readFileSync(dataPath('audit.log'), 'utf8').trim().split('\n');
    return lines
      .slice(-limit)
      .reverse()
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}
