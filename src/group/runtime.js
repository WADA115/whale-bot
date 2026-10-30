import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
const MAX_RECENT = 40;

function blank() {
  return {
    recent: [],
    imageRefs: {},
    lastBotAt: 0,
    lastBotReplyTo: '',
    lastHumanAt: 0,
    lastHumanName: '',
    topic: ''
  };
}

function normalizeState(raw) {
  if (!raw || typeof raw !== 'object') return blank();
  return { ...blank(), ...raw, recent: Array.isArray(raw.recent) ? raw.recent.slice(-MAX_RECENT) : [] };
}

export function createGroupRuntime({ dbPath, cfg = {}, random = Math.random } = {}) {
  if (!dbPath) throw new Error('group runtime dbPath required');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA);
  const settings = cfg.groupRuntime ?? {};
  const botNames = [...new Set([
    String(cfg.role?.displayName || ''),
    ...(Array.isArray(cfg.role?.groupNameKeywords) ? cfg.role.groupNameKeywords.map(String) : []),
    '鱼鱼',
    '小鲸鱼'
  ].filter(Boolean))];
  const cooldownMs = Math.max(5000, Number(settings.botCooldownMs) || 30000);
  const ambientReply = settings.ambientReply === true;
  const ownerProbability = Math.max(0, Math.min(1, Number(settings.ownerReplyProbability ?? 0.35)));
  const directCooldownMs = Math.max(1000, Number(settings.directCooldownMs) || 5000);
  const trustedProbability = Math.max(0, Math.min(1, Number(settings.trustedReplyProbability ?? 0.5)));

  function load(groupId) {
    const row = db.prepare('SELECT version, payload FROM group_state WHERE group_id=?').get(groupId);
    return { version: Number(row?.version) || 0, state: normalizeState(row ? JSON.parse(row.payload) : null) };
  }

  function save(groupId, version, state) {
    db.prepare(`INSERT INTO group_state(group_id,version,payload,updated_at) VALUES (?,?,?,?)
      ON CONFLICT(group_id) DO UPDATE SET version=excluded.version, payload=excluded.payload, updated_at=excluded.updated_at`)
      .run(groupId, version, JSON.stringify(state), Date.now());
  }

  function nameMentioned(text) {
    const s = String(text ?? '');
    return botNames.some((name) => s.includes(`@${name}`) || s.includes(name));
  }

  function observe({ group, userId, name, text, messageId = '', media = [], direct = false, isSelf = false, isBot = false, owner = false, trusted = false } = {}) {
    const groupId = String(group ?? '');
    if (!groupId) return { decision: 'ignore', reason: 'no-group' };
    const { version, state } = load(groupId);
    const now = Date.now();
    const sender = String(name || userId || '');
    const body = String(text ?? '').trim();
    const msg = { id: String(messageId), user: String(userId ?? ''), name: sender, text: body, at: now, media: media.map((m) => m?.kind ?? m) };
    state.recent.push(msg);
    while (state.recent.length > MAX_RECENT) state.recent.shift();

    if (isSelf) {
      state.lastBotAt = now;
      state.lastBotReplyTo = String(messageId);
      save(groupId, version + 1, state);
      return { decision: 'ignore', reason: 'self', state };
    }
    if (isBot) {
      save(groupId, version + 1, state);
      return { decision: 'ignore', reason: 'other-bot', state };
    }

    const wasAfterBot = state.lastBotAt && now - state.lastBotAt < 5 * 60 * 1000;
    state.lastHumanAt = now;
    state.lastHumanName = sender;
    const explicit = direct || nameMentioned(body);
    const isQuestion = /[?？]|吗|呢|怎么|为什么|啥|什么/.test(body);
    let decision = 'ambient';
    let reason = 'ambient';
    if (explicit) {
      if (state.lastBotAt && now - state.lastBotAt < directCooldownMs) {
        decision = 'ignore'; reason = 'direct-cooldown';
      } else { decision = 'direct'; reason = 'direct'; }
    }
    else if (owner) {
      if (wasAfterBot && now - state.lastBotAt < cooldownMs) {
        decision = 'ignore';
        reason = 'owner-cooldown';
      } else {
        decision = random() < ownerProbability ? 'likely' : 'ignore';
        reason = decision === 'likely' ? 'owner-probability' : 'owner-skip';
      }
    } else if (trusted) {
      decision = random() < trustedProbability ? 'likely' : 'ignore';
      reason = decision === 'likely' ? 'trusted-probability' : 'trusted-skip';
    }
    else if (isQuestion && wasAfterBot) { decision = 'likely'; reason = 'question-after-bot'; }
    else if (ambientReply && !wasAfterBot) { decision = 'ambient'; reason = 'ambient-allowed'; }
    else if (wasAfterBot && now - state.lastBotAt < cooldownMs) { decision = 'ignore'; reason = 'bot-cooldown'; }
    else if (!ambientReply) { decision = 'ignore'; reason = 'not-addressed'; }

    save(groupId, version + 1, state);
    return {
      decision, reason, state, version: version + 1,
      target: sender,
      targetUserId: String(userId ?? ''),
      replyToMessageId: messageId ? String(messageId) : ''
    };
  }

  function rememberImage(group, { messageId, desc, user = '', at = Date.now() } = {}) {
    const groupId = String(group ?? '');
    if (!groupId || !desc) return;
    const { version, state } = load(groupId);
    state.imageRefs[String(messageId)] = { desc: String(desc).slice(0, 1200), user: String(user), at };
    const keys = Object.keys(state.imageRefs);
    while (keys.length > 30) delete state.imageRefs[keys.shift()];
    save(groupId, version + 1, state);
  }

  function lastImage(group, ttlMs = 30 * 60 * 1000) {
    const groupId = String(group ?? '');
    const { state } = load(groupId);
    const items = Object.values(state.imageRefs).filter((x) => Date.now() - x.at < ttlMs);
    return items.sort((a, b) => b.at - a.at)[0] ?? null;
  }

  function recordBotReply(group, { messageId = '', at = Date.now() } = {}) {
    const groupId = String(group ?? '');
    if (!groupId) return;
    const { version, state } = load(groupId);
    state.lastBotAt = at;
    state.lastBotReplyTo = String(messageId);
    save(groupId, version + 1, state);
  }

  function get(group) {
    const { version, state } = load(String(group ?? ''));
    return { version, state };
  }

  function close() { try { db.close(); } catch {} }
  return { observe, rememberImage, lastImage, recordBotReply, get, close };
}
