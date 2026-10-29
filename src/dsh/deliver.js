// DSH 投递内容组装：唤醒快照后缀、文本/图片 parts、错误文案脱敏。
// 真正的会话创建/发送仍由 bridge 的 deliverPromptNow 负责。

/** 唤醒快照拼到 prompt 末尾；snapshot 为空则原样返回。 */
export function appendWakeSnapshot(promptText, snapshot) {
  if (!snapshot) return promptText;
  return promptText + `\n\n【本次消息快照】\n${JSON.stringify(snapshot)}\n以上消息已提供，无需重复查询；partial=true 时用 qq_get_unread_messages(afterSeq=readThroughSeq) 继续读取。先处理当前消息；回复前如需确认后续补充，用 qq_wait_for_messages(purpose="reply") 补足短静默，已安静够久会立即返回，不要先长等。收尾只确认你已处理的 readThroughSeq（本地 seq，非 QQ messageId），传给 qq_mark_read 或 qq_set_wake_config 的 throughSeq；新到消息留待处理。`;
}

/**
 * 组装 DSH prompt 的 content parts。
 * @param {object} args
 * @param {string} args.promptText
 * @param {Array} [args.media]
 * @param {(text:string)=>string} args.withSlangContext
 * @param {(media:Array)=>Promise<Array>} args.resolveMediaList
 */
export async function buildDeliveryContent({ promptText, media = [], withSlangContext, resolveMediaList }) {
  if (Array.isArray(media) && media.length > 0) {
    const imageParts = await resolveMediaList(media);
    return [{ type: 'text', text: withSlangContext(promptText) }, ...imageParts];
  }
  return [{ type: 'text', text: withSlangContext(promptText) }];
}

/** 投递失败时的提示文案：命中敏感规则时隐藏错误详情。 */
export function deliveryErrorText({ code = '', message = '', shouldRedact = false } = {}) {
  const text = `${code}: ${message}`;
  return shouldRedact ? '（含敏感信息，已隐藏）' : text;
}
