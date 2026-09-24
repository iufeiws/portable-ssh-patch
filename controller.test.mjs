import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeviceController } from './payload/controller-core.mjs';
import { EventEmitter } from 'node:events';

const device = id => ({ id, name: id.toUpperCase(), ssh: `server-${id}`, port: 3080, auth: 'systemd', unit: 'dsh.service' });
function fixture(t, failAuth = false) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-device-state-test-'));
  let visible = true, stops = 0, starts = 0, tokens = 0;
  const failures = new Map(), views = [];
  class View {
    constructor(options) {
      this.options = options; this.closed = false; this.loaded = []; this.draft = '';
      Object.assign(this, { webContents: Object.assign(new EventEmitter(), {
        session: { setProxy: async () => {}, fetch: async () => ({ status: failAuth ? 401 : 200, body: { cancel: async () => {} } }) },
        setWindowOpenHandler() {}, isDestroyed: () => this.closed,
        close: () => { this.closed = true; }, loadURL: async url => this.loaded.push(url), focus() {}
      }) });
      views.push(this);
    }
    setBounds(bounds) { this.bounds = bounds; }
    setVisible(value) { this.visible = value; }
  }
  const owner = { refresh() {}, resize() {}, content: { setVisible: value => { visible = value; } }, contentBounds: { x: 0, y: 36, width: 900, height: 700 }, window: { isDestroyed: () => false, contentView: { addChildView() {}, removeChildView() {} } } };
  const controller = new DeviceController(owner, {
    app: { getPath: () => dir }, WebContentsView: View,
    readToken: async () => { tokens++; return 'A'.repeat(43); },
    startTunnel: async (d, failure) => { starts++; failures.set(d.id, failure); return { origin: `http://127.0.0.1:${18080 + starts}`, stop: () => { stops++; } }; }
  });
  const call = (action, id, extra = {}) => controller.command({ scope: 'ssh-devices', action, id, ...extra });
  t.after(() => { controller.dispose(); rmSync(dir, { recursive: true }); });
  return { controller, call, views, visible: () => visible, starts: () => starts, tokens: () => tokens, stops: () => stops, disconnect: id => failures.get(id)(new Error('connection lost')), dir };
}
test('fresh installation contains only the local device and opens no tunnel', t => {
  const f = fixture(t);
  assert.equal(f.controller.state().selected, 'local');
  assert.deepEqual(f.controller.devices, []); assert.equal(f.starts(), 0);
});
test('A to B to A preserves both pages, draft, authentication and tunnels', async t => {
  const f = fixture(t); f.controller.save([device('a'), device('b')]);
  await f.call('connect', 'a'); f.views[0].draft = 'unfinished message';
  await f.call('connect', 'b');
  assert.equal(f.views[0].visible, false); assert.equal(f.views[1].visible, true);
  await f.call('connect', 'a');
  assert.equal(f.views.length, 2); assert.equal(f.starts(), 2); assert.equal(f.tokens(), 2);
  assert.equal(f.views[0].draft, 'unfinished message'); assert.equal(f.views[0].loaded.length, 1);
  assert.equal(f.views[0].visible, true); assert.equal(f.views[1].visible, false);
  assert.notEqual(f.views[0].options.webPreferences.partition, f.views[1].options.webPreferences.partition);
  await f.call('connect', 'local');
  assert.equal(f.visible(), true); assert.equal(f.stops(), 0);
  assert.ok(f.views.every(view => !view.closed));
  f.controller.dispose(); assert.equal(f.stops(), 2); assert.ok(f.views.every(view => view.closed));
});
test('explicit reconnect replaces only the requested device', async t => {
  const f = fixture(t); f.controller.save([device('a'), device('b')]);
  await f.call('connect', 'a'); await f.call('connect', 'b'); await f.call('reconnect', 'a');
  assert.equal(f.starts(), 3); assert.equal(f.stops(), 1);
  assert.equal(f.views[0].closed, true); assert.equal(f.views[1].closed, false);
  assert.equal(f.views[1].loaded.length, 1);
});
test('background SSH failure is reported without changing foreground or silently reconnecting', async t => {
  const f = fixture(t); f.controller.save([device('a'), device('b')]);
  await f.call('connect', 'a'); await f.call('connect', 'b'); f.disconnect('a');
  assert.equal(f.controller.state().selected, 'b'); assert.equal(f.controller.state().error, '');
  assert.ok(f.controller.state().tabs.a.error);
  await f.call('connect', 'a'); assert.equal(f.starts(), 2); assert.ok(f.controller.state().error);
});
test('failed login stays selected, releases resources and does not fall back to local', async t => {
  const f = fixture(t, true); f.controller.save([device('a')]); await f.call('connect', 'a');
  assert.equal(f.controller.state().selected, 'a'); assert.ok(f.controller.state().error);
  assert.equal(f.visible(), false); assert.equal(f.stops(), 1); assert.equal(f.views[0].closed, true);
  await f.call('connect', 'local'); assert.equal(f.visible(), true);
});
test('only the editor pins chrome open; returning to list releases the pin', async t => {
  const f = fixture(t);
  await f.call('panel', undefined, { open: true, persistent: false }); assert.equal(f.controller.panelOpen, false);
  await f.call('panel', undefined, { open: true, persistent: true }); assert.equal(f.controller.panelOpen, true);
  await f.call('panel', undefined, { open: true, persistent: false }); assert.equal(f.controller.panelOpen, false);
  await f.call('panel', undefined, { open: false }); assert.equal(f.controller.owner.expanded, false);
});
test('app restart retains device configuration but not live connections', async t => {
  const f = fixture(t); f.controller.save([device('a')]); await f.call('connect', 'a');
  f.controller.dispose();
  const next = new DeviceController(f.controller.owner, f.controller.services);
  assert.equal(next.state().selected, 'local'); assert.ok(next.devices.some(d => d.id === 'a'));
  assert.deepEqual(next.state().tabs, {});
  await next.command({ scope: 'ssh-devices', action: 'connect', id: 'a' }); assert.equal(f.starts(), 2); next.dispose();
});
test('editing a cached endpoint requires an explicit disconnect and never loses other tabs', async t => {
  const f = fixture(t); f.controller.save([device('a'), device('b')]); await f.call('connect', 'a'); await f.call('connect', 'b');
  await assert.rejects(f.call('save', undefined, { device: { ...device('a'), port: 8080 } }));
  await f.call('disconnect', 'a');
  await f.call('save', undefined, { device: { ...device('a'), port: 8080, token: 'DO_NOT_SAVE' } });
  assert.equal(f.views[1].closed, false);
  assert.equal(readFileSync(join(f.dir, 'ssh-devices.json'), 'utf8').includes('DO_NOT_SAVE'), false);
});
test('refresh and developer tools target the selected cached page only', async t => {
  const f = fixture(t); f.controller.save([device('a'), device('b')]);
  await f.call('connect', 'a'); await f.call('connect', 'b');
  const calls = [];
  f.views.forEach((view, i) => { view.webContents.reloadIgnoringCache = () => calls.push(['reload', i]); view.webContents.toggleDevTools = () => calls.push(['developer', i]); });
  await f.controller.control('reload'); await f.controller.control('developer');
  await f.call('connect', 'a'); await f.controller.control('reload');
  assert.deepEqual(calls, [['reload', 1], ['developer', 1], ['reload', 0]]);
  assert.equal(f.starts(), 2);
});
test('remote terminal is unavailable and local terminal retains original controls', async t => {
  const f = fixture(t); f.controller.save([device('a')]); await f.call('connect', 'a');
  const targets = [];
  f.controller.owner.actions = { openTerminal: () => targets.push('local') };
  await assert.rejects(f.controller.control('terminal'));
  assert.deepEqual(targets, []);
  assert.equal(f.controller.state().error, '');
  await f.call('connect', 'local'); await f.controller.control('terminal');
  assert.deepEqual(targets, ['local']);
});
test('cancelled remote restart leaves all sessions untouched', async t => {
  const f = fixture(t); f.controller.save([device('a')]); await f.call('connect', 'a');
  f.controller.services.confirmRestart = async () => false;
  f.controller.services.restartService = async () => { throw new Error('must not execute'); };
  await f.controller.control('restart');
  assert.equal(f.starts(), 1); assert.equal(f.stops(), 0); assert.equal(f.views[0].closed, false);
});
test('confirmed restart affects only the target and exchanges a new login', async t => {
  const f = fixture(t); f.controller.save([device('a'), device('b')]); await f.call('connect', 'a'); await f.call('connect', 'b');
  const targets = [];
  f.controller.services.confirmRestart = async d => { targets.push(['confirm', d.id]); return true; };
  f.controller.services.restartService = async d => targets.push(['restart', d.id]);
  await f.controller.control('restart');
  assert.deepEqual(targets, [['confirm', 'b'], ['restart', 'b']]);
  assert.equal(f.views[0].closed, false); assert.equal(f.views[1].closed, true);
  assert.equal(f.starts(), 3); assert.equal(f.tokens(), 3);
});
test('restart failures expose the service error and never replay the restart', async t => {
  const f = fixture(t); f.controller.save([device('a')]); await f.call('connect', 'a');
  let attempts = 0;
  f.controller.services.confirmRestart = async () => true;
  f.controller.services.restartService = async () => { attempts++; throw new Error('service permission denied'); };
  await assert.rejects(f.controller.control('restart'));
  assert.equal(attempts, 1); assert.match(f.controller.state().error, /permission denied/);
  assert.equal(f.starts(), 1);
});
