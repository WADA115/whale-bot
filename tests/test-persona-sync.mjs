import fs from 'node:fs';

function readDevKey() {
  try {
    if (process.env.QQB_DEV_KEY) return process.env.QQB_DEV_KEY;
    return fs.readFileSync(new URL('../state/dev-key.txt', import.meta.url), 'utf8').trim();
  } catch { return 'dev-key-missing'; }
}
// 验证：人格卡 ↔ 设定 联动
const base = 'http://127.0.0.1:3200';

async function login() {
  const r = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'dev', devKey: readDevKey() })
  });
  return (r.headers.get('set-cookie') || '').split(';')[0];
}

async function post(path, body, cookie) {
  const r = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body ?? {})
  });
  let json = {};
  try { json = await r.json(); } catch {}
  return { status: r.status, body: json };
}

const get = async (path, cookie) => {
  const r = await fetch(base + path, { headers: cookie ? { cookie } : {} });
  let json = {};
  try { json = await r.json(); } catch {}
  return { status: r.status, body: json };
};

const cookie = await login();
console.log('① 开发者登录:', cookie ? 'OK' : '失败');

const persona = await get('/api/persona', cookie);
const active = persona.body.active;
console.log('② 当前人格卡:', active);

const before = await get('/api/memory', cookie);
const beforeAuto = (before.body.settings || []).filter((x) => String(x.from || '').startsWith('persona:'));
console.log('③ 同步前设定：总', (before.body.settings || []).length, '条，其中来自人格卡', beforeAuto.length, '条');

const sync = await post('/api/persona/sync', {}, cookie);
console.log('④ 手动同步:', sync.status, sync.body.msg || JSON.stringify(sync.body).slice(0, 100));

const after = await get('/api/memory', cookie);
const settings = after.body.settings || [];
const auto = settings.filter((x) => String(x.from || '').startsWith('persona:'));
const manual = settings.filter((x) => !String(x.from || '').startsWith('persona:'));
console.log('⑤ 同步后：总', settings.length, '条（人格卡生成', auto.length, '条，手工保留', manual.length, '条）');
console.log('⑥ 生成样例:');
for (const x of auto.slice(0, 4)) console.log('   -', x.text.slice(0, 70));

if (auto.length > 0 && manual.length >= 0) console.log('\n✅ 联动生效');
else console.log('\n❌ 联动没生效');
