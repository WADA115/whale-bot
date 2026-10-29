// 语境判断解析测试
import { parseVerdictText, parseVerdictReasoning, parseClassifyAnswer } from '../src/group-classify.js';

let pass = 0; let fail = 0;
const ok = (m) => { console.log('  ✅ ' + m); pass += 1; };
const bad = (m) => { console.log('  ❌ ' + m); fail += 1; };

if (parseVerdictText('是') === true && parseVerdictText('否') === false) ok('content 单字');
else bad('content 单字异常');
if (parseVerdictText('不是') === false && parseVerdictText('回答：是') === true) ok('content 否定/前缀');
else bad('content 否定异常');
if (parseVerdictText('') === null) ok('空 content 返回 null');
else bad('空 content 异常');

if (parseVerdictReasoning('分析后，结论是：否。') === false) ok('reasoning 判定否');
else bad('reasoning 否异常');
if (parseVerdictReasoning('先看是不是在叫它……答案是 是') === true) ok('reasoning 判定是');
else bad('reasoning 是异常');
if (parseVerdictReasoning('没有明确结论') === null) ok('无结论返回 null');
else bad('无结论异常');

const r1 = parseClassifyAnswer('', '推理：这条在叫它，所以是');
if (r1.addressed === true && r1.reason.startsWith('reasoning')) ok('空 content 用 reasoning');
else bad('reasoning 回退异常：' + JSON.stringify(r1));

const r2 = parseClassifyAnswer('', '');
if (r2.addressed === true && r2.reason === 'empty→是') ok('全空时拿不准判是（不静默丢掉）');
else bad('空答案兜底异常：' + JSON.stringify(r2));

const r3 = parseClassifyAnswer('否', '');
if (r3.addressed === false) ok('content 否优先');
else bad('content 否被覆盖');

console.log('\n' + (fail ? `❌ ${fail} 项失败` : `✅ ${pass} 项全部通过`));
process.exit(fail ? 1 : 0);
