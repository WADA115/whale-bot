// 成长 M3：把 influence 接到说话上（只调参数，不改人格卡和用户设置）
//
// 规则：
//   · 所有影响最多 ±20%（对应 influence ±0.3）
//   · 成长关闭 / 没有演化数据 → 完全保持原样
//   · 只读 state/growth/state.json，写盘由成长模块负责
import fs from 'node:fs';
import path from 'node:path';

export const INFLUENCE_CAP = 0.3;
export const EFFECT_CAP = 0.2;

export function clampInfluence(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-INFLUENCE_CAP, Math.min(INFLUENCE_CAP, n));
}

const STAGE_LINES = {
  new: '你们还在互相熟悉，别太自来熟。',
  settling: '你们已经熟悉了，可以放松一点。',
  familiar: '你们很熟了，可以开玩笑、提旧事。',
  tacit: '你们有默契了，说话可以更随意。'
};

export function stageLine(id) {
  return STAGE_LINES[String(id ?? 'new')] ?? STAGE_LINES.new;
}

/** 读成长状态；不存在或关闭时返回 null（表示完全不介入）。 */
export function readInfluence(stateDir, { enabled = true } = {}) {
  if (!enabled) return null;
  try {
    const file = path.join(stateDir, 'growth', 'state.json');
    const st = JSON.parse(fs.readFileSync(file, 'utf8'));
    const inf = st.influence ?? {};
    return {
      stage: st.stage?.id ?? 'new',
      narrative: typeof st.narrative?.text === 'string' ? st.narrative.text : '',
      stageLine: stageLine(st.stage?.id),
      toneBias: clampInfluence(inf.toneBias),
      memoryWarmth: clampInfluence(inf.memoryWarmth),
      expressiveness: clampInfluence(inf.expressiveness),
      initiative: clampInfluence(inf.initiative)
    };
  } catch { return null; }
}

/** 情绪权重：基础 3 → 最多 ±0.6（权重 1~5 的尺度）。 */
export function emotionWeightWithGrowth(base, toneBias) {
  const b = Number(base);
  const baseW = Number.isFinite(b) ? b : 3;
  return Math.max(1, Math.min(5, baseW + clampInfluence(toneBias) * 2));
}

/** 记忆预算：最多 ±20%。 */
export function memoryBudgetWithGrowth(base, warmth) {
  const b = Number(base);
  const baseN = Number.isFinite(b) ? b : 500;
  return Math.round(baseN * (1 + clampInfluence(warmth) * (EFFECT_CAP / INFLUENCE_CAP)));
}

/** 概率类（表情/颜文字/主动插话）：最多 ±20%，并夹在 0~1。 */
export function chanceWithGrowth(base, bias) {
  const b = Number(base);
  const baseN = Number.isFinite(b) ? b : 0;
  return Math.max(0, Math.min(1, baseN * (1 + clampInfluence(bias) * (EFFECT_CAP / INFLUENCE_CAP))));
}

/** 面板「说话影响」用的对照数据。 */
export function previewInfluence(influence) {
  if (!influence) return null;
  return {
    stage: influence.stage,
    stageLine: influence.stageLine,
    emotionWeight: { base: 3, now: Number(emotionWeightWithGrowth(3, influence.toneBias).toFixed(2)) },
    memoryBudget: { base: 500, now: memoryBudgetWithGrowth(500, influence.memoryWarmth) },
    stickerChance: { base: 0.22, now: Number(chanceWithGrowth(0.22, influence.expressiveness).toFixed(3)) },
  };
}
