// Byte-preserving ASAR patcher for DSH Desktop 0.11.1.
//
// Only two packed files change (out/main/index.js and out/preload/index.cjs).
// The patched archive is produced by:
//   1. rewriting the header (the two entries get new size/offset/integrity),
//   2. copying the ENTIRE original data blob verbatim right after the new header,
//   3. appending the two modified files after that blob.
// Because the whole original blob is copied untouched and offsets are relative to
// the blob start, every other file keeps its original offset and bytes. No third
// party modules are needed, and no unpacked file is touched.
//
// Header layout (verified against this build):
//   [u32 4][u32 headerSize][u32 headerSize-4][u32 headerSize-10][JSON][pad]
//   JSON starts at 16, JSON length = headerSize - 10, data starts at 8 + headerSize.
// `node` is not always plain Node. DSH Desktop ships a node.cmd that sets
// ELECTRON_RUN_AS_NODE=1 and runs the desktop executable, so the interpreter can be
// Electron-as-Node. Electron installs an fs hook that intercepts every path matching
// /\.asar/i and treats it as an archive *inside* another archive, so
// fs.readFileSync('<...>/resources/app.asar') fails with
//   ENOENT,  not found in <...>/resources/app.asar
// Setting process.noAsar makes the hook ignore asar paths. This module only ever
// treats the archive as opaque bytes, so disabling the hook is always correct here
// and is a no-op under plain Node.
process.noAsar = true;

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const BLOCK_SIZE = 4194304;

export function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function integrityOf(buf) {
  const blocks = [];
  for (let i = 0; i < buf.length; i += BLOCK_SIZE) blocks.push(sha256(buf.subarray(i, i + BLOCK_SIZE)));
  return { algorithm: 'SHA256', hash: sha256(buf), blockSize: BLOCK_SIZE, blocks: blocks.length ? blocks : [sha256(buf)] };
}

export function readAsar(path) {
  const buf = readFileSync(path);
  if (buf.readUInt32LE(0) !== 4) throw new Error('不是受支持的 asar 头格式（field0 != 4）');
  const headerSize = buf.readUInt32LE(4);
  if (buf.readUInt32LE(8) !== headerSize - 4 || buf.readUInt32LE(12) !== headerSize - 10) throw new Error('asar 头字段不一致');
  const json = buf.subarray(16, 16 + headerSize - 10).toString('utf8');
  const header = JSON.parse(json);
  return { buf, headerSize, header, dataStart: 8 + headerSize };
}

export function nodeAt(header, parts) {
  let cur = header;
  for (const part of parts) { if (!cur.files || !cur.files[part]) return null; cur = cur.files[part]; }
  return cur;
}

export function readEntry(asar, parts) {
  const node = nodeAt(asar.header, parts);
  if (!node || typeof node.offset === 'undefined') return null;
  const start = asar.dataStart + parseInt(node.offset, 10);
  return asar.buf.subarray(start, start + node.size);
}

export function formatEntries(asar) {
  const list = [];
  (function walk(node, prefix) {
    for (const name of Object.keys(node.files || {})) {
      const child = node.files[name];
      const full = prefix ? `${prefix}/${name}` : name;
      if (child.files) walk(child, full);
      else list.push({ path: full, unpacked: !!child.unpacked, size: child.size });
    }
  })(asar.header, '');
  return list;
}

function replaceOnce(text, before, after, label) {
  const parts = text.split(before);
  if (parts.length !== 2) throw new Error(`补丁锚点不唯一或不存在（${label}）：匹配到 ${parts.length - 1} 处`);
  return text.replace(before, after);
}

