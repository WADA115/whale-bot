// 群聊“是不是在跟机器人说话”判断结果解析。
// 模型是推理模型：content 可能为空，答案落在 reasoning 里；不能一空就判“否”。

function normalize(s) {
  return String(s ?? '').replace(/[\s。.!！？?]/g, '').trim();
}

/** 从 content 里读：是/否/不是；读不出返回 null。 */
export function parseVerdictText(content) {
  const t = normalize(content);
  if (!t) return null;
  if (t.startsWith('不是')) return false;
  if (t.startsWith('否')) return false;
  if (t.startsWith('是')) return true;
  // 兜底：句子里出现“回答：是/结论：否”
  const m = t.match(/(?:回答|结论|答案|输出)[:：]?(是|否|不是)/);
  if (m) return !String(m[1]).startsWith('否') && !String(m[1]).startsWith('不是');
  return null;
}

/** 从 reasoning 里找最后一个独立的是/否。 */
export function parseVerdictReasoning(reasoning) {
  const text = String(reasoning ?? '');
  const hits = [...text.matchAll(/不是|否|是/g)];
  if (!hits.length) return null;
  return hits[hits.length - 1][0] === '是';
}

/**
 * 解析判断器输出。
 * 约定：拿不准时判「是」（宁可多接一句），而不是静默丢掉。
 */
export function parseClassifyAnswer(content, reasoning = '') {
  const direct = parseVerdictText(content);
  if (direct !== null) return { addressed: direct, reason: direct ? '是' : '否' };
  const fromReasoning = parseVerdictReasoning(reasoning);
  if (fromReasoning !== null) return { addressed: fromReasoning, reason: fromReasoning ? 'reasoning:是' : 'reasoning:否' };
  return { addressed: true, reason: 'empty→是' };
}
