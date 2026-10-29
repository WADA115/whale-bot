// 成长 · 周演化（M2）
//
// 输入：过去 7 天的 kept（模型筛选后的片段）+ 当前状态
// 输出：特质/需求/依恋的提案、阶段评估、影响参数预览、可读的「为什么变」
//
// 全部纯函数，方便测试；写盘与快照在 growth-store / app.js 里做。
// M2 只更新状态，不影响说话（M3 才消费 influence）。

export const LIMITS = {
  perTrait: 0.05,      // 单次每个特质最多 ±0.05
  perWeek: 0.15,       // 单次全部特质合计最多 ±0.15
  anchor: 1.0,         // 离基座最多 ±1.0
  needStep: 6,         // 单次需求最多 ±6
  attachStep: 6        // 单次依恋最多 ±6
};

const KEYS = ['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism'];

const RULES = [
  { kind: 'praise', words: ['夸', '喜欢', '谢谢', '厉害', '棒', '爱', '可爱', '好耶'] },
  { kind: 'conflict', words: ['生气', '讨厌', '烦', '滚', '吵', '别烦', '闭嘴'] },
  { kind: 'repair', words: ['对不起', '道歉', '没事', '原谅', '别生气'] },
  { kind: 'secret', words: ['秘密', '别告诉', '只告诉你', '偷偷'] }
];

export function classify(item) {
  const text = String(item?.summary || item?.text || '');
  for (const rule of RULES) {
    if (rule.words.some((w) => text.includes(w))) return rule.kind;
  }
  if (item?.kind === 'preference') return 'praise';
  if (item?.kind === 'emotion') return 'emotion';
  return 'chat';
}

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

/** 汇总一周信号。 */
export function aggregateWeek(keptByDate) {
  const days = Object.keys(keptByDate ?? {}).sort();
  const counts = { praise: 0, conflict: 0, repair: 0, secret: 0, emotion: 0, chat: 0, info: 0 };
  let total = 0;
  let lateNight = 0;
  let emptyDays = 0;

  for (const date of days) {
    const items = keptByDate[date] ?? [];
    if (!items.length) emptyDays += 1;
    for (const it of items) {
      total += 1;
      const kind = classify(it);
      counts[kind] = (counts[kind] ?? 0) + 1;
      if (it?.kind === 'preference' || it?.kind === 'info') counts.info += 1;
      const hour = new Date(Number(it?.ts) || 0).getHours();
      if (hour >= 0 && hour < 5) lateNight += 1;
    }
  }

  return {
    days: days.length,
    total,
    emptyDays,
    lateNight,
    ...counts,
    warmth: (counts.praise + counts.repair + 1) / (counts.conflict + 1)
  };
}

function step(delta, limit) {
  return clamp(delta, -limit, limit);
}

