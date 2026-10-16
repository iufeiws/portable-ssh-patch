#!/usr/bin/env node
// Verified installer for the DSH Desktop (0.11.1, app.asar build) SSH device switcher.
//
//   node install.mjs check     "<DSH Desktop 安装目录>"
//   node install.mjs install   "<DSH Desktop 安装目录>"
//   node install.mjs uninstall "<DSH Desktop 安装目录>"
//
// The installer fingerprints resources/app.asar, applies the reviewed injections and
// rewrites the archive byte-preservingly. The original archive is kept under
// resources/ssh-device-patch-backup/ so uninstall can restore it exactly.
// resources/app.asar.unpacked is never touched.
//
// The desktop must be fully exited first, and that is enforced rather than merely
// documented: see runningInstances() for why patching a live process is unsafe.
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, rmSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { buildPatchedAsar, verifyTarget, sha256 } from './lib/asar-patch.mjs';

// See lib/asar-patch.mjs: when `node` is Electron-as-Node, Electron's asar fs hook
// intercepts any `*.asar` path and every read/write/copy of resources/app.asar fails
// with ENOENT. This script only handles the archive as an opaque file.
process.noAsar = true;

const here = dirname(fileURLToPath(import.meta.url));
const rawArgs = process.argv.slice(2);
const force = rawArgs.includes('--force');
const [action, argument] = rawArgs.filter((arg) => arg !== '--force');
if (!['install', 'uninstall', 'check'].includes(action) || !argument) {
  throw new Error('用法：node install.mjs install|uninstall|check "DSH Desktop 安装目录" [--force]');
}

const root = resolve(argument);
const resources = join(root, 'resources');
const asarPath = join(resources, 'app.asar');
const unpackedPath = join(resources, 'app.asar.unpacked');
const backupDir = join(resources, 'ssh-device-patch-backup');
const backupAsar = join(backupDir, 'app.asar');
const receiptPath = join(backupDir, 'receipt.json');
const manifest = JSON.parse(readFileSync(join(here, 'manifest.json'), 'utf8'));
const target = manifest.files[0];
const snippets = {
  injectMain: readFileSync(join(here, 'payload', 'inject-main.txt'), 'utf8'),
  injectPreloadFn: readFileSync(join(here, 'payload', 'inject-preload-fn.txt'), 'utf8')
};
const hashOf = (path) => sha256(readFileSync(path));

// Refuse to patch a desktop that is still running.
//
// A live process caches the asar header when it starts. This patch changes the header
// size (in this build the data region moves by 4 bytes), so a process that was already
// running keeps reading every file it loads later from a shifted offset. The window
// still opens and most code keeps working because it was loaded before the swap, but
// any module pulled from the archive afterwards fails - for example
// `dsh-web-fetch-http` can no longer import `undici`, surfacing as
// "Invalid package config ... app.asar/node_modules/undici/package.json".
//
// Restarting the desktop is enough to recover; reinstalling is neither necessary nor
// helpful.
//
// Detection is deliberately narrowed to the executables that live in this installation
// directory. Enumerating every process and reading its .Path can block indefinitely on
// a machine with unrelated stuck processes, which would hang the installer; querying a
// few known names costs milliseconds. Matching on the full path (not just the image
// name) also keeps a second, identically named install from being reported.
//
// Returns the matching executable paths, or [] when none were found or the check
// could not be completed.
function runningInstances(installRoot) {
  const needle = installRoot.toLowerCase().replace(/'/g, "''");
  try {
    if (process.platform === 'win32') {
      const names = readdirSync(installRoot)
        .filter((name) => /\.exe$/i.test(name))
        .filter((name) => !/^uninstall/i.test(name))
        .map((name) => name.slice(0, -4));
      if (!names.length) return [];
      const nameList = names.map((name) => `'${name.replace(/'/g, "''")}'`).join(',');
      const script = [
        "$ErrorActionPreference='SilentlyContinue'",
        `Get-Process -Name ${nameList} | ForEach-Object { $_.Path } | Where-Object { $_ }` +
          ` | ForEach-Object { $_.ToLower() } | Where-Object { $_.StartsWith('${needle}') }` +
          ' | Select-Object -Unique'
      ].join('; ');
      const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 15000
      });
      return out.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    }
    const self = process.argv[1] || '';
    const out = execFileSync('ps', ['-Ao', 'command='], { encoding: 'utf8', timeout: 15000 });
    return out
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.includes(installRoot) && !line.includes(self));
  } catch (error) {
    console.warn(`（未能检查 DSH Desktop 是否在运行：${error.message}）`);
    return [];
  }
}

