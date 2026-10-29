// 随机插话判定：只按「上次插话」控制密度，不被普通回复重置。
export const DEFAULT_CHIME_GAP_MS = 7 * 60 * 1000;

export function canChime({ now = Date.now(), lastChimeAt = 0, minGapMs = DEFAULT_CHIME_GAP_MS } = {}) {
  const gap = Number(minGapMs);
  return now - Number(lastChimeAt || 0) > (Number.isFinite(gap) ? gap : DEFAULT_CHIME_GAP_MS);
}

export function rollChime({ probability = 0, random = Math.random() } = {}) {
  const p = Number(probability);
  return Number.isFinite(p) && p > 0 && random < p;
}
