// 新链路编排测试
import { runDialoguePipeline } from '../src/dialogue/pipeline.js';

let pass = 0; let fail = 0;
const ok = (m) => { console.log('  ✅ ' + m); pass += 1; };
const bad = (m) => { console.log('  ❌ ' + m); fail += 1; };
const cfg = { role: { displayName: '鱼鱼' } };

const noGate = await runDialoguePipeline({
  event: { text: '嗯' }, thread: {}, cfg,
  asks: { gate: async () => ({ content: '否' }) }
});
if (noGate.plan === null && noGate.stage === 'gate') ok('gate 否 → 不出计划');
else bad('gate 否异常：' + JSON.stringify(noGate));

const noThink = await runDialoguePipeline({
  event: { text: '题呢' }, thread: {}, cfg,
  asks: {
    gate: async () => ({ content: '是' }),
    thinker: async () => ({ content: '{"shouldReply":false,"target":"甲"}' })
  }
});
if (noThink.plan === null && noThink.stage === 'thinker') ok('thinker 否 → 不出计划');
else bad('thinker 否异常');

let spoke = 0;
const full = await runDialoguePipeline({
  event: { text: '题呢' }, thread: {}, cfg,
  asks: {
    gate: async () => ({ content: '是' }),
    thinker: async () => ({ content: '{"shouldReply":true,"target":"甲","keyPoints":["接照旧"],"confidence":0.8}' }),
    speaker: async () => { spoke += 1; return { content: '{"messages":["接照旧"]}' }; }
  }
});
if (full.plan?.messages[0] === '接照旧' && spoke === 1) ok('全链路出计划');
else bad('全链路异常：' + JSON.stringify(full));

console.log('\n' + (fail ? `❌ ${fail} 项失败` : `✅ ${pass} 项全部通过`));
process.exit(fail ? 1 : 0);
