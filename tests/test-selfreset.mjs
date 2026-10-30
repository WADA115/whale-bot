import fs from 'node:fs';

function readDevKey() {
  try {
    if (process.env.QQB_DEV_KEY) return process.env.QQB_DEV_KEY;
    return fs.readFileSync(new URL('../state/dev-key.txt', import.meta.url), 'utf8').trim();
  } catch { return 'dev-key-missing'; }
}
// 验证：登录页自助重置（无需失败记录、无需管理员）
const base = 'http://127.0.0.1:3200';

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

const user = 'sr' + Date.now().toString().slice(-5);
console.log('① 注册:', (await post('/api/auth/register', { user, pass: 'orig123456' })).status);

const reset = await post('/api/auth/reset', { user });
console.log('② 直接重置（没失败过、没找管理员）:', reset.status, reset.body.msg);

const temp = await post('/api/auth/login', { mode: 'user', user, pass: 'QqBot-Reset-2026' });
console.log('③ 临时密码登录:', temp.status, '| mustChange:', temp.body.mustChange);

const changed = await post('/api/auth/change-password', { newPass: 'brandnew123' }, temp.cookie);
console.log('④ 设新密码:', changed.status, changed.body.msg);

const login2 = await post('/api/auth/login', { mode: 'user', user, pass: 'brandnew123' });
console.log('⑤ 新密码登录:', login2.status, '| mustChange:', login2.body.mustChange);

const dev = await post('/api/auth/login', { mode: 'dev', devKey: readDevKey() });
await post('/api/auth/accounts', { op: 'delete', user }, dev.cookie);
console.log('⑥ 清理完成');
