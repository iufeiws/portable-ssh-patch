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
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPatchedAsar, verifyTarget, sha256 } from './lib/asar-patch.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const [action, argument] = process.argv.slice(2);
if (!['install', 'uninstall', 'check'].includes(action) || !argument) {
  throw new Error('用法：node install.mjs install|uninstall|check "DSH Desktop 安装目录"');
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
  if (existsSync(unpackedPath)) {
    console.log('（注意：安装时若程序正在运行，请通过托盘退出后重新打开，否则仍在跑旧代码。）');
  }
}
