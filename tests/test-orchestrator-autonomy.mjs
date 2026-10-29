// 自主表达测试
import { evaluateInitiative } from '../src/orchestrator/autonomy.js';

let pass = 0; let fail = 0;
const ok = (m) => { console.log('  ✅ ' + m); pass += 1; };
const bad = (m) => { console.log('  ❌ ' + m); fail += 1; };
const now = 1000 * 60 * 60;

const early = evaluateInitiative({ now, lastActivityAt: now - 60 * 1000, openQuestions: ['x'] });
if (early.action === 'wait' && early.reason.includes('空闲')) ok('未到空闲 → 等待');
else bad('空闲阈值异常');

const full = evaluateInitiative({
  now,
  lastActivityAt: now - 10 * 60 * 1000,
  openQuestions: ['题没答'],
  budget: { used: 0, limit: 3, windowStartAt: now - 60 * 1000 },
  cfg: { autonomy: { minIdleMs: 8 * 60 * 1000 } }
});
if (full.action === 'initiate' && full.drive === 'care' && full.reason) ok('有未接问题 → 主动');
else bad('主动异常：' + JSON.stringify(full));

const exhausted = evaluateInitiative({
  now,
  lastActivityAt: now - 10 * 60 * 1000,
  openQuestions: ['题没答'],
  budget: { used: 3, limit: 3, windowStartAt: now - 60 * 1000 },
  cfg: { autonomy: { minIdleMs: 8 * 60 * 1000 } }
});
if (exhausted.action === 'wait' && exhausted.reason.includes('预算')) ok('预算用尽 → 等待');
else bad('预算异常');

const reset = evaluateInitiative({
  now,
  lastActivityAt: now - 10 * 60 * 1000,
  openQuestions: ['题没答'],
  budget: { used: 3, limit: 3, windowStartAt: now - 2 * 60 * 60 * 1000 },
  cfg: { autonomy: { minIdleMs: 8 * 60 * 1000, windowMs: 60 * 60 * 1000 } }
});
if (reset.action === 'initiate') ok('窗口滚动 → 预算重置');
else bad('窗口重置异常');

console.log('\n' + (fail ? `❌ ${fail} 项失败` : `✅ ${pass} 项全部通过`));
process.exit(fail ? 1 : 0);
