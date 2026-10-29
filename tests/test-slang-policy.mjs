// P1 单测：问梗识别、敏感过滤、置信度/过期判断
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isAskingMeaning, extractAskedTerms, isSensitiveTerm, shouldInject, expiresAtFromNow } from '../src/slang-policy.js';
import { saveSlang, loadSlang, buildSlangContext, SLANG_STATUS } from '../src/slang-learner.js';

let pass = 0; let fail = 0;
const ok = (m) => { console.log('  ✅ ' + m); pass += 1; };
const bad = (m) => { console.log('  ❌ ' + m); fail += 1; };

// 1. 问句识别
if (isAskingMeaning('原神是什么梗') && isAskingMeaning('这个词啥意思') && !isAskingMeaning('今天吃什么')) ok('问梗识别');
else bad('问梗识别异常');

// 2. 引号候选
const a = extractAskedTerms('「尊嘟假嘟」是什么意思');
if (a.includes('尊嘟假嘟')) ok('引号候选：' + a.join('、'));
else bad('引号候选异常：' + JSON.stringify(a));

// 3. X 是什么梗
const b = extractAskedTerms('原神是什么意思啊');
if (b.includes('原神')) ok('句式候选：' + b.join('、'));
else bad('句式候选异常：' + JSON.stringify(b));

// 4. 普通聊天不抽
if (extractAskedTerms('今天好累').length === 0) ok('普通聊天不抽');
else bad('普通聊天误抽');

// 5. 敏感词不学
if (extractAskedTerms('「色情」是什么意思').length === 0 && isSensitiveTerm('色情')) ok('敏感词过滤');
else bad('敏感词没过滤');

// 6. 长度限制
if (extractAskedTerms('「这是一个特别特别长的词条内容」是什么意思').length === 0) ok('超长词条丢弃');
else bad('超长词条没丢');

// 7. 置信度/过期
const now = Date.now();
const base = { status: SLANG_STATUS.CONFIRMED, meaning: '梗', confidence: 0.8, expiresAt: expiresAtFromNow(30, now) };
if (shouldInject(base, { now })) ok('已确认 + 高置信度可注入');
else bad('应注入却没注入');
if (!shouldInject({ ...base, confidence: 0.2 }, { now })) ok('低置信度不注入');
else bad('低置信度被注入');
if (!shouldInject({ ...base, expiresAt: expiresAtFromNow(-1, now) }, { now })) ok('过期不注入');
else bad('过期仍注入');

// 8. 保存时清理过期
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slang-'));
const file = path.join(dir, 'slang.json');
saveSlang(file, [
  { content: '原神', meaning: '游戏', status: SLANG_STATUS.CONFIRMED, confidence: 0.8, expiresAt: expiresAtFromNow(30, now) },
  { content: '过期词', meaning: '旧梗', status: SLANG_STATUS.CONFIRMED, confidence: 0.8, expiresAt: expiresAtFromNow(-1, now) }
]);
const loaded = loadSlang(file);
if (loaded.length === 1 && loaded[0].content === '原神') ok('保存时清掉过期条目');
else bad('过期清理异常：' + JSON.stringify(loaded.map((x) => x.content)));

// 9. 注入表只含可注入条目
const ctx = buildSlangContext(loaded, 8, 0.5);
if (ctx.includes('原神') && !ctx.includes('过期词')) ok('注入表过滤正确');
else bad('注入表异常');

fs.rmSync(dir, { recursive: true, force: true });

console.log('\n' + (fail ? `❌ ${fail} 项失败` : `✅ ${pass} 项全部通过`));
process.exit(fail ? 1 : 0);
