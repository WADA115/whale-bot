// 完整唤醒 prompt 组装：状态由 bridge 以 deps 传入，本模块只负责拼装。
// 这样快速改措辞/顺序时不用碰 bridge 的状态机。

import { buildWakeReasonSuffix } from './wake.js';

/**
 * @param {object} args
 * @param {string} args.key
 * @param {string} args.reason
 * @param {object} args.deps  状态读取与格式化函数、配置片段
 */
export function renderWakePromptV2({ key, reason, deps = {} }) {
  const {
    readRoleState,
    selfIdentityTextV2,
    getSocialV2State,
    formatMemoryV2,
    formatParticipationV2,
    stickerCfg = {},
    stickerEntries = [],
    buildStickerStrategyHint,
    buildStickerContext,
    preSleepMs = 300000,
    replyTimingV2,
    describeAge,
    looksLikeUnfinished,
    formatInitialPromptV2,
    buildTimeSenseLine,
    wakeReasonSeq,
    findV2MessageBySeq
  } = deps;

  const roleState = readRoleState();
  const roleLine = roleState.role ? `【当前角色】${roleState.role}（完整角色卡请调用 qq_get_prompt 查看）\n\n` : '';
  const identityLine = selfIdentityTextV2();
  const st = getSocialV2State(key);
  const tokenLine = `【会话令牌】${st.agentToken}（调用二代状态工具时请在参数中带上此令牌）\n\n`;
  const memoryText = formatMemoryV2(st);
  const memoryLine = memoryText ? `${memoryText}\n\n` : '';
  const participationText = formatParticipationV2(st);
  const participationLine = participationText ? `${participationText}\n\n` : '';
  const antiAiLine = '【反AI味】你不是客服：不用有求必应，可以装傻、已读乱回、拒绝推荐；少用“一绝/真管用/保证/绝对”这类词。\n\n';
  const stickerLine = stickerCfg.enabled !== false && stickerCfg.includeInPrompt !== false
    ? `${buildStickerStrategyHint()}\n${buildStickerContext(stickerEntries, stickerCfg.promptMaxStickers ?? 8)}\n\n`
    : '';
  const proactiveLine = '【积极性】不要习惯性潜水：群里有你能接的话题就主动参与，偶尔插一句别人的话题也很正常；只有确实没话可说、对方已明确结束、或长时间没人说话时才潜水。\n\n';
  const replyTiming = replyTimingV2(st);
  const replyLine = `【首回复节奏】先处理已有消息，完整的问题及时回答。需要确认对方是否继续补充时，用 qq_wait_for_messages(purpose="reply", quietMs=${replyTiming.quietMs})；从最后来信计时，合批和读提示词的耗时也算，目前还差约 ${Math.ceil(replyTiming.remainingQuietMs / 1000)} 秒静默。已安静够久可直接回，工具也会立即返回并补上思考期间的新消息。只有明确没说完、你确实要等下文时，才用普通 messages 长等待。\n\n`;
  const preSleepLine = `【沉睡前强制等待】这是决定潜水收尾时的步骤，不是首回复的前置条件。除非对方明确说“不聊了/晚安/下了/拜拜”等结束语，否则每次设置潜水/下一次唤醒前，必须先调用 qq_wait_for_messages(timeoutMs=${preSleepMs}) 完成一次沉睡前观察；回复前 purpose="reply" 的短静默不能代替这次完整观察。若 ${Math.round(preSleepMs / 60000)} 分钟内没人说话，返回 preSleepWaitSatisfied=true，可以设置下一次唤醒并沉睡；若期间有人发新消息，先查看返回的 newMessages——判断不需要你参与就可以直接沉睡，若你选择参与回复，则下次想睡时需要重新等待观察窗口。【不要靠猜】：等待返回里的 canSleepNow/hint 就是闸门的判断结果——canSleepNow=true 立刻收尾（mark_read 或 set_wake_config）；false 时按 hint 给出的 timeoutMs 一次等满，别用更短的 timeoutMs 去凑（更短的等待不算观察，只会白等一轮）。\n\n`;

  const lastMsg = [...(Array.isArray(st.recentMessages) ? st.recentMessages : [])].reverse().find((m) => m && !m.isSelf);
  const lastAiMin = st.lastAiReplyAt ? Math.max(0, Math.round((Date.now() - Number(st.lastAiReplyAt)) / 60000)) : null;
  const statusBits = [`未读 ${(st.unread || []).length} 条`];
  if (lastMsg) {
    const lastAgo = describeAge(lastMsg.time, Date.now());
    statusBits.push(`最近一条来自 ${String(lastMsg.sender || '未知')}${lastAgo ? `（${lastAgo} 前）` : ''}：${String(lastMsg.text || lastMsg.plain || '').slice(0, 30)}`);
  }
  if (lastMsg && looksLikeUnfinished(String(lastMsg.tail || lastMsg.plain || lastMsg.text || ''))) statusBits.push('对方可能没说完');
  if (lastAiMin != null) statusBits.push(`你上次发言 ${lastAiMin} 分钟前`);
  const statusLine = `【此刻状态】${statusBits.join('；')}\n\n`;

  const wc = st.wakeConfig || {};
  const wcTr = wc.triggers || {};
  const wcMode = wc.mode === 'active' ? '活跃' : '潜水';
  const wcTime = wc.infinite ? '无限' : (wc.sleepUntil && Number.isFinite(Date.parse(wc.sleepUntil)) ? `有限至 ${new Date(wc.sleepUntil).toLocaleString()}` : '未设时间');
  const wcTriggers = [];
  if (wcTr.atMention) wcTriggers.push('@');
  if (wcTr.nameMention) wcTriggers.push('名字');
  if (Array.isArray(wcTr.keywords) && wcTr.keywords.length) wcTriggers.push('关键词');
  if (wcTr.question) wcTriggers.push('提问');
  if (wcTr.poke) wcTriggers.push('拍一拍');
  if (Array.isArray(wcTr.speakerIds) && wcTr.speakerIds.length) wcTriggers.push(`指定成员(${wcTr.speakerIds.length}:${wcTr.speakerIds.join(',')})`);
  if (wcTr.anyMessage) wcTriggers.push('任意消息');
  if (Number(wcTr.probability) > 0) wcTriggers.push(`概率${wcTr.probability}`);
  const wakeLine = `【当前唤醒】${wcMode}，${wcTime}${wcTriggers.length ? `；触发：${wcTriggers.join('/')}` : ''}\n\n`;

  const initialPromptText = reason === 'bootstrap' ? formatInitialPromptV2(key) : '';
  const initialPromptLine = initialPromptText ? `${initialPromptText}\n\n` : '';
  const timeSenseLine = buildTimeSenseLine(st);
  const base = roleLine + identityLine + tokenLine + initialPromptLine + antiAiLine + proactiveLine + stickerLine + replyLine + statusLine + wakeLine + memoryLine + participationLine + preSleepLine + timeSenseLine;

  const triggeredSeq = wakeReasonSeq(reason);
  const triggeredMsg = triggeredSeq ? findV2MessageBySeq(st, triggeredSeq) : null;
  const triggeredAgo = triggeredMsg ? describeAge(triggeredMsg.time, Date.now()) : '';
  const triggeredLine = triggeredAgo ? `（触发这条是 ${triggeredAgo} 前发的${triggeredMsg?.sender ? `，来自「${triggeredMsg.sender}」` : ''}，不是刚刚）` : '';
  return `${base}${buildWakeReasonSuffix({ reason, key, triggeredLine, preSleepMs })}`;
}
