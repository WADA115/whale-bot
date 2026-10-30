import fs from 'node:fs';
import { openKnowledgeDb, searchHybrid, searchKeyword, getStyleProfile } from './db.js';

export function createKnowledgeQuery({ dbPath, embed = null, log = () => {} } = {}) {
  let db = null;
  function open() {
    if (db) return db;
    if (!dbPath || !fs.existsSync(dbPath)) return null;
    db = openKnowledgeDb(dbPath);
    return db;
  }
  async function search(query, { limit = 6 } = {}) {
    const conn = open();
    if (!conn) return { lines: [], evidence: [], style: null };
    let vec = null;
    if (typeof embed === 'function') {
      try { vec = await embed(String(query ?? '')); } catch (error) { log('[knowledge] embedding 失败：' + (error?.message ?? error)); }
    }
    const hits = searchHybrid(conn, query, vec, limit);
    const rows = hits.length ? hits : searchKeyword(conn, query, limit);
    const lines = rows.map((r, i) => `[知识${i + 1}] ${String(r.text ?? '').slice(0, 240)}`);
    const evidence = rows.map((r) => `doc:${r.document_id}#chunk:${r.id} ${String(r.text ?? '').slice(0, 300)}`);
    return { lines, evidence, style: getStyleProfile(conn, 'default') };
  }
  function close() { try { db?.close(); } catch {} db = null; }
  return { search, close };
}
