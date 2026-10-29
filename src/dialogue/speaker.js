// 表达层：把 thought packet 说成小鲸鱼的话；只产出消息，不发送。
import { formatRecentLine, formatCurrentLine } from '../group-history.js';
import { normalizeAction } from './actions.js';

export function buildSpeakerPrompt({ event = {}, thread = {}, thought = {}, roleHint = '', cfg = {}, extraContext = '', repairNotes = '' } = {}) {
  const name = String(cfg.role?.displayName || '鱼鱼');
  const history = (thread.events ?? []).slice(-20)
    .map((e) => formatRecentLine({ name: e.sender?.name ?? e.name, text: e.text, at: e.at, replyTo: e.replyTo, self: e.sender?.isSelf ?? e.self }))
    .join('\n');
  const system = `你是 QQ 群机器人「${name}」的表达层。思维层已经想好了，你只负责把它说成人话。

要求：
- 严格按 thought.keyPoints 说，不要新增事实、不要答非所问
- 保持角色语气；不要客服腔、不要列表/标题/加粗
- 1~3 条消息，每条不超过 60 字；口语、短句
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
  return parseSpeaker(out?.content ?? '');
}
