// 多气泡发送节奏：固定间隔 / 按长度 / 随机长间隔。
export function clampGap(ms, sendCfg) {
  const min = Math.max(100, Number(sendCfg?.burstIntervalMinMs) || 300);
  const max = Math.max(min, Number(sendCfg?.maxGapMs) || 10000);
  return Math.max(min, Math.min(max, Math.round(Number(ms) || min)));
}

export function computeGaps(messages, gapMode, gapMs, gaps, sendCfg, random = Math.random) {
  const delays = [];
  if (!messages || messages.length <= 1) return delays;
  const mode = gapMode === 'fixed' || gapMode === 'byLength' ? gapMode : 'auto';
  if (mode === 'fixed') {
    if (Array.isArray(gaps) && gaps.length >= messages.length - 1) {
      for (let i = 0; i < messages.length - 1; i++) delays.push(clampGap(gaps[i], sendCfg));
    } else {
      const g = clampGap(Number(gapMs) || Number(sendCfg?.burstIntervalMinMs) || 1000, sendCfg);
      for (let i = 0; i < messages.length - 1; i++) delays.push(g);
    }
  } else if (mode === 'byLength') {
    const base = Number(sendCfg?.gapBaseMs) || 800;
    const perChar = Number(sendCfg?.gapPerCharMs) || 20;
    for (let i = 0; i < messages.length - 1; i++) {
      const chars = Math.max(1, String(messages[i] || '').length);
      delays.push(clampGap(base + chars * perChar, sendCfg));
    }
  } else {
    const longProb = Math.min(1, Math.max(0, Number(sendCfg?.longGapProbability) || 0));
    for (let i = 0; i < messages.length - 1; i++) {
      const useLong = longProb > 0 && random() < longProb;
      const min = useLong ? (Number(sendCfg?.longGapMinMs) || 5000) : (Number(sendCfg?.burstIntervalMinMs) || 1000);
      const max = useLong ? (Number(sendCfg?.longGapMaxMs) || 10000) : (Number(sendCfg?.burstIntervalMaxMs) || 3000);
      delays.push(clampGap(Math.round(min + random() * (max - min)), sendCfg));
    }
  }
  return delays;
}
