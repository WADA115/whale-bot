// 四标准测试
import { checkGrounding, checkConsistency, checkClarity, checkAutonomy, checkStandards } from '../src/orchestrator/standards.js';

let pass = 0; let fail = 0;
const ok = (m) => { console.log('  ✅ ' + m); pass += 1; };
const bad = (m) => { console.log('  ❌ ' + m); fail += 1; };

if (checkGrounding({ draft: '你昨天说要去北京', evidence: [] }).pass === false) ok('无证据事实 → 拦截');
else bad('无证据未拦');
if (checkGrounding({ draft: '你昨天说要去北京，可能我记错了', evidence: [] }).pass === true) ok('hedge → 放行');
else bad('hedge 被拦');
if (checkGrounding({ draft: '你昨天说要去北京', evidence: ['你昨天说要去北京'] }).pass === true) ok('有证据 → 放行');
else bad('有证据被拦');

if (checkConsistency({ draft: '你昨天没去北京', facts: ['你昨天去了北京'] }).pass === false) ok('正反冲突 → 拦截');
else bad('冲突未拦');
if (checkConsistency({ draft: '今天天气不错', facts: ['你昨天去了北京'] }).pass === true) ok('无关 → 放行');
else bad('无关被拦');

if (checkClarity({ draft: 'a？b？', thought: { intent: 'answer' }, plan: { messages: ['a？b？'] } }).pass === false) ok('多问题 → 拦截');
else bad('多问题未拦');
if (checkClarity({ draft: '好的', thought: { intent: 'answer' }, plan: { messages: ['好的'] } }).pass === true) ok('短句 → 放行');
else bad('短句被拦');
if (checkClarity({ draft: 'x', thought: {}, plan: { messages: ['x'] } }).pass === false) ok('缺主意图 → 拦截');
else bad('缺意图未拦');

if (checkAutonomy({ decision: { action: 'reply' } }).pass === true) ok('被动回复 → 放行');
else bad('被动被拦');
if (checkAutonomy({ decision: { action: 'initiate' } }).pass === false) ok('主动无驱动 → 拦截');
else bad('主动未拦');
if (checkAutonomy({ decision: { action: 'initiate', drive: 'care', reason: '跟进' } }).pass === true) ok('主动有理由 → 放行');
else bad('主动有理由被拦');

const all = checkStandards({ draft: '好的', thought: { intent: 'answer', keyPoints: ['a'] }, plan: { messages: ['好的'] }, decision: { action: 'reply' } });
if (all.pass === true) ok('四标准全过');
else bad('四标准误杀：' + JSON.stringify(all.violations));

console.log('\n' + (fail ? `❌ ${fail} 项失败` : `✅ ${pass} 项全部通过`));
process.exit(fail ? 1 : 0);
