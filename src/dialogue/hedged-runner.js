import { buildTransactionPrompt, parseTransaction, raceTransactions } from './hedged.js';
import { checkStandards } from '../orchestrator/standards.js';

export async function runHedgedDialogue({
  key, event, thread, roleHint, recall, notes = {}, asks, cfg,
  log = () => {}
} = {}) {
  const noteLines = [];
  if (notes.tone) noteLines.push('【对话状态】语气：' + notes.tone);
  if (Array.isArray(notes.open_questions) && notes.open_questions.length) noteLines.push('【未解决】' + notes.open_questions.join(' / '));
  if (Array.isArray(notes.memory_candidates) && notes.memory_candidates.length) noteLines.push('【候选记忆】' + notes.memory_candidates.join(' / '));
  const mode = String(event?.chat ?? '').startsWith('group:') ? 'group' : 'private';
  const prompt = buildTransactionPrompt({ event, thread, roleHint, context: [...(recall?.lines ?? []), ...noteLines], cfg, mode });

  const validate = (tx) => {
    if (tx.action === 'skip') return tx;
    const report = checkStandards({
      draft: tx.messages.join(' '),
      thought: { intent: 'answer', keyPoints: tx.messages.slice(0, 4) },
      plan: { messages: tx.messages },
      evidence: recall?.evidence,
      facts: recall?.facts,
      commitments: recall?.commitments,
      decision: { action: 'reply', reason: 'hedged' }
    });
    if (!report.pass) {
      throw new Error('standards ' + JSON.stringify(report.violations ?? []).slice(0, 300));
    }
    return tx;
  };

  const run = async (provider, signal, delayMs = 0, label = '') => {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    if (signal?.aborted) throw new Error('aborted');
    let raw;
    try { raw = await provider(); }
    catch (error) {
      if (error?.name !== 'AbortError' && error?.message !== 'aborted') log(`[hedge] ${label} error=${error?.message ?? error}`);
      throw error;
    }
    const tx = parseTransaction(raw?.content ?? '');
    if (!tx) {
      log(`[hedge] ${label} invalid raw=${JSON.stringify(String(raw?.content ?? '')).slice(0, 300)}`);
      throw new Error('invalid transaction');
    }
    return validate(tx);
  };

  const winner = await raceTransactions([
    { name: 'deepseek', run: (signal) => run(() => asks.hedge.deepseek({ ...prompt, signal }), signal, 0, 'deepseek') },
    { name: 'local', run: (signal) => run(() => asks.hedge.local({ ...prompt, signal }), signal, 600, 'local') }
  ], { log });
  if (winner) return { ...winner.value, provider: winner.name };

  try {
    log(`[hedge] 进入修复重试 ${key}`);
    const compact = buildTransactionPrompt({
      event,
      thread: { events: (thread.events ?? []).slice(-6) },
      roleHint: String(roleHint ?? '').slice(0, 1500),
      context: (recall?.lines ?? []).slice(-10),
      cfg,
      mode
    });
    const raw = await asks.hedge.deepseek({ ...compact, signal: null });
    const tx = parseTransaction(raw?.content ?? '');
    if (tx) {
      const fixed = validate(tx);
      log(`[hedge] 修复成功 ${key}（${fixed.messages.length} 条）`);
      return { ...fixed, provider: 'deepseek-rescue' };
    }
    log(`[hedge] 修复失败 ${key} raw=${JSON.stringify(String(raw?.content ?? '')).slice(0, 300)}`);
  } catch (error) {
    log(`[hedge] 修复异常 ${key}: ${error?.message ?? error}`);
  }
  return null;
}
