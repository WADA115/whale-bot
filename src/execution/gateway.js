// 唯一出口：校验、幂等、过期、取消、审计、分条、结果。
import { normalizeExecutionAction } from './action.js';

export function createExecutionGateway({
  sendOne,
  sendExpression = null,
  audit = async () => true,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = () => Date.now(),
  log = () => {}
} = {}) {
  if (typeof sendOne !== 'function') throw new Error('sendOne required');
  const seen = new Set();
  const chains = new Map();
  const cancelled = new Map();

  function cancelChat(chat) {
    cancelled.set(chat, (cancelled.get(chat) ?? 0) + 1);
  }

  function isCancelled(chat, currentEpoch) {
    return (cancelled.get(chat) ?? 0) !== currentEpoch;
  }

  async function runAction(action, { signal, epoch } = {}) {
    const chat = action.chat || '';
    const currentEpoch = epoch ?? (cancelled.get(chat) ?? 0);
    if (action.actionId) {
      if (seen.has(action.actionId)) return { ok: false, reason: 'duplicate', actionId: action.actionId };
      seen.add(action.actionId);
    }
    if (action.source === 'dialogue' || action.source === 'initiative') {
      if (action.standards?.pass !== true) return { ok: false, reason: 'standards', actionId: action.actionId };
    }
    if (action.expiresAt && now() > action.expiresAt) return { ok: false, reason: 'expired', actionId: action.actionId };

    if (action.type === 'expression') {
      if (typeof sendExpression !== 'function') return { ok: false, reason: 'no-expression-handler', actionId: action.actionId };
      if (signal?.aborted || isCancelled(chat, currentEpoch)) return { ok: false, reason: 'cancelled', actionId: action.actionId };
      const allowed = await audit('[expression]', action);
      if (!allowed) return { ok: false, reason: 'audit', actionId: action.actionId };
      try {
        await sendExpression(chat, action);
        return { ok: true, expression: true, actionId: action.actionId };
      } catch (error) {
        log('expression send failed: ' + (error?.message ?? error));
        return { ok: false, reason: 'send', error: error?.message ?? String(error), actionId: action.actionId };
      }
    }

    const sent = [];
    for (let i = 0; i < action.messages.length; i += 1) {
      if (signal?.aborted || isCancelled(chat, currentEpoch)) return { ok: false, reason: 'cancelled', sent, actionId: action.actionId };
      if (i > 0) {
        const d = Number(action.delayMs?.[i - 1]);
        if (Number.isFinite(d) && d > 0) await sleep(d);
        if (signal?.aborted || isCancelled(chat, currentEpoch)) return { ok: false, reason: 'cancelled', sent, actionId: action.actionId };
      }
      const allowed = await audit(action.messages[i], action);
      if (!allowed) return { ok: false, reason: 'audit', sent, actionId: action.actionId };
      try {
        await sendOne(chat, action.messages[i], action);
        sent.push(action.messages[i]);
      } catch (error) {
        log('send failed: ' + (error?.message ?? error));
        return { ok: false, reason: 'send', sent, error: error?.message ?? String(error), actionId: action.actionId };
      }
    }
    return { ok: true, sent, actionId: action.actionId };
  }

  async function execute(raw, ctx = {}) {
    const normalized = normalizeExecutionAction(raw);
    if (!normalized.ok) return { ok: false, reason: 'invalid', error: normalized.error };
    const action = normalized.action;
    if (action.type === 'skip' || action.type === 'wait') return { ok: true, skipped: true, action };
    const chat = action.chat || ctx.chat || '';
    action.chat = chat;
    const prev = chains.get(chat) ?? Promise.resolve();
    const epoch = cancelled.get(chat) ?? 0;
    const next = prev.then(() => runAction(action, { ...ctx, epoch }), () => runAction(action, { ...ctx, epoch }));
    chains.set(chat, next.catch(() => {}));
    return next;
  }

  return { execute, cancelChat, seen, chains };
}
