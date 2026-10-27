// 语境引擎：让机器人"看懂"当前在聊什么、谁在跟谁说话、之前说过什么。
//
// 它解决的问题（都是实测踩过的）：
//   1. 只说一句话时，模型不知道上文 —— 之前只把"触发了回复的那条"投给会话；
//   2. 群里多人交错发言，模型分不清谁在跟谁说话；
//   3. 话题会漂移，聊十分钟后模型还在回答开头的问题；
//   4. 没有"没说完的话"的概念 —— 别人问了一句没回答，下一轮就丢了。
//
// 数据模型（每个会话一份）：
//   turns:     最近的发言（谁、说什么、几点、是否对机器人说的）
//   topic:     当前话题摘要（每 N 条用便宜模型压缩一次）
//   pending:   悬而未决的问题/请求（被问到但还没回应的）
//   participants: 发言人 → 发言次数/最后发言时间（判断"是不是只有两个人在聊"）
//
// 输出：一段紧凑的"情境块"，贴在 prompt 前面，通常 300~600 字。
import fs from 'node:fs';
import path from 'node:path';

const MAX_TURNS = 60;

/** 文本归一化后是否等价（去空白/标点差异，用于判重）。 */
function normEq(a, b) {
  const n = (s) => String(s ?? '').replace(/[\s\p{P}]/gu, '').toLowerCase();
  return n(a) === n(b);
}

