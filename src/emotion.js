// 情绪强度：把「理性 ↔ 感性」量化成 1~5，供提示词和面板共用。
//
// 1 = 很克制（冷静、简短、少用语气词）
// 3 = 正常
// 5 = 很外放（情绪明显、口语化、可以夸张）
//
// 纯函数，不读写文件，方便测试。

export function clampLevel(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return 3;
  return Math.max(1, Math.min(5, v));
}

/**
 * 自动档：按心情、消息语气、人格卡风格推算强度。
 * @param {{base?:number, moodScore?:number, text?:string, roleHint?:string}} p
 */
export function autoEmotionLevel({ base = 3, moodScore = 0, text = '', roleHint = '' } = {}) {
  let score = clampLevel(base);

  // 心情波动大 → 更外放
  if (Math.abs(Number(moodScore) || 0) >= 3) score += 1;

  // 消息本身很激动 → 跟着外放
  const t = String(text ?? '');
  if (/[！!]{2,}|哈哈|笑死|呜呜|卧槽|啊啊|？？|太.{0,3}了/.test(t)) score += 1;

  // 长消息 / 技术性提问 → 收敛
  if (t.length > 80 || /为什么|原理|分析|怎么实现|区别|配置|报错/.test(t)) score -= 1;

  // 人格卡风格
  const hint = String(roleHint ?? '');
  if (/活泼|元气|傲娇|俏皮|黏人|撒娇|毒舌|疯/.test(hint)) score += 1;
  if (/冷静|理性|严谨|克制|专业|沉稳/.test(hint)) score -= 1;

  return clampLevel(score);
}

/** 生成注入提示词用的那一行。 */
export function emotionPrompt(level, weight = 3) {
  const lv = clampLevel(level);
  const w = clampLevel(weight);
  const label = ['', '很克制', '偏理性', '正常', '偏感性', '很外放'][lv];
  let line = '【表达强度】' + lv + '/5（' + label + '）——数字越大越有情绪、越口语化；越小越冷静、越简洁。不要把数字说出来。颜文字偶尔用一次就好，别每条都加。';
  if (w <= 2) line += ' 语气收着一点，别太外放。';
  else if (w >= 4) line += ' 情绪可以明显一点，别压着。';
  return line + '\n\n';
}
