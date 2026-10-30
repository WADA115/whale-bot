import fs from 'node:fs';

import { ensureState } from './_setup.mjs';

ensureState();

function readDevKey() {
  try {
    if (process.env.QQB_DEV_KEY) return process.env.QQB_DEV_KEY;
    return fs.readFileSync(new URL('../state/dev-key.txt', import.meta.url), 'utf8').trim();
  } catch { return 'dev-key-missing'; }
}
// 验证：本地管理「重置密码」全流程（接口级）
const base = 'http://127.0.0.1:3200';

// 端到端测试：需要面板正在运行，且它用的就是本仓库的 state。
// 默认跳过，避免 clone 下来直接跑测试时误报。
if (process.env.QQB_E2E !== '1') {
  console.log('跳过：端到端测试。先用本仓库启动面板，再 QQB_E2E=1 node tests/test-reset-button.mjs');
  process.exit(0);
}

async function post(path, body, cookie) {
  const r = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body ?? {})
  });
  let json = {};
  try { json = await r.json(); } catch {}
  return { status: r.status, body: json, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}

const user = 'rb' + Date.now().toString().slice(-5);

const dev = await post('/api/auth/login', { mode: 'dev', devKey: readDevKey() });
console.log('② 开发者登录:', dev.status);

// 用开发者建号（公开注册有每小时限额，测试不该消耗它）
console.log('① 建普通账户:', (await post('/api/auth/accounts', { user, pass: 'test123456' }, dev.cookie)).status);

const reset = await post('/api/profiles/manage', { op: 'reset-password', user }, dev.cookie);
console.log('③ 本地管理重置:', reset.status, reset.body.msg);

const temp = await post('/api/auth/login', { mode: 'user', user, pass: 'QqBot-Reset-2026' });
console.log('④ 临时密码登录:', temp.status, '| mustChange:', temp.body.mustChange);

const changed = await post('/api/auth/change-password', { newPass: 'fresh123456' }, temp.cookie);
console.log('⑤ 设新密码:', changed.status, changed.body.msg);

const relogin = await post('/api/auth/login', { mode: 'user', user, pass: 'fresh123456' });
console.log('⑥ 新密码登录:', relogin.status, '| mustChange:', relogin.body.mustChange);

const list = await (await fetch(base + '/api/profiles', { headers: { cookie: dev.cookie } })).json();
const rows = list.list ?? list.profiles ?? [];
console.log('⑦ 本地管理列表可见:', list.ok, '档案数', rows.length);

await post('/api/auth/accounts', { op: 'delete', user }, dev.cookie);
console.log('⑧ 清理');