// Both injections, unchanged from the reviewed implementation.
export function applyInjections(mainText, preloadText, snippets) {
  const lines = mainText.split('\n');
  let lastImport = -1;
  for (let i = 0; i < Math.min(lines.length, 200); i++) {
    if (/^import[\s{*]/.test(lines[i])) lastImport = i;
    else if (lastImport >= 0 && lines[i].trim() !== '' && !/^import/.test(lines[i])) break;
  }
  if (lastImport < 0) throw new Error('main 中找不到 import 段，无法注入');
  const spliced = lines.slice();
  spliced.splice(lastImport + 1, 0, snippets.injectMain);
  const main = spliced.join('\n');

  let preload = replaceOnce(preloadText, 'function mountWindowsMenuBar(options) {', snippets.injectPreloadFn + 'function mountWindowsMenuBar(options) {', 'mountWindowsMenuBar 定义');
  preload = replaceOnce(
    preload,
    'mountWindowsMenuBar({ document: document2, ipcRenderer });\n  syncTheme(document2, ipcRenderer);',
    'mountWindowsMenuBar({ document: document2, ipcRenderer });\n  mountDeviceSwitcher({ document: document2, ipcRenderer });\n  syncTheme(document2, ipcRenderer);',
    'mountWindowsMenuBar 调用'
  );
  return { main, preload };
}

export function verifyTarget(sourcePath, snippets) {
  const asar = readAsar(sourcePath);
  const main = readEntry(asar, ['out', 'main', 'index.js']);
  const preload = readEntry(asar, ['out', 'preload', 'index.cjs']);
  if (!main) throw new Error('目标包里找不到 out/main/index.js');
  if (!preload) throw new Error('目标包里找不到 out/preload/index.cjs');
  applyInjections(main.toString('utf8'), preload.toString('utf8'), snippets);
  return { files: formatEntries(asar).length, unpacked: formatEntries(asar).filter((f) => f.unpacked).length };
}

export function buildPatchedAsar(sourcePath, destPath, snippets) {
  const asar = readAsar(sourcePath);
  const mainOrig = readEntry(asar, ['out', 'main', 'index.js']);
  const preloadOrig = readEntry(asar, ['out', 'preload', 'index.cjs']);
  if (!mainOrig || !preloadOrig) throw new Error('目标包结构不符合预期');

  const { main, preload } = applyInjections(mainOrig.toString('utf8'), preloadOrig.toString('utf8'), snippets);
  const mainBuf = Buffer.from(main, 'utf8');
  const preloadBuf = Buffer.from(preload, 'utf8');

  const dataSize = asar.buf.length - asar.dataStart;
  const mainNode = nodeAt(asar.header, ['out', 'main', 'index.js']);
  const preloadNode = nodeAt(asar.header, ['out', 'preload', 'index.cjs']);
  mainNode.size = mainBuf.length;
  mainNode.offset = String(dataSize);
  mainNode.integrity = integrityOf(mainBuf);
  preloadNode.size = preloadBuf.length;
  preloadNode.offset = String(dataSize + mainBuf.length);
  preloadNode.integrity = integrityOf(preloadBuf);

  let json = Buffer.from(JSON.stringify(asar.header), 'utf8');
  while ((json.length + 10) % 4 !== 0) json = Buffer.concat([json, Buffer.from(' ')]);
  const headerSize = json.length + 10;
  const head = Buffer.alloc(8 + headerSize);
  head.writeUInt32LE(4, 0);
  head.writeUInt32LE(headerSize, 4);
  head.writeUInt32LE(headerSize - 4, 8);
  head.writeUInt32LE(headerSize - 10, 12);
  json.copy(head, 16);

  const out = Buffer.concat([head, asar.buf.subarray(asar.dataStart), mainBuf, preloadBuf]);
  writeFileSync(destPath, out);

  // Self-check: the produced archive must parse and still carry both entries.
  const check = readAsar(destPath);
  const checkMain = readEntry(check, ['out', 'main', 'index.js']);
  const checkPreload = readEntry(check, ['out', 'preload', 'index.cjs']);
  if (!checkMain || !checkPreload) throw new Error('生成的新包自检失败：找不到目标文件');
  if (sha256(checkMain) !== sha256(mainBuf) || sha256(checkPreload) !== sha256(preloadBuf)) throw new Error('生成的新包自检失败：内容不一致');

  return { patchedSha256: sha256(out), size: out.length, mainBytes: mainBuf.length, preloadBytes: preloadBuf.length };
}
