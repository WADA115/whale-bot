// 记忆 / 情绪权重：1~5，可由人格卡 + 设定 + 当前语境自动算，也可由开发者手动定。
//
// 记忆权重：控制注入预算与"翻旧账"的积极程度（1 少提，5 爱提）
// 情绪权重：控制情绪对语气的影响强度（1 压住，5 放大）
//
// 纯函数，方便测试。

export const WEIGHT_LIMITS = { min: 1, max: 5 };
export const WEIGHT_DEFAULT = 3;

export function clampWeight(value, fallback = WEIGHT_DEFAULT) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(WEIGHT_LIMITS.min, Math.min(WEIGHT_LIMITS.max, n));
}

const PERSONA_WARM = /活泼|元气|傲娇|俏皮|黏人|撒娇|毒舌|热情|话多/;
const PERSONA_COOL = /冷静|理性|严谨|克制|专业|沉稳|寡言|话少/;
const PERSONA_NOSTALGIC = /念旧|回忆|往事|记得|细节|记事/;
const SETTING_NO_REMINISCE = /别翻旧账|别提以前|不要提过去|少提旧事|别念旧/;
const SETTING_CARE = /关心|体贴|多问|照顾|陪伴/;
const TECHNICAL = /为什么|原理|分析|怎么实现|区别|配置|报错|代码|接口/;

/**
 * 自动权重。
 * @param {{personaHint?:string, settingsText?:string, text?:string, base?:number}} p
 */
export function autoWeights({ personaHint = '', settingsText = '', text = '', base = WEIGHT_DEFAULT } = {}) {
  const persona = String(personaHint ?? '');
  const settings = String(settingsText ?? '');
  const msg = String(text ?? '');

  let memory = clampWeight(base);
  let emotion = clampWeight(base);

  // 人格卡：风格影响两者
  if (PERSONA_WARM.test(persona)) emotion += 1;
  if (PERSONA_COOL.test(persona)) emotion -= 1;
  if (PERSONA_NOSTALGIC.test(persona)) memory += 1;

  // 设定：明确说"别翻旧账"就压记忆；说"多关心"就抬情绪
  if (SETTING_NO_REMINISCE.test(settings)) memory -= 1;
  if (SETTING_CARE.test(settings)) emotion += 1;

  // 语境：技术提问压低两者，情绪化表达抬高情绪
  if (TECHNICAL.test(msg)) { memory -= 1; emotion -= 1; }
  if (/[！!]{2,}|哈哈|笑死|呜呜|啊啊|？？/.test(msg)) emotion += 1;

  return { memory: clampWeight(memory), emotion: clampWeight(emotion) };
}

/**
 * 取出生效权重：auto 打开时用自动值，否则用手动值。
 * 手动值只有开发者能写进全局配置；普通用户档案里即使有也会被忽略。
 */
export function resolveWeights(cfg = {}, { personaHint = '', settingsText = '', text = '' } = {}) {
  const w = cfg.role?.weights ?? {};
  const auto = w.auto !== false;
  const baseMem = clampWeight(w.memory?.value ?? WEIGHT_DEFAULT);
  const baseEmo = clampWeight(w.emotion?.value ?? WEIGHT_DEFAULT);
  if (!auto) return { memory: baseMem, emotion: baseEmo, auto: false };
  const autoVals = autoWeights({ personaHint, settingsText, text, base: WEIGHT_DEFAULT });
  // auto 时仍允许用 value 作为偏置？不：auto 完全接管，避免两套逻辑打架
  return { ...autoVals, auto: true };
}

/** 记忆权重 → 注入字符预算（默认 500 字 ≈ 权重 3）。 */
export function memoryBudget(weight) {
  const w = clampWeight(weight);
  return { always: Math.round(500 * (0.4 + 0.2 * w)), relevant: Math.round(500 * (0.4 + 0.2 * w)) };
}

/** 记忆权重 → 相关条目上限（默认 6 条 ≈ 权重 3）。 */
export function memoryHitLimit(weight) {
  return Math.max(2, Math.min(9, Math.round(clampWeight(weight) * 2)));
}
