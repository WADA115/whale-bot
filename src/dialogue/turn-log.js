// 对话回合日志：每次“是否接/怎么接”都落一行 JSONL，供回放与评测。
import fs from 'node:fs';
import path from 'node:path';

const TEXT_MAX = 240;

function dayStamp(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function turnLogFile(dir, now = new Date()) {
  return path.join(dir, `turns-${dayStamp(now)}.jsonl`);
}

export function appendTurnLog(entry, { dir, now = new Date() } = {}) {
  if (!dir) throw new Error('缺少日志目录');
  fs.mkdirSync(dir, { recursive: true });
  const record = {
    ts: Date.now(),
    turnId: String(entry.turnId ?? ''),
    chat: String(entry.chat ?? ''),
    trigger: String(entry.trigger ?? ''),
    sender: String(entry.sender ?? '').slice(0, 40),
    text: String(entry.text ?? '').slice(0, TEXT_MAX),
    at: Array.isArray(entry.at) ? entry.at.slice(0, 3).map(String) : [],
    gate: entry.gate && typeof entry.gate === 'object'
      ? {
        addressed: entry.gate.addressed === true,
        reason: String(entry.gate.reason ?? '').slice(0, 40),
        latencyMs: Math.max(0, Number(entry.gate.latencyMs) || 0)
      }
      : null,
    action: String(entry.action ?? ''),
    contract: entry.contract && typeof entry.contract === 'object'
      ? {
        action: String(entry.contract.action ?? ''),
        interject: entry.contract.interject === true,
        replyTo: String(entry.contract.replyTo ?? ''),
        reason: String(entry.contract.reason ?? '').slice(0, 80)
      }
      : null,
    shadow: entry.shadow && typeof entry.shadow === 'object'
      ? {
        candidate: entry.shadow.candidate === true,
        reason: String(entry.shadow.reason ?? '').slice(0, 40),
        source: String(entry.shadow.source ?? '').slice(0, 20)
      }
      : null,
    thought: entry.thought && typeof entry.thought === 'object'
      ? {
        shouldReply: entry.thought.shouldReply === true,
        target: String(entry.thought.target ?? '').slice(0, 40),
        intent: String(entry.thought.intent ?? '').slice(0, 30),
        keyPoints: Array.isArray(entry.thought.keyPoints) ? entry.thought.keyPoints.slice(0, 4).map(String).map((x) => x.slice(0, 120)) : [],
        constraints: Array.isArray(entry.thought.constraints) ? entry.thought.constraints.slice(0, 4).map(String).map((x) => x.slice(0, 80)) : [],
        confidence: Math.max(0, Math.min(1, Number(entry.thought.confidence) || 0))
      }
      : null,
    spoken: entry.spoken && typeof entry.spoken === 'object'
      ? {
        messages: Array.isArray(entry.spoken.messages) ? entry.spoken.messages.slice(0, 5).map(String).map((x) => x.slice(0, 160)) : [],
        replyTo: String(entry.spoken.replyTo ?? ''),
        delayMs: Array.isArray(entry.spoken.delayMs) ? entry.spoken.delayMs.slice(0, 5).map((n) => Math.max(0, Number(n) || 0)) : []
      }
      : null,
    prediction: entry.prediction && typeof entry.prediction === 'object'
      ? {
        needThink: entry.prediction.needThink === true,
        difficulty: String(entry.prediction.difficulty ?? '').slice(0, 20),
        intent: String(entry.prediction.intent ?? '').slice(0, 30),
        confidence: Math.max(0, Math.min(1, Number(entry.prediction.confidence) || 0)),
        route: String(entry.prediction.route ?? '').slice(0, 10)
      }
      : null,
    reason: String(entry.reason ?? '').slice(0, 80)
  };
  fs.appendFileSync(turnLogFile(dir, now), JSON.stringify(record) + '\n', 'utf8');
  return record;
}

export function readTurnLogs({ dir, date = new Date(), limit = 200 } = {}) {
  const file = turnLogFile(dir, date);
  let raw = '';
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return []; }
  return raw.split(/\r?\n/).filter(Boolean).slice(-Math.max(1, limit)).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}
