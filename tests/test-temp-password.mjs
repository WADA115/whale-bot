import fs from 'node:fs';

function readDevKey() {
  try {
    if (process.env.QQB_DEV_KEY) return process.env.QQB_DEV_KEY;
    return fs.readFileSync(new URL('../state/dev-key.txt', import.meta.url), 'utf8').trim();
  } catch { return 'dev-key-missing'; }
}
// 全流程验证：注册 → 错密码 → 重置(QqBot-Reset-2026) → 临时密码登录 → 强制改密 → 新密码登录
const base = 'http://127.0.0.1:3200';

const post = async (path, body, cookie) => {
  const r = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body ?? {})
  });
  let json = {};
  try { json = await r.json(); } catch {}
  return { status: r.status, body: json, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
};

const user = 'tp' + Date.now().toString().slice(-5);
console.log('用户:', user);

const reg = await post('/api/auth/register', { user, pass: 'orig123456' });
console.log('① 注册:', reg.status);

const early = await post('/api/auth/reset', { user });
console.log('② 没失败就重置:', early.status, early.body.msg);

await post('/api/auth/login', { mode: 'user', user, pass: 'wrong-one' });
const reset = await post('/api/auth/reset', { user });
console.log('③ 失败后重置:', reset.status, reset.body.msg, '| 临时密码:', reset.body.tempPassword);

const tempLogin = await post('/api/auth/login', { mode: 'user', user, pass: 'QqBot-Reset-2026' });
console.log('④ 临时密码登录:', tempLogin.status, '| mustChange:', tempLogin.body.mustChange);

const status = await (await fetch(base + '/api/auth/status', { headers: { cookie: tempLogin.cookie } })).json();
console.log('⑤ status.mustChange:', status.mustChange);

const badChange = await post('/api/auth/change-password', { newPass: 'QqBot-Reset-2026' }, tempLogin.cookie);
console.log('⑥ 又设成临时密码:', badChange.status, badChange.body.msg);

const okChange = await post('/api/auth/change-password', { newPass: 'mynew123456' }, tempLogin.cookie);
console.log('⑦ 设置新密码:', okChange.status, okChange.body.msg);

const after = await (await fetch(base + '/api/auth/status', { headers: { cookie: tempLogin.cookie } })).json();
console.log('⑧ 改完后 mustChange:', after.mustChange);

const newLogin = await post('/api/auth/login', { mode: 'user', user, pass: 'mynew123456' });
console.log('⑨ 新密码登录:', newLogin.status, '| mustChange:', newLogin.body.mustChange);

const oldLogin = await post('/api/auth/login', { mode: 'user', user, pass: 'QqBot-Reset-2026' });
console.log('⑩ 临时密码已失效:', oldLogin.status);

// 开发者直改（无失败记录也能重置，防死锁）
const dev = await post('/api/auth/login', { mode: 'dev', devKey: readDevKey() });
const devReset = await post('/api/profiles/manage', { op: 'reset-password', user }, dev.cookie);
console.log('⑪ 开发者本地重置:', devReset.status, devReset.body.msg);

const devLoginAgain = await post('/api/auth/login', { mode: 'user', user, pass: 'QqBot-Reset-2026' });
console.log('⑫ 重置后临时密码又能进:', devLoginAgain.status, '| mustChange:', devLoginAgain.body.mustChange);

// 清理
await post('/api/auth/accounts', { op: 'delete', user }, dev.cookie);
console.log('⑬ 清理测试账户');
