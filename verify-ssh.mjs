import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { startTunnel, readToken } from './payload/ssh.mjs';

const [ssh, port = '3080', unit = 'dsh.service'] = process.argv.slice(2);
if (!ssh) throw new Error('Usage: node verify-ssh.mjs <ssh-alias> [dsh-port] [user-service]');
const device = { id: 'verification', name: 'Verification', ssh, port: Number(port), auth: 'systemd', unit };
function request(origin, path, { cookie, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(origin + path, { method: body ? 'POST' : 'GET', timeout: 15000, headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk)); res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('verification timed out')));
    req.end(body ? JSON.stringify(body) : undefined);
  });
}
const tunnel = await startTunnel(device, error => { console.error(error.message); process.exitCode = 1; });
try {
  const token = await readToken(device);
  const login = await request(tunnel.origin, '/?token=' + encodeURIComponent(token));
  if (login.status !== 303) throw new Error(`Token exchange failed: HTTP ${login.status}`);
  const cookie = (login.headers['set-cookie'] ?? []).map(value => value.split(';')[0]).join('; ');
  const page = await request(tunnel.origin, '/', { cookie });
  if (page.status !== 200 || !page.body.includes('<html')) throw new Error(`Authenticated page unavailable: HTTP ${page.status}`);
  console.log('PASS: SSH forwarding, current systemd token exchange, authenticated DSH HTML');
  const api = await request(tunnel.origin, '/api/llm/listProviders', { cookie, body: { type: 'client-request', rpcId: randomUUID(), method: 'llm/listProviders', payload: { args: {} } } });
  if (api.status !== 200 || JSON.parse(api.body).result?.ok !== true) { const result = JSON.parse(api.body); throw new Error(`Read-only provider API failed: HTTP ${api.status}; ${JSON.stringify(result.result?.error ?? { type: result.type, keys: Object.keys(result) })}`); }
  console.log('PASS: authenticated read-only DSH API through SSH; credentials were not printed or saved');
} finally { tunnel.stop(); }
