import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

const exec = promisify(execFile);
export function validateDevice(value) {
  if (!value || !/^[a-zA-Z0-9_-]{1,80}$/.test(value.id) || value.id === 'local') throw new Error('设备 ID 无效');
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 100) throw new Error('设备名称无效');
  if (typeof value.ssh !== 'string' || !/^[a-zA-Z0-9_][a-zA-Z0-9_.@-]{0,200}$/.test(value.ssh)) throw new Error('请填写 SSH 配置别名或 user@host，不接受命令参数');
  if (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535) throw new Error('DSH 端口必须为 1–65535');
  if (value.auth !== 'systemd') throw new Error('该设备未配置自动鉴权；请编辑设备并填写运行 DSH 的用户服务名');
  if (!/^[a-zA-Z0-9_][a-zA-Z0-9_.@-]{0,100}\.service$/.test(value.unit)) throw new Error('systemd 服务名无效');
  return { id: value.id, name: value.name.trim(), ssh: value.ssh, port: value.port, auth: 'systemd', unit: value.unit };
}
export function sshOptions() {
  return ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3'];
}
export async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}
export function probe(origin) {
  return new Promise((resolve, reject) => {
    const req = http.get(origin, { timeout: 1200, agent: false }, res => { res.resume(); resolve(res.statusCode); });
    req.on('timeout', () => req.destroy(new Error('等待 DSH 超时')));
    req.on('error', reject);
  });
}
export async function startTunnel(device, onFailure, signal) {
  validateDevice(device);
  const port = await freePort();
  signal?.throwIfAborted();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn('ssh', [...sshOptions(), '-N', '-o', 'ExitOnForwardFailure=yes', '-L', `127.0.0.1:${port}:127.0.0.1:${device.port}`, device.ssh], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let diagnostic = '', failure, stopped = false, ready = false;
  child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk).slice(-4000); });
  const failed = error => { failure = error; if (ready && !stopped) onFailure(error); };
  child.on('error', failed);
  child.on('exit', (code, exitSignal) => { if (!stopped) failed(new Error(`SSH 已断开 (${code ?? exitSignal})：${diagnostic.trim()}`)); });
  const stop = () => { stopped = true; signal?.removeEventListener('abort', stop); child.kill(); };
  signal?.addEventListener('abort', stop, { once: true });
  try {
    for (let i = 0; i < 50; i++) {
      signal?.throwIfAborted();
      if (failure) throw failure;
      let status;
      try { status = await probe(origin); } catch (error) {
        if (!['ECONNREFUSED', 'ECONNRESET'].includes(error.code) && error.message !== '等待 DSH 超时') throw error;
      }
      if (status) {
        if (![200, 401, 303].includes(status)) throw new Error(`远端入口返回 HTTP ${status}，请检查 DSH 端口`);
        if (failure) throw failure;
        ready = true;
        return { origin, stop };
      }
      await delay(200, undefined, { signal });
    }
    throw new Error(`SSH 转发未就绪：${diagnostic.trim() || '请检查远端 DSH 服务及 SSH AllowTcpForwarding'}`);
  } catch (error) { stop(); throw error; }
}
export function parseToken(text) {
  const value = text.trim();
  const token = /^https?:\/\//.test(value) ? new URL(value).searchParams.get('token') : value;
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,256}$/.test(token)) throw new Error('需要包含 token 的 DSH 访问链接或启动令牌');
  return token;
}
export async function readToken(device, supplied, signal) {
  validateDevice(device);
  // Only the validated unit name is interpolated. Logs stay in memory and are never printed.
  const command = `id=$(systemctl --user show -P InvocationID ${device.unit}) && test -n "$id" && journalctl --user "_SYSTEMD_INVOCATION_ID=$id" --no-pager -o cat`;
  let stdout;
  try { ({ stdout } = await exec('ssh', [...sshOptions(), device.ssh, command], { windowsHide: true, timeout: 20000, maxBuffer: 8 * 1024 * 1024, signal })); }
  catch (error) { throw new Error(`无法自动读取 ${device.ssh} 的 ${device.unit} 启动记录：${error.stderr?.trim() || error.code || error.message}`); }
  const tokens = [...stdout.matchAll(/dsh web: http:\/\/(?:127\.0\.0\.1|localhost):(\d+)\/\?token=([A-Za-z0-9_-]+)/g)].filter(match => Number(match[1]) === device.port);
  if (tokens.length !== 1) throw new Error(`${device.unit} 当前启动记录中找到 ${tokens.length} 个端口 ${device.port} 的登录入口；请检查服务名、端口和该服务是否记录 dsh web 启动输出`);
  return parseToken(tokens[0][2]);
}
