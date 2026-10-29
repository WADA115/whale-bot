// 叙事对外审核：主人私聊之外，叙事必须先过这一层。
//
// 目标：不让私人记忆/身份信息/敏感话题跟着提示词进群或进别人私聊。
// 做法（规则，纯本地，零成本）：
//   1. 分句，逐句检查
//   2. 句子里有「秘密 / 密码 / 地址 / 电话 / 银行卡 / 身份证 / 吵架」等 → 整句丢弃
//   3. 句子里有 QQ 号 / 手机号 / 邮箱 / 链接 → 打码或丢弃
//   4. 剩下的句子拼起来，最多 60 字；太少就宁可不注入
//
// 返回 null 表示「不适合对外说」，调用方直接跳过。

const DROP_SENTENCE = /秘密|别告诉|只告诉你|偷偷|密码|身份证|银行卡|住址|地址|电话|手机号|微信|支付宝|转账|吵架|吵起来|生气|讨厌|滚|烦死|分手|抑郁|自杀/;
const MASK = [
  [/(?:\+?86[-\s]?)?1[3-9]\d{9}/g, '[手机号]'],
  [/\b\d{5,12}\b/g, '[号码]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[邮箱]'],
  [/https?:\/\/\S+/gi, '[链接]'],
  [/[A-Za-z]:\\[^\s，。；]+/g, '[路径]']
];

export function reviewNarrative(raw, { maxChars = 60 } = {}) {
  const text = String(raw ?? '').trim();
  if (!text) return null;

  const sentences = text
    .split(/(?<=[。！？!?；;])/)
    .map((s) => s.trim())
    .filter(Boolean);

  const kept = [];
  for (const sentence of sentences) {
    if (DROP_SENTENCE.test(sentence)) continue;
    let s = sentence;
    for (const [re, rep] of MASK) s = s.replace(re, rep);
    if (/\[(手机号|号码|邮箱|链接|路径)\]/.test(s)) {
      // 打码后信息量太低，整句不要
      continue;
    }
    kept.push(s);
  }

  const out = kept.join('').replace(/\s+/g, ' ').trim();
  if (out.length < 8) return null;
  return out.slice(0, maxChars);
}

/** 给面板/日志用：哪些句子被丢了。 */
export function reviewReport(raw) {
  const text = String(raw ?? '').trim();
  const sentences = text.split(/(?<=[。！？!?；;])/).map((s) => s.trim()).filter(Boolean);
  const dropped = sentences.filter((s) => DROP_SENTENCE.test(s) || MASK.some(([re]) => re.test(s)));
  return { total: sentences.length, dropped: dropped.length, kept: sentences.length - dropped.length };
}
