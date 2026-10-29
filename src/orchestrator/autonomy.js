// 自主表达：有驱动、有理由、有预算，不随机插话。
export const DRIVES = ['curiosity', 'care', 'play', 'share'];

export function evaluateInitiative({
  now = Date.now(),
  lastActivityAt = 0,
  openQuestions = [],
  unresolved = [],
  mood = {},
  budget = { used: 0, limit: 3, windowStartAt: 0 },
  cfg = {}
} = {}) {
  const idleMs = Math.max(0, now - lastActivityAt);
  const minIdleMs = Number(cfg.autonomy?.minIdleMs) || 8 * 60 * 1000;
  const windowMs = Number(cfg.autonomy?.windowMs) || 60 * 60 * 1000;
  let used = Number(budget.used) || 0;
  if (budget.windowStartAt && now - budget.windowStartAt > windowMs) used = 0;
  const limit = Number(budget.limit ?? cfg.autonomy?.maxPerHour ?? 3) || 3;
  const remaining = Math.max(0, limit - used);

  if (idleMs < minIdleMs) return { action: 'wait', reason: '还没到空闲阈值', remaining };
  if (remaining <= 0) return { action: 'wait', reason: '主动预算已用尽', remaining };

  const candidates = [];
  if (openQuestions.length) {
    candidates.push({ drive: 'care', reason: '有未接住的问题', score: 0.8 });
  }
  if (unresolved.length) {
    candidates.push({ drive: 'care', reason: '有未完成的话题', score: 0.7 });
  }
  if (Number(mood.energy ?? 0.6) > 0.5) {
    candidates.push({ drive: 'curiosity', reason: '状态还行，可以探索', score: 0.4 });
  }
  if (Number(mood.valence ?? 0) > 0.2) {
    candidates.push({ drive: 'play', reason: '心情不错，可以接个梗', score: 0.3 });
  }
  if (!candidates.length) return { action: 'wait', reason: '没有合适驱动', remaining };

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  return {
    action: 'initiate',
    drive: best.drive,
    reason: best.reason,
    score: best.score,
    remaining: remaining - 1,
    budget: { used: used + 1, limit, windowStartAt: budget.windowStartAt || now }
  };
}
