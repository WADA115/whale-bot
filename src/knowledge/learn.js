import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { openKnowledgeDb, insertSource, insertDocument, insertChunks, knowledgeStats, setStyleProfile } from './db.js';
import { writeReady } from './ready.js';
import { collectTopic as collectBili } from './crawl/bilibili.js';
import { collectTopic as collectTieba } from './crawl/tieba.js';
import { collectTopic as collectDeepSeek } from './crawl/deepseek.js';
import { collectRelated } from './crawl/related.js';
import { callOllamaEmbed } from '../dialogue/model.js';

const PII = /(?:1[3-9]\d{9}|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|\bsk-[A-Za-z0-9_-]{16,}\b|\bBearer\s+[A-Za-z0-9._-]{16,}|\b\d{5,12}\b)/g;

export function redact(text) {
  return String(text ?? '').replace(PII, '[已脱敏]');
}

export function chunkText(text, size = 450, overlap = 50) {
  const clean = redact(String(text ?? '').replace(/\s+/g, ' ').trim());
  if (!clean) return [];
  if (clean.length <= size) return [clean];
  const out = [];
  for (let i = 0; i < clean.length; i += Math.max(1, size - overlap)) {
    out.push(clean.slice(i, i + size));
    if (i + size >= clean.length) break;
  }
  return out;
}

function styleOf(texts) {
  const all = texts.join('\n');
  const sentences = all.split(/[。！？!?；;\n]+/).filter((s) => s.trim());
  const avg = sentences.length ? sentences.reduce((a, s) => a + s.length, 0) / sentences.length : 0;
  const emoji = (all.match(/[\u{1F300}-\u{1FAFF}]/gu) ?? []).length;
  return {
    avgSentenceLen: Math.round(avg),
    emojiRate: all.length ? +(emoji / all.length).toFixed(4) : 0,
    samples: sentences.slice(0, 30),
    updatedAt: Date.now()
  };
}

export async function runLearning({
  stateDir,
  dbPath,
  topics = ['小鲸鱼', 'QQ 机器人'],
  minutes = 90,
  maxVideos = 20,
  platforms = ['deepseek'],
  collectors = { deepseek: collectDeepSeek, bilibili: collectBili, tieba: collectTieba },
  manualDocs = [],
  relatedSeeds = [],
  incremental = true,
  embed = callOllamaEmbed,
  log = () => {}
} = {}) {
  const dir = path.join(stateDir, 'knowledge');
  fs.mkdirSync(dir, { recursive: true });
  const staging = path.join(dir, 'knowledge.staging.db');
  const active = dbPath || path.join(dir, 'knowledge.db');
  const useIncremental = incremental === true && fs.existsSync(active);
  if (!useIncremental) { try { fs.unlinkSync(staging); } catch {} }
  const db = openKnowledgeDb(useIncremental ? active : staging);
  const version = new Date().toISOString();
  db.prepare('INSERT INTO learning_runs(version,status,started_at) VALUES (?,?,?)').run(version, 'running', Date.now());
  const deadline = Date.now() + Math.max(1, minutes) * 60 * 1000;
  const docs = [];
  const errors = [];
  docs.push(...manualDocs);
  if (relatedSeeds.length) {
    try { docs.push(...await collectRelated(relatedSeeds, { maxVideos, commentsPerVideo: 1, log })); }
    catch (error) { errors.push('related:' + (error?.message ?? error)); }
  }

  for (const topic of topics) {
    for (const platform of platforms) {
      if (Date.now() >= deadline) break;
      try {
        const collector = collectors[platform];
        if (!collector) continue;
        const items = platform === 'bilibili'
          ? await collector(topic, { maxVideos, commentsPerVideo: 1, log })
          : platform === 'tieba'
            ? await collector(topic, { maxThreads: 5, log })
            : await collector(topic, { maxResults: maxVideos, log });
        docs.push(...items);
      } catch (error) {
        errors.push(`${platform}:${topic}:${error?.message ?? error}`);
        log(`[learn] ${platform} ${topic} 失败：${error?.message ?? error}`);
      }
    }
  }

  for (const doc of docs) {
    if (Date.now() >= deadline + 30 * 60 * 1000) break;
    try {
      const sourceId = insertSource(db, {
        platform: doc.platform,
        url: doc.url,
        title: doc.title,
        authorHash: crypto.createHash('sha256').update(String(doc.author ?? '')).digest('hex').slice(0, 16),
        publishedAt: doc.publishedAt ?? 0,
        robotsOk: true,
        license: 'public-page'
      });
      const documentId = insertDocument(db, { sourceId, text: doc.text, quality: Math.min(1, doc.text.length / 800) });
      if (!documentId) continue;
      const parts = chunkText(doc.text);
      let embeddings = [];
      if (embed) {
        try {
          const vectors = await embed({ model: 'bge-m3', input: parts, timeoutMs: 60000 });
          embeddings = vectors;
        } catch (error) {
          log(`[learn] embedding 失败（先存文本）：${error?.message ?? error}`);
        }
      }
      insertChunks(db, { documentId, chunks: parts, embeddings });
    } catch (error) {
      errors.push(String(error?.message ?? error));
    }
  }

  const stats = knowledgeStats(db);
  const texts = db.prepare('SELECT text FROM chunks LIMIT 5000').all().map((r) => r.text);
  setStyleProfile(db, 'default', styleOf(texts));
  const ready = stats.chunks >= 10 && errors.length < Math.max(5, docs.length);
  db.prepare('UPDATE learning_runs SET status=?, sources=?, documents=?, chunks=?, finished_at=? WHERE version=?')
    .run(ready ? 'ready' : 'insufficient', stats.sources, stats.documents, stats.chunks, Date.now(), version);
  db.close();

  if (!ready) {
    return { ok: false, reason: 'insufficient corpus', stats, errors, staging };
  }
  if (!useIncremental) fs.copyFileSync(staging, active);
  const payload = {
    version,
    corpusHash: crypto.createHash('sha256').update(active + version + stats.chunks).digest('hex').slice(0, 16),
    dbPath: active,
    stats,
    topics,
    readyAt: Date.now()
  };
  writeReady(stateDir, payload);
  log(`[learn] READY：${stats.chunks} chunks / ${stats.documents} docs`);
  return { ok: true, ...payload, errors };
}
