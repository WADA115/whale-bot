// 随机插话判定测试：冷却只受上次插话影响
import { canChime, rollChime, DEFAULT_CHIME_GAP_MS } from '../src/chime.js';

let pass = 0; let fail = 0;
const ok = (m) => { console.log('  ✅ ' + m); pass += 1; };
const bad = (m) => { console.log('  ❌ ' + m); fail += 1; };

const now = Date.now();

// 1. 从没插过话 → 允许（不受“刚回复过”影响）
if (canChime({ now, lastChimeAt: 0, minGapMs: DEFAULT_CHIME_GAP_MS })) ok('首次插话允许');
else bad('首次插话被拒');

// 2. 刚插过 → 冷却中
if (!canChime({ now, lastChimeAt: now - 60_000, minGapMs: 7 * 60_000 })) ok('冷却中拒绝');
else bad('冷却中仍允许');

// 3. 超过冷却 → 允许
if (canChime({ now, lastChimeAt: now - 8 * 60_000, minGapMs: 7 * 60_000 })) ok('超过冷却允许');
else bad('超过冷却仍拒绝');

// 4. 概率抽取
if (rollChime({ probability: 0.18, random: 0.1 }) && !rollChime({ probability: 0.18, random: 0.9 })) ok('概率抽取');
else bad('概率抽取异常');
if (!rollChime({ probability: 0, random: 0 })) ok('概率 0 永不插话');
else bad('概率 0 仍插话');

console.log('\n' + (fail ? `❌ ${fail} 项失败` : `✅ ${pass} 项全部通过`));
process.exit(fail ? 1 : 0);
