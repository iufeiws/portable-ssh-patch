const bridge = window.desktopChrome;
let state, panel, page = 'list', draft, fields, formError;
const button = document.createElement('button');
button.id = 'ssh-device-button'; button.type = 'button'; button.textContent = '切换设备';
const el = (tag, text, parent, cls) => { const n = document.createElement(tag); if (text) n.textContent = text; if (cls) n.className = cls; parent?.append(n); return n; };
function mount() {
  const identity = document.querySelector('.dshDesktopFrameIdentity');
  if (identity && !button.isConnected) identity.append(button);
  if (!state) return;
  const actions = document.querySelector('.dshDesktopNativeActions[data-placement="titlebar"]');
  const terminal = actions?.querySelector(':scope > button.dshDesktopTitlebarIconButton');
  if (!terminal) return;
  if (state.selected !== 'local') {
    terminal.dataset.remoteTerminalDisabled = 'true';
    if (!terminal.disabled) terminal.disabled = true;
    terminal.title = '远端设备不支持打开终端';
    terminal.setAttribute('aria-label', terminal.title);
  } else if (terminal.dataset.remoteTerminalDisabled) {
    delete terminal.dataset.remoteTerminalDisabled;
    terminal.disabled = actions.querySelector('.dshDesktopNativeActionMenuAnchor > button').disabled;
    terminal.title = '打开本机 DSH 终端';
    terminal.setAttribute('aria-label', terminal.title);
  }
}
new MutationObserver(mount).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled'] });
function update(next) {
  if (!next?.devices) return;
  state = next.devices;
  const name = state.devices.find(d => d.id === state.selected)?.name ?? '本机';
  button.textContent = state.selected === 'local' ? '设备：本机 ▾' : `设备：${name} · ${state.status} ▾`;
  button.dataset.error = String(!!state.error); button.title = state.error || '切换设备';
  if (panel && page === 'list') renderList();
  mount();
}
async function invoke(command) { const result = await bridge.invoke({ scope: 'ssh-devices', ...command }); update({ devices: result }); return result; }
function run(action) { return async () => { try { await action(); } catch (error) { if (formError) formError.textContent = error.message; else if (panel) el('p', error.message, panel, 'device-error'); } }; }
function action(parent, label, handler, cls) { const b = el('button', label, parent, cls); b.type = 'button'; b.onclick = run(handler); return b; }
async function close() { if (page === 'edit') captureDraft(); await invoke({ action: 'panel', open: false }); panel?.remove(); panel = undefined; }
async function showList() { page = 'list'; await bridge.invoke({ scope: 'ssh-devices', action: 'panel', open: true, persistent: false }); renderList(); }
function header(title, back) {
  const head = el('div', '', panel, 'device-heading');
  if (back) action(head, '‹', () => { captureDraft(); return showList(); }, 'device-icon').setAttribute('aria-label', '返回设备列表');
  el('h2', title, head);
  if (!back) action(head, '＋', () => edit(), 'device-icon').setAttribute('aria-label', '添加设备');
  action(head, '×', close, 'device-icon').setAttribute('aria-label', '关闭设备面板');
}
function renderList() {
  if (!panel) return;
  panel.replaceChildren(); panel.dataset.page = 'list'; formError = undefined;
  header('切换设备');
  for (const device of [{ id: 'local', name: '本机' }, ...state.devices]) {
    const selected = state.selected === device.id;
    const row = el('div', '', panel, 'device-row'); row.dataset.selected = String(selected);
    const select = action(row, '', () => invoke({ action: 'connect', id: device.id }), 'device-select');
    el('strong', `${selected ? '● ' : ''}${device.name}`, select);
    el('small', device.id === 'local' ? '此电脑' : `${device.ssh} · DSH ${device.port}`, select);
    const cached = state.tabs[device.id];
    if (!selected && cached) el('small', cached.status, select, cached.error ? 'device-error' : 'device-status');
    if (device.id !== 'local') action(row, '⋯', () => edit(device), 'device-icon').setAttribute('aria-label', `编辑 ${device.name}`);
    if (selected && device.id !== 'local') {
      const detail = el('div', '', panel, 'device-detail');
      el('span', state.status, detail, state.error ? 'device-error' : 'device-status');
      if (state.error) {
        const error = el('pre', state.error, detail, 'device-error'); error.setAttribute('role', 'alert');
        action(detail, '重新连接', () => invoke({ action: 'reconnect', id: device.id }));
        action(detail, '编辑连接', () => edit(device));
      }
      if (cached) action(detail, '断开连接', () => invoke({ action: 'disconnect', id: device.id }));
    }
  }
  el('p', '已打开的设备会保留页面与连接，切换不会刷新。', panel, 'device-note');
}
function captureDraft() { if (!fields) return; for (const key of Object.keys(fields)) draft[key] = fields[key].value; }
async function edit(device) {
  page = 'edit';
  await bridge.invoke({ scope: 'ssh-devices', action: 'panel', open: true, persistent: true });
  draft = device ? { ...device } : (draft?.isNew ? draft : { id: crypto.randomUUID(), name: '', ssh: '', port: '3080', unit: 'dsh.service', isNew: true });
  panel.replaceChildren(); panel.dataset.page = 'edit'; header(draft.isNew ? '添加设备' : '编辑设备', true);
  el('p', '通过 SSH 安全连接，DSH 登录会话自动交换。', panel, 'device-note');
  fields = {};
  const field = (key, label, parent = panel) => {
    const wrap = el('label', label, parent); const input = el('input', '', wrap); input.value = draft[key]; input.autocomplete = 'off'; fields[key] = input;
    input.oninput = () => { draft[key] = input.value; };
    if (key === 'port') { input.type = 'number'; input.min = 1; input.max = 65535; }
    return input;
  };
  field('name', '设备名称').placeholder = '例如：实验室服务器';
  field('ssh', 'SSH 地址 / 配置别名').placeholder = '例如：dev-server 或 user@server';
  field('port', '远端 DSH 端口');
  const advanced = el('details', '', panel); el('summary', '高级设置', advanced); field('unit', '运行 DSH 的用户服务', advanced);
  el('p', '使用系统 SSH 配置、密钥及端口设置。鉴权由应用自动完成，无需复制 token。', panel, 'device-note');
  formError = el('p', '', panel, 'device-error'); formError.setAttribute('role', 'alert');
  const footer = el('div', '', panel, 'device-footer');
  action(footer, '取消', () => { draft = undefined; fields = undefined; return showList(); });
  action(footer, '保存设备', async () => {
    captureDraft();
    await invoke({ action: 'save', device: { id: draft.id, name: draft.name, ssh: draft.ssh, port: Number(draft.port), auth: 'systemd', unit: draft.unit } });
    draft = undefined; fields = undefined; await showList();
  }, 'device-primary');
  if (!draft.isNew) action(panel, '删除设备', async () => { await invoke({ action: 'delete', id: draft.id }); draft = undefined; fields = undefined; await showList(); }, 'device-delete');
}
button.onclick = run(async () => {
  if (panel) { await close(); return; }
  await invoke({ action: 'panel', open: true, persistent: page === 'edit' });
  panel = el('section', '', document.body); panel.id = 'ssh-device-panel'; panel.className = 'dshDesktopActionMenu'; panel.setAttribute('aria-label', '设备连接');
  if (page === 'edit' && draft) await edit(draft.isNew ? undefined : draft); else { page = 'list'; renderList(); }
});
const dismissList = run(async () => { if (panel && page === 'list') await close(); });
bridge.onDismiss(dismissList);
document.addEventListener('mousedown', event => { if (panel && page === 'list' && !panel.contains(event.target) && event.target !== button) dismissList(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && page === 'list') dismissList(); });
bridge.subscribe(update);
bridge.invoke('state').then(update).catch(error => { button.textContent = '设备配置错误'; button.title = error.message; });
mount();
