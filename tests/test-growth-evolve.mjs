// 成长 M2 单测：信号、提案、预算、锚点、阶段
import { aggregateWeek, proposeEvolution, evaluateStage, evolveOnce, LIMITS } from '../src/growth-evolve.js';

let pass = 0; let fail = 0;
const ok = (m) => { console.log('  ✅ ' + m); pass += 1; };
const bad = (m) => { console.log('  ❌ ' + m); fail += 1; };

const baseState = () => ({
  traits: { openness: 3, conscientiousness: 3, extraversion: 3, agreeableness: 3, neuroticism: 3 },
  base: { openness: 3, conscientiousness: 3, extraversion: 3, agreeableness: 3, neuroticism: 3 },
  needs: { autonomy: 50, competence: 50, relatedness: 50 },
  attachment: { safety: 50, trust: 50, intimacy: 50 },
  energy: 60,
  stage: { id: 'new', since: 0, progress: 0 }
});

// 1. 信号
const kept = {
  '2026-10-20': [
    { kind: 'preference', summary: '喜欢冰美式', ts: Date.now() },
    { kind: 'emotion', summary: '主人夸我了，好开心', ts: Date.now() }
  ],
  '2026-10-21': [
    { kind: 'emotion', summary: '他生气了，说讨厌', ts: Date.now() },
    { kind: 'chat', summary: '对不起，我道歉', ts: Date.now() }
  ],
  '2026-10-22': []
};
const s = aggregateWeek(kept);
if (s.praise >= 1 && s.conflict >= 1 && s.repair >= 1 && s.emptyDays === 1) ok('信号统计正确：' + JSON.stringify(s).slice(0, 80));
else bad('信号统计错：' + JSON.stringify(s));

// 2. 提案在预算内
const p = proposeEvolution(baseState(), s);
const keys = ['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism'];
let within = true;
for (const k of keys) {
  if (Math.abs(p.traits[k] - 3) > LIMITS.perTrait + 1e-9) within = false;
}
if (within) ok('单个特质不超 ±' + LIMITS.perTrait);
else bad('特质越界：' + JSON.stringify(p.traits));

const total = keys.reduce((sum, k) => sum + Math.abs(p.traits[k] - 3), 0);
if (total <= LIMITS.perWeek + 1e-6) ok('总变化不超 ±' + LIMITS.perWeek + '（' + total.toFixed(3) + '）');
else bad('总变化越界：' + total);

if (p.reasons.length >= 3) ok('有可读原因（' + p.reasons.length + ' 条）');
else bad('原因太少：' + JSON.stringify(p.reasons));

// 3. 锚点：基座被拉远也不会超过 ±1
const far = baseState();
far.base = { ...far.base, agreeableness: 5 };
far.traits = { ...far.traits, agreeableness: 3 };
const p2 = proposeEvolution(far, { ...s, praise: 999, conflict: 0 });
if (Math.abs(p2.traits.agreeableness - 5) <= 1) ok('锚点生效（不离基座 ±1 以上）');
else bad('锚点失效：' + p2.traits.agreeableness);

// 4. 阶段：不跳级
const readyState = baseState();
readyState.attachment.trust = 60;
const young = evaluateStage(readyState, s, { daysSinceFirst: 3, totalEvents: 40 });
if (young.advanced && young.stage.id === 'settling') ok('满足条件进「熟悉」');
else bad('阶段没推进：' + JSON.stringify(young));

const skip = evaluateStage({ ...readyState, stage: { id: 'new' } }, s, { daysSinceFirst: 100, totalEvents: 1000 });
if (skip.stage.id === 'settling') ok('一次只进一级，不跳到交心');
else bad('阶段跳级：' + skip.stage.id);

const blocked = evaluateStage(baseState(), s, { daysSinceFirst: 2, totalEvents: 40 });
if (!blocked.advanced && blocked.conditions.some((c) => c.key === 'days')) ok('天数不够不推进');
else bad('阶段误推进');

// 5. 完整演化：状态结构合法
const r = evolveOnce(baseState(), kept, { daysSinceFirst: 3, totalEvents: 40 });
if (r.traits && r.needs && r.attachment && r.influence && typeof r.influence.toneBias === 'number') ok('evolveOnce 输出完整');
else bad('evolveOnce 缺字段：' + JSON.stringify(Object.keys(r)));

if (Math.abs(r.influence.toneBias) <= 0.3 && Math.abs(r.influence.memoryWarmth) <= 0.3) ok('影响参数在 ±0.3 内');
else bad('影响参数越界：' + JSON.stringify(r.influence));

// 6. 冷清的一周：需求下降但不为负
const quiet = evolveOnce(baseState(), { '2026-10-20': [], '2026-10-21': [] }, { daysSinceFirst: 1, totalEvents: 0 });
if (quiet.needs.relatedness >= 0 && quiet.needs.relatedness <= 100) ok('冷清周需求仍在 0~100');
else bad('需求越界：' + quiet.needs.relatedness);

console.log('\n' + (fail ? `❌ ${fail} 项失败` : `✅ ${pass} 项全部通过`));
process.exit(fail ? 1 : 0);
