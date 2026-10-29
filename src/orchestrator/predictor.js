// 思维路由预测器（P0）：只判断“这次要不要叫醒 pro”，不产出内容。
// 规则版：零成本、可解释；后续可用 turn-log 训练小分类器替换。

const ACK = /^(好|好的|嗯|哦|噢|行|可以|收到|666|6|2|3|？|\?|-|——|草|哈+|呵+|在吗|在不在)$/;
const MEMORY = /(上次|之前|昨天|前天|答应|记得|说过|提过|承诺)/;
const QUESTION = /[?？]|(吗|呢|怎么|为什么|哪|谁|多少|是不是|能不能|行不行)/;
const PRONOUN = /(他|她|它|这个|那个|这事|那事)/;
const NEGATION = /(不是|没|别|从不|绝对|一定)/;

function keywords(cfg) {
  return Array.isArray(cfg.role?.groupNameKeywords) && cfg.role.groupNameKeywords.length
    ? cfg.role.groupNameKeywords
    : ['小鲸鱼', '鱼鱼'];
}

export function predictRoute({ event = {}, thread = {}, cfg = {} } = {}) {
  const text = String(event.text ?? '').trim();
  const at = Array.isArray(event.at) ? event.at : [];
  const named = at.includes('你') || keywords(cfg).some((k) => k && text.includes(k));
  const qMarks = (text.match(/[?？]/g) ?? []).length;
  const questionCount = qMarks > 0 ? qMarks : (QUESTION.test(text) ? 1 : 0);
  const memory = MEMORY.test(text);
  const ack = ACK.test(text);
  const long = text.length > 100;
  const multi = qMarks > 1 || long;

  let difficulty = 'normal';
  let intent = 'chat';
  let confidence = 0.6;
  let needThink = true;

  if (!text) {
    difficulty = 'easy'; intent = 'ignore'; confidence = 0.9; needThink = false;
  } else if (ack && !named) {
    difficulty = 'easy'; intent = 'ack'; confidence = 0.9; needThink = false;
  } else if (memory || multi) {
    difficulty = 'hard'; intent = 'memory'; confidence = 0.72;
  } else if (named) {
    difficulty = 'normal'; intent = 'addressed'; confidence = 0.7;
  } else if (questionCount > 0) {
    difficulty = 'normal'; intent = 'answer_question'; confidence = 0.65;
  } else if (text.length < 8) {
    difficulty = 'easy'; intent = 'chat'; confidence = 0.8; needThink = false;
  }

  const risk = {
    grounding: memory ? 0.6 : 0.08,
    conflict: NEGATION.test(text) ? 0.3 : 0.05,
    ambiguity: multi ? 0.65 : (PRONOUN.test(text) ? 0.3 : 0.08)
  };
  const maxRisk = Math.max(risk.grounding, risk.conflict, risk.ambiguity);
  const namedBoost = named ? 0.05 : 0;

  const route = (!needThink && confidence >= 0.85 && maxRisk < 0.15)
    ? 'flash'
    : 'pro';

  return {
    needThink,
    difficulty,
    intent,
    confidence: Math.min(0.99, confidence + namedBoost),
    risk,
    route
  };
}
