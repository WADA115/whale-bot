import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runLearning } from '../src/knowledge/learn.js';
import { collectTopic as collectBili } from '../src/knowledge/crawl/bilibili.js';
import { collectIndexed as collectTiebaIndex } from '../src/knowledge/crawl/tieba.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const stateDir = path.join(root, 'state');
const dbPath = path.join(stateDir, 'knowledge', 'knowledge.db');
const log = (line) => console.log(line);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const BAD = /色情|成人视频|裸聊|约炮|赌博|毒品|制毒|自杀|自残|血腥|肢解|虐杀|未成年/;
const BILI = [
  ['梗', '网络热梗'],
  ['梗', '抽象梗'],
  ['游戏', '游戏梗'],
  ['游戏', '游戏名场面'],
  ['地狱笑话', '地狱笑话'],
  ['猎奇', '猎奇视频'],
  ['猎奇', '怪谈']
];
const TIEBA = [['梗', '网络热梗'], ['游戏', '游戏'], ['地狱笑话', '地狱笑话'], ['猎奇', '猎奇']];

const docs = [];
for (const [category, query] of BILI) {
  try {
    const items = await collectBili(query, { maxVideos: 4, commentsPerVideo: 1, log });
    for (const item of items) {
      const text = String(item.text ?? '');
      if (text.length < 40 || BAD.test(text)) continue;
      docs.push({ ...item, title: `[${category}] ${item.title}`, text: `分类：${category}\n${text}` });
    }
    log(`[fun] B站 ${query}: ${items.length}`);
  } catch (error) {
    log(`[fun] B站 ${query} 失败：${error?.message ?? error}`);
  }
  await sleep(1200);
}
for (const [category, query] of TIEBA) {
  try {
    const items = await collectTiebaIndex(query, { maxThreads: 5, log });
    for (const item of items) {
      if (BAD.test(item.text)) continue;
      docs.push({ ...item, title: `[${category}] ${item.title}`, text: `分类：${category}\n${item.text}` });
    }
    log(`[fun] 贴吧索引 ${query}: ${items.length}`);
  } catch (error) {
    log(`[fun] 贴吧 ${query} 失败：${error?.message ?? error}`);
  }
  await sleep(1500);
}
const unique = [];
const seen = new Set();
for (const doc of docs) {
  if (!doc.url || seen.has(doc.url)) continue;
  seen.add(doc.url);
  unique.push(doc);
}
log(`[fun] 待入库 ${unique.length} 条`);
if (!unique.length) {
  console.log('[fun] 没有可入库内容');
  process.exit(1);
}
const result = await runLearning({
  stateDir,
  dbPath,
  topics: ['梗', '游戏', '地狱笑话', '猎奇'],
  minutes: 10,
  platforms: [],
  manualDocs: unique,
  log
});
console.log(JSON.stringify(result, null, 2));
fs.writeFileSync(path.join(stateDir, 'knowledge', 'fun-last.json'), JSON.stringify({ at: Date.now(), docs: unique.length, result }, null, 2));
process.exit(result.ok ? 0 : 1);
