import { fileURLToPath } from 'node:url';

import { ensureState } from './_setup.mjs';

ensureState();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 自主记忆测试：判断规则 + 只写事实、绝不碰设定/人格卡
import fs from 'node:fs';
import path from 'node:path';
import { judge, explain } from '../src/auto-memory.js';

const STATE = path.join(ROOT, 'state');
const MEM = path.join(STATE, 'memory.json');
const ROLES = path.join(ROOT, 'roles');

let pass = 0; let fail = 0;
const ok = (m) => { console.log('  ✅ ' + m); pass += 1; };
const bad = (m) => { console.log('  ❌ ' + m); fail += 1; };
const check = (text, expect, label) => {
  const r = judge(text);
  if (r.remember === expect) ok(label + ' → ' + (r.remember ? explain(r) : '不记：' + r.reason));
  else bad(label + ' → 期望 ' + expect + '，实际 ' + JSON.stringify(r));
};

// 1. 该记的
check('我家养了一只叫团子的猫', true, '身份/宠物');
check('我喜欢喝冰美式不加糖', true, '偏好');
check('以后别叫我全名', true, '约定');
check('明天要考试，有点紧张', true, '近期事实');

// 2. 不该记的
check('你好呀', false, '寒暄');
check('在吗？', false, '寒暄+提问');
check('你今天吃什么？', false, '提问');
check('加微信领优惠券', false, '广告');
check('嗯', false, '太短');

// 3. 层级判断
const longCases = ['我叫阿杰', '我养了一只狗', '我最爱吃火锅', '以后都叫我小杰'];
for (const t of longCases) {
  const r = judge(t);
  if (r.remember && r.tier === 'long') ok('长期判定：' + t);
  else bad('应判长期：' + t + ' → ' + JSON.stringify(r));
}
const shortCase = judge('今天加班到十点');
if (shortCase.remember && shortCase.tier === 'short') ok('短期判定：今天加班到十点');
else bad('应判短期：' + JSON.stringify(shortCase));

// 4. 隔离：模块本身不写盘
const before = fs.readFileSync(MEM, 'utf8');
const roleBefore = fs.readdirSync(ROLES).map((f) => f + ':' + fs.statSync(path.join(ROLES, f)).size).join(',');
for (const t of ['我叫测试', '我喜欢测试', '明天测试']) judge(t);
const after = fs.readFileSync(MEM, 'utf8');
const roleAfter = fs.readdirSync(ROLES).map((f) => f + ':' + fs.statSync(path.join(ROLES, f)).size).join(',');
if (before === after) ok('判断过程不写记忆文件');
else bad('判断过程改了记忆文件！');
if (roleBefore === roleAfter) ok('判断过程不碰人格卡');
else bad('判断过程改了人格卡！');

// 5. 源码层面确认：模块不 import 写文件的 API
const src = fs.readFileSync(path.join(ROOT, 'src', 'auto-memory.js'), 'utf8');
if (!/writeFileSync|renameSync|mkdirSync/.test(src)) ok('auto-memory.js 里没有任何写盘调用');
else bad('auto-memory.js 里有写盘调用！');

console.log('\n' + (fail ? `❌ ${fail} 项失败` : `✅ ${pass} 项全部通过`));
process.exit(fail ? 1 : 0);
