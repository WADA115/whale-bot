// 情绪强度：范围、自动档启发式、提示词格式
import { clampLevel, autoEmotionLevel, emotionPrompt } from '../src/emotion.js';

let pass = 0; let fail = 0;
const ok = (m) => { console.log('  ✅ ' + m); pass += 1; };
const bad = (m) => { console.log('  ❌ ' + m); fail += 1; };

// 1. 范围钳制
for (const [input, want] of [[0, 1], [1, 1], [3, 3], [5, 5], [9, 5], [-2, 1], ['4', 4], [NaN, 3], [2.6, 3]]) {
  const got = clampLevel(input);
  if (got === want) ok(`clamp(${input}) = ${got}`);
  else bad(`clamp(${input}) 期望 ${want}，实际 ${got}`);
}

// 2. 自动档：激动的话更高
const calm = autoEmotionLevel({ base: 3, text: '帮我看看这个配置为什么报错' });
const excited = autoEmotionLevel({ base: 3, text: '哈哈哈哈笑死我了！！！' });
if (excited > calm) ok(`激动(${excited}) > 冷静(${calm})`);
else bad(`激动没比冷静高：${excited} vs ${calm}`);

// 3. 人格卡影响
const lively = autoEmotionLevel({ base: 3, text: '在吗', roleHint: '你活泼、元气、爱撒娇' });
const cool = autoEmotionLevel({ base: 3, text: '在吗', roleHint: '你冷静、理性、严谨' });
if (lively > cool) ok(`活泼人格(${lively}) > 冷静人格(${cool})`);
else bad(`人格卡没影响：${lively} vs ${cool}`);

// 4. 心情影响
const moody = autoEmotionLevel({ base: 3, moodScore: 4, text: '嗯' });
if (moody >= 4) ok('心情波动大时更外放');
else bad('心情没影响：' + moody);

// 5. 永远在 1~5
let allInRange = true;
for (let i = 0; i < 200; i++) {
  const lv = autoEmotionLevel({
    base: 1 + Math.floor(Math.random() * 5),
    moodScore: (Math.random() - 0.5) * 10,
    text: Math.random() > 0.5 ? '哈哈哈！！！' : '为什么这个配置会报错，原理是什么',
    roleHint: Math.random() > 0.5 ? '活泼元气' : '冷静理性'
  });
  if (lv < 1 || lv > 5) { allInRange = false; break; }
}
if (allInRange) ok('200 次随机输入都落在 1~5');
else bad('出现了越界值');

// 6. 提示词格式
const line = emotionPrompt(4);
if (line.includes('【表达强度】4/5') && line.includes('偏感性') && line.includes('不要把数字说出来')) ok('提示词格式正确');
else bad('提示词格式不对：' + line);

console.log('\n' + (fail ? `❌ ${fail} 项失败` : `✅ ${pass} 项全部通过`));
process.exit(fail ? 1 : 0);
