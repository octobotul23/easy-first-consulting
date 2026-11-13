/**
 * Keeps a copy of every build's package in versions/v<version>/ (the version comes from package.json,
 * raised by scripts/bump-version.mjs) and adds a line to versions/versions.txt. Nothing is ever deleted.
 * versions/ stays out of git: delivery packages never go to GitHub.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

/** @param {string} file the package just written (absolute, or relative to the project folder) */
export function keepVersion(file) {
  const src = path.resolve(root, file);
  const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const dir = path.join(root, 'versions', `v${version}`);
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, path.basename(src));
  // Atomic: a temporary file first, then the real name.
  fs.copyFileSync(src, `${dest}.tmp`);
  fs.renameSync(`${dest}.tmp`, dest);

  const mb = (fs.statSync(dest).size / 1048576).toFixed(1);
  const when = new Date().toLocaleString('en-GB').replace(',', '');
  const list = path.join(root, 'versions', 'versions.txt');
  if (!fs.existsSync(list)) fs.writeFileSync(list, 'version   built on             package                              size\n');
  fs.appendFileSync(list, `${`v${version}`.padEnd(10)}${when.padEnd(21)}${path.basename(src).padEnd(37)}${mb} MB\n`);
  console.log(`kept in ${path.relative(root, dest).split(path.sep).join('/')}`);
}
