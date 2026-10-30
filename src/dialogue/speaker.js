// 表达层：把 thought packet 说成小鲸鱼的话；只产出消息，不发送。
import { formatRecentLine, formatCurrentLine } from '../group-history.js';
import { normalizeAction } from './actions.js';

export function buildSpeakerPrompt({ event = {}, thread = {}, thought = {}, roleHint = '', cfg = {}, extraContext = '', repairNotes = '' } = {}) {
  const name = String(cfg.role?.displayName || '鱼鱼');
  const delivery = thought?.delivery ?? {};
  const deliveryHint = delivery.bubbles
    ? `${delivery.bubbles} 条左右，长度 ${delivery.length || 'normal'}，节奏 ${delivery.pacing || 'single'}；reason=${delivery.reason || ''}`
    : 'auto';
  const history = (thread.events ?? []).slice(-20)
    .map((e) => formatRecentLine({ name: e.sender?.name ?? e.name, text: e.text, at: e.at, replyTo: e.replyTo, self: e.sender?.isSelf ?? e.self }))
    .join('\n');
  const system = `你是 QQ 群机器人「${name}」的表达层。思维层已经想好了，你只负责把它说成人话。

要求：
- 严格按 thought.keyPoints 说，不要新增事实、不要答非所问
- thought 是内部计划，绝不能把 thought / keyPoints / 解释直接当成回复发出去
- 保持角色语气；不要客服腔、不要列表/标题/加粗
- 条数和长度由你根据内容判断：一句话能说清就一条；需要分层/举例再分条；不要为短而短，也不要无意义刷屏
- 如果 thought.delivery 给了预算，按预算来；它只是建议，内容需要时可以调整
- 每条消息读起来要完整，不要把同一句话拆成两条
- 不要重复对方刚说的话；不要抱怨/嘲讽对方催你；不要连续追问
- 表达预算：${deliveryHint}
- thought.constraints 必须遵守
- 只输出 JSON：{"messages":["..."],"replyTo":"可选消息id","delayMs":[可选毫秒数组]}
${roleHint ? `\n角色卡（只取风格）：\n${String(roleHint).slice(0, 4000)}` : ''}`;
  const current = formatCurrentLine({ senderName: event.sender?.name ?? '', at: event.at ?? [], text: event.text ?? '' });
  const user = `thought：
${JSON.stringify(thought)}

${history ? `最近线程：\n${history}\n\n` : ''}${current}`;
  return { system, user };
}

export function parseSpeaker(text) {
  const raw = String(text ?? '').replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let data;
  try { data = JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
  const normalized = normalizeAction({
    action: 'reply',
    messages: data.messages,
    replyTo: data.replyTo,
    delayMs: data.delayMs,
    reason: 'speaker'
  });
  if (!normalized.ok) return null;
  return {
    messages: normalized.action.messages,
    replyTo: normalized.action.replyTo,
    delayMs: normalized.action.delayMs
  };
}

export async function speak({ event, thread, thought, roleHint = '', cfg = {}, ask, extraContext = '', repairNotes = '' } = {}) {
  if (typeof ask !== 'function' || !thought) return null;
  const { system, user } = buildSpeakerPrompt({ event, thread, thought, roleHint, cfg, extraContext, repairNotes });
  const out = await ask({ system, user });
  const first = String(out?.content ?? '').trim();
  let parsed = parseSpeaker(first);
  if (!parsed) {
    const retry = await ask({
      system: system + '\n\n上一次输出不是合法 JSON 或 messages 为空。只输出一个 JSON 对象，messages 至少一条。',
      user
    });
    const second = String(retry?.content ?? '').trim();
    parsed = parseSpeaker(second);
    if (!parsed) {
      // 第三次用“纯文本”约束，避免把 thought/keyPoints 当成回复泄露出去。
      const simple = await ask({
        system: '只输出一句自然的中文回复，直接回应用户。不要解释思考过程，不要复述内部计划，不要输出 JSON。',
        user: formatCurrentLine({ senderName: event.sender?.name ?? '', at: event.at ?? [], text: event.text ?? '' })
      });
      const text = String(simple?.content ?? '').trim();
      if (text) return { messages: [text.slice(0, 300)], replyTo: '', delayMs: [], fallback: true };
      return { messages: [], parseError: true, raw: first.slice(0, 500), rawRetry: second.slice(0, 500) };
    }
  }
  return parsed;
}
