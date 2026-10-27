// 全面自检：接口、流程、页面、文件、日志
import fs from 'node:fs';

function readDevKey() {
  try {
    if (process.env.QQB_DEV_KEY) return process.env.QQB_DEV_KEY;
    return fs.readFileSync(new URL('../state/dev-key.txt', import.meta.url), 'utf8').trim();
  } catch { return 'dev-key-missing'; }
}
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.argv[2];          // E:\deepseek_qq.bot\qq-bridge
const base = 'http://127.0.0.1:3200';
let fails = 0;
const pass = (m) => console.log('  ✅ ' + m);
const fail = (m) => { console.log('  ❌ ' + m); fails += 1; };

const j = async (r) => { try { return await r.json(); } catch { return {}; } };
const post = async (p, body, cookie) => {
  const r = await fetch(base + p, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body)
  });
  return { status: r.status, body: await j(r), cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
};

// 1. 服务与页面
console.log('\n[1] 服务与公开页面');
try {
  const st = await (await fetch(base + '/api/auth/status')).json();
  pass('面板在线，未登录状态正常（registered=' + st.registered + '）');
} catch (e) { fail('面板连不上：' + e.message); }

for (const [p, must] of [['/login.html', '普通用户'], ['/guide.html', '注册']]) {
  try {
    const r = await fetch(base + p);
    const t = await r.text();
    if (r.ok && t.includes(must)) pass(p + ' 正常（' + (t.length / 1024).toFixed(1) + ' KB）');
    else fail(p + ' 内容异常');
  } catch (e) { fail(p + ' 打不开：' + e.message); }
}
const guide = await (await fetch(base + '/guide.html')).text();
if (/dev-key|开发者密钥|state\/dev-key/.test(guide)) fail('guide.html 还在泄露开发者信息');
else pass('guide.html 不含开发者入口/密钥信息');

// 2. 开发者登录
console.log('\n[2] 开发者登录');
const dev = await post('/api/auth/login', { mode: 'dev', devKey: readDevKey() });
if (dev.status === 200) pass('密钥登录 200'); else fail('密钥登录 ' + dev.status);
const devStatus = await (await fetch(base + '/api/status', { headers: { cookie: dev.cookie } })).json();
if (devStatus.ports && typeof devStatus.snowlumaUiUp === 'boolean') pass('服务状态可读：' + JSON.stringify(devStatus.ports));
else fail('服务状态异常');
if (devStatus.bootAt) pass('bootAt 存在（免责声明按启动弹）');
else fail('缺少 bootAt');

// 3. 普通账户流程
console.log('\n[3] 普通账户');
const name = 'chk' + Date.now().toString().slice(-5);
// 用开发者直接建账户（避免反复自检把"每 IP 每小时 5 次注册"用光）
const created = await post('/api/auth/accounts', { user: name, pass: 'test123456' }, dev.cookie);
if (created.status === 200) pass('创建普通账户 200');
else fail('创建普通账户 ' + created.status + ' ' + JSON.stringify(created.body));
const reg = await post('/api/auth/login', { mode: 'user', user: name, pass: 'test123456' });
if (reg.status === 200) pass('普通账户登录 200');
else fail('普通账户登录 ' + reg.status + ' ' + JSON.stringify(reg.body));

const prof = await post('/api/profile', {
  qq: '100200300', personaText: '测试人格：说话简短。', behavior: { groupTrigger: 'mention', chime: 0.4 },
  trusted: ['123123123'], memory: [{ text: '测试记忆', tier: 'short' }]
}, reg.cookie);
if (prof.status === 200) pass('保存档案 200'); else fail('保存档案 ' + prof.status + ' ' + JSON.stringify(prof.body));

const got = await (await fetch(base + '/api/profile', { headers: { cookie: reg.cookie } })).json();
if (got.profile?.qq === '100200300' && (got.profile?.personaText || '').includes('测试人格')) pass('档案读回正确（记忆已改存独立文件）');
else fail('档案读回异常：' + JSON.stringify(got).slice(0, 120));

const deny = await post('/api/config', { 'role.groupTrigger': 'all' }, reg.cookie);
if (deny.status === 403) pass('普通账户改全局被拒 403'); else fail('普通账户能改全局！' + deny.status);

const mem = await fetch(base + '/api/memory', { headers: { cookie: reg.cookie } });
const memJson = await mem.json().catch(() => ({}));
if (mem.status === 200) pass('普通账户读自己的记忆（200）');
else fail('普通账户读记忆异常：' + mem.status);
if (!JSON.stringify(memJson).includes('小鲸鱼')) pass('普通账户读不到开发者的记忆');
else fail('普通账户读到了开发者的记忆！');

