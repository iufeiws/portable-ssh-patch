#!/usr/bin/env node
// Live end-to-end check for the SSH device switcher. It really performs:
//   1. remote endpoint discovery over SSH (the same script the patch injects)
//   2. an OpenSSH local port forward
//   3. the token exchange (expects HTTP 303) and the authenticated page fetch
//
// Usage:  node test-chain.mjs <ssh-alias> [expected-port]
// The login token is used in memory only; it is never printed or written.
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const target = process.argv[2];
const expectedPort = Number(process.argv[3] || 0);
if (!target) throw new Error('用法：node test-chain.mjs <ssh别名> [期望端口]');

const sshOpts = ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3'];
const remoteScript = readFileSync(join(here, 'payload', 'remote-entry.sh'), 'utf8').replace(/\r\n/g, '\n');
const remoteB64 = Buffer.from(remoteScript, 'utf8').toString('base64');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}
function request(url, cookie) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { timeout: 8000, headers: cookie ? { cookie } : {} }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end();
  });
}

const started = Date.now();
const { stdout } = await promisify(execFile)('ssh', [...sshOpts, target, `echo ${remoteB64} | base64 -d | sh`], { windowsHide: true, timeout: 40000, maxBuffer: 8 * 1024 * 1024 });
const match = stdout.trim().match(/dsh web: http:\/\/(?:127\.0\.0\.1|localhost):(\d+)\/\?token=([A-Za-z0-9_-]+)/);
if (!match) {
  console.error('FAIL: 远端没有返回登录入口：', JSON.stringify(stdout.trim().slice(0, 160)));
  process.exit(1);
}
const remotePort = Number(match[1]);
const token = match[2];
console.log(`1) 端点发现成功  ${Date.now() - started}ms  port=${remotePort}  tokenLen=${token.length}`);
if (expectedPort && expectedPort !== remotePort) console.log(`   （注意：期望端口 ${expectedPort}，实际 ${remotePort}）`);

const local = await freePort();
const child = spawn('ssh', [...sshOpts, '-N', '-o', 'ExitOnForwardFailure=yes', '-L', `127.0.0.1:${local}:127.0.0.1:${remotePort}`, target], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
let diagnostic = '';
let exited = false;
child.stderr.on('data', (chunk) => { diagnostic += chunk; });
child.on('exit', (code) => { exited = true; diagnostic += ` [ssh exit ${code}]`; });

const origin = `http://127.0.0.1:${local}`;
let ready = false;
let lastError = '';
for (let i = 0; i < 90 && !exited; i++) {
  try {
    const res = await request(origin + '/');
    if ([200, 401, 303].includes(res.status)) { ready = true; break; }
    lastError = 'status ' + res.status;
  } catch (error) { lastError = error.code || error.message; }
  await delay(500);
}
console.log(`2) SSH 转发就绪=${ready}  ${Date.now() - started}ms  最后错误=${lastError} ${exited ? ('ssh已退出:' + diagnostic.trim()) : ''}`);
if (!ready) { child.kill(); process.exit(1); }

const login = await request(origin + '/?token=' + encodeURIComponent(token));
const cookie = (login.headers['set-cookie'] || []).map((value) => value.split(';')[0]).join('; ');
console.log(`3) 令牌交换状态=${login.status}（应为 303）  已获得会话 Cookie=${cookie.length > 0}`);
const page = await request(origin + '/', cookie);
console.log(`4) 已认证页面状态=${page.status}  含 <html=${page.body.includes('<html')}`);

const ok = login.status === 303 && page.status === 200 && page.body.includes('<html');
console.log(ok ? `PASS：整条链路可用（${Date.now() - started}ms）` : 'FAIL：链路未完成');
child.kill();
process.exit(ok ? 0 : 1);
