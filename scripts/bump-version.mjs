#!/usr/bin/env node
/**
 * Raises the site's version by one (0.0.1 → 0.0.2) before every build. package.json is the only place
 * the version is written; vite.config.ts reads it into the build, and the panel shows it under Settings.
 * Writes are atomic: a temporary file first, then the real name.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const write = (file, text) => {
  fs.writeFileSync(`${file}.tmp`, text);
  fs.renameSync(`${file}.tmp`, file);
};

const pkgFile = `${root}package.json`;
const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(pkg.version || '0.0.0');
if (!m) {
  console.error(`package.json: the version "${pkg.version}" is not like 0.0.1.`);
  process.exit(1);
}
const next = `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
pkg.version = next;
write(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`);

// The lock file repeats the version; keep it the same.
const lockFile = `${root}package-lock.json`;
if (fs.existsSync(lockFile)) {
  const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
  lock.version = next;
  if (lock.packages?.['']) lock.packages[''].version = next;
  write(lockFile, `${JSON.stringify(lock, null, 2)}\n`);
}
console.log(`version ${next}`);