const running = action === 'check' ? [] : runningInstances(root);
if (running.length) {
  if (!force) {
    throw new Error(
      '检测到 DSH Desktop 正在运行，拒绝修改 app.asar：\n  ' + running.join('\n  ') +
      '\n\n正在运行的进程缓存了旧的 asar 头，而本补丁会改变头长度，' +
      '\n修改后它会从偏移错位的位置读取归档内的文件，导致部分模块加载失败。' +
      '\n请通过托盘菜单完全退出程序后重试。' +
      '\n（确认要冒险继续，可加 --force；那样安装后必须完全重启才会生效。）'
    );
  }
  console.warn('警告：DSH Desktop 正在运行，--force 已跳过运行检查；安装后必须完全重启程序。');
}

if (!existsSync(asarPath)) {
  throw new Error(`目标不是 ${manifest.targetProduct} ${manifest.targetVersion} 的 app.asar 安装：找不到 ${asarPath}`);
}

if (action === 'check') {
  const actual = hashOf(asarPath);
  if (actual !== target.sha256) {
    throw new Error(`app.asar 指纹不匹配，此构建不受支持。\n  期望 ${target.sha256}\n  实际 ${actual}`);
  }
  const info = verifyTarget(asarPath, snippets);
  console.log(`版本与文件指纹通过检查（${manifest.targetProduct} ${manifest.targetVersion}）。`);
  console.log(`包内条目 ${info.files} 个，其中 unpacked ${info.unpacked} 个；全部补丁锚点通过检查。`);
} else if (action === 'uninstall') {
  if (!existsSync(receiptPath)) throw new Error('未找到安装记录（receipt.json），无法卸载；请保留现有文件并人工检查');
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  const actual = hashOf(asarPath);
  if (actual !== receipt.patched) throw new Error(`app.asar 在安装后被改动（期望 ${receipt.patched}，实际 ${actual}），拒绝覆盖`);
  if (!existsSync(backupAsar)) throw new Error('备份缺失，无法恢复');
  if (hashOf(backupAsar) !== receipt.original) throw new Error('备份已损坏，拒绝恢复');
  copyFileSync(backupAsar, asarPath);
  if (hashOf(asarPath) !== receipt.original) throw new Error('恢复后的 app.asar 校验失败');
  rmSync(backupAsar);
  rmSync(receiptPath);
  rmSync(backupDir, { recursive: true, force: true });
  console.log('已恢复原始 app.asar。设备配置保留在 Electron userData/ssh-devices.json。');
} else {
  if (existsSync(backupDir) || existsSync(receiptPath)) {
    throw new Error('检测到已安装（或未完成的）补丁；请先卸载，或在确认后删除 resources/ssh-device-patch-backup');
  }
  const actual = hashOf(asarPath);
  if (actual !== target.sha256) {
    throw new Error(`app.asar 指纹不匹配，此构建不受支持；需要针对该构建重新审查并生成补丁。\n  期望 ${target.sha256}\n  实际 ${actual}`);
  }
  const tempPath = asarPath + '.patch-new';
  const result = buildPatchedAsar(asarPath, tempPath, snippets);
  mkdirSync(backupDir, { recursive: true });
  copyFileSync(asarPath, backupAsar);
  if (hashOf(backupAsar) !== target.sha256) throw new Error('备份校验失败，已中止');
  copyFileSync(tempPath, asarPath);
  rmSync(tempPath);
  if (hashOf(asarPath) !== result.patchedSha256) throw new Error('安装后的 app.asar 校验失败');
  writeFileSync(receiptPath, JSON.stringify({
    patchVersion: manifest.patchVersion,
    target: `${manifest.targetProduct} ${manifest.targetVersion}`,
    file: 'resources/app.asar',
    original: target.sha256,
    patched: result.patchedSha256,
    installedAt: new Date().toISOString()
  }, null, 2));
  console.log('补丁已安装。');
  console.log(`  resources/app.asar  ${result.patchedSha256}`);
  console.log(`  原文件备份          ${backupAsar}`);
  console.log('请完全重启 DSH Desktop；resources/app.asar.unpacked 未被改动。');
}
