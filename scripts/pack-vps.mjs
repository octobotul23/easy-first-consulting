#!/usr/bin/env node
/**
 * Packs the site for a Linux server (VPS) into easyfirst-vps.tar.gz: the built site (dist/), the Node
 * server, package.json, README and deploy/ (install script, service, nginx). Never data/: the texts,
 * accounts and uploads live on the server. Uses the system's tar (Windows 10+, macOS, Linux).
 *
 *   npm run vps     build, then pack
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = 'easyfirst-vps.tar.gz';
const parts = ['dist', 'server', 'deploy', 'package.json', 'README.md'];
const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) fail('No dist/index.html. Build first: npm run build');
if (!fs.existsSync(path.join(root, 'server', 'build', 'entry.js'))) fail('No server/build/entry.js. Build first: npm run build');
// Scripts and configs run on Linux: Windows line endings would break them.
for (const f of fs.readdirSync(path.join(root, 'deploy'))) {
  if (fs.readFileSync(path.join(root, 'deploy', f), 'utf8').includes('\r')) fail(`deploy/${f} has Windows line endings (CRLF). Save it with LF.`);
}

const tmp = `${out}.tmp`;
const r = spawnSync('tar', ['-czf', tmp, ...parts], { cwd: root, stdio: 'inherit' });
if (r.error || r.status !== 0) fail(`tar failed${r.error ? `: ${r.error.message}` : ''}`);
fs.renameSync(path.join(root, tmp), path.join(root, out));
console.log(`${out}: ${(fs.statSync(path.join(root, out)).size / 1048576).toFixed(1)} MB`);
