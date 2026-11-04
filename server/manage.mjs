#!/usr/bin/env node
/**
 * Admin accounts, from the terminal only (the site has no sign-up page).
 *
 *   npm run admin:create                 create an account (asks for a name and a password)
 *   npm run admin:password -- <name>     set a new password for an account
 *   node server/manage.mjs list-admins
 *   node server/manage.mjs remove-admin <name>
 *
 * The password is typed hidden. Options: --data <folder> (or DATA_DIR) for the data folder.
 */
import readline from 'node:readline';
import { audit, DATA_DIR, loadUsers, saveUsers, USERNAME } from './lib/store.mjs';
import { hashPassword, passwordProblem } from './lib/passwords.mjs';

const [, , command, ...rest] = process.argv;
const positional = rest.filter((a, i) => !a.startsWith('--') && !(rest[i - 1] ?? '').startsWith('--'));

/* ---------- Input ---------- */

let piped = null;
/** Lines from a pipe (for scripts): `printf 'name\npass\npass\n' | node server/manage.mjs create-admin`. */
async function pipedLine() {
  if (!piped) {
    piped = [];
    const rl = readline.createInterface({ input: process.stdin, terminal: false });
    for await (const line of rl) piped.push(line);
  }
  return piped.shift() ?? '';
}

async function ask(question) {
  if (!process.stdin.isTTY) return pipedLine();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question(question, resolve));
  rl.close();
  return answer.trim();
}

/** Reads a password without showing it. */
async function askHidden(question) {
  if (!process.stdin.isTTY) return pipedLine();
  process.stdout.write(question);
  const stdin = process.stdin;
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  return new Promise((resolve) => {
    let value = '';
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u0003') {
          process.stdout.write('\nCancelled.\n');
          process.exit(130);
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else if (ch >= ' ') value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function newPassword(username) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const a = await askHidden('New password (hidden, at least 12 characters): ');
    const problem = passwordProblem(a, username);
    if (problem) {
      console.error(problem);
      if (!process.stdin.isTTY) process.exit(1);
      continue;
    }
    const b = await askHidden('Type it again: ');
    if (a !== b) {
      console.error('The two passwords are different. Try again.');
      if (!process.stdin.isTTY) process.exit(1);
      continue;
    }
    return a;
  }
  console.error('No password set.');
  process.exit(1);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

/* ---------- Commands ---------- */

async function createAdmin() {
  const users = loadUsers();
  const username = positional[0] ?? (await ask('User name for the admin panel: '));
  if (!USERNAME.test(username)) fail('Use 3–40 letters, digits, dots, dashes or underscores for the user name.');
  if (users.some((u) => u.username.toLowerCase() === username.toLowerCase()))
    fail(`“${username}” already exists. To set a new password: npm run admin:password -- ${username}`);
  const password = await newPassword(username);
  const now = new Date().toISOString();
  users.push({ username, hash: await hashPassword(password), created: now, changed: now });
  saveUsers(users);
  audit('account.create', { user: username, by: 'terminal' });
  console.log(`\nAccount “${username}” created in ${DATA_DIR}.\nSign in at /admin (see README for the hidden shortcuts).`);
}

async function resetPassword() {
  const users = loadUsers();
  const username = positional[0] ?? (await ask('User name: '));
  const user = users.find((u) => u.username.toLowerCase() === String(username).toLowerCase());
  if (!user) fail(`There is no account “${username}”. Accounts: ${users.map((u) => u.username).join(', ') || 'none yet'}.`);
  const password = await newPassword(user.username);
  user.hash = await hashPassword(password);
  // Sessions started before this moment stop working: everyone signs in again with the new password.
  user.changed = new Date().toISOString();
  saveUsers(users);
  audit('password.reset', { user: user.username, by: 'terminal' });
  console.log(`\nNew password set for “${user.username}”. Open sessions of this account are signed out.`);
}

function listAdmins() {
  const users = loadUsers();
  if (!users.length) return console.log(`No accounts yet in ${DATA_DIR}. Create one: npm run admin:create`);
  for (const u of users) console.log(`${u.username}  (created ${u.created?.slice(0, 10)}, password changed ${u.changed?.slice(0, 10)})`);
}

function removeAdmin() {
  const users = loadUsers();
  const username = positional[0];
  if (!username) fail('Which account? node server/manage.mjs remove-admin <name>');
  const left = users.filter((u) => u.username.toLowerCase() !== username.toLowerCase());
  if (left.length === users.length) fail(`There is no account “${username}”.`);
  saveUsers(left);
  audit('account.remove', { user: username, by: 'terminal' });
  console.log(`Account “${username}” removed.`);
}

const commands = {
  'create-admin': createAdmin,
  'reset-password': resetPassword,
  'list-admins': listAdmins,
  'remove-admin': removeAdmin,
};

const run = commands[command];
if (!run) {
  console.log(`Admin accounts for the site.

  node server/manage.mjs create-admin [name]     create an account
  node server/manage.mjs reset-password <name>   set a new password
  node server/manage.mjs list-admins             show the accounts
  node server/manage.mjs remove-admin <name>     delete an account

  Data folder: ${DATA_DIR}  (change with --data <folder> or DATA_DIR)`);
  process.exit(command ? 1 : 0);
}
await run();
