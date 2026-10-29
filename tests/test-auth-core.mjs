// 鉴权核心测试：scrypt、会话、退避。
import { hashPassword, verifyPassword, newSalt, needsRehash, SCRYPT, LEGACY_SCRYPT } from '../src/core/auth/password.mjs';
import { createSessionStore, parseCookies } from '../src/core/auth/session.mjs';
import { createThrottle } from '../src/core/auth/throttle.mjs';

let pass = 0; let fail = 0;
const ok = (m) => { console.log('  ✅ ' + m); pass += 1; };
const bad = (m) => { console.log('  ❌ ' + m); fail += 1; };

const salt = newSalt();
const stored = hashPassword('correct horse battery staple', salt, SCRYPT);
if (stored.length === SCRYPT.keylen * 2 && stored !== hashPassword('x', salt, SCRYPT)) ok('scrypt 显式参数 + 随机盐');
else bad('scrypt 输出异常');
if (verifyPassword('correct horse battery staple', salt, stored, SCRYPT)) ok('正确密码验证');
else bad('正确密码失败');
if (!verifyPassword('wrong', salt, stored, SCRYPT)) ok('错误密码拒绝');
else bad('错误密码放行');
if (verifyPassword('correct horse battery staple', salt, hashPassword('correct horse battery staple', salt, LEGACY_SCRYPT), LEGACY_SCRYPT)) ok('旧哈希兼容');
else bad('旧哈希不兼容');
if (needsRehash(LEGACY_SCRYPT) && !needsRehash(SCRYPT)) ok('旧参数需要 rehash');
else bad('rehash 判定异常');

const store = createSessionStore({ ttlMs: 1000 });
const req = { headers: {} };
const token = store.issue(req, 'u1', 'user', '127.0.0.1');
const cookieReq = { headers: { cookie: `whale_session=${token}` } };
if (store.current(cookieReq)?.user === 'u1') ok('会话签发/读取');
else bad('会话读取失败');
store.revoke(cookieReq);
if (!store.current(cookieReq)) ok('会话撤销');
else bad('会话撤销失败');
const expired = store.issue(req, 'u2', 'user');
store.sessions.get(expired).exp = Date.now() - 1;
if (!store.current({ headers: { cookie: `whale_session=${expired}` } })) ok('会话过期');
else bad('会话未过期');

const th = createThrottle({ maxFails: 3, windowMs: 1000, devBaseMs: 10 });
for (let i = 0; i < 3; i += 1) th.recordLoginFail('1.1.1.1');
if (th.loginBlocked('1.1.1.1')) ok('普通登录 3 次失败后限速');
else bad('登录限速失败');
th.clearLogin('1.1.1.1');
if (!th.loginBlocked('1.1.1.1')) ok('成功后清除限速');
else bad('清除限速失败');

const d1 = th.recordDevFail('2.2.2.2');
const d2 = th.recordDevFail('2.2.2.2');
if (d1.delayMs === 10 && d2.delayMs === 20) ok('开发者密钥指数退避');
else bad('退避公式异常：' + JSON.stringify([d1, d2]));
if (th.devGate('2.2.2.2').blocked) ok('退避期间 blocked');
else bad('退避未生效');
th.clearDev('2.2.2.2');
if (!th.devGate('2.2.2.2').blocked) ok('成功清除退避');
else bad('清除退避失败');

const cookies = parseCookies({ headers: { cookie: 'a=1; whale_session=abc%3D' } });
if (cookies.whale_session === 'abc=') ok('cookie 解码');
else bad('cookie 解码异常');

console.log('\n' + (fail ? `❌ ${fail} 项失败` : `✅ ${pass} 项全部通过`));
process.exit(fail ? 1 : 0);
