// 成长 M3 单测：影响钳制、映射、关闭即原样
import {
  clampInfluence, readInfluence, emotionWeightWithGrowth, memoryBudgetWithGrowth,
  chanceWithGrowth, stageLine, previewInfluence, INFLUENCE_CAP, EFFECT_CAP
} from '../src/growth-influence.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let pass = 0; let fail = 0;
const ok = (m) => { console.log('  ✅ ' + m); pass += 1; };
const bad = (m) => { console.log('  ❌ ' + m); fail += 1; };

// 1. 钳制
if (clampInfluence(0.9) === INFLUENCE_CAP && clampInfluence(-9) === -INFLUENCE_CAP) ok('影响钳制在 ±' + INFLUENCE_CAP);
else bad('钳制失败');
if (clampInfluence(NaN) === 0) ok('NaN → 0');
else bad('NaN 处理失败');

// 2. 情绪权重：3 + 0.3*2 = 3.6；并夹在 1~5
if (Math.abs(emotionWeightWithGrowth(3, 0.3) - 3.6) < 1e-9) ok('情绪权重 3 → 3.6');
else bad('情绪权重映射错：' + emotionWeightWithGrowth(3, 0.3));
if (emotionWeightWithGrowth(5, 0.3) === 5 && emotionWeightWithGrowth(1, -0.3) === 1) ok('情绪权重不越 1~5');
else bad('情绪权重越界');

// 3. 记忆预算 ±20%
if (memoryBudgetWithGrowth(500, 0.3) === 600 && memoryBudgetWithGrowth(500, -0.3) === 400) ok('记忆预算 500 → 600 / 400');
else bad('记忆预算映射错：' + memoryBudgetWithGrowth(500, 0.3));

// 4. 概率 ±20%，且 0~1
if (Math.abs(chanceWithGrowth(0.22, 0.3) - 0.264) < 1e-9) ok('表情概率 0.22 → 0.264');
else bad('概率映射错：' + chanceWithGrowth(0.22, 0.3));
if (chanceWithGrowth(0.9, 0.3) <= 1 && chanceWithGrowth(0, 0.3) === 0) ok('概率不越 0~1');
else bad('概率越界');

// 5. 阶段文案
if (stageLine('familiar').includes('开玩笑') && stageLine('nope').length > 0) ok('阶段文案有兜底');
else bad('阶段文案异常');

// 6. 关闭 / 无数据 → null
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gi-'));
if (readInfluence(dir) === null) ok('没有 state.json 时返回 null（不介入）');
else bad('无数据时没返回 null');

fs.mkdirSync(path.join(dir, 'growth'), { recursive: true });
fs.writeFileSync(path.join(dir, 'growth', 'state.json'), JSON.stringify({
  stage: { id: 'settling' },
  influence: { toneBias: 0.9, memoryWarmth: -0.9, expressiveness: 0.3, initiative: -0.3 }
}), 'utf8');
const gi = readInfluence(dir);
if (gi && gi.toneBias === 0.3 && gi.memoryWarmth === -0.3 && gi.stage === 'settling') ok('读状态并钳制生效');
else bad('读状态异常：' + JSON.stringify(gi));

if (readInfluence(dir, { enabled: false }) === null) ok('关闭开关 → null');
else bad('关闭开关没生效');

// 7. 面板预览
const pv = previewInfluence(gi);
if (pv && pv.emotionWeight.now === 3.6 && pv.memoryBudget.now === 400) ok('预览数据正确');
else bad('预览异常：' + JSON.stringify(pv));

fs.rmSync(dir, { recursive: true, force: true });

console.log('\n' + (fail ? `❌ ${fail} 项失败` : `✅ ${pass} 项全部通过`));
process.exit(fail ? 1 : 0);