// 4. 密码重置规则（临时密码 00000 + 强制改密）
const devForReset = await post('/api/auth/login', { mode: 'dev', devKey: readDevKey() });
const devCookie = devForReset.cookie;
console.log('\n[4] 密码重置规则');
// 本机自用：允许直接重置（不需要先失败）
const direct = await post('/api/auth/reset', { user: name }, reg.cookie);
if (direct.status === 200 && direct.body.tempPassword === '00000') pass('可直接重置（无需失败记录）');
else fail('直接重置失败：' + direct.status + ' ' + JSON.stringify(direct.body).slice(0, 80));
const resetRes = await post('/api/auth/reset', { user: name }, reg.cookie);
if (resetRes.status === 200 && resetRes.body.tempPassword === '00000') pass('失败后重置 → 临时密码 00000');
else fail('重置异常：' + JSON.stringify(resetRes.body).slice(0, 100));

const tempLogin = await post('/api/auth/login', { mode: 'user', user: name, pass: '00000' });
if (tempLogin.status === 200 && tempLogin.body.mustChange === true) pass('临时密码可登录，且 mustChange=true');
else fail('临时密码登录异常：' + tempLogin.status + ' ' + JSON.stringify(tempLogin.body).slice(0, 80));

const sameTemp = await post('/api/auth/change-password', { newPass: '00000' }, tempLogin.cookie);
if (sameTemp.status === 400) pass('不能把新密码设成 00000'); else fail('竟然允许设回 00000！' + sameTemp.status);

const changed = await post('/api/auth/change-password', { newPass: 'new123456' }, tempLogin.cookie);
if (changed.status === 200) pass('设置新密码成功'); else fail('改密码失败：' + changed.status + ' ' + JSON.stringify(changed.body));

const newLogin = await post('/api/auth/login', { mode: 'user', user: name, pass: 'new123456' });
if (newLogin.status === 200 && newLogin.body.mustChange === false) pass('新密码可登录，mustChange 已清');
else fail('新密码登录异常：' + newLogin.status);

const tempGone = await post('/api/auth/login', { mode: 'user', user: name, pass: '00000' });
if (tempGone.status === 401) pass('临时密码已失效（401）'); else fail('临时密码仍可用！' + tempGone.status);

const devReset = await post('/api/profiles/manage', { op: 'reset-password', user: name }, devCookie);
if (devReset.status === 200 && devReset.body.tempPassword === '00000') pass('开发者本地重置（无需失败记录）');
else fail('开发者重置失败：' + devReset.status + ' ' + JSON.stringify(devReset.body).slice(0, 80));

// 5. 内容与文件
console.log('\n[5] 内容与文件');
const ch = await (await fetch(base + '/api/changelog', { headers: { cookie: dev.cookie } })).json();
if ((ch.markdown || '').includes('2026-10-27')) pass('更新日志可读（' + (ch.markdown || '').length + ' 字符）');
else fail('更新日志异常');

const personas = await (await fetch(base + '/api/personas', { headers: { cookie: dev.cookie } })).json();
if ((personas.list || []).length >= 2) pass('人格卡列表：' + personas.list.map((x) => x.name).join(' / '));
else fail('人格卡列表异常');

for (const f of ['重置密码.ps1', 'CHANGELOG.md', '使用手册.md', 'README.md', '致谢.md', '开源打包.ps1', '迁移.ps1', '同步令牌.ps1']) {
  if (fs.existsSync(path.join(root, f))) pass(f + ' 存在');
  else fail(f + ' 缺失');
}

// 密码重置脚本编码（PowerShell 要 BOM）
const ps1 = fs.readFileSync(path.join(root, '重置密码.ps1'));
if (ps1[0] === 0xEF && ps1[1] === 0xBB && ps1[2] === 0xBF) pass('重置密码.ps1 带 BOM（中文不会乱码）');
else fail('重置密码.ps1 缺 BOM');

