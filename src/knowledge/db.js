import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

export function openKnowledgeDb(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  return db;
}

export function hashText(text) {
  return crypto.createHash('sha256').update(String(text ?? '')).digest('hex');
}

export function insertSource(db, { platform, url, title = '', authorHash = '', publishedAt = 0, robotsOk = false, license = '' }) {
  const now = Date.now();
  const stmt = db.prepare(`INSERT OR IGNORE INTO sources
    (platform, url, title, author_hash, published_at, fetched_at, robots_ok, license)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  stmt.run(platform, url, title, authorHash, publishedAt, now, robotsOk ? 1 : 0, license);
  return db.prepare('SELECT id FROM sources WHERE platform=? AND url=?').get(platform, url)?.id ?? null;
}

export function insertDocument(db, { sourceId, text, lang = 'zh', quality = 0 }) {
  const body = String(text ?? '').trim();
  if (!body) return null;
  const h = hashText(body);
  const existing = db.prepare('SELECT id FROM documents WHERE content_hash=?').get(h);
  if (existing) return null; // 已存在：增量学习跳过，避免重复 chunk/embedding
  const stmt = db.prepare(`INSERT INTO documents
    (source_id, lang, text, content_hash, quality_score, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`);
  stmt.run(sourceId, lang, body, h, quality, Date.now());
  return db.prepare('SELECT last_insert_rowid() AS id').get().id;
}

export function insertChunks(db, { documentId, chunks, embeddings = [] }) {
  const stmt = db.prepare(`INSERT INTO chunks
    (document_id, ord, text, token_count, embedding, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`);
  let n = 0;
  for (let i = 0; i < chunks.length; i += 1) {
    const text = String(chunks[i] ?? '').trim();
    if (!text) continue;
    const vec = embeddings[i];
    const blob = Array.isArray(vec) && vec.length
      ? Buffer.from(new Float32Array(vec).buffer)
      : null;
    stmt.run(documentId, i, text, text.length, blob, Date.now());
    n += 1;
  }
  return n;
}

function decodeEmbedding(blob) {
  if (!blob) return null;
  const buf = Buffer.from(blob);
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0; let na = 0; let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export function searchKeyword(db, query, limit = 20) {
  const q = String(query ?? '').trim();
  if (!q) return [];
  const safe = q.replace(/["']/g, ' ').split(/\s+/).filter(Boolean).slice(0, 6).map((w) => `"${w}"`).join(' OR ');
  try {
    const hits = db.prepare(`SELECT c.id, c.text, c.document_id, d.text AS doc_text, d.id AS doc_id
      FROM chunks_fts f JOIN chunks c ON c.id=f.rowid JOIN documents d ON d.id=c.document_id
      WHERE chunks_fts MATCH ? LIMIT ?`).all(safe, limit);
    if (hits.length) return hits;
  } catch {}
  try {
    return db.prepare(`SELECT c.id, c.text, c.document_id, d.text AS doc_text, d.id AS doc_id
      FROM chunks c JOIN documents d ON d.id=c.document_id
      WHERE c.text LIKE ? LIMIT ?`).all(`%${q}%`, limit);
  } catch {
    return [];
  }
}

export function searchSemantic(db, queryEmbedding, limit = 20) {
  if (!Array.isArray(queryEmbedding) || !queryEmbedding.length) return [];
  const rows = db.prepare('SELECT id, text, document_id, embedding FROM chunks WHERE embedding IS NOT NULL LIMIT 20000').all();
  const scored = [];
  for (const row of rows) {
    const vec = decodeEmbedding(row.embedding);
    const score = cosine(queryEmbedding, vec);
    if (score > 0.25) scored.push({ id: row.id, text: row.text, document_id: row.document_id, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function searchHybrid(db, query, queryEmbedding, limit = 6) {
  const k = searchKeyword(db, query, 20);
  const v = searchSemantic(db, queryEmbedding, 20);
  const scores = new Map();
  k.forEach((row, i) => scores.set(row.id, { row, score: 1 / (60 + i + 1) }));
  v.forEach((row, i) => {
    const prev = scores.get(row.id);
    const add = 1 / (60 + i + 1);
    if (prev) prev.score += add;
    else scores.set(row.id, { row, score: add });
  });
  return [...scores.values()].sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.row);
}

export function upsertSlang(db, term, meaning, evidence = '', confidence = 0.5) {
  db.prepare(`INSERT INTO slang(term, meaning, evidence, confidence, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(term) DO UPDATE SET meaning=excluded.meaning, evidence=excluded.evidence,
    confidence=excluded.confidence, updated_at=excluded.updated_at`)
    .run(String(term), String(meaning), String(evidence), Number(confidence) || 0, Date.now());
}

export function setStyleProfile(db, scope, payload) {
  db.prepare(`INSERT INTO style_profiles(scope, payload, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(scope) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at`)
    .run(scope, JSON.stringify(payload), Date.now());
}

export function getStyleProfile(db, scope = 'default') {
  const row = db.prepare('SELECT payload FROM style_profiles WHERE scope=?').get(scope);
  try { return row ? JSON.parse(row.payload) : null; } catch { return null; }
}

export function knowledgeStats(db) {
  const one = (sql) => db.prepare(sql).get()?.n ?? 0;
  return {
    sources: one('SELECT COUNT(*) AS n FROM sources'),
    documents: one('SELECT COUNT(*) AS n FROM documents'),
    chunks: one('SELECT COUNT(*) AS n FROM chunks'),
    embedded: one('SELECT COUNT(*) AS n FROM chunks WHERE embedding IS NOT NULL'),
    slang: one('SELECT COUNT(*) AS n FROM slang')
  };
}