/** 生成演化提案。 */
export function proposeEvolution(state, signals) {
  const traits = { ...(state.traits ?? {}) };
  const base = state.base ?? traits;
  const reasons = [];
  const nextTraits = { ...traits };

  const addTrait = (key, delta, why) => {
    const d = step(delta, LIMITS.perTrait);
    if (!d) return;
    nextTraits[key] = clamp((nextTraits[key] ?? 3) + d, 1, 5);
    reasons.push({ key, delta: Number(d.toFixed(3)), why });
  };

  addTrait('agreeableness', signals.praise * 0.004 + signals.repair * 0.01 - signals.conflict * 0.01,
    `表扬 ${signals.praise} / 修复 ${signals.repair} / 冲突 ${signals.conflict}`);
  addTrait('neuroticism', signals.conflict * 0.01 - signals.repair * 0.006 - signals.praise * 0.002,
    `冲突 ${signals.conflict}，修复 ${signals.repair}`);
  addTrait('extraversion', (signals.total - 8) * 0.002 + signals.lateNight * 0.003,
    `本周保留 ${signals.total} 条，深夜 ${signals.lateNight} 次`);
  addTrait('openness', (signals.chat + signals.info) * 0.0015, `新话题/信息 ${signals.chat + signals.info}`);
  addTrait('conscientiousness', signals.info * 0.002, `偏好与约定 ${signals.info}`);

  // 总量预算
  const totalDelta = KEYS.reduce((sum, k) => sum + Math.abs(nextTraits[k] - (traits[k] ?? 3)), 0);
  if (totalDelta > LIMITS.perWeek) {
    const scale = LIMITS.perWeek / totalDelta;
    for (const k of KEYS) nextTraits[k] = (traits[k] ?? 3) + ((nextTraits[k] - (traits[k] ?? 3)) * scale);
    reasons.push({ key: 'budget', delta: 0, why: '本周变化超过预算，按比例缩到 ' + LIMITS.perWeek });
  }

  // 基座锚点
  for (const k of KEYS) {
    const anchor = Number(base[k] ?? 3);
    nextTraits[k] = clamp(clamp(nextTraits[k], anchor - LIMITS.anchor, anchor + LIMITS.anchor), 1, 5);
  }

  const needs = { ...(state.needs ?? {}) };
  needs.relatedness = clamp((needs.relatedness ?? 50) + step((signals.praise + signals.repair - signals.conflict) * 2, LIMITS.needStep), 0, 100);
  needs.competence = clamp((needs.competence ?? 50) + step(signals.info * 0.6, LIMITS.needStep), 0, 100);
  needs.autonomy = clamp((needs.autonomy ?? 50) + step((signals.total - 6) * 0.5, LIMITS.needStep), 0, 100);

  const attachment = { ...(state.attachment ?? {}) };
  attachment.trust = clamp((attachment.trust ?? 50) + step((signals.praise - signals.conflict) * 1.5, LIMITS.attachStep), 0, 100);
  attachment.safety = clamp((attachment.safety ?? 50) + step(signals.repair * 2 - signals.conflict * 2, LIMITS.attachStep), 0, 100);
  attachment.intimacy = clamp((attachment.intimacy ?? 50) + step(signals.lateNight * 1.5 + signals.secret * 3, LIMITS.attachStep), 0, 100);

  const influence = {
    toneBias: clamp(((needs.relatedness - 50) / 50) * 0.3 + ((nextTraits.extraversion - 3) / 2) * 0.1, -0.3, 0.3),
    memoryWarmth: clamp(((attachment.intimacy - 50) / 50) * 0.3 + ((attachment.trust - 50) / 50) * 0.2, -0.3, 0.3),
    expressiveness: clamp(((nextTraits.extraversion - 3) / 2) * 0.2 + ((state.energy ?? 60) - 50) / 100 * 0.2, -0.3, 0.3),
    initiative: clamp(((attachment.safety - 50) / 50) * 0.2 + ((needs.relatedness - 50) / 50) * 0.2, -0.3, 0.3)
  };

  return { traits: nextTraits, needs, attachment, influence, reasons };
}

const STAGES = [
  { id: 'settling', name: '熟悉', minDays: 3, minEvents: 40, minTrust: 55 },
  { id: 'familiar', name: '交心', minDays: 14, minEvents: 150, minTrust: 65 },
  { id: 'tacit', name: '默契', minDays: 30, minEvents: 400, minTrust: 75 }
];

/** 阶段评估：一次只进一级；返回进度与缺口。 */
export function evaluateStage(state, signals, { daysSinceFirst = 0, totalEvents = 0 } = {}) {
  const current = state.stage?.id ?? 'new';
  const order = ['new', 'settling', 'familiar', 'tacit'];
  const idx = Math.max(0, order.indexOf(current));
  const next = STAGES[idx];

  if (!next) {
    return { stage: { ...state.stage, progress: 1 }, next: null, conditions: [] };
  }

  const days = Math.max(0, daysSinceFirst);
  const events = Math.max(0, totalEvents);
  const trust = Number(state.attachment?.trust ?? 50);
  const conditions = [
    { key: 'days', label: '天数', value: days, need: next.minDays, pct: clamp(days / next.minDays, 0, 1) },
    { key: 'events', label: '事件', value: events, need: next.minEvents, pct: clamp(events / next.minEvents, 0, 1) },
    { key: 'trust', label: '信任', value: trust, need: next.minTrust, pct: clamp(trust / next.minTrust, 0, 1) }
  ];
  const progress = Math.min(...conditions.map((c) => c.pct));
  const ready = conditions.every((c) => c.value >= c.need);

  return {
    stage: ready
      ? { id: next.id, since: Date.now(), progress: 0 }
      : { ...state.stage, id: current, progress: Number(progress.toFixed(3)) },
    next: ready ? (STAGES[idx + 1] ?? null) : next,
    advanced: ready,
    conditions
  };
}

/** 一轮演化的完整结果（不写盘）。 */
export function evolveOnce(state, keptByDate, { daysSinceFirst = 0, totalEvents = 0 } = {}) {
  const signals = aggregateWeek(keptByDate);
  const proposal = proposeEvolution(state, signals);
  const stageResult = evaluateStage({ ...state, ...proposal }, signals, { daysSinceFirst, totalEvents });
  return {
    signals,
    traits: proposal.traits,
    needs: proposal.needs,
    attachment: proposal.attachment,
    influence: proposal.influence,
    reasons: proposal.reasons,
    stage: stageResult.stage,
    stageNext: stageResult.next,
    advanced: !!stageResult.advanced,
    conditions: stageResult.conditions
  };
}
