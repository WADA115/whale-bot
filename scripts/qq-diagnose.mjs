import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSecret } from '../src/secrets.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
const token = String(cfg.snowluma?.accessToken || readSecret(root, 'snowlumaAccessToken') || '').trim();
const base = String(cfg.snowluma?.httpUrl || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const headers = token ? { authorization: `Bearer ${token}` } : {};

async function call(action, params = {}) {
  const url = new URL(`${base}/${action}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`${action} HTTP ${res.status}`);
  const json = await res.json();
  if (json?.retcode && json.retcode !== 0) throw new Error(`${action} retcode=${json.retcode}`);
  return json?.data;
}

const login = await call('get_login_info');
const selfId = login?.user_id;
console.log('bot:', login?.nickname, selfId);
const groups = (cfg.allow?.groups ?? []).map(String);
for (const gid of groups) {
  try {
    const info = await call('get_group_info', { group_id: gid, no_cache: true });
    console.log(`group ${gid}: ${info?.group_name} all_shut=${info?.group_all_shut}`);
    if (selfId) {
      const member = await call('get_group_member_info', { group_id: gid, user_id: selfId, no_cache: true });
      const until = Number(member?.shut_up_timestamp) || 0;
      const now = Math.floor(Date.now() / 1000);
      console.log(`  self role=${member?.role} shut_until=${until ? new Date(until * 1000).toLocaleString('zh-CN') : 'none'}`);
      if (until > now) console.log(`  ⚠️ 当前被禁言，剩余 ${Math.ceil((until - now) / 60)} 分钟，群发会被 QQ 拒绝（result=120）`);
    }
  } catch (error) {
    console.log(`group ${gid}: 查询失败 ${error?.message ?? error}`);
  }
}
