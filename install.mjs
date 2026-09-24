import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, readdirSync, unlinkSync, rmdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const [action, argument] = process.argv.slice(2);
if (!['install', 'uninstall', 'check'].includes(action) || !argument) throw new Error('用法：node install.mjs install|uninstall|check "DSH Desktop 安装目录"');
const root = resolve(argument), app = join(root, 'resources', 'app');
const manifest = JSON.parse(readFileSync(join(here, 'manifest.json'), 'utf8'));
const backup = join(app, 'ssh-device-patch-backup');
const receiptPath = join(backup, 'receipt.json');
const hash = value => createHash('sha256').update(value).digest('hex');
const patchPath = join(app, 'lib', 'device-switch');
if (action !== 'check' && process.platform === 'win32' && existsSync(join(root, 'DSH Desktop.exe'))) {
  const processes = execFileSync('tasklist', ['/FI', 'IMAGENAME eq DSH Desktop.exe', '/NH'], { encoding: 'utf8', windowsHide: true });
  if (/DSH Desktop\.exe/i.test(processes)) throw new Error('请先通过托盘退出 DSH Desktop，再安装或卸载补丁；安装器不会终止正在运行的任务');
}
function replaceOnce(text, before, after) {
  if (text.split(before).length !== 2) throw new Error(`补丁锚点不唯一或不存在：${before.slice(0, 80)}`);
  return text.replace(before, after);
}
function patched(path, text) {
  if (path.endsWith('.html')) return replaceOnce(text, '</head>', '<link rel="stylesheet" href="../device-switch/titlebar.css">\n<script type="module" src="../device-switch/titlebar.js"></script>\n</head>');
  text = 'import { DeviceController } from "./device-switch/controller.mjs";\n' + text;
  text = replaceOnce(text, 'window.contentView.addChildView(this.chromeView);', 'window.contentView.addChildView(this.chromeView);\n\t\tthis.devices = new DeviceController(this);');
  text = replaceOnce(text, '\t\t\tmode: this.spec.mode === "extended" ? "extended" : "compatibility",', '\t\t\tdevices: this.devices.state(),\n\t\t\tmode: this.spec.mode === "extended" ? "extended" : "compatibility",');
  text = replaceOnce(text, '\tcommand(command) {\n\t\tswitch (command) {', '\tcommand(command) {\n\t\tif (command && typeof command === "object") return this.devices.command(command);\n\t\tif (["terminal", "reload", "developer", "restart"].includes(command)) return this.devices.control(command);\n\t\tswitch (command) {');
  text = replaceOnce(text, '\t\t\tthis.chromeBounds = chromeBounds;\n\t\t}\n\t};', '\t\t\tthis.chromeBounds = chromeBounds;\n\t\t}\n\t\tthis.devices?.resize();\n\t};');
  text = replaceOnce(text, '\t\tthis.disposed = true;\n\t\tthis.window.off("blur", this.dismiss);', '\t\tthis.disposed = true;\n\t\tthis.devices?.dispose();\n\t\tthis.window.off("blur", this.dismiss);');
  text = replaceOnce(text, '\tcollapse = () => {\n\t\tthis.expanded = false;', '\tcollapse = () => {\n\t\tif (this.devices?.panelOpen) return;\n\t\tthis.expanded = false;');
  text = replaceOnce(text, '\tdismiss = () => {\n\t\tif (!this.disposed', '\tdismiss = () => {\n\t\tif (this.devices?.panelOpen) return;\n\t\tif (!this.disposed');
  text = replaceOnce(text, 'return !this.released && !this.options.isQuitting() && this.options.canRecoverRenderer()', 'return (!this.compatibilityShell?.devices || this.compatibilityShell.devices.selected === "local") && !this.released && !this.options.isQuitting() && this.options.canRecoverRenderer()');
  text = replaceOnce(text, 'const isolated = spec.mode !== "advanced" && platform.platform !== "linux";', 'const isolated = spec.mode !== "advanced" && platform.platform !== "linux";\n\t\tif (!isolated) await dialog.showMessageBox({ type: "warning", title: "SSH 设备补丁", message: "当前窗口模式不支持设备切换。请在 Windows 或 macOS 使用兼容模式或扩展模式。" });');
  return text;
}
if (action === 'uninstall') {
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  for (const file of receipt.files) if (hash(readFileSync(join(app, file.path))) !== file.patched) throw new Error(`安装后文件已变化，拒绝覆盖：${file.path}`);
  for (const file of receipt.payload) if (hash(readFileSync(join(patchPath, file.name))) !== file.hash) throw new Error(`补丁文件已变化，拒绝删除：${file.name}`);
  for (const file of receipt.files) {
    const original = readFileSync(join(backup, file.name));
    if (hash(original) !== file.original) throw new Error(`备份损坏：${file.name}`);
  }
  for (const file of receipt.files) copyFileSync(join(backup, file.name), join(app, file.path));
  for (const file of receipt.payload) unlinkSync(join(patchPath, file.name));
  rmdirSync(patchPath);
  for (const file of receipt.files) unlinkSync(join(backup, file.name));
  unlinkSync(receiptPath); rmdirSync(backup);
  console.log('已恢复原文件。设备配置保留在 Electron userData/ssh-devices.json。');
} else {
  if (existsSync(receiptPath) || existsSync(backup) || existsSync(patchPath)) throw new Error('发现已安装或未完成的补丁；请检查备份，禁止重复覆盖');
  if (JSON.parse(readFileSync(join(app, 'package.json'), 'utf8')).version !== manifest.targetVersion) throw new Error(`DSH Desktop 版本不受支持；此补丁仅适配 ${manifest.targetVersion}，需要重新审查并生成补丁`);
  const files = manifest.files.map(file => {
    const raw = readFileSync(join(app, file.path));
    if (hash(raw) !== file.sha256) throw new Error(`原文件指纹不匹配：${file.path}`);
    const content = patched(file.path, raw.toString('utf8').replaceAll('\r\n', '\n'));
    return { path: file.path, name: file.path.replaceAll('/', '__'), original: hash(raw), patched: hash(content), raw, content };
  });
  if (action === 'check') console.log('版本、文件指纹和全部补丁锚点通过检查。');
  else {
    mkdirSync(backup); mkdirSync(patchPath);
    for (const file of files) writeFileSync(join(backup, file.name), file.raw);
    const payload = readdirSync(join(here, 'payload')).map(name => {
      const bytes = readFileSync(join(here, 'payload', name));
      writeFileSync(join(patchPath, name), bytes);
      return { name, hash: hash(bytes) };
    });
    writeFileSync(receiptPath, JSON.stringify({ files: files.map(({ raw, content, ...f }) => f), payload }, null, 2));
    for (const file of files) writeFileSync(join(app, file.path), file.content);
    console.log('补丁已安装。请启动 DSH Desktop，使用兼容或扩展模式。');
  }
}