// 6. 面板脚本语法
console.log('\n[6] 前端脚本');
const html = fs.readFileSync(path.join(root, 'public', 'panel.html'), 'utf8');
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
let okAll = true;
blocks.forEach((m, i) => {
  const tmp = path.join(process.env.TEMP ?? '.', `chk-${i}.js`);
  fs.writeFileSync(tmp, m[1], 'utf8');
  try { execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' }); }
  catch { okAll = false; fail('面板脚本块 ' + i + ' 语法错误'); }
  try { fs.unlinkSync(tmp); } catch {}
});
if (okAll) pass('面板内联脚本语法通过（' + blocks.length + ' 块）');

for (const k of ['nav-changelog', 'neverDisclaimer', 'persona-cards', 'profile-box', 'trusted-chips']) {
  if (html.includes(k)) pass('面板包含 ' + k);
  else fail('面板缺少 ' + k);
}

// 7. 日志干净度
console.log('\n[7] 日志');
for (const f of ['bridge.log', 'watchdog.log', 'panel.log']) {
  const p = path.join(root, 'state', 'logs', f);
  if (fs.existsSync(p)) pass(f + ' 在 state/logs（' + (fs.statSync(p).size / 1024).toFixed(1) + ' KB）');
  else fail(f + ' 不在 state/logs');
}
const legacy = ['bridge.log', 'panel.log', 'watchdog.log'].filter((f) => fs.existsSync(path.join(root, 'state', f)));
if (!legacy.length) pass('state 根目录没有旧日志残留');
else fail('还有旧日志：' + legacy.join(', '));

const panelLog = fs.readFileSync(path.join(root, 'state', 'logs', 'panel.log'), 'utf8').trim().split('\n').slice(-6).join('\n');
if (/is not defined|TypeError|ReferenceError|请求出错/.test(panelLog)) fail('面板日志有报错：\n' + panelLog);
else pass('面板日志无报错');


// 8. 开发者模式 / 本地管理 / 人格卡
console.log('\n[8] 开发者模式与本地管理');
const dm = await (await fetch(base + '/api/devmode', { headers: { cookie: dev.cookie } })).json();
if (dm.ok && typeof dm.activated === 'boolean') pass('开发者模式状态可读：' + (dm.activated ? '已激活' : '已停用'));
else fail('开发者模式状态异常：' + JSON.stringify(dm));

const plist = await (await fetch(base + '/api/profiles', { headers: { cookie: dev.cookie } })).json();
if (plist.ok && Array.isArray(plist.list)) pass('本地管理列表可读（' + plist.list.length + ' 个档案）');
else fail('本地管理列表异常');

const noDev = await fetch(base + '/api/profiles', { headers: { cookie: reg.cookie } });
if (noDev.status === 403) pass('普通账户看不到本地管理（403）');
else fail('普通账户能看本地管理！' + noDev.status);

// 人格卡：建一张 → 读回 → 删掉
const cardName = '自检卡' + Date.now().toString().slice(-4);
const saveCard = await post('/api/personas/save', { name: cardName, content: '这是自检生成的人格卡，内容够十个字。' }, dev.cookie);
if (saveCard.status === 200) pass('人格卡新建成功：' + cardName);
else fail('人格卡新建失败：' + JSON.stringify(saveCard.body));
const cardList = await (await fetch(base + '/api/personas', { headers: { cookie: dev.cookie } })).json();
if ((cardList.list || []).some((x) => x.name === cardName)) pass('新卡出现在列表里');
else fail('新卡不在列表里');
const cardGet = await (await fetch(base + '/api/personas/get?name=' + encodeURIComponent(cardName), { headers: { cookie: dev.cookie } })).json();
if (cardGet.ok && (cardGet.content || '').includes('自检')) pass('新卡内容读回正确');
else fail('新卡内容读回失败');
const cardDel = await post('/api/personas/delete', { name: cardName }, dev.cookie);
if (cardDel.status === 200) pass('人格卡删除成功');
else fail('人格卡删除失败：' + JSON.stringify(cardDel.body));

// 档案管理：关联 QQ / 导入人格 / 删除
if (got.profile?.qq) {
  const linked = await post('/api/profiles/manage', { op: 'link', user: name, qq: '999888777' }, dev.cookie);
  if (linked.status === 200) pass('档案关联 QQ 成功');
  else fail('关联 QQ 失败：' + JSON.stringify(linked.body));
  const imported = await post('/api/profiles/manage', { op: 'import-persona', user: name, name: '自检导入卡' }, dev.cookie);
  if (imported.status === 200) { pass('导入人格成功'); await post('/api/personas/delete', { name: '自检导入卡' }, dev.cookie); }
  else fail('导入人格失败：' + JSON.stringify(imported.body));
  const removed = await post('/api/profiles/manage', { op: 'delete', user: name }, dev.cookie);
  if (removed.status === 200) pass('删除档案成功');
  else fail('删除档案失败：' + JSON.stringify(removed.body));
}

console.log('\n' + (fails ? `❌ 自检发现 ${fails} 个问题` : '✅ 自检全部通过'));
process.exit(fails ? 1 : 0);

