// 线程存储：按 chat 维护最近事件、参与者、开放问题（内存派生，事件落盘）。
import { readEvents } from './events.js';

const MAX_EVENTS = 60;

function looksLikeQuestion(text) {
  const s = String(text ?? '').trim();
  return /[?？]\s*$/.test(s) || /(吗|呢|怎么|为什么|哪|谁|多少|是不是|能不能|行不行)[?？]?\s*$/.test(s);
}

export function createThreadStore({ dir, loadDays = 2 } = {}) {
  const threads = new Map();

  function thread(chat) {
    if (!threads.has(chat)) threads.set(chat, { chat, events: [], openQuestions: [], counters: { human: 0, self: 0, bot: 0 } });
    return threads.get(chat);
  }

  function observe(raw) {
    if (!raw || !raw.chat) return;
    const t = thread(raw.chat);
    t.events.push(raw);
    while (t.events.length > MAX_EVENTS) t.events.shift();

    if (raw.sender?.isSelf) {
      t.counters.self += 1;
      t.openQuestions = [];
    } else if (raw.sender?.isBot) {
      t.counters.bot += 1;
      t.openQuestions = [];
    } else {
      t.counters.human += 1;
      if (looksLikeQuestion(raw.text)) {
        t.openQuestions.push({ id: raw.id, from: raw.sender?.name ?? '', text: raw.text, ts: raw.ts });
        while (t.openQuestions.length > 5) t.openQuestions.shift();
      }
    }
    return t;
  }

  function snapshot(chat, { limit = 30 } = {}) {
    const t = thread(chat);
    const events = t.events.slice(-Math.max(1, limit));
    const lastSelf = [...events].reverse().find((e) => e.sender?.isSelf) ?? null;
    const lastHuman = [...events].reverse().find((e) => !e.sender?.isSelf && !e.sender?.isBot) ?? null;
    return {
      chat,
      events,
      lastSelf,
      lastHuman,
      openQuestions: t.openQuestions.slice(-5),
      counters: { ...t.counters }
    };
  }

  function loadRecent(now = new Date()) {
    for (let i = 0; i < Math.max(0, loadDays); i += 1) {
      const d = new Date(now.getTime() - i * 86400000);
      for (const e of readEvents({ dir, date: d, limit: 500 })) observe(e);
    }
  }

  return { observe, snapshot, loadRecent, size: () => threads.size };
}
