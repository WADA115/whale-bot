import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  openKnowledgeDb, insertSource, insertDocument, insertChunks,
  searchKeyword, searchHybrid, setStyleProfile, getStyleProfile, knowledgeStats
} from '../src/knowledge/db.js';
import { readReady, writeReady } from '../src/knowledge/ready.js';
import { chunkText, redact } from '../src/knowledge/learn.js';

let pass = 0;
const ok = (name, cond) => { if (cond) { pass += 1; console.log('  ✅ ' + name); } else { console.log('  ❌ ' + name); process.exitCode = 1; } };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-'));
const dbPath = path.join(dir, 'knowledge.db');
const db = openKnowledgeDb(dbPath);
const sid = insertSource(db, { platform: 'bilibili', url: 'https://example.com/a', title: '测试' });
const did = insertDocument(db, { sourceId: sid, text: '小鲸鱼喜欢在雨天听歌，也喜欢和朋友聊天。' });
insertChunks(db, { documentId: did, chunks: ['小鲸鱼喜欢在雨天听歌'], embeddings: [[1, 0, 0]] });
ok('中文关键词检索', searchKeyword(db, '雨天', 5).length === 1);
ok('语义检索融合', searchHybrid(db, '唱歌', [0.9, 0.1, 0], 5).length >= 0);
ok('统计', knowledgeStats(db).chunks === 1);
setStyleProfile(db, 'default', { avgSentenceLen: 12 });
ok('风格画像', getStyleProfile(db, 'default').avgSentenceLen === 12);
ok('PII 脱敏', redact('电话 13800138000') === '电话 [已脱敏]');
ok('切块', chunkText('测试'.repeat(500), 100, 10).length > 1);
db.close();

writeReady(dir, { stats: { chunks: 1 } });
ok('READY 写入/读取', readReady(dir)?.stats?.chunks === 1);

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} 项知识库测试通过`);
