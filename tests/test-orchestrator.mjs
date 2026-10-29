// Orchestrator 事务测试
import { orchestrateDialog } from '../src/orchestrator/index.js';

let pass = 0; let fail = 0;
const ok = (m) => { console.log('  ✅ ' + m); pass += 1; };
const bad = (m) => { console.log('  ❌ ' + m); fail += 1; };
const cfg = { role: { displayName: '鱼鱼' }, dialogue: { standardsEnforce: true } };
const thought = '{"shouldReply":true,"target":"甲","intent":"answer_question","keyPoints":["接照旧"],"confidence":0.8}';

const noGate = await orchestrateDialog({
  event: { text: '嗯' }, thread: {}, cfg,
  asks: { gate: async () => ({ content: '否' }) }
});
if (noGate.plan === null && noGate.stage === 'gate') ok('gate 否 → 不产出');
else bad('gate 否异常');

const full = await orchestrateDialog({
  event: { text: '题呢' }, thread: {}, cfg,
  asks: {
    gate: async () => ({ content: '是' }),
    thinker: async () => ({ content: thought }),
    speaker: async () => ({ content: '{"messages":["接照旧"]}' })
  }
});
if (full.plan?.messages[0] === '接照旧' && full.trace?.standards?.pass) ok('全链路 + 四标准');
else bad('全链路异常：' + JSON.stringify(full.trace?.standards?.violations));

const badDraft = await orchestrateDialog({
  event: { text: '题呢' }, thread: {}, cfg,
  asks: {
    gate: async () => ({ content: '是' }),
    thinker: async () => ({ content: thought }),
    speaker: async () => ({ content: '{"messages":["你昨天说要去北京"]}' })
  },
  context: { recall: () => ({ lines: [], evidence: [] }) }
});
if (badDraft.plan === null && badDraft.stage === 'standards') ok('无证据事实 → 拦下');
else bad('无证据未拦：' + JSON.stringify(badDraft.plan));

let calls = 0;
const repaired = await orchestrateDialog({
  event: { text: '题呢' }, thread: {}, cfg,
  asks: {
    gate: async () => ({ content: '是' }),
    thinker: async () => ({ content: thought }),
    speaker: async () => {
      calls += 1;
      return { content: calls === 1 ? '{"messages":["你昨天说要去北京"]}' : '{"messages":["接照旧"]}' };
    }
  },
  context: { recall: () => ({ lines: [], evidence: [] }) }
});
if (repaired.plan?.messages[0] === '接照旧' && calls === 2) ok('修复后放行');
else bad('修复异常：' + JSON.stringify(repaired));

console.log('\n' + (fail ? `❌ ${fail} 项失败` : `✅ ${pass} 项全部通过`));
process.exit(fail ? 1 : 0);
