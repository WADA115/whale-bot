// 语境 / 唤醒 / 主动提示词模板：从 bridge.js 抽出。
// 只拼字符串；上下文由调用方用 buildContextBlock 收集后传进来。

export const SILENT_MARKER = '[SILENT]';
export const SPACE_SPLIT_HINT = '想分多条消息时用空格分隔；不想分条就不要加空格，用标点连接。注意：中英文/数字之间的空格也会被当作分条信号。';
export const DIRECTION_HINT = '注意：消息里的 [引用 某人：...] 表示这句话是在回应被引用的人；引用的是你的消息才是在找你，引用别人时别默认是在找你。';

/** 活跃阶段：只贴新消息；allowSilent=false 表示这条必须回。 */
export function buildBatchPromptText({ lines = '', allowSilent = true } = {}) {
  const directionHint = lines.includes('[引用') ? `${DIRECTION_HINT}\n` : '';
  if (!allowSilent) {
    return `【新消息】\n${lines}\n\n${directionHint}请回复消息。\n${SPACE_SPLIT_HINT}`;
  }
  return `【新消息】\n${lines}\n\n${directionHint}请根据情况决定是否回复。如果不需要回应、想潜水/不接话，请只输出 ${SILENT_MARKER}；否则正常回复。\n${SPACE_SPLIT_HINT}`;
}

/** 冷场试探。 */
export function buildProbePromptText({ contextBlock = '' } = {}) {
  return `【群聊上下文】\n${contextBlock}\n\n群里安静了一会儿，你可以说点什么。如果不想说，请只输出 ${SILENT_MARKER}。\n${SPACE_SPLIT_HINT}`;
}

/** 活跃超时退场。 */
export function buildActiveExitPromptText({ roleHint = '', contextBlock = '' } = {}) {
  let p = '';
  if (roleHint) p += roleHint + '\n\n';
  p += `【群聊上下文】\n${contextBlock}\n\n你已经参与群聊有一阵子了，现在该自然地收尾/潜水了。请说一句简短的退场话（例如“我先潜水了”“你们聊，我摸鱼去了”），说完后就安静下来，不再继续接话。`;
  return p;
}

/** 观望阶段主动开话题。 */
export function buildProactivePromptText({ roleHint = '', contextBlock = '' } = {}) {
  let p = '';
  if (roleHint) p += roleHint + '\n\n';
  p += `【群聊上下文】\n${contextBlock}\n\n群内已经长时间没人说话了，你打算开启一个新话题。优先结合你的人格/角色设定的兴趣，其次结合群里大家的兴趣，挑一个合适的话题。可以联网搜索一些新鲜话题来聊。如果你觉得现在不适合开口，可以只输出 ${SILENT_MARKER}。\n${SPACE_SPLIT_HINT}`;
  return p;
}
