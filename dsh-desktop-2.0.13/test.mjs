import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { validateDevice, parseToken } from './payload/ssh.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(process.env.DSH_INSTALL_DIR ?? join(here, '..'));
const manifest = JSON.parse(readFileSync(join(here, 'manifest.json'), 'utf8'));
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-ssh-patch-test-'));
  t.after(() => rmSync(dir, { recursive: true }));
  const app = join(dir, 'resources', 'app'); mkdirSync(app, { recursive: true });
  writeFileSync(join(app, 'package.json'), JSON.stringify({ version: manifest.targetVersion }));
  for (const f of manifest.files) {
    mkdirSync(dirname(join(app, f.path)), { recursive: true });
    const originalRoot = join(root, 'resources', 'app');
    const installed = existsSync(join(originalRoot, 'ssh-device-patch-backup', 'receipt.json'));
    copyFileSync(installed ? join(originalRoot, 'ssh-device-patch-backup', f.path.replaceAll('/', '__')) : join(originalRoot, f.path), join(app, f.path));
  }
  return { dir, app };
}
function run(action, dir) { return execFileSync('node', [join(here, 'install.mjs'), action, dir], { encoding: 'utf8', stdio: 'pipe' }); }
test('install and uninstall restore every original byte', t => {
  const { dir, app } = fixture(t);
  const before = manifest.files.map(f => readFileSync(join(app, f.path)));
  run('install', dir);
  assert.ok(existsSync(join(app, 'lib/device-switch/controller.mjs')));
  for (const f of manifest.files.filter(f => f.path.endsWith('.js'))) execFileSync('node', ['--check', join(app, f.path)], { stdio: 'pipe' });
  run('uninstall', dir);
  manifest.files.forEach((f, i) => assert.deepEqual(readFileSync(join(app, f.path)), before[i]));
  assert.equal(existsSync(join(app, 'lib/device-switch')), false);
});
test('unknown application build is left untouched', t => {
  const { dir, app } = fixture(t);
  const path = join(app, manifest.files[0].path); writeFileSync(path, 'different application build');
  assert.throws(() => run('install', dir));
  assert.equal(readFileSync(path, 'utf8'), 'different application build');
  assert.equal(existsSync(join(app, 'ssh-device-patch-backup')), false);
});
test('uninstall does not overwrite subsequent user edits', t => {
  const { dir, app } = fixture(t); run('install', dir);
  const path = join(app, manifest.files[0].path); writeFileSync(path, 'user edit');
  assert.throws(() => run('uninstall', dir));
  assert.equal(readFileSync(path, 'utf8'), 'user edit');
  assert.ok(existsSync(join(app, 'ssh-device-patch-backup')));
});
test('device inputs cannot inject SSH options or remote shell commands', () => {
  const valid = { id: 'other', name: 'Other server', ssh: 'user@server', port: 4000, auth: 'systemd', unit: 'dsh.service' };
  assert.equal(validateDevice(valid).ssh, valid.ssh);
  for (const ssh of ['-oProxyCommand=evil', 'dev-server;whoami', 'dev-server\n-oProxyCommand=evil']) assert.throws(() => validateDevice({ ...valid, ssh }));
  assert.throws(() => validateDevice({ ...valid, unit: 'dsh.service;id' }));
  assert.throws(() => validateDevice({ ...valid, port: 70000 }));
  assert.throws(() => validateDevice({ ...valid, id: '../other' }));
});
test('manual login accepts a DSH URL without retaining its remote address', () => {
  const token = 'A'.repeat(43);
  assert.equal(parseToken('http://127.0.0.1:3080/?token=' + token), token);
  assert.equal(parseToken(token), token);
  assert.throws(() => parseToken('http://127.0.0.1:3080/'));
});
