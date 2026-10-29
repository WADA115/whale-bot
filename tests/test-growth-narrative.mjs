// 成长 M4 单测：本地叙事、清洗、合法性
import { buildLocalNarrative, parseNarrative, isValidNarrative, buildNarrativePrompt, stageName } from '../src/growth-narrative.js';

let pass = 0; let fail = 0;
const ok = (m) => { console.log('  ✅ ' + m); pass += 1; };
const bad = (m) => { console.log('  ❌ ' + m); fail += 1; };

// 1. 阶段名
if (stageName('familiar') === '交心' && stageName('xxx') === '初识') ok('阶段名有兜底');
else bad('阶段名异常');

// 2. 本地叙事：有内容、有长度上限
const n1 = buildLocalNarrative({ stage: 'settling', signals: { praise: 3, conflict: 1, repair: 2, lateNight: 1 }, summaries: ['他夸我了'] });
if (n1.includes('熟悉') && n1.length <= 110 && n1.length > 5) ok('本地叙事正常（' + n1.length + ' 字）');
else bad('本地叙事异常：' + n1);

const n2 = buildLocalNarrative({ stage: 'new', signals: {}, summaries: [] });
if (n2 && n2.length > 0) ok('空信号也有叙事');
else bad('空信号没叙事');

// 3. 清洗
if (parseNarrative('“我们最近挺好的。”') === '我们最近挺好的。') ok('去引号');
else bad('去引号失败：' + parseNarrative('“我们最近挺好的。”'));
if (parseNarrative('第一句\n第二句') === '第一句 第二句') ok('换行变空格');
else bad('换行处理失败');
if (parseNarrative('```\n我们挺好的\n```') === '我们挺好的') ok('去代码块');
else bad('代码块处理失败');
if (parseNarrative('无') === null && parseNarrative('') === null) ok('空/无 → null');
else bad('空值处理失败');
const long = parseNarrative('啊'.repeat(300));
if (long && long.length <= 100) ok('超长被截断到 100');
else bad('超长没截断：' + (long || '').length);

// 4. 合法性
if (isValidNarrative('我们最近挺好的。') && !isValidNarrative('- 列表') && !isValidNarrative('')) ok('合法性判断正确');
else bad('合法性判断错');

// 5. prompt 带约束
const prompt = buildNarrativePrompt({ stage: 'tacit', signals: { praise: 2 }, summaries: ['他说喜欢我'] });
if (prompt.includes('不超过 80') && prompt.includes('不要编造') && prompt.includes('[0]')) ok('prompt 含约束与片段');
else bad('prompt 异常');

console.log('\n' + (fail ? `❌ ${fail} 项失败` : `✅ ${pass} 项全部通过`));
process.exit(fail ? 1 : 0);
