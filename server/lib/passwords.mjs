/**
 * Password hashing with scrypt (Node's built-in crypto) and a random salt per password.
 * Stored as: scrypt$<logN>$<r>$<p>$<salt base64>$<hash base64>
 */
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const LOG_N = 15; // N = 32768
const R = 8;
const P = 1;
const KEYLEN = 64;
const MAXMEM = 128 * 1024 * 1024;

function derive(password, salt, logN, r, p) {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize('NFKC'), salt, KEYLEN, { N: 2 ** logN, r, p, maxmem: MAXMEM }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await derive(password, salt, LOG_N, R, P);
  return ['scrypt', LOG_N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

/** A hash for "no such user": login takes the same time whether the name exists or not. */
let dummy = null;
export async function dummyHash() {
  dummy ??= await hashPassword(randomBytes(18).toString('base64'));
  return dummy;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, logN, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, 'base64');
  const n = Number(logN);
  if (!Number.isInteger(n) || n < 14 || n > 20) return false;
  const key = await derive(password, Buffer.from(salt, 'base64'), n, Number(r), Number(p));
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Rules for a new password. Returns an error message, or null when it is fine. */
export function passwordProblem(password, username = '') {
  if (typeof password !== 'string' || password.length < 12) return 'The password needs at least 12 characters.';
  if (password.length > 200) return 'The password can have at most 200 characters.';
  if (username && password.toLowerCase().includes(username.toLowerCase())) return 'The password must not contain the user name.';
  if (/^(.)\1+$/.test(password)) return 'The password can’t be one character repeated.';
  return null;
}