export function createContextEngine({ file, log = () => {} } = {}) {
  let data = { version: 1, convs: {} };
  let dirty = false;
  let saveTimer = null;

  function load() {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (raw && typeof raw === 'object' && raw.convs) data = raw;
    } catch (error) {
      if (error?.code !== 'ENOENT') log(`[ctx] 读取失败（按空状态处理）：${error?.message ?? error}`);
    }
  }

  function scheduleSave() {
    dirty = true;
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      flush();
    }, 1000);
    if (typeof saveTimer.unref === 'function') saveTimer.unref();
  }

  function flush() {
    if (!dirty) return;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(tmp, file);
      dirty = false;
    } catch (error) {
      log(`[ctx] 保存失败：${error?.message ?? error}`);
    }
  }

  function conv(key) {
    const k = String(key);
    if (!data.convs[k]) {
      data.convs[k] = {
        key: k,
        turns: [],
        topic: '',
        topicAt: 0,
        pending: [],
        participants: {},
        createdAt: Date.now(),
      };
    }
    return data.convs[k];
  }

  /** 记一条发言。addressed=true 表示这条是对机器人说的（被 @/点名/判断为是）。 */
  function observe(key, { sender, text, addressed = false, at = Date.now(), kind = 'text' }) {
    const c = conv(key);
    const body = String(text ?? '').trim();
    if (!body) return;
    const who = String(sender || '群友').slice(0, 24);
    // 重复发言合并：同一个人 5 分钟内又发了同样的话，只记一次并计数，
    // 这样刷屏（"在吗"×10）不会把上下文撑爆，也不会让模型以为有很多信息。
    const last = c.turns[c.turns.length - 1];
    if (last && last.sender === who && !addressed && normEq(last.text, body) && at - last.at < 5 * 60 * 1000) {
      last.repeat = (last.repeat ?? 1) + 1;
      last.at = at;
      scheduleSave();
      return;
    }
    c.turns.push({ sender: who, text: body.slice(0, 300), addressed: !!addressed, at, kind });
    while (c.turns.length > MAX_TURNS) c.turns.shift();
    const p = c.participants[who] || { count: 0, lastAt: 0 };
    p.count += 1;
    p.lastAt = at;
    c.participants[who] = p;
    // 问句且不是对机器人说的 → 记成"待回应"
    if (/[?？]\s*$/.test(body) && !addressed) {
      c.pending.push({ sender: who, text: body.slice(0, 120), at });
      while (c.pending.length > 6) c.pending.shift();
    }
    scheduleSave();
  }

  /** 历史数据里的连续重复也可以压掉（只压"同一人 + 相同文本 + 5 分钟内"）。 */
  function dedupeTurns(key, { windowMs = 5 * 60 * 1000 } = {}) {
    const c = conv(key);
    const out = [];
    let merged = 0;
    for (const t of c.turns) {
      const prev = out[out.length - 1];
      if (prev && prev.sender === t.sender && normEq(prev.text, t.text) && t.at - prev.at < windowMs) {
        prev.repeat = (prev.repeat ?? 1) + 1;
        prev.at = t.at;
        merged += 1;
        continue;
      }
      out.push({ ...t });
    }
    if (merged) {
      c.turns = out;
      scheduleSave();
      log(`[ctx] 折叠 ${key} 的 ${merged} 条重复发言`);
    }
    return merged;
  }

  /** 机器人回应后，清掉与这句相关的待回应。 */
  function markAnswered(key, { sender, text } = {}) {
    const c = conv(key);
    if (!c.pending.length) return;
    const t = String(text ?? '').trim();
    c.pending = c.pending.filter((p) => {
      if (sender && p.sender === sender) return false;
      if (t && p.text && (t.includes(p.text.slice(0, 12)) || p.text.includes(t.slice(0, 12)))) return false;
      return true;
    });
    scheduleSave();
  }

  function setTopic(key, summary) {
    const c = conv(key);
    c.topic = String(summary || '').slice(0, 300);
    c.topicAt = Date.now();
    scheduleSave();
  }

  /** 最近 N 条发言的纯文本（给压缩话题用）。 */
  function recentTranscript(key, limit = 20) {
    const c = conv(key);
    return c.turns.slice(-limit).map((t) => `${t.sender}：${t.text}${t.addressed ? '（对机器人）' : ''}`).join('\n');
  }

  /** 谁在跟谁说话：最近 8 条里出现的发言人。 */
  function activeSpeakers(key, limit = 8) {
    const c = conv(key);
    const names = [];
    for (const t of c.turns.slice(-limit)) {
      if (!names.includes(t.sender)) names.push(t.sender);
    }
    return names;
  }

  function pendingQuestions(key) {
    return (conv(key).pending || []).slice(-3);
  }

  /**
   * 生成情境块。maxChars 控制长度；没有内容时返回 ''。
   */
  function buildBlock(key, { maxChars = 900, transcriptLimit = 8, includeTranscript = true } = {}) {
    const c = conv(key);
    const lines = [];
    let used = 0;
    const push = (line) => {
      if (!line) return;
      if (used + line.length > maxChars) return;
      lines.push(line);
      used += line.length;
    };

    if (c.topic) push(`【当前话题】${c.topic}`);

    const speakers = activeSpeakers(key);
    if (speakers.length) {
      push(`【在场】${speakers.join('、')}`);
    }

    const pend = pendingQuestions(key);
    if (pend.length) {
      push(`【还没回应】${pend.map((p) => `${p.sender}：${p.text}`).join(' ｜ ')}`);
    }

    // 关键词/黑话由调用方通过记忆模块注入，这里只管对话结构

    if (includeTranscript && c.turns.length) {
      const tail = c.turns.slice(-transcriptLimit)
        .map((t) => `${t.sender}：${t.text}${t.addressed ? '（问机器人）' : ''}`)
        .join('\n');
      if (tail) push(`【刚才的对话】\n${tail}`);
    }

    if (!lines.length) return '';
    return `${lines.join('\n')}\n\n`;
  }

  /** 话题压缩的触发判断：每 6 条或超过 5 分钟。 */
  function shouldRefreshTopic(key, { everyN = 6, everyMs = 5 * 60 * 1000 } = {}) {
    const c = conv(key);
    if (!c.turns.length) return false;
    if (c.turns.length < 3) return false;
    const sinceTopic = Date.now() - (c.topicAt || 0);
    const sinceLast = c.turns.length % everyN === 0;
    return sinceTopic > everyMs || sinceLast;
  }

  /** 所有会话 key（定期折叠重复发言时用）。 */
  function keys() {
    return Object.keys(data.convs);
  }

  /** 压缩后裁掉较早的发言，只留最近 keepLast 条（要点已写进摘要）。 */
  function trimOldTurns(key, { keepLast = 8 } = {}) {
    const c = conv(key);
    if (c.turns.length <= keepLast) return 0;
    const removed = c.turns.length - keepLast;
    c.turns = c.turns.slice(-keepLast);
    scheduleSave();
    log(`[ctx] 压缩后裁掉 ${key} 的 ${removed} 条较早发言`);
    return removed;
  }

  /** 可以拿去摘要的那部分发言（不含最近 keepLast 条）。 */
  function olderTurns(key, { keepLast = 8, limit = 40 } = {}) {
    const c = conv(key);
    const cut = Math.max(0, c.turns.length - keepLast);
    return c.turns.slice(Math.max(0, cut - limit), cut);
  }

  function stats(key) {
    const c = conv(key);
    return { turns: c.turns.length, topic: c.topic ? c.topic.slice(0, 40) : '', pending: c.pending.length, speakers: activeSpeakers(key).length };
  }

  function pruneOlderThan(days = 14) {
    const cutoff = Date.now() - days * 86400000;
    let removed = 0;
    for (const [k, c] of Object.entries(data.convs)) {
      if ((c.turns.at(-1)?.at ?? 0) < cutoff) {
        delete data.convs[k];
        removed += 1;
      }
    }
    if (removed) { scheduleSave(); log(`[ctx] 清理了 ${removed} 个过期会话语境`); }
    return removed;
  }

  load();

  return { observe, dedupeTurns, keys, trimOldTurns, olderTurns, markAnswered, setTopic, recentTranscript, activeSpeakers, pendingQuestions, buildBlock, shouldRefreshTopic, stats, pruneOlderThan, flush };
}
