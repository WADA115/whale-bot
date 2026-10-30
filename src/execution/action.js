// 执行层动作契约：Orchestrator 产出，Gateway 唯一消费。
export const SOURCES = ['dialogue', 'initiative', 'system', 'command'];
export const TYPES = ['reply', 'skip', 'wait', 'react', 'initiate', 'expression'];

export function normalizeExecutionAction(raw = {}) {
  const source = String(raw.source ?? 'dialogue');
  if (!SOURCES.includes(source)) return { ok: false, error: 'unknown source: ' + source };
  const type = String(raw.type ?? raw.action ?? 'reply');
  if (!TYPES.includes(type)) return { ok: false, error: 'unknown type: ' + type };
  if (type === 'skip' || type === 'wait') {
    return { ok: true, action: { actionId: String(raw.actionId ?? ''), turnId: String(raw.turnId ?? ''), source, type, reason: String(raw.reason ?? '').slice(0, 200) } };
  }
  if (type === 'expression') {
    const kind = String(raw.expression?.kind ?? raw.kind ?? '');
    const value = String(raw.expression?.value ?? raw.value ?? '').trim();
    if (!['sticker', 'face', 'kaomoji'].includes(kind) || !value) return { ok: false, error: 'invalid expression' };
    return {
      ok: true,
      action: {
        actionId: String(raw.actionId ?? ''),
        turnId: String(raw.turnId ?? ''),
        source,
        type,
        chat: String(raw.chat ?? ''),
        expression: { kind, value },
        expiresAt: Math.max(0, Number(raw.expiresAt) || 0),
        standards: raw.standards && typeof raw.standards === 'object' ? { pass: raw.standards.pass === true } : null,
        reason: String(raw.reason ?? '').slice(0, 200)
      }
    };
  }
  const messages = (Array.isArray(raw.messages) ? raw.messages : [])
    .map((m) => String(m ?? '').trim())
    .filter(Boolean)
    .slice(0, 5);
  if (!messages.length) return { ok: false, error: 'no messages' };
  return {
    ok: true,
    action: {
      actionId: String(raw.actionId ?? ''),
      turnId: String(raw.turnId ?? ''),
      source,
      type,
      chat: String(raw.chat ?? ''),
      messages,
      replyTo: raw.replyTo != null ? String(raw.replyTo) : '',
      delayMs: Array.isArray(raw.delayMs) ? raw.delayMs.slice(0, 5).map((n) => Math.max(0, Number(n) || 0)) : [],
      interject: raw.interject === true,
      expiresAt: Math.max(0, Number(raw.expiresAt) || 0),
      standards: raw.standards && typeof raw.standards === 'object' ? { pass: raw.standards.pass === true } : null,
      reason: String(raw.reason ?? '').slice(0, 200)
    }
  };
}
