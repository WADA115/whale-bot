// 思维层：pro 模型输出结构化 thought packet；只用于内部决策/影子日志，不外显。
import { formatRecentLine, formatCurrentLine } from '../group-history.js';

const MAX_KEYPOINTS = 5;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Number(n) || 0));

export function buildThinkerPrompt({ event = {}, thread = {}, roleHint = '', cfg = {}, extraContext = '' } = {}) {
  const name = String(cfg.role?.displayName || '鱼鱼');
  const others = Array.isArray(cfg.role?.smartTrigger?.otherBots)
    ? cfg.role.smartTrigger.otherBots.filter(Boolean).slice(0, 10) : [];
  const history = (thread.events ?? []).slice(-30)
    .map((e) => formatRecentLine({ name: e.sender?.name ?? e.name, text: e.text, at: e.at, replyTo: e.replyTo, self: e.sender?.isSelf ?? e.self }))
    .join('\n');
  const system = `你是 QQ 群机器人「${name}」的思维层。你只负责“想”，不负责“说”。
根据线程判断：这条消息要不要回、回给谁、核心意思是什么、有什么约束。

只输出一个 JSON 对象，不要 Markdown、不要解释。字段：
{
  "shouldReply": true/false,
  "target": "回给谁（群友名/你）",
  "intent": "answer_question|join_chat|comfort|tease|clarify|ignore",
  "keyPoints": ["最多 4 条，每条不超过 40 字"],
  "emotion": { "valence": -1~1, "arousal": 0~1, "stance": "neutral|playful|serious|soft" },
  "delivery": { "bubbles": 0, "length": "short|normal|long", "pacing": "single|burst", "reason": "为什么这样分条" },
  "constraints": ["最多 4 条，如：一句话、别解释梗、别用列表"],
  "confidence": 0~1
}

判断原则：
- @ 了「${name}」、叫它名字、接着它上一句追问 → shouldReply=true
- @ 了别人 / 其他机器人、明显在跟别人说话 → false
- 拿不准时倾向 true，但 keyPoints 要短
- 其他机器人：${others.length ? others.join('、') : '无'}
${roleHint ? `\n角色卡（只取风格，不要照抄）：\n${String(roleHint).slice(0, 6000)}` : ''}`;
  const current = formatCurrentLine({ senderName: event.sender?.name ?? '', at: event.at ?? [], text: event.text ?? '' });
  const user = `${extraContext ? `【召回/心理】\n${String(extraContext).slice(0, 1600)}\n\n` : ''}${history ? `最近线程：\n${history}\n\n` : ''}${current}`;
  return { system, user };
}

export function parseThought(text) {
  const raw = String(text ?? '').replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  if (!raw) return null;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let data;
  try { data = JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const keyPoints = (Array.isArray(data.keyPoints) ? data.keyPoints : [])
    .map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, MAX_KEYPOINTS).map((x) => x.slice(0, 120));
  const deliveryRaw = data.delivery && typeof data.delivery === 'object' ? data.delivery : {};
  const bubbles = Math.max(0, Math.min(20, Math.round(Number(deliveryRaw.bubbles) || 0)));
  const delivery = {
    bubbles,
    length: ['short', 'normal', 'long'].includes(deliveryRaw.length) ? deliveryRaw.length : 'normal',
    pacing: ['single', 'burst'].includes(deliveryRaw.pacing) ? deliveryRaw.pacing : 'single',
    reason: String(deliveryRaw.reason ?? '').slice(0, 80)
  };
  const constraints = (Array.isArray(data.constraints) ? data.constraints : [])
    .map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 4).map((x) => x.slice(0, 80));
  const emo = data.emotion && typeof data.emotion === 'object' ? data.emotion : {};
  return {
    shouldReply: data.shouldReply === true,
    target: String(data.target ?? '').slice(0, 40),
    intent: String(data.intent ?? 'ignore').slice(0, 30),
    keyPoints,
    delivery,
    emotion: {
      valence: clamp(emo.valence, -1, 1),
      arousal: clamp(emo.arousal, 0, 1),
      stance: ['neutral', 'playful', 'serious', 'soft'].includes(emo.stance) ? emo.stance : 'neutral'
    },
    constraints,
    confidence: clamp(data.confidence, 0, 1)
  };
}

export async function think({ event, thread, roleHint = '', cfg = {}, ask, extraContext = '' } = {}) {
  if (typeof ask !== 'function') return null;
  const { system, user } = buildThinkerPrompt({ event, thread, roleHint, cfg, extraContext });
  const out = await ask({ system, user });
  const first = String(out?.content ?? '').trim();
  let parsed = parseThought(first);
  if (!parsed) {
    const retry = await ask({
      system: system + '\n\n上一次输出不是合法 JSON。只输出一个 JSON 对象。',
      user
    });
    parsed = parseThought(String(retry?.content ?? '').trim());
  }
  if (!parsed) {
    return {
      shouldReply: true,
      target: '',
      intent: 'answer',
      keyPoints: ['用一句话回应对方，别编造事实'],
      delivery: { bubbles: 0, length: 'normal', pacing: 'single', reason: 'fallback' },
      emotion: { valence: 0, arousal: 0.25, stance: 'neutral' },
      constraints: ['简短', '口语'],
      confidence: 0.2,
      fallback: true
    };
  }
  return parsed;
}
