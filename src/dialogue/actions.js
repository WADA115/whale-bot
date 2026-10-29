// 对话动作契约：reply / skip / wait / react。
// 旧逻辑也先产出这个结构，后续换成 agent 时发送层不用改。

export const ACTION_TYPES = ['reply', 'skip', 'wait', 'react'];

export function normalizeAction(input = {}) {
  const rawAction = String(input.action ?? '').trim();
  if (!ACTION_TYPES.includes(rawAction)) return { ok: false, error: '未知 action：' + rawAction };
  const reason = String(input.reason ?? '').slice(0, 200);
  if (rawAction === 'reply') {
    const messages = (Array.isArray(input.messages) ? input.messages : [])
      .map((m) => String(m ?? '').trim())
      .filter(Boolean)
      .slice(0, 5);
    if (!messages.length) return { ok: false, error: 'reply 缺少 messages' };
    return {
      ok: true,
      action: {
        action: 'reply',
        messages,
        replyTo: input.replyTo != null ? String(input.replyTo) : '',
        interject: input.interject === true,
        delayMs: Array.isArray(input.delayMs) ? input.delayMs.slice(0, 5).map((n) => Math.max(0, Number(n) || 0)) : [],
        reason
      }
    };
  }
  if (rawAction === 'wait') {
    return { ok: true, action: { action: 'wait', waitMs: Math.max(0, Number(input.waitMs) || 0), reason } };
  }
  if (rawAction === 'react') {
    return { ok: true, action: { action: 'react', emoji: String(input.emoji ?? '').slice(0, 20), reason } };
  }
  return { ok: true, action: { action: 'skip', reason } };
}
