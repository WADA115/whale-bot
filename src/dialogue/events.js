// 对话事件日志：每条群/私聊消息一个事件，供线程存储与回放。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const TEXT_MAX = 300;

function dayStamp(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function eventFile(dir, now = new Date()) {
  return path.join(dir, `events-${dayStamp(now)}.jsonl`);
}

export function createEventId(now = Date.now()) {
  return `evt_${now.toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
}

export function normalizeEvent(raw = {}) {
  const sender = raw.sender && typeof raw.sender === 'object' ? raw.sender : {};
  return {
    id: String(raw.id || createEventId()),
    chat: String(raw.chat ?? ''),
    sender: {
      id: String(sender.id ?? ''),
      name: String(sender.name ?? '').slice(0, 40),
      isSelf: sender.isSelf === true,
      isBot: sender.isBot === true
    },
    text: String(raw.text ?? '').slice(0, TEXT_MAX),
    at: Array.isArray(raw.at) ? raw.at.slice(0, 5).map(String) : [],
    replyTo: String(raw.replyTo ?? ''),
    media: Array.isArray(raw.media) ? raw.media.slice(0, 10).map(String) : [],
    ts: Number(raw.ts) || Date.now()
  };
}

export function appendEvent(event, { dir } = {}) {
  if (!dir) throw new Error('缺少事件目录');
  fs.mkdirSync(dir, { recursive: true });
  const e = normalizeEvent(event);
  fs.appendFileSync(eventFile(dir, new Date(e.ts)), JSON.stringify(e) + '\n', 'utf8');
  return e;
}

export function readEvents({ dir, date = new Date(), limit = 500 } = {}) {
  let raw = '';
  try { raw = fs.readFileSync(eventFile(dir, date), 'utf8'); } catch { return []; }
  const rows = raw.split(/\r?\n/).filter(Boolean).slice(-Math.max(1, limit));
  return rows.map((line) => {
    try { return normalizeEvent(JSON.parse(line)); } catch { return null; }
  }).filter(Boolean);
}
