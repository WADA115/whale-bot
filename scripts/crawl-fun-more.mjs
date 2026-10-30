import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runLearning } from '../src/knowledge/learn.js';
import { searchVideos, videoDetail, videoComments } from '../src/knowledge/crawl/bilibili.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const stateDir = path.join(root, 'state');
const dbPath = path.join(stateDir, 'knowledge', 'knowledge.db');
const log = (line) => console.log(line);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const BAD = /色情|成人视频|裸聊|约炮|赌博|毒品|制毒|自杀|自残|血腥|肢解|虐杀|未成年/;
const queries = [
  ['梗', '抽象梗'],
  ['游戏', '游戏名场面'],
  ['猎奇', '猎奇视频'],
  ['猎奇', '怪谈']
];
const docs = [];
for (const [category, query] of queries) {
  let videos = [];
  for (let attempt = 1; attempt <= 3 && !videos.length; attempt += 1) {
    try {
      videos = await searchVideos(query, { log });
    } catch (error) {
      log(`[more] ${query} 第 ${attempt} 次失败：${error?.message ?? error}`);
      if (attempt < 3) await sleep(3000 * attempt);
    }
  }
  if (!videos.length) {
    log(`[more] ${query} 仍不可用，跳过`);
    continue;
  }
  for (const v of videos.slice(0, 4)) {
    try {
      const detail = await videoDetail(v.bvid, { log });
      const parts = [detail.title, detail.description].filter(Boolean);
      try { parts.push(...(await videoComments(detail.aid, { log })).slice(0, 10)); } catch {}
      const text = parts.join('\n').trim();
      if (text.length < 40 || BAD.test(text)) continue;
      docs.push({ ...detail, platform: 'bilibili', author: v.author, title: `[${category}] ${detail.title}`, text: `分类：${category}\n${text}` });
    } catch (error) {
      log(`[more] 详情失败 ${v.bvid}：${error?.message ?? error}`);
    }
  }
  log(`[more] ${query}: ${docs.length}`);
  await sleep(2200);
}
const unique = [];
const seen = new Set();
for (const doc of docs) {
  if (!doc.url || seen.has(doc.url)) continue;
  seen.add(doc.url);
  unique.push(doc);
}
log(`[more] 待入库 ${unique.length} 条`);
if (!unique.length) process.exit(1);
const result = await runLearning({ stateDir, dbPath, topics: ['梗', '游戏', '猎奇'], minutes: 8, platforms: [], manualDocs: unique, log });
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
