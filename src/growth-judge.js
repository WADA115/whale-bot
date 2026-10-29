// 成长 · 压缩与判断（M1）
//
// 纯函数为主：规则兜底、prompt 构造、模型输出解析、日摘要生成。
// 模型调用本身在 app.js 里做（不在插件里），这样插件炸了也不影响判断。

export const SCORE_KEEP = 2;

const NOISE = /^(嗯+|哦+|好+|行|可|可以|哈+|呵+|嘿+|草|6+|？+|\?+|。+|…+|收到|ok|OK)$/i;

export function isNoise(text) {
  const s = String(text ?? '').trim();
  if (!s || s.length < 6) return true;
  if (NOISE.test(s)) return true;
  if (!/[\u4e00-\u9fa5a-zA-Z]/.test(s)) return true;
  return false;
}

export function fingerprint(text) {
  return String(text ?? '')
    .replace(/[\s，。！？、,.!?~～…（）()【】\[\]"'“”‘’]/g, '')
    .toLowerCase()
    .slice(0, 60);
}

/** 规则兜底：模型不可用时，只留「有信息量」的句子。 */
export function ruleJudge(text) {
  const s = String(text ?? '');
  if (isNoise(s)) return { keep: false, score: 0, kind: 'noise' };
  const info = /喜欢|讨厌|约定|以后|下次|记住|别叫|叫我|生日|习惯|怕|想要|梦想|工作|学校|朋友|家人|失眠|熬夜|难受|开心|生气|道歉|谢谢|对不起/.test(s);
  const emotion = /[！!]{2,}|哈哈|笑死|呜呜|啊啊|？？/.test(s);
  const length = s.length >= 18;
  if (info) return { keep: true, score: 3, kind: 'info' };
  if (emotion || length) return { keep: true, score: 2, kind: emotion ? 'emotion' : 'chat' };
  return { keep: s.length >= 10, score: 1, kind: 'chat' };
}

/** 构造模型判断的 prompt（只给候选片段，编号从 0 开始）。 */
export function buildJudgePrompt(items) {
  const list = items.map((it, i) => `[${i}] ${String(it.text ?? '').slice(0, 160)}`).join('\n');
  return [
    '你在帮一个 QQ 机器人筛选「值得长期记住的聊天片段」。',
    '逐条打分（0~3），只输出 JSON，不要解释：',
    '3 = 新信息 / 关系事件 / 明确偏好或约定',
    '2 = 情绪明显 / 有互动价值',
    '1 = 普通闲聊',
    '0 = 废话、重复、无信息',
    '',
    '输出格式：{"items":[{"i":0,"score":3,"kind":"preference","text":"主人喜欢被叫笨蛋"}]}',
    'text 用一句简洁中文概括，不要保留原话里的脏话。',
    '',
    '片段：',
    list
  ].join('\n');
}

/** 解析模型输出；容忍 ```json 包裹和前后废话。 */
export function parseJudge(raw) {
  const s = String(raw ?? '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(s.slice(start, end + 1));
    if (!Array.isArray(obj.items)) return null;
    return obj.items
      .filter((x) => x && Number.isFinite(Number(x.i)))
      .map((x) => ({
        i: Number(x.i),
        score: Math.max(0, Math.min(3, Math.round(Number(x.score) || 0))),
        kind: String(x.kind ?? 'chat').slice(0, 20),
        text: String(x.text ?? '').slice(0, 200)
      }));
  } catch { return null; }
}

/** 把模型评分合并回候选；模型漏掉的条目用规则兜底。 */
export function mergeJudge(items, judged) {
  const map = new Map((judged ?? []).map((x) => [x.i, x]));
  return items.map((it, i) => {
    const m = map.get(i);
    if (m) return { ...it, score: m.score, kind: m.kind, summary: m.text || it.text };
    const r = ruleJudge(it.text);
    return { ...it, score: r.score, kind: r.kind, summary: it.text };
  });
}

/** 日摘要：只用保留项，控制在 ~220 字。 */
export function buildDigest(kept, date, keepScore = SCORE_KEEP) {
  const items = (kept ?? []).filter((x) => x.score >= keepScore);
  const lines = items.slice(0, 12).map((x) => `- ${x.summary || x.text}`);
  const text = lines.join('\n').slice(0, 240);
  return {
    date,
    count: items.length,
    text,
    kinds: items.reduce((acc, x) => {
      acc[x.kind || 'chat'] = (acc[x.kind || 'chat'] ?? 0) + 1;
      return acc;
    }, {})
  };
}
