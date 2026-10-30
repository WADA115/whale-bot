// 标准 OneBot v11 连通性探测：只读，不发送任何 QQ 消息。
// 用法：node scripts/onebot-probe.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
let secrets = {};
try { secrets = JSON.parse(fs.readFileSync(path.join(root, 'state', 'secrets.json'), 'utf8')) || {}; } catch {}
const gw = cfg.gateway ?? {};
const httpUrl = String(gw.httpUrl || cfg.snowluma?.httpUrl || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const wsUrl = String(gw.wsUrl || cfg.snowluma?.wsUrl || 'ws://127.0.0.1:3001');
const token = String(gw.accessToken || cfg.snowluma?.accessToken || secrets.snowlumaAccessToken || '');
const wsToken = String(gw.wsAccessToken || cfg.snowluma?.wsAccessToken || secrets.snowlumaWsAccessToken || token);
const headers = { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) };

async function action(name, params = {}) {
  const res = await fetch(`${httpUrl}/${name}`, {
    method: 'POST', headers, body: JSON.stringify(params), signal: AbortSignal.timeout(10000)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.status === 'failed' || (json.retcode != null && json.retcode !== 0)) {
    throw new Error(`${name}: HTTP ${res.status} ${json.wording || json.message || json.retcode || ''}`);
  }
  return json.data;
}

console.log(`OneBot HTTP: ${httpUrl}`);
let failed = 0;
try {
  const me = await action('get_login_info');
  console.log(`  login: ${me.nickname ?? '?'} (${me.user_id ?? '?'})`);
} catch (error) {
  failed += 1;
  console.log(`  login: FAILED ${error.message}`);
}

for (const [name, params] of [
  ['get_status', {}],
  ['get_group_list', {}]
]) {
  try {
    const data = await action(name, params);
    const n = Array.isArray(data) ? ` (${data.length})` : '';
    console.log(`  ${name}: ok${n}`);
  } catch (error) {
    console.log(`  ${name}: 不支持或失败（可降级）：${error.message}`);
  }
}

const groups = Array.isArray(cfg.allow?.groups) ? cfg.allow.groups : [];
for (const gid of groups) {
  try {
    const members = await action('get_group_member_list', { group_id: Number(gid) });
    console.log(`  group ${gid}: ${Array.isArray(members) ? members.length : 0} members`);
  } catch (error) {
    console.log(`  group ${gid}: member list FAILED（可能无权限）：${error.message}`);
    failed += 1;
  }
}

const wsUrlAuth = wsToken ? `${wsUrl}${wsUrl.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(wsToken)}` : wsUrl;
try {
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrlAuth);
    const timer = setTimeout(() => reject(new Error('timeout')), 5000);
    ws.addEventListener('open', () => { clearTimeout(timer); ws.close(); resolve(); });
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('ws error')); });
  });
  console.log(`  websocket: ok ${wsUrl}`);
} catch (error) {
  failed += 1;
  console.log(`  websocket: FAILED ${error.message}`);
}

console.log(failed ? `\n❌ ${failed} 项失败` : '\n✅ OneBot v11 基础接口可用');
process.exit(failed ? 1 : 0);
