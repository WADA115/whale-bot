// 用户名校验 / 档案文件名测试
import { validateUserName, userKey, profileFileName, USER_LIMITS } from '../src/user-id.js';

let pass = 0; let fail = 0;
const ok = (m) => { console.log('  ✅ ' + m); pass += 1; };
const bad = (m) => { console.log('  ❌ ' + m); fail += 1; };

// 1. 正常名字
for (const name of ['123456', '小鲸鱼', 'alice_01', 'a-b']) {
  const r = validateUserName(name);
  if (r.ok && r.name === name) ok('允许：' + name); else bad('误拒：' + name + ' ' + (r.msg || ''));
}

// 2. 非法字符 / 路径
for (const name of ['../x', 'a/b', 'a\\b', 'a.b', 'a b', 'CON', 'nul', 'COM1', 'LPT9', 'x.', 'x ']) {
  const r = validateUserName(name);
  if (!r.ok) ok('拒绝：' + name); else bad('误放：' + name);
}

// 3. 长度
if (!validateUserName('a').ok) ok('拒绝过短');
else bad('过短未拒');
if (!validateUserName('a'.repeat(USER_LIMITS.max + 1)).ok) ok('拒绝过长');
else bad('过长未拒');

// 4. NFKC + 大小写唯一
if (validateUserName('Ａlice').name === 'Alice') ok('全角归一化');
else bad('归一化异常');
if (userKey('Alice') === userKey('alice')) ok('大小写唯一键');
else bad('大小写键不一致');

// 5. 档案文件名：哈希、大小写一致、不泄漏原名
const f1 = profileFileName('Alice');
const f2 = profileFileName('alice');
if (/^[0-9a-f]{16}\.json$/.test(f1) && f1 === f2 && !f1.includes('Alice')) ok('档案文件名哈希且大小写一致');
else bad('档案文件名异常：' + f1);

console.log('\n' + (fail ? `❌ ${fail} 项失败` : `✅ ${pass} 项全部通过`));
process.exit(fail ? 1 : 0);
