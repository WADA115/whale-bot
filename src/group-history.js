// 群聊判断器的线程格式化：让分类器看到“谁 @ 了谁、在回复谁、哪句是你自己、什么时候说的”。
function clockOf(ts) {
  if (!ts) return '';
  const d = new Date(Number(ts));
  if (!Number.isFinite(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function formatRecentLine({ name = '', text = '', at = [], replyTo = '', self = false, ts = 0 } = {}) {
  const tags = [];
  if (Array.isArray(at) && at.length) tags.push('@ ' + at.join('、'));
  if (replyTo) tags.push('回复 ' + replyTo);
  const tagText = tags.length ? `（${tags.join('；')}）` : '';
  const time = clockOf(ts);
  return `${time ? `[${time}] ` : ''}${self ? '[你] ' : ''}${name}${tagText}：${text}`;
}

export function formatCurrentLine({ senderName = '', at = [], text = '', ts = 0 } = {}) {
  const tagText = Array.isArray(at) && at.length ? `（@ ${at.join('、')}）` : '';
  const time = clockOf(ts);
  return `${time ? `[${time}] ` : ''}${senderName}${tagText}：${text}`;
}

/** 把 @ 目标转成名字；自己显示为「你」。 */
export function atLabel(qq, selfId, resolveName) {
  if (String(qq) === String(selfId)) return '你';
  const name = resolveName(qq);
  return name ? String(name).slice(0, 20) : `QQ${qq}`;
}
