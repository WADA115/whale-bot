import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runLearning } from '../src/knowledge/learn.js';
import { readReady } from '../src/knowledge/ready.js';
import { openKnowledgeDb, knowledgeStats } from '../src/knowledge/db.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-'));
const long = (tag) => `${tag} `.repeat(400);
const fake = async () => [1, 2, 3, 4].map((i) => ({
  platform: 'bilibili', url: `https://example.com/${i}`, title: `测试${i}`,
  author: 'tester', publishedAt: 0, text: long(`小鲸鱼知识${i}`)
}));
const result = await runLearning({
  stateDir: dir,
  topics: ['测试'],
  minutes: 1,
  platforms: ['bilibili'],
  collectors: { bilibili: fake },
  embed: null,
  log: () => {}
});
if (!result.ok) throw new Error('learning failed ' + JSON.stringify(result));
const ready = readReady(dir);
if (!ready || ready.stats.chunks < 10) throw new Error('READY/chunks wrong');
const db = openKnowledgeDb(ready.dbPath);
const stats = knowledgeStats(db);
db.close();
if (stats.chunks < 10) throw new Error('db chunks wrong');
console.log('  ✅ 学习舱 fake 采集 → READY', stats);
const before = stats.chunks;
const again = await runLearning({ stateDir: dir, topics: ['测试'], minutes: 1, platforms: ['bilibili'], collectors: { bilibili: fake }, embed: null, log: () => {} });
if (!again.ok || again.stats.chunks !== before) throw new Error('incremental duplicate: ' + JSON.stringify(again.stats));
console.log('  ✅ 增量不重复', again.stats);
fs.rmSync(dir, { recursive: true, force: true });
console.log('\n1 项学习舱测试通过');
