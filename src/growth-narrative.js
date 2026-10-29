// 成长 M4：自我叙事（把一周经历压成 2 句话）
//
// 原则：
//   · 只依据给定的片段，不编造
//   · 最多 2 句、≤100 字
//   · 模型失败/输出不合法 → 本地模板兜底
//   · 叙事只注入一行，不覆盖人格卡

const STAGE_NAMES = { new: '初识', settling: '熟悉', familiar: '交心', tacit: '默契' };

export function stageName(id) {
  return STAGE_NAMES[String(id ?? 'new')] ?? '初识';
}

/** 本地模板：只使用信号计数和少量摘要。 */
export function buildLocalNarrative({ stage = 'new', signals = {}, summaries = [] } = {}) {
  const sn = stageName(stage);
  const praise = Number(signals.praise ?? 0);
  const repair = Number(signals.repair ?? 0);
  const conflict = Number(signals.conflict ?? 0);
  const nights = Number(signals.lateNight ?? 0);

  const parts = [];
  parts.push(`我们最近到了「${sn}」这个阶段。`);
  if (praise > 0) parts.push('他夸过我，也愿意跟我说些日常。');
  else if (conflict > 0) parts.push('有过几次不太愉快，后来慢慢说开了。');
  else if (nightSuffix(nights)) parts.push('有几次聊到很晚。');
  else parts.push('聊的都是些普通的小事。');
  if (repair > 0 && conflict > 0) parts.push('吵架之后我道过歉。');
  else if (summaries[0]) parts.push(String(summaries[0]).slice(0, 30) + '。');

  return parts.join('').slice(0, 110);
}

function nightSuffix(n) { return n > 0; }

/** 构造模型叙事 prompt。 */
export function buildNarrativePrompt({ stage = 'new', signals = {}, summaries = [] } = {}) {
  const list = summaries.slice(0, 8).map((s, i) => `[${i}] ${String(s).slice(0, 80)}`).join('\n');
  return [
    '你在帮一个 QQ 机器人写「这一周的自述」。',
    '要求：',
    '1. 只用下面列出的片段，不要编造没发生的事',
    '2. 2 句话以内，总字数不超过 80',
    '3. 第一人称，像在跟朋友随口说，不要客套、不要列表',
    '4. 不要提“记录/总结/数据”这类词',
    '5. 不要写号码、地址、密码、秘密这类敏感信息',
    '',
    `当前阶段：${stageName(stage)}`,
    `本周信号：表扬 ${signals.praise ?? 0} / 冲突 ${signals.conflict ?? 0} / 修复 ${signals.repair ?? 0} / 深夜 ${signals.lateNight ?? 0}`,
    '',
    '片段：',
    list || '（这周没什么特别的）'
  ].join('\n');
}

/** 清洗模型输出：去引号/换行，限制长度。 */
export function parseNarrative(raw) {
  let out = String(raw ?? '');
  out = out.replace(/```[a-zA-Z]*/g, '').replace(/\x60/g, '');
  out = out.replace(/\s*\n+\s*/g, ' ');
  out = out.replace(/^["\'“”‘’\s]+|["\'“”‘’\s]+$/g, '').trim();
  if (!out) return null;
  if (/^(无|没有|暂无)$/.test(out)) return null;
  return out.slice(0, 100);
}

/** 检查叙事是否明显超纲（长度/列表感）。 */
export function isValidNarrative(text) {
  const s = String(text ?? '').trim();
  if (!s) return false;
  if (s.length > 100) return false;
  if (/^[-*•]/.test(s)) return false;
  return true;
}
