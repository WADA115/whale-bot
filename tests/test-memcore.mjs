// 记忆内核单测：分层、晋升、淘汰、合并、摘要、注入块、迁移、去重。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createMemoryCore, similarity } from '../src/memory-core.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memcore-'));
const file = path.join(dir, 'memory.json');
const mem = createMemoryCore({ file, log: () => {} });

// 1. 分层写入
mem.addSetting('你是小鲸鱼，傲娇嘴硬但心软');
mem.addFact('主人叫 阿明', { tier: 'long', weight: 2 });
mem.addFact('今天中午吃了拉面', { tier: 'short' });
const st = mem.stats();
assert.equal(st.settings, 1, '设定应写入长期');
assert.equal(st.longFacts, 1, '长期事实 1 条');
assert.equal(st.shortFacts, 1, '短期事实 1 条');
console.log('OK 分层 →', JSON.stringify(st));

// 2. 注入块：设定始终出现，短期按相关性
const blocks = mem.buildPromptBlocks('今天吃什么了', { key: 'private:1' });
assert.ok(blocks.always.includes('小鲸鱼'), '始终块应含设定');
assert.ok(blocks.relevant.includes('拉面'), '相关块应命中短期记忆');
console.log('OK 注入 → always', blocks.always.length, '字 / relevant', blocks.relevant.length, '字');

// 3. 无关查询不瞎贴
const blocks2 = mem.buildPromptBlocks('量子力学是什么', { key: 'private:1' });
assert.ok(!blocks2.relevant.includes('拉面'), '无关查询不该命中拉面');
console.log('OK 无关不贴');

// 4. 晋升：命中 2 次自动升长期
mem.search('拉面', { limit: 3 });
mem.search('拉面', { limit: 3 });
const promoted = mem.autoPromote({ minAccess: 2 });
assert.equal(promoted.length, 1, '应晋升 1 条');
assert.ok(mem.list().long.some((f) => f.text.includes('拉面')), '长期层应包含拉面');
console.log('OK 晋升 →', promoted[0].text, '| 现在', JSON.stringify(mem.stats()));

// 5. 合并：跨层也能合
mem.addFact('主人叫 阿明，是个程序员', { tier: 'short' });
const target = mem.list().long.find((f) => f.text.includes('阿明'));
const cand = mem.similarFacts('主人叫 阿明，是个程序员', { minSimilarity: 0.3 });
assert.ok(cand.length >= 1, '应找到相似项');
const keepId = cand[0].fact.id;
const dropIds = cand.slice(1).map((c) => c.fact.id);
const merged = mem.mergeFacts(keepId, dropIds, '主人叫 阿明，是个程序员');
assert.ok(merged, '合并应成功');
console.log('OK 合并 → 删', merged.removed, '条，留', merged.tier);

// 6. 摘要
mem.setSummary('private:1', '早上聊了机器人记忆模块的重构，决定分长期/短期两层。', { turns: 12 });
const sum = mem.getSummary('private:1');
assert.ok(sum.text.includes('长期'), '摘要应保存');
const blocks3 = mem.buildPromptBlocks('继续', { key: 'private:1' });
assert.ok(blocks3.relevant.includes('之前聊过'), '注入块应带摘要');
console.log('OK 摘要 →', sum.text.length, '字');

// 7. 短期淘汰：老且低分的删，重要留下
const now = Date.now();
const snap = mem.snapshot();
// 人为把一条短期记忆改成 10 天前、访问 0
const core2 = createMemoryCore({ file: path.join(dir, 'memory2.json'), log: () => {} });
core2.addFact('十天前的杂事', { tier: 'short' });
core2.addFact('重要约定', { tier: 'short', weight: 3 });
core2.flush(); // 落盘是 debounce 的，这里手动刷一次再改文件
const raw = JSON.parse(fs.readFileSync(path.join(dir, 'memory2.json'), 'utf8'));
for (const f of raw.short.facts) {
  f.ts = now - 10 * 86400000;
  if (f.text.includes('杂事')) { f.weight = 1; f.accessCount = 0; }
}
fs.writeFileSync(path.join(dir, 'memory2.json'), JSON.stringify(raw), 'utf8');
const core3 = createMemoryCore({ file: path.join(dir, 'memory2.json'), log: () => {} });
const pruned = core3.pruneShortTerm({ ttlMs: 3 * 86400000 });
assert.equal(pruned.facts, 1, `应淘汰 1 条，实际 ${pruned.facts}`);
assert.ok(core3.list().short.some((f) => f.text.includes('重要约定')), '重要的老记忆应保留');
console.log('OK 淘汰 →', JSON.stringify(pruned));

// 8. 旧格式迁移
const legacy = path.join(dir, 'legacy.json');
fs.writeFileSync(legacy, JSON.stringify({ facts: [{ text: '旧记忆A' }, { text: '旧记忆B' }], keywords: [{ word: '难绷', meaning: '绷不住了' }] }), 'utf8');
const migrated = createMemoryCore({ file: legacy, log: () => {} });
assert.equal(migrated.stats().shortFacts, 2, '旧事实应迁到短期层');
assert.equal(migrated.stats().shortKeywords + migrated.stats().longKeywords, 1, '旧关键词应迁移');
console.log('OK 迁移 →', JSON.stringify(migrated.stats()));

// 9. 相似度
assert.ok(similarity('主人叫 阿明', '主人叫 阿明，是程序员') > 0.6, '近义应高分');
assert.ok(similarity('主人叫 阿明', '今天天气不错') < 0.2, '无关应低分');
console.log('OK 相似度');

fs.rmSync(dir, { recursive: true, force: true });
console.log('\n全部通过');
