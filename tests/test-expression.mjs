// 表达引擎单测：润色不伤语义、情绪方向正确、表情挑选合理、概率受控。
import assert from 'node:assert/strict';

import { polishReply, moodFromText, moodLabel, createMood, pickSticker, worthSticker, decideExtras } from '../src/expression.js';

// 1. 润色：去 AI 腔，但保留意思
const cases = [
  ['作为一个AI语言模型，我无法唱歌。', '我无法唱歌。'],
  ['首先，这个不行。其次，那个也不行。总的来说，都不行。', '这个不行。另外那个也不行。反正都不行。'],
  ['希望这个回答能对你有所帮助！', ''],
  ['如果你还有其他问题，随时问我。', ''],
  ['**重点**：真的不行', '重点：真的不行'],
  ['1. 第一点\n2. 第二点', '第一点\n第二点'],
  ['很抱歉，我做不到。', '抱歉，我做不到。'],
];
for (const [input, want] of cases) {
  const got = polishReply(input);
  assert.equal(got, want, `润色「${input}」\n期望：${want}\n实际：${got}`);
  console.log(`OK 润色「${input.slice(0, 18)}…」→「${got.slice(0, 24)}」`);
}

// 2. 正常口语不该被改坏
const normal = ['笑死，这也太真实了', '我不去', '行吧', '你画得啥啊哈哈哈'];
for (const t of normal) assert.equal(polishReply(t), t, `不该改动：${t}`);
console.log('OK 正常口语不被误改');

// 3. 情绪方向
assert.ok(moodFromText('笑死我了哈哈哈') > 0, '开心应为正');
assert.ok(moodFromText('烦死了，真无语') < 0, '不爽应为负');
assert.equal(moodFromText('今天八点'), 0, '中性应为 0');
console.log(`OK 情绪 → 开心 ${moodFromText('笑死我了哈哈哈')} / 不爽 ${moodFromText('烦死了，真无语')} / 中性 ${moodFromText('今天八点')}`);

// 4. 情绪衰减
const mood = createMood({ halfLifeMs: 60 * 1000 });
mood.feed('笑死我了');
const high = mood.get();
assert.ok(high > 0, '喂正的应转正');
console.log('OK 情绪状态 →', high, mood.label());

// 5. 表情挑选：笑 → 含"笑"的表情
const entries = [
  { id: 'a', desc: '笑死', tags: [], useCount: 0 },
  { id: 'b', desc: '草', tags: [], useCount: 0 },
  { id: 'c', desc: '哭', tags: [], useCount: 0 },
];
const picked = pickSticker(entries, '笑死我了哈哈哈');
assert.equal(picked.id, 'a', '应挑中「笑死」那张');
console.log('OK 表情匹配 →', picked.desc);

// 6. 冷却：刚用过的降权
const recent = [{ id: 'a', desc: '笑死', useCount: 0, lastUsedAt: Date.now() }, { id: 'b', desc: '笑了', useCount: 0 }];
const p2 = pickSticker(recent, '笑死', { now: Date.now() });
assert.equal(p2.id, 'b', '刚用过的应让位');
console.log('OK 冷却 →', p2.desc);

// 7. 长句不配表情
assert.equal(worthSticker('这是一段很长很长的话，'.repeat(10)), false);
assert.equal(worthSticker('笑死'), true);
console.log('OK 长句不配表情');

// 8. 概率受控：强制随机值
const always = decideExtras({ text: '笑死', cfg: { role: { expression: { stickerChance: 1, cooldownMs: 0 } } }, rng: () => 0.01, recent: {} });
assert.equal(always.sticker, true, '概率 1 时应发');
const never = decideExtras({ text: '笑死', cfg: { role: { expression: { stickerChance: 0, faceChance: 0, cooldownMs: 0 } } }, rng: () => 0.99, recent: {} });
assert.equal(never.sticker, false, '概率 0 时不该发');
const disabled = decideExtras({ text: '笑死', cfg: { role: { expression: { enabled: false } } } });
assert.equal(disabled.sticker, false);
console.log('OK 概率/开关受控');

console.log('\n全部通过');
