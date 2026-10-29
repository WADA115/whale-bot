// 新 gate：规则先筛，剩下的交给廉价模型；只决定“值不值得叫醒 agent”。
import { formatRecentLine, formatCurrentLine } from '../group-history.js';
import { parseClassifyAnswer } from '../group-classify.js';

function botName(cfg) {
  return String(cfg.role?.displayName || '鱼鱼');
}

function nameKeywords(cfg) {
  const kws = Array.isArray(cfg.role?.groupNameKeywords) ? cfg.role.groupNameKeywords.filter(Boolean) : [];
  return kws.length ? kws : ['小鲸鱼', '鱼鱼'];
}

/** @returns {{candidate:boolean|null, reason:string, source:'rules'|'model'|'fallback'}} */
export function ruleGate({ event = {}, cfg = {} } = {}) {
  if (event.sender?.isSelf) return { candidate: false, reason: '自己发的', source: 'rules' };
  const at = Array.isArray(event.at) ? event.at : [];
  if (at.includes('你')) return { candidate: true, reason: 'at 了机器人', source: 'rules' };
  const text = String(event.text ?? '');
  if (nameKeywords(cfg).some((k) => text.includes(k))) return { candidate: true, reason: '叫了名字', source: 'rules' };
  if (event.sender?.isBot) return { candidate: false, reason: '其他 bot 说的', source: 'rules' };
  if (at.length && !at.includes('你')) return { candidate: false, reason: 'at 了别人', source: 'rules' };
  if (Array.isArray(event.media) && event.media.length) return { candidate: true, reason: '带媒体', source: 'rules' };
  if (!text.trim()) return { candidate: false, reason: '空消息', source: 'rules' };
  return { candidate: null, reason: '需要模型判断', source: 'rules' };
}

export function buildGatePrompt({ event = {}, thread = {}, cfg = {} } = {}) {
  const name = botName(cfg);
  const others = Array.isArray(cfg.role?.smartTrigger?.otherBots)
    ? cfg.role.smartTrigger.otherBots.filter(Boolean).slice(0, 10) : [];
  const history = (thread.events ?? []).slice(-20).map((e) => formatRecentLine({ name: e.sender?.name ?? e.name, text: e.text, at: e.at, replyTo: e.replyTo, self: e.sender?.isSelf ?? e.self })).join('\n');
  const otherLine = others.length ? `\n群里其他机器人/账号：${others.join('、')}；@它们、它们说的话不算叫你。` : '';
  const system = `你在帮 QQ 群机器人「${name}」判断：最新这条消息值不值得叫醒它来回应。
只输出一个字：是 或 否。
规则：
- @ 了「${name}」、叫它的名字、或接着它上一句追问 → 是
- @ 了别人/别的机器人、明显在跟别人说话 → 否
- 群里只有一两个人闲聊、内容与它无关 → 否
- 带图片/文件/语音、明显需要它看 → 是
- 拿不准时判「是」（宁可多接一句，也不要像没听见）${otherLine}`;
  const current = formatCurrentLine({
    senderName: event.sender?.name ?? '',
    at: event.at ?? [],
    text: event.text ?? ''
  });
  const user = `${history ? `最近群聊：\n${history}\n\n` : ''}${current}`;
  return { system, user };
}

/**
 * @param {object} args
 * @param {(p:{system:string,user:string})=>Promise<{content:string,reasoning?:string}>} [args.ask]
 */
export async function evaluateGate({ event = {}, thread = {}, cfg = {}, ask } = {}) {
  const ruled = ruleGate({ event, cfg });
  if (ruled.candidate !== null) return ruled;
  if (typeof ask !== 'function') return { candidate: false, reason: 'no-model', source: 'fallback' };
  try {
    const { system, user } = buildGatePrompt({ event, thread, cfg });
    const out = await ask({ system, user });
    const verdict = parseClassifyAnswer(out?.content ?? '', out?.reasoning ?? '');
    return { candidate: verdict.addressed, reason: verdict.reason, source: 'model' };
  } catch (error) {
    return { candidate: true, reason: 'gate-error→是', source: 'fallback' };
  }
}
