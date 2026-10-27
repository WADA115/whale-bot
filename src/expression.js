// 表达引擎：让回复"像个人在说话"，而不是一段文本。
//
// 三件事：
//   1. 润色（polish）：去掉 AI 腔和书面语，但**不改意思**。纯规则，零延迟。
//   2. 情绪（mood）：从对方的话里估一个情绪分，衰减，用来决定语气和要不要发表情。
//   3. 配表情（pickSticker / decideExtras）：句子里出现"笑/无语/生气"这类词时，
//      找库里最贴的表情；带冷却和概率，避免每条都甩表情。
//
// 为什么不做成"再调一次模型润色"：每条回复多一次调用，慢且贵，
// 而 AI 腔主要是固定词句，规则能覆盖八成。

/** 书面/AI 腔 → 口语。只做安全的替换，不改变语义。 */
const POLISH_RULES = [
  // 注意：中文不是 \w，\b 在 JS 里对汉字无效，所以这里不能用 \b 做边界
  [/(?:作为|身为)(?:一个|一名)?\s*AI(?:\s*语言模型|\s*助手)?[，,]?/gi, ''],
  [/(?:作为|身为)(?:一个|一名)?(?:人工智能|助手|语言模型)[，,]?/gi, ''],
  [/首先[，,]?/g, ''],
  [/其次[，,]?/g, '另外'],
  [/最后[，,]?/g, ''],
  [/总的来说[，,]?/g, '反正'],
  [/总而言之[，,]?/g, '反正'],
  [/需要注意的是[，,]?/g, ''],
  [/希望(这个|上述)?(回答|内容|信息)?(能)?(对你)?(有所)?帮助[。！!]?/g, ''],
  [/如果你(还)?有(任何)?(其他)?(问题|疑问)[，,]?(随时|欢迎)[^。！!？?]*[。！!？?]?/g, ''],
  [/需要我(再)?(帮你)?(做|试)(点|些)?别的吗[？?]?/g, ''],
  [/很抱歉[，,]?/g, '抱歉，'],
  [/非常抱歉[，,]?/g, '抱歉，'],
  [/我理解你的(感受|心情)[。，,]?/g, ''],
  [/请(注意|知悉)[，,]?/g, ''],
  [/以下是[^：:]*[：:]/g, ''],
  [/\*\*/g, ''],
  [/`/g, ''],
  // 列表符号放在 ** 之后处理，否则 "**重点**" 会被当成列表项吃掉一个星号
  [/^(?:\d+[.、)]|[-*•])\s*/gm, ''],
  [/——/g, '，'],
  [/;；/g, '，'],
];

export function polishReply(text) {
  let s = String(text ?? '');
  for (const [re, to] of POLISH_RULES) s = s.replace(re, to);
  // 收拾残留：连续标点、行首空白、多余空行
  s = s
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^[\s，。]+/, '')
    .replace(/[，,]{2,}/g, '，')
    .replace(/([。！？!?])\1+/g, '$1')
    .trim();
  return s;
}

// ── 情绪 ────────────────────────────────────────────────────────────────
const POSITIVE = [
  ['笑死', 2], ['哈哈', 2], ['笑', 1], ['好耶', 2], ['牛', 1], ['厉害', 2], ['喜欢', 2],
  ['可爱', 2], ['谢谢', 1], ['爱你', 3], ['太棒', 2], ['舒服', 1], ['开心', 2], ['好玩', 1],
  ['可以啊', 1], ['不错', 1], ['赞', 1], ['强', 1], ['好欸', 2], ['爽', 1]
];
const NEGATIVE = [
  ['烦', 1], ['烦死', 2], ['生气', 2], ['气死', 3], ['无语', 1], ['难绷', 1], ['难受', 2],
  ['难过', 2], ['哭', 1], ['累', 1], ['烦人', 2], ['讨厌', 2], ['滚', 2], ['傻', 1],
  ['弱智', 2], ['烂', 1], ['恶心', 2], ['烦死了', 3], ['不爽', 2], ['崩', 1], ['寄', 1]
];

/** 粗估情绪分：正数偏开心，负数偏不爽，0 平静。 */
export function moodFromText(text) {
  const s = String(text ?? '');
  if (!s) return 0;
  let score = 0;
  for (const [w, v] of POSITIVE) if (s.includes(w)) score += v;
  for (const [w, v] of NEGATIVE) if (s.includes(w)) score -= v;
  // 反问/质问偏负面；感叹号多个偏激动
  if (/[?？]{2,}|是不是有病|凭什么/.test(s)) score -= 1;
  const bangs = (s.match(/[!！]/g) ?? []).length;
  if (bangs >= 2) score += score >= 0 ? 1 : -1;
  return Math.max(-5, Math.min(5, score));
}

export function moodLabel(score) {
  const s = Number(score) || 0;
  if (s >= 4) return '乐得不行';
  if (s >= 2) return '心情不错';
  if (s > 0) return '有点小开心';
  if (s === 0) return '平静';
  if (s > -2) return '有点嫌弃';
  if (s > -4) return '不太爽';
  return '在生气边缘';
}

/** 带衰减的情绪状态（每次对话往里喂一点，时间久了自动回中）。 */
export function createMood({ halfLifeMs = 40 * 60 * 1000 } = {}) {
  let score = 0;
  let at = Date.now();
  const decay = () => {
    const now = Date.now();
    const dt = now - at;
    at = now;
    if (dt <= 0) return;
    score *= Math.pow(0.5, dt / halfLifeMs);
  };
  return {
    feed(text) {
      decay();
      score = Math.max(-5, Math.min(5, score + moodFromText(text) * 0.8));
      return score;
    },
    get() {
      decay();
      return Math.round(score * 10) / 10;
    },
    label() {
      return moodLabel(score);
    },
    reset() { score = 0; at = Date.now(); },
  };
}

// ── 配表情 ──────────────────────────────────────────────────────────────
// 关键词 → 适合的表情特征（用于给表情库打分）
const STICKER_HINTS = [
  { words: ['笑', '哈', '乐', '好耶'], tags: ['笑', '哈', '开心', '乐'] },
  { words: ['无语', '难绷', '服了', '醉了'], tags: ['无语', '白眼', '？', '?', '翻'] },
  { words: ['气', '烦', '讨厌', '滚'], tags: ['气', '怒', '打', '刀'] },
  { words: ['哭', '难受', '崩', '寄'], tags: ['哭', '泪', '难过'] },
  { words: ['可爱', '喜欢', '爱', '好萌'], tags: ['可爱', '爱', '心', '萌'] },
  { words: ['困', '睡', '累'], tags: ['睡', '困', '累', 'zzz'] },
  { words: ['惊', '震惊', '卧槽', 'wc'], tags: ['惊', '震', '呆'] },
  { words: ['赞', '牛', '厉害', '强'], tags: ['赞', '强', '牛', '大拇指'] }
];

/**
 * 从表情库里挑一个最贴合这句话的。
 * 打分：备注/标签命中关键词 + 最近没用过 + 用过次数少。
 */
export function pickSticker(entries, text, { now = Date.now() } = {}) {
  const list = Array.isArray(entries) ? entries.filter((e) => e && (e.id || e.resId || e.url)) : [];
  if (!list.length) return null;
  const s = String(text ?? '');
  const hints = [];
  for (const h of STICKER_HINTS) {
    if (h.words.some((w) => s.includes(w))) hints.push(...h.tags);
  }
  const scored = list.map((e) => {
    const hay = `${e.desc ?? ''} ${e.localNote ?? ''} ${(e.tags ?? []).join(' ')}`.toLowerCase();
    let score = 0;
    for (const t of hints) if (hay.includes(String(t).toLowerCase())) score += 2;
    // 冷却：15 分钟内用过的降权
    const usedAgo = now - (e.lastUsedAt ?? 0);
    if (usedAgo < 15 * 60 * 1000) score -= 3;
    score -= Math.min(3, (e.useCount ?? 0) * 0.3);
    score += Math.random() * 1.2; // 一点随机，别总是同一张
    return { entry: e, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].entry;
}

/** 这句话是否适合配表情（陈述长句就不配了）。 */
export function worthSticker(text) {
  const s = String(text ?? '').trim();
  if (!s) return false;
  if (s.length > 120) return false;
  if (/^(好|嗯|行|可以|ok)?$/i.test(s)) return true;
  return STICKER_HINTS.some((h) => h.words.some((w) => s.includes(w))) || s.length <= 20;
}

/**
 * 决定这条回复要不要额外发点东西。
 * 返回 { sticker: boolean, face: boolean, draw: boolean, reason }
 */
export function decideExtras({ text, mood = 0, cfg = {}, rng = Math.random, recent = {} } = {}) {
  const c = cfg.role?.expression ?? {};
  if (c.enabled === false) return { sticker: false, face: false, draw: false, reason: 'disabled' };
  const stickerChance = Number(c.stickerChance ?? 0.22);
  const faceChance = Number(c.faceChance ?? 0.12);
  const drawChance = Number(c.drawChance ?? 0.02);
  const now = Date.now();
  const cooldown = Number(c.cooldownMs ?? 90 * 1000);

  const sticker = worthSticker(text)
    && now - (recent.lastStickerAt ?? 0) > cooldown
    && rng() < stickerChance + (Math.abs(mood) >= 3 ? 0.08 : 0);

  // 小黄脸：便宜、必达，用来补语气；和表情包二选一
  const face = !sticker
    && now - (recent.lastFaceAt ?? 0) > cooldown
    && rng() < faceChance;

  // 画图：只在"提到了画/图/自己长啥样"时，且概率很低
  const draw = /(画|图|长什么样|自画像|示意)/.test(String(text ?? ''))
    && now - (recent.lastDrawAt ?? 0) > 10 * 60 * 1000
    && rng() < 0.35 + drawChance;

  return { sticker, face, draw, reason: `${mood.toFixed?.(1) ?? mood}` };
}

// ── 情感 → 小黄脸 ────────────────────────────────────────────────────────
// 小黄脸一定能发出去（不像表情包依赖 CDN），所以它是"补语气"的兜底。
const FACE_BY_MOOD = [
  { words: ['笑', '哈', '乐', '好耶', '棒'], id: 14 },   // 微笑
  { words: ['无语', '难绷', '服了', '醉了', '白眼'], id: 22 }, // 白眼
  { words: ['气', '烦', '讨厌', '滚'], id: 11 },          // 发怒
  { words: ['哭', '难受', '崩', '寄'], id: 9 },           // 大哭
  { words: ['惊', '震惊', '卧槽', 'wc', '？'], id: 0 },   // 惊讶
  { words: ['赞', '牛', '厉害', '强'], id: 79 },          // 强
  { words: ['困', '睡', '累'], id: 25 },                  // 困
  { words: ['可爱', '喜欢', '爱你', '萌'], id: 66 },      // 爱心
  { words: ['尴尬', '社死'], id: 10 },                    // 尴尬
  { words: ['馋', '想吃', '好吃'], id: 24 },              // 饥饿
];

/** 按句子内容挑一个合适的小黄脸 id；挑不到返回 0（惊讶）以外的常见表情。 */
export function pickFace(text, mood = 0) {
  const s = String(text ?? '');
  for (const row of FACE_BY_MOOD) {
    if (row.words.some((w) => s.includes(w))) return row.id;
  }
  if (mood >= 3) return 14;   // 心情好 → 微笑
  if (mood <= -3) return 22;  // 心情差 → 白眼
  return null;
}