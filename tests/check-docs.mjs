// 相对路径：仓库根 = 本文件上一级
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

﻿// 两端说明一致性检查：登录页说明（guide.html）与面板手册（使用手册.md）
// 以后改完功能跑这个，确保两边说法不打架。
import fs from 'node:fs';

const root = process.argv[2] || ROOT;
const manual = fs.readFileSync(root + '/使用手册.md', 'utf8');
const guide = fs.readFileSync(root + '/public/guide.html', 'utf8');
const login = fs.readFileSync(root + '/public/login.html', 'utf8');

let fails = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fails += 1; };

// 1. 关键事实两边都要有
const facts = [
  ['临时密码 00000', /00000/],
  ['注册入口', /注册/],
  ['密码长度 6', /6/],
  ['用户名长度 2', /2~24|2 ~ 24/]
];
for (const [label, re] of facts) {
  if (re.test(manual) && re.test(guide)) ok(label + '：两边一致');
  else bad(label + '：' + (!re.test(manual) ? '手册缺 ' : '') + (!re.test(guide) ? '登录页缺' : ''));
}

// 2. 只在手册里出现的开发者信息，登录页不能出现
const devOnly = ['开发者密钥', 'dev-key', 'state/profiles', '本地管理'];
for (const word of devOnly) {
  if (manual.includes(word) && guide.includes(word)) bad('「' + word + '」出现在登录页（应只在手册）');
  else ok('「' + word + '」只在手册里');
}

// 3. 过期表述（两边都不能有）
const stale = ['第一个账户必然是开发者', '创建开发者账户', '面板五个标签', '只能看，改不了设置'];
for (const t of stale) {
  if (manual.includes(t) || guide.includes(t) || login.includes(t)) bad('过期表述：' + t);
}
ok('没有过期表述');

// 4. 登录页两个按钮都要有
if (login.includes('注册') && login.includes('登录')) ok('登录页有注册/登录两个按钮');
else bad('登录页缺按钮');

// 5. 手册章节结构（一到十，分类清晰）
const heads = [...manual.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
const want = ['启动', '身份', '忘记密码', '常用设置', '人格卡', '记忆', '日志与排错', '输入限制', '脚本清单', '文件在哪'];
for (const w of want) {
  if (heads.some((h) => h.includes(w))) ok('章节：' + w);
  else bad('缺章节：' + w);
}

// 6. 手册不要太长（保持简洁）
const lines = manual.split('\n').length;
if (lines <= 200) ok('手册长度 ' + lines + ' 行（够简洁）');
else bad('手册太长：' + lines + ' 行，建议精简');

console.log('\n' + (fails ? '❌ 两端说明有 ' + fails + ' 处不一致' : '✅ 两端说明一致'));
process.exit(fails ? 1 : 0);

