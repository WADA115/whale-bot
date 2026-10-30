import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = fs.readFileSync(new URL('./ledger-schema.sql', import.meta.url), 'utf8');
const MAX_PAYLOAD = 4000;

function payloadText(value) {
  try { return JSON.stringify(value ?? null).slice(0, MAX_PAYLOAD); } catch { return 'null'; }
}

export function createTurnLedger({ dbPath } = {}) {
  if (!dbPath) throw new Error('ledger dbPath required');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA);

  function append(turnId, stage, payload) {
    const seq = (db.prepare('SELECT COALESCE(MAX(seq),0)+1 AS n FROM turn_events WHERE turn_id=?').get(turnId)?.n) ?? 1;
    db.prepare('INSERT INTO turn_events(turn_id,seq,stage,payload,ts) VALUES (?,?,?,?,?)')
      .run(turnId, seq, String(stage), payloadText(payload), Date.now());
    return seq;
  }

  function begin(chat, input = {}) {
    const key = String(chat ?? '').trim();
    if (!key) throw new Error('chat required');
    db.exec('BEGIN IMMEDIATE');
    try {
      const row = db.prepare('SELECT version FROM chat_state WHERE chat=?').get(key);
      const version = (Number(row?.version) || 0) + 1;
      db.prepare(`INSERT INTO chat_state(chat,version,updated_at) VALUES (?,?,?)
        ON CONFLICT(chat) DO UPDATE SET version=excluded.version, updated_at=excluded.updated_at`)
        .run(key, version, Date.now());
      const turnId = crypto.randomUUID();
      append(turnId, 'received', { ...input, chat: key, version });
      db.exec('COMMIT');
      return { id: turnId, turnId, chat: key, version, startedAt: Date.now() };
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      throw error;
    }
  }

  function stage(turnId, stageName, payload = {}) {
    if (!turnId) return false;
    append(turnId, stageName, payload);
    return true;
  }

  function commit(turnId, { action = 'reply', messages = [], evidence = [], standards = null, outcome = 'sent' } = {}) {
    if (!turnId) return { ok: false, error: 'no-turn' };
    db.exec('BEGIN IMMEDIATE');
    try {
      const existing = db.prepare('SELECT * FROM turns WHERE turn_id=?').get(turnId);
      if (existing) { db.exec('COMMIT'); return { ok: false, error: 'already-committed' }; }
      const events = db.prepare('SELECT stage,payload FROM turn_events WHERE turn_id=? ORDER BY seq').all(turnId);
      if (!events.length) { db.exec('ROLLBACK'); return { ok: false, error: 'no-events' }; }
      let received = {};
      try { received = JSON.parse(events[0].payload); } catch {}
      const chat = String(received.chat ?? '');
      const version = Number(received.version) || 0;
      const current = chat ? db.prepare('SELECT version FROM chat_state WHERE chat=?').get(chat)?.version : null;
      if (chat && Number(current) !== version) {
        append(turnId, 'stale', { declared: version, current });
        db.exec('COMMIT');
        return { ok: false, error: 'stale-turn' };
      }
      db.prepare(`INSERT INTO turns(turn_id,chat,version,action,messages,evidence,standards,outcome,created_at)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(
        turnId, chat || 'unknown', version || 1,
        String(action), payloadText(messages), payloadText(evidence), payloadText(standards), String(outcome), Date.now()
      );
      append(turnId, 'committed', { action, messages, evidence, standards, outcome });
      db.exec('COMMIT');
      return { ok: true };
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      return { ok: false, error: String(error?.message ?? error) };
    }
  }

  function updateOutcome(turnId, outcome) {
    if (!turnId) return false;
    try {
      db.prepare('UPDATE turns SET outcome=? WHERE turn_id=?').run(String(outcome), turnId);
      append(turnId, 'outcome', { outcome: String(outcome) });
      return true;
    } catch { return false; }
  }

  function applyNotes(turnId, patch) {
    if (!turnId || !patch) return false;
    append(turnId, 'state_patch', patch);
    return true;
  }

  function fail(turnId, error) {
    if (!turnId) return;
    append(turnId, 'failed', { error: String(error?.message ?? error).slice(0, 500) });
  }

  function get(turnId) {
    const turn = db.prepare('SELECT * FROM turns WHERE turn_id=?').get(turnId);
    const events = db.prepare('SELECT seq,stage,payload,ts FROM turn_events WHERE turn_id=? ORDER BY seq').all(turnId);
    return { turn, events };
  }

  function recent(chat, limit = 20) {
    return db.prepare('SELECT * FROM turns WHERE chat=? ORDER BY created_at DESC LIMIT ?').all(chat, limit);
  }

  function applyNotes(chat, patch = {}) {
    if (!chat || !patch || typeof patch !== 'object') return false;
    const now = Date.now();
    const stmt = db.prepare(`INSERT INTO chat_notes(chat,key,value,updated_at) VALUES (?,?,?,?)
      ON CONFLICT(chat,key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`);
    for (const key of ['tone', 'open_questions', 'memory_candidates']) {
      if (patch[key] == null) continue;
      const value = JSON.stringify(patch[key]).slice(0, 2000);
      stmt.run(chat, key, value, now);
    }
    return true;
  }

  function getNotes(chat) {
    const rows = db.prepare('SELECT key,value,updated_at FROM chat_notes WHERE chat=?').all(chat);
    const out = {};
    for (const row of rows) {
      if (Date.now() - Number(row.updated_at) > 7 * 24 * 3600 * 1000) continue;
      try { out[row.key] = JSON.parse(row.value); } catch {}
    }
    return out;
  }
  function updateOutcome(turnId, outcome) {
    if (!turnId) return false;
    try {
      db.prepare('UPDATE turns SET outcome=? WHERE turn_id=?').run(String(outcome), turnId);
      append(turnId, 'outcome', { outcome: String(outcome) });
      return true;
    } catch { return false; }
  }

  function close() { try { db.close(); } catch {} }
  return { begin, stage, commit, fail, get, recent, applyNotes, getNotes, updateOutcome, close };
}
