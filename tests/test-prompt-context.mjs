// 语境/主动提示词快照：抽取自 bridge.js
import { SILENT_MARKER, SPACE_SPLIT_HINT, DIRECTION_HINT, buildBatchPromptText, buildProbePromptText, buildActiveExitPromptText, buildProactivePromptText } from '../src/prompt/context.js';

let pass = 0; let fail = 0;
const ok = (m) => { console.log('  ✅ ' + m); pass += 1; };
const bad = (m) => { console.log('  ❌ ' + m); fail += 1; };

// 1. 批量：必须回
const must = buildBatchPromptText({ lines: 'A：在吗', allowSilent: false });
if (must.includes('请回复消息') && !must.includes(SILENT_MARKER) && must.includes(SPACE_SPLIT_HINT)) ok('必须回模板');
else bad('必须回模板异常');

// 2. 批量：可静默
const can = buildBatchPromptText({ lines: 'A：在吗' });
if (can.includes(SILENT_MARKER) && can.includes('决定是否回复')) ok('可静默模板');
else bad('可静默模板异常');

// 3. 引用提示只在有引用时出现
const quoted = buildBatchPromptText({ lines: '[引用 A：早] B：早啊' });
if (quoted.includes(DIRECTION_HINT)) ok('引用提示出现');
else bad('引用提示缺失');
if (!can.includes(DIRECTION_HINT)) ok('无引用不提示');
else bad('无引用误提示');

// 4. 试探
const probe = buildProbePromptText({ contextBlock: 'A：早' });
if (probe.includes('【群聊上下文】') && probe.includes('安静了一会儿') && probe.includes(SILENT_MARKER)) ok('试探模板');
else bad('试探模板异常');

// 5. 退场
const exit = buildActiveExitPromptText({ roleHint: '【角色】小鲸鱼', contextBlock: 'A：早' });
if (exit.startsWith('【角色】小鲸鱼\n\n') && exit.includes('收尾/潜水') && exit.includes('【群聊上下文】')) ok('退场模板');
else bad('退场模板异常');

// 6. 主动
const pro = buildProactivePromptText({ roleHint: '', contextBlock: 'A：早' });
if (!pro.startsWith('\n') && pro.includes('开启一个新话题') && pro.includes(SPACE_SPLIT_HINT)) ok('主动模板');
else bad('主动模板异常');

// 7. 纯函数
if (buildBatchPromptText({ lines: 'x' }) === buildBatchPromptText({ lines: 'x' })) ok('同输入同输出');
else bad('输出不稳定');

console.log('\n' + (fail ? `❌ ${fail} 项失败` : `✅ ${pass} 项全部通过`));
process.exit(fail ? 1 : 0);
