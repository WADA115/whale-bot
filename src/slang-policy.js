// 黑话候选策略：什么时候值得学、能不能对外搜、什么时候过期。
// 只做判断，不读写文件，方便单测。

const SENSITIVE = /(习近平|共产党|六四|台独|港独|疆独|藏独|法轮|恐怖|爆炸|枪|杀|色情|黄片|裸|约炮|毒品|冰毒|海洛因)/;

const ASK_RE = /(什么意思|啥意思|什么梗|啥梗|谐音|听不[懂明]|没听懂|不懂|这是啥|啥东西|什么来头|梗吗)/;

const STOP = new Set(['这个', '那个', '什么', '怎么', '就是', '然后', '可以', '不是', '没有', '知道', '感觉', '意思', '东西', '一下']);

/** 敏感词不进候选、不联网。 */
export function isSensitiveTerm(term) {
  return SENSITIVE.test(String(term ?? ''));
}

/** 用户是不是在问“这是什么意思/什么梗”。 */
export function isAskingMeaning(text) {
  return ASK_RE.test(String(text ?? ''));
}

/**
 * 从一句提问里抽候选词。
 * 只认三种：引号里的短语、X是什么意思/什么梗、X是谐音。
 */
export function extractAskedTerms(text) {
  const body = String(text ?? '').trim();
  if (!body || !isAskingMeaning(body)) return [];
  const out = [];
  const push = (t) => {
    const term = String(t ?? '').trim().replace(/[，。！？!?、；;：:\s]/g, '');
    if (term.length < 2 || term.length > 8) return;
    if (STOP.has(term)) return;
    if (isSensitiveTerm(term)) return;
    if (!out.includes(term)) out.push(term);
  };
  for (const m of body.matchAll(/[「『“"]([^」』”"]{2,16})[」』”"]/g)) push(m[1]);
  for (const m of body.matchAll(/([\u4e00-\u9fa5A-Za-z0-9]{2,8}?)(?:是什么意思|什么意思|啥意思|是什么梗|什么梗|的梗|是谐音|谐音)/g)) push(m[1]);
  return out;
}

export function clampConfidence(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/** 默认 90 天过期；手动确认的也可以给更长。 */
export function expiresAtFromNow(days = 90, now = Date.now()) {
  return new Date(now + Math.max(0, Number(days) || 0) * 86400000).toISOString();
}

export function isExpired(entry, now = Date.now()) {
  if (!entry?.expiresAt) return false;
  const t = Date.parse(entry.expiresAt);
  return Number.isFinite(t) && t <= now;
}

/** 是否允许注入提示词：已确认、有含义、没过期、置信度够。 */
export function shouldInject(entry, { minConfidence = 0.5, now = Date.now() } = {}) {
  return Boolean(entry)
    && entry.status === 'confirmed'
    && Boolean(entry.meaning)
    && !isExpired(entry, now)
    && clampConfidence(entry.confidence ?? 0.6) >= minConfidence;
}
