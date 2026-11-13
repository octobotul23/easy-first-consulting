#!/usr/bin/env node
/**
 * Packs the demo build (dist-demo/) into easy-first-consulting-demo.zip, ready to upload
 * as a "site" demo (for example on ILUZ): index.html at the top, plain deflate, no zip64.
 * Uses only Node itself, no npm packages.
 *
 *   npm run demo                                   build the demo, then pack it
 *   node scripts/pack-demo.mjs --out other.zip     pack again under another name
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { keepVersion } from './keep-version.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const root = fileURLToPath(new URL('..', import.meta.url));
const dist = path.resolve(root, arg('dist', 'dist-demo'));
const out = path.resolve(root, arg('out', 'easy-first-consulting-demo.zip'));

const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};
if (!fs.existsSync(path.join(dist, 'index.html'))) fail(`No index.html in ${dist}. Build the demo first: npm run build:demo`);
if (!fs.existsSync(path.join(dist, 'admin.html'))) fail(`No admin.html in ${dist}. Build the demo first: npm run build:demo`);

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.isFile()) files.push(p);
  }
})(dist);
files.sort();

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 =
  zlib.crc32 ??
  ((buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  });

function dosTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((Math.max(d.getFullYear(), 1980) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

const locals = [];
const centrals = [];
let offset = 0;
for (const file of files) {
  const name = path.relative(dist, file).split(path.sep).join('/');
  if (name.startsWith('__') || name.split('/').some((p) => p === '..' || p === '.' || p === '')) fail(`Unsafe file name in the build: ${name}`);
  const data = fs.readFileSync(file);
  const packed = zlib.deflateRawSync(data, { level: 9 });
  const stored = packed.length >= data.length;
  const body = stored ? data : packed;
  const { time, date } = dosTime(fs.statSync(file).mtime);
  const nameBuf = Buffer.from(name, 'utf8');
  const crc = crc32(data);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(0x0800, 6); // UTF-8 names
  local.writeUInt16LE(stored ? 0 : 8, 8);
  local.writeUInt16LE(time, 10);
  local.writeUInt16LE(date, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28);
  locals.push(local, nameBuf, body);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4); // made by
  central.writeUInt16LE(20, 6); // version needed
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(stored ? 0 : 8, 10);
  central.writeUInt16LE(time, 12);
  central.writeUInt16LE(date, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(body.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(offset, 42);
  centrals.push(central, nameBuf);

  offset += local.length + nameBuf.length + body.length;
}

const cd = Buffer.concat(centrals);
if (files.length > 0xffff || offset + cd.length > 0xfffffff0) fail('The build is too large for a plain zip.');
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(cd.length, 12);
end.writeUInt32LE(offset, 16);

// Atomic: a temporary file first, then the real name.
const tmp = `${out}.tmp`;
fs.writeFileSync(tmp, Buffer.concat([...locals, cd, end]));
fs.renameSync(tmp, out);
console.log(`${path.relative(root, out)}: ${files.length} files, ${(fs.statSync(out).size / 1048576).toFixed(1)} MB`);
keepVersion(out);
