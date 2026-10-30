// 双引擎对冲：同一份上下文，云端/本地同时生成，先通过校验者胜出。
// 只负责“比赛”，不发送；发送仍由 Gateway 完成。

const SYSTEM = (name) => `你是 QQ 机器人「${name}」。请直接决定这一轮怎么回。

只输出一个 JSON 对象，不要 Markdown、不要解释、不要在 JSON 外写任何字：
{
  "action": "reply" | "skip",
  "messages": ["要发送的每条消息"],
  "reasoning": "只给系统看的内部理由，绝对不能出现在 messages 里",
  "evidence": ["引用到的知识编号，如 知识1"],
  "state_patch": { "tone": "neutral|playful|serious", "open_questions": [], "memory_candidates": [] },
  "replyTo": "可选，被引用消息 id",
  "delayMs": [可选，每条之间的毫秒],
  "confidence": 0.0
}

要求：
- 气泡数量和每条长度由你根据内容决定，不强制短，也不要无意义刷屏
- 每条消息读起来要完整，不要把同一句话拆成两条
- reasoning 是内部计划，绝不能复述到 messages
- 不要抱怨/嘲讽对方催你，不要连续追问
- 以本轮系统提供的【当前图片】为准；不要说自己看不到图、图一片白，除非本轮明确写了无法读取
- 不要重复自己过去的故障/抱怨（图白、看不到、上下文丢了、加载慢），也不要拿这些当梗
- 不要命令对方重发、不要指责对方“发空包”；需要补充信息时用一句自然请求
- 没有合适回复时 action=skip，messages=[]
- 角色卡只取风格，不要照抄`;

export function buildTransactionPrompt({ event = {}, thread = {}, roleHint = '', context = [], cfg = {}, mode = 'private' } = {}) {
  const name = String(cfg.role?.displayName || '鱼鱼');
  const history = (thread.events ?? []).slice(-20)
    .map((e) => `${e.sender?.name ?? ''}：${e.text ?? ''}`)
    .join('\n');
  const current = `${event.sender?.name ?? ''}：${event.text ?? ''}`;
  const ctx = (Array.isArray(context) ? context : []).slice(-50).join('\n');
  const groupRules = mode === 'group'
    ? '\n\n群聊模式：\n- 默认短；默认只发 1 条，最多 2 条；不要补第二句解释，对方明确要求才展开\n- 不要把全场总结一遍，不要对所有人说话\n- 群友互相聊天时不要插话；别人没说完不打断、不抢话、不连续追问；不确定就 action=skip\n- 不复述自己过去说过的话，不拿旧故障/旧梗当谈资\n- 不命令别人重发，不指责别人\n- 气泡数量和长度由你判断，但别刷屏'
    : '';
  const system = SYSTEM(name) + groupRules + (roleHint ? `\n\n角色卡：\n${String(roleHint).slice(0, 4000)}` : '');
  const user = `${ctx ? `【记忆/语境】\n${ctx}\n\n` : ''}${history ? `【最近线程】\n${history}\n\n` : ''}【当前消息】\n${current}`;
  return { system, user };
}

function fromData(data) {
  const action = data?.action === 'skip' ? 'skip' : 'reply';
  const messages = (Array.isArray(data?.messages) ? data.messages : [])
    .map((m) => String(m ?? '').trim())
    .filter(Boolean)
    .slice(0, 50);
  if (action === 'reply' && !messages.length) return null;
  const evidence = (Array.isArray(data?.evidence) ? data.evidence : []).map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 20);
  const patch = data?.state_patch && typeof data.state_patch === 'object' ? {
    tone: ['neutral', 'playful', 'serious'].includes(data.state_patch.tone) ? data.state_patch.tone : undefined,
    open_questions: (Array.isArray(data.state_patch.open_questions) ? data.state_patch.open_questions : []).map(String).map((x) => x.trim()).filter(Boolean).slice(0, 5),
    memory_candidates: (Array.isArray(data.state_patch.memory_candidates) ? data.state_patch.memory_candidates : []).map(String).map((x) => x.trim()).filter(Boolean).slice(0, 5)
  } : null;
  return {
    action,
    messages,
    evidence,
    state_patch: patch,
    replyTo: data?.replyTo != null && String(data.replyTo) !== '0' ? String(data.replyTo) : '',
    delayMs: Array.isArray(data?.delayMs) ? data.delayMs.slice(0, 49).map((n) => Math.max(0, Number(n) || 0)) : [],
    reasoning: String(data?.reasoning ?? '').slice(0, 500),
    confidence: Math.max(0, Math.min(1, Number(data?.confidence) || 0))
  };
}

function extractMessages(raw) {
  const key = raw.search(/"messages"\s*:/);
  if (key < 0) return [];
  const arrStart = raw.indexOf('[', key);
  if (arrStart < 0) return [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let end = -1;
  for (let i = arrStart; i < raw.length; i += 1) {
    const ch = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '[') depth += 1;
    else if (ch === ']') {
      depth -= 1;
      if (depth === 0) { end = i; break; }
    }
  }
  const body = raw.slice(arrStart, end >= 0 ? end + 1 : raw.length);
  try {
    const parsed = JSON.parse(body);
    return Array.isArray(parsed) ? parsed.map(String).map((x) => x.trim()).filter(Boolean) : [];
  } catch {
    const out = [];
    const re = /"((?:\\.|[^"\\])*)"/g;
    let m;
    while ((m = re.exec(body))) {
      try { out.push(JSON.parse(`"${m[1]}"`).trim()); } catch {}
    }
    return out.filter(Boolean);
  }
}

export function parseTransaction(text) {
  const raw = String(text ?? '').replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  if (!raw) return null;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const parsed = fromData(JSON.parse(raw.slice(start, end + 1)));
      if (parsed) return parsed;
    } catch {}
  }
  // 截断/缺右括号时的确定性修复：只提取 messages，绝不猜事实。
  const messages = extractMessages(raw);
  if (!messages.length) return null;
  const actionMatch = /"action"\s*:\s*"(skip|reply)"/.exec(raw);
  const action = actionMatch?.[1] === 'skip' ? 'skip' : 'reply';
  if (action === 'skip') return fromData({ action: 'skip', messages: [] });
  const replyTo = /"replyTo"\s*:\s*"([^"]*)"/.exec(raw)?.[1] || '';
  return fromData({ action: 'reply', messages, replyTo, reasoning: 'repaired' });
}
/**
 * attempts: [{ name, run(signal) -> parsed }]
 * 返回第一个成功的 attempt；其余 abort。
 */
export async function raceTransactions(attempts, { log = () => {} } = {}) {
  if (!Array.isArray(attempts) || attempts.length < 1) return null;
  const controller = new AbortController();
  const errors = [];
  const tasks = attempts.map(async (attempt) => {
    try {
      const value = await attempt.run(controller.signal);
      if (!value) throw new Error('invalid');
      return { name: attempt.name, value };
    } catch (error) {
      if (!controller.signal.aborted) errors.push(`${attempt.name}:${error?.message ?? error}`);
      throw error;
    }
  });
  try {
    const winner = await Promise.any(tasks);
    controller.abort();
    log(`[hedge] 赢家 ${winner.name}`);
    return winner;
  } catch {
    controller.abort();
    log(`[hedge] 全部失败：${errors.join(' | ').slice(0, 300)}`);
    return null;
  }
}
