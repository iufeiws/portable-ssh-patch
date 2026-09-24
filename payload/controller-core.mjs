import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { validateDevice } from './ssh.mjs';

export class DeviceController {
  constructor(owner, services) {
    this.owner = owner;
    this.services = services;
    this.selected = 'local';
    this.panelOpen = false; // Only the editor pins the native chrome open.
    this.tabs = new Map();
    this.path = join(services.app.getPath('userData'), 'ssh-devices.json');
    this.devices = existsSync(this.path) ? JSON.parse(readFileSync(this.path, 'utf8')).map(validateDevice) : [];
    if (new Set(this.devices.map(device => device.id)).size !== this.devices.length) throw new Error('SSH 设备 ID 重复');
  }
  state() {
    const current = this.tabs.get(this.selected);
    const describe = tab => ({ status: tab.status, stage: tab.stage, error: tab.error, busy: tab.busy, connected: tab.connected });
    return { devices: this.devices, selected: this.selected,
      ...(current ? describe(current) : { status: this.selected === 'local' ? '本机' : '未连接', stage: '', error: '', busy: false, connected: false }),
      tabs: Object.fromEntries([...this.tabs].map(([id, tab]) => [id, describe(tab)])) };
  }
  live(tab) { return !this.disposed && this.tabs.get(tab.id) === tab; }
  publish() { if (!this.disposed) this.owner.refresh(); }
  progress(tab, stage) { tab.stage = stage; tab.status = stage; this.publish(); }
  resize() { for (const tab of this.tabs.values()) if (tab.view && this.owner.contentBounds) tab.view.setBounds(this.owner.contentBounds); }
  select(id) {
    this.selected = id;
    this.owner.content.setVisible(id === 'local');
    for (const tab of this.tabs.values()) tab.view?.setVisible(tab.id === id);
    const web = this.tabs.get(id)?.view?.webContents;
    if (web && !web.isDestroyed()) web.focus();
    this.publish();
  }
  release(tab) {
    clearInterval(tab.monitor);
    tab.abort.abort();
    tab.tunnel?.stop(); tab.tunnel = undefined;
    if (tab.view) {
      if (!this.owner.window.isDestroyed()) this.owner.window.contentView.removeChildView(tab.view);
      if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close({ waitForBeforeUnload: false });
      tab.view = undefined;
    }
    tab.connected = false;
  }
  dispose() { this.disposed = true; for (const tab of this.tabs.values()) this.release(tab); this.tabs.clear(); }
  fail(tab, stage, error) {
    if (!this.live(tab)) return;
    clearInterval(tab.monitor);
    tab.connected = false; tab.status = '连接失败'; tab.stage = stage;
    tab.error = `${stage}失败\n${error.message}`.replace(/([?&]token=)[^\s&#]+/g, '$1[REDACTED]');
    this.publish();
  }
  save(devices) {
    mkdirSync(this.services.app.getPath('userData'), { recursive: true });
    const temp = `${this.path}.${randomUUID()}.tmp`;
    writeFileSync(temp, JSON.stringify(devices, null, 2) + '\n', { mode: 0o600 });
    renameSync(temp, this.path); this.devices = devices;
  }
  async openExternalLink(url) {
    try {
      const target = new URL(url);
      if (!['http:', 'https:', 'mailto:'].includes(target.protocol)) throw new Error(`不支持的链接协议：${target.protocol}`);
      await this.services.openExternal(target.href);
    } catch (error) {
      this.services.showLinkError(error.message);
    }
  }
  async control(action) {
    const local = { terminal: 'openTerminal', reload: 'reload', developer: 'developerTools', restart: 'restart' };
    if (!Object.hasOwn(local, action)) throw new Error('不支持的设备控件');
    if (this.selected === 'local') return this.owner.actions[local[action]]();
    if (action === 'terminal') throw new Error('远端设备不支持打开终端');
    const device = this.devices.find(d => d.id === this.selected);
    if (!device) throw new Error('当前设备不存在');
    const tab = this.tabs.get(device.id);
    try {
      if (action === 'restart') {
        if (this.restartPending) throw new Error('已有远端重启操作进行中');
        this.restartPending = true;
        try {
          if (!await this.services.confirmRestart(device)) return;
          if (tab) { this.tabs.delete(device.id); this.release(tab); }
          const pending = { id: device.id, abort: new AbortController(), status: '正在重启远端 DSH', stage: '重启远端服务', busy: true, connected: false, error: '' };
          this.tabs.set(device.id, pending); this.publish();
          try { await this.services.restartService(device); }
          catch (error) { pending.busy = false; this.fail(pending, '重启远端服务', error); throw error; }
          return await this.command({ scope: 'ssh-devices', action: 'reconnect', id: device.id });
        } finally { this.restartPending = false; }
      }
      if (!tab?.view || tab.view.webContents.isDestroyed()) throw new Error(`设备 ${device.name} 没有可操作的页面，请先连接`);
      if (action === 'reload') tab.view.webContents.reloadIgnoringCache();
      if (action === 'developer') tab.view.webContents.toggleDevTools();
    } catch (error) {
      const current = this.tabs.get(device.id);
      if (current) { current.error = error.message; this.publish(); }
      throw error;
    }
  }
  async command(command) {
    if (!command || command.scope !== 'ssh-devices') throw new Error('设备命令无效');
    if (this.restartPending && command.id && ['connect', 'reconnect', 'disconnect', 'delete'].includes(command.action) && this.tabs.get(command.id)?.status === '正在重启远端 DSH' && command.action !== 'reconnect') throw new Error('该设备正在重启，请等待操作完成');
    if (command.action === 'panel') {
      this.panelOpen = command.open === true && command.persistent === true;
      this.owner.expanded = command.open === true; this.owner.resize(); return this.state();
    }
    if (command.action === 'save') {
      const device = validateDevice(command.device);
      const previous = this.devices.find(d => d.id === device.id);
      const tab = this.tabs.get(device.id);
      const changed = previous && ['ssh', 'port', 'unit'].some(key => device[key] !== previous[key]);
      if (tab && changed) throw new Error('该设备保留着页面和连接，请先在设备列表断开连接，再修改连接配置');
      this.save([...this.devices.filter(d => d.id !== device.id), device]); this.publish(); return this.state();
    }
    if (command.action === 'delete') {
      if (command.id === this.selected) throw new Error('请先切换到其他设备，再删除当前设备');
      this.save(this.devices.filter(d => d.id !== command.id));
      const tab = this.tabs.get(command.id);
      if (tab) { this.tabs.delete(command.id); this.release(tab); }
      this.publish(); return this.state();
    }
    if (command.action === 'disconnect') {
      const tab = this.tabs.get(command.id);
      if (tab) { this.tabs.delete(command.id); this.release(tab); }
      this.publish(); return this.state();
    }
    if (!['connect', 'reconnect'].includes(command.action)) throw new Error('未知设备操作');
    const device = command.id === 'local' ? undefined : this.devices.find(d => d.id === command.id);
    if (command.id !== 'local' && !device) throw new Error('设备不存在');
    if (command.action === 'reconnect') {
      const old = this.tabs.get(command.id);
      if (old) { this.tabs.delete(command.id); this.release(old); }
    }
    this.select(command.id);
    // Switching a previously visited device never reloads its page or recreates its tunnel.
    if (!device || this.tabs.has(device.id)) return this.state();
    const tab = { id: device.id, abort: new AbortController(), status: '连接中', stage: '', error: '', busy: true, connected: false };
    this.tabs.set(device.id, tab);
    try {
      this.progress(tab, '建立 SSH 隧道');
      tab.tunnel = await this.services.startTunnel(device, error => this.fail(tab, 'SSH 连接已断开', error), tab.abort.signal);
      tab.abort.signal.throwIfAborted();
      const origin = tab.tunnel.origin;
      this.progress(tab, '自动获取 DSH 登录凭证');
      const token = await this.services.readToken(device, undefined, tab.abort.signal);
      tab.abort.signal.throwIfAborted();
      const identity = createHash('sha256').update(JSON.stringify([device.id, device.ssh, device.port])).digest('hex');
      const view = new this.services.WebContentsView({ webPreferences: { partition: `persist:dsh-ssh-${identity}`, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false } });
      tab.view = view;
      const web = view.webContents;
      this.owner.window.contentView.addChildView(view, 1);
      view.setVisible(this.selected === tab.id); this.resize();
      web.setWindowOpenHandler(({ url }) => {
        void this.openExternalLink(url);
        return { action: 'deny' };
      });
      const guard = (event, url) => { if (new URL(url ?? event.url).origin !== origin) { event.preventDefault(); tab.error = '已阻止页面离开所选设备的 DSH 地址'; this.publish(); } };
      web.on('will-navigate', guard); web.on('will-redirect', guard);
      web.on('will-attach-webview', event => event.preventDefault());
      web.on('render-process-gone', () => this.fail(tab, '页面进程退出', new Error('请重新连接此设备')));
      web.on('did-fail-load', (_event, code, description, _url, main) => { if (main && code !== -3) this.fail(tab, '加载远端页面', new Error(description)); });
      await web.session.setProxy({ mode: 'direct' });
      this.progress(tab, '交换 DSH 登录会话');
      const response = await web.session.fetch(`${origin}/?token=${encodeURIComponent(token)}`, { redirect: 'follow', cache: 'no-store', signal: AbortSignal.any([tab.abort.signal, AbortSignal.timeout(20000)]) });
      await response.body?.cancel();
      if (response.status !== 200) throw new Error(`远端拒绝自动登录 (HTTP ${response.status})，请确认服务名与 DSH 端口`);
      const check = await web.session.fetch(origin, { cache: 'no-store', signal: AbortSignal.any([tab.abort.signal, AbortSignal.timeout(10000)]) });
      await check.body?.cancel();
      if (check.status !== 200) throw new Error(`DSH 登录验证失败 (HTTP ${check.status})`);
      tab.abort.signal.throwIfAborted(); this.progress(tab, '加载远端界面');
      await web.loadURL(origin);
      if (tab.error) throw new Error(tab.error);
      tab.connected = true; tab.status = '已连接';
      if (this.selected === tab.id) web.focus();
      // Monitor background devices too. No requests are replayed and failure never changes selection.
      tab.monitor = setInterval(async () => {
        if (!this.live(tab) || tab.checking || !tab.connected) return;
        tab.checking = true;
        try {
          const health = await web.session.fetch(origin, { cache: 'no-store', signal: AbortSignal.any([tab.abort.signal, AbortSignal.timeout(10000)]) });
          await health.body?.cancel();
          if (health.status !== 200) throw new Error(`DSH 返回 HTTP ${health.status}，可能已停止或登录会话已失效；请重新连接`);
        } catch (error) { this.fail(tab, '检查远端 DSH', error); }
        finally { tab.checking = false; }
      }, 15000);
      tab.monitor.unref?.();
    } catch (error) {
      if (this.live(tab)) { this.release(tab); this.fail(tab, tab.stage, error); }
    } finally { tab.busy = false; this.publish(); }
    return this.state();
  }
}
