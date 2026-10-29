// P0 单测：长输入截断 + 人设锚点
import { guardIncomingText, buildPersonaAnchor } from '../src/persona-guard.js';

let pass = 0; let fail = 0;
const ok = (m) => { console.log('  ✅ ' + m); pass += 1; };
const bad = (m) => { console.log('  ❌ ' + m); fail += 1; };

// 1. 短文本不动
const short = guardIncomingText('今天好累');
if (!short.truncated && short.text === '今天好累') ok('短文本原样通过');
else bad('短文本被改：' + JSON.stringify(short));

// 2. 超长文本保留头尾
const long = '开头'.repeat(2000) + '中间内容'.repeat(1000) + '结尾';
const g = guardIncomingText(long, { maxChars: 2000, headChars: 800, tailChars: 400 });
if (g.truncated && g.text.includes('开头') && g.text.includes('结尾') && g.text.includes('省略')) ok('超长文本保留头尾并标注省略');
else bad('超长文本处理异常');

// 3. 代码行数超限
const code = Array.from({ length: 300 }, (_, i) => `line ${i} const a = 1;`).join('\n');
const l = guardIncomingText(code, { maxChars: 100000, maxLines: 100, headLines: 60, tailLines: 30 });
if (l.truncated && l.omittedLines > 0 && l.text.includes('省略')) ok('超行代码按行截断（省略 ' + l.omittedLines + ' 行）');
else bad('代码截断异常：' + JSON.stringify({ truncated: l.truncated, omitted: l.omittedLines }));

// 4. 边界：空文本
const empty = guardIncomingText('');
if (!empty.truncated && empty.text === '') ok('空文本不报错');
else bad('空文本异常');

// 5. 锚点内容
const a = buildPersonaAnchor();
if (a.includes('人设锚点') && a.includes('小鲸鱼') && a.includes('不是人格') && a.includes('谐音')) ok('锚点包含角色/代码/谐音规则');
else bad('锚点内容缺失：' + a);

// 6. 锚点长度可控
if (a.length <= 260) ok('锚点长度 ' + a.length + ' 字');
else bad('锚点太长：' + a.length);

console.log('\n' + (fail ? `❌ ${fail} 项失败` : `✅ ${pass} 项全部通过`));
process.exit(fail ? 1 : 0);
