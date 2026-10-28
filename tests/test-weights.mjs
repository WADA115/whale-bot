// 权重模块单测
import {
  clampWeight, autoWeights, resolveWeights, memoryBudget, memoryHitLimit, WEIGHT_DEFAULT
} from '../src/weights.js';

let pass = 0; let fail = 0;
const ok = (m) => { console.log('  ✅ ' + m); pass += 1; };
const bad = (m) => { console.log('  ❌ ' + m); fail += 1; };

// 1. 钳制
for (const [input, want] of [[0, 1], [1, 1], [3, 3], [5, 5], [9, 5], ['4', 4], [NaN, 3]]) {
  const got = clampWeight(input);
  if (got === want) ok(`clamp(${input}) = ${got}`);
  else bad(`clamp(${input}) 期望 ${want} 实际 ${got}`);
}

// 2. 人格卡影响
const warm = autoWeights({ personaHint: '你活泼、黏人、爱撒娇' });
const cool = autoWeights({ personaHint: '你冷静、理性、严谨' });
if (warm.emotion > cool.emotion) ok(`活泼人格情绪权重(${warm.emotion}) > 冷静人格(${cool.emotion})`);
else bad('人格卡没影响情绪权重');

const nostalgic = autoWeights({ personaHint: '你念旧，爱提以前的事' });
if (nostalgic.memory > autoWeights({}).memory) ok('念旧人格记忆权重更高');
else bad('念旧没抬记忆权重');

// 3. 设定影响
const noR = autoWeights({ settingsText: '别翻旧账，别提以前的事' });
if (noR.memory < autoWeights({}).memory) ok('设定「别翻旧账」压低记忆权重');
else bad('设定没压记忆权重');

const care = autoWeights({ settingsText: '要多关心对方，注意情绪' });
if (care.emotion >= autoWeights({}).emotion) ok('设定「多关心」不压情绪权重');
else bad('设定反而压了情绪权重');

// 4. 语境影响
const tech = autoWeights({ text: '这个配置为什么报错，原理是什么' });
const emo = autoWeights({ text: '哈哈哈哈笑死我了！！！' });
if (tech.memory < emo.memory || tech.emotion < emo.emotion) ok('技术提问比情绪化表达更收敛');
else bad('语境没影响权重：' + JSON.stringify({ tech, emo }));

// 5. resolveWeights：auto 与手动
const autoCfg = { role: { weights: { auto: true } } };
const r1 = resolveWeights(autoCfg, { personaHint: '活泼', text: '哈哈哈！！！' });
if (r1.auto === true && r1.emotion >= 3) ok('auto 模式生效');
else bad('auto 模式异常：' + JSON.stringify(r1));

const manualCfg = { role: { weights: { auto: false, memory: { value: 5 }, emotion: { value: 1 } } } };
const r2 = resolveWeights(manualCfg, { personaHint: '活泼', text: '哈哈哈' });
if (r2.memory === 5 && r2.emotion === 1 && r2.auto === false) ok('手动模式生效');
else bad('手动模式异常：' + JSON.stringify(r2));

// 6. 预算与条数
const b1 = memoryBudget(1);
const b5 = memoryBudget(5);
if (b1.always < b5.always && b5.always <= 1400) ok(`预算随权重上升（${b1.always} → ${b5.always}）`);
else bad('预算异常：' + JSON.stringify({ b1, b5 }));

const h1 = memoryHitLimit(1);
const h5 = memoryHitLimit(5);
if (h1 >= 2 && h5 <= 9 && h5 > h1) ok(`相关条目上限（${h1} → ${h5}）`);
else bad('条目上限异常：' + JSON.stringify({ h1, h5 }));

// 7. 默认值
if (WEIGHT_DEFAULT === 3 && memoryBudget(3).always === 500) ok('权重 3 = 现在的 500 字预算');
else bad('默认预算没对齐：' + memoryBudget(3).always);

console.log('\n' + (fail ? `❌ ${fail} 项失败` : `✅ ${pass} 项全部通过`));
process.exit(fail ? 1 : 0);
