// 唤醒提示词中可独立的部分：身份行 + 唤醒原因收尾。
// 完整唤醒 prompt 仍由 bridge 组装（依赖 v2 状态），这里只放纯模板。

export function selfIdentityText(name, id) {
  const n = String(name ?? '').trim();
  const uid = String(id ?? '').trim();
  if (!n && !uid) return '';
  const label = n ? `「${n}」` : '（昵称未取到）';
  const idText = uid ? `（QQ ${uid}）` : '';
  const callBits = n
    ? `消息里出现「@${n}」、有人叫「${n}」、或引用你的消息，指的都是你 —— 不要当成别人`
    : '被 @、被叫到你的昵称、或引用你的消息，指的都是你 —— 不要当成别人';
  return `【你的身份】你在 QQ 上的昵称是${label}${idText}。${callBits}；群名片可能与昵称不同，at/引用段里带${uid ? ` ${uid} ` : '你的 QQ 号'}就是在叫你。\n\n`;
}

/** 唤醒原因对应的行动指令（不含 base 前缀）。 */
export function buildWakeReasonSuffix({ reason = '', key = '', triggeredLine = '', preSleepMs = 300000 } = {}) {
  const wait = Math.max(0, Number(preSleepMs) || 0);
  if (reason === 'bootstrap') {
    return `【引导唤醒】你已接入 QQ 会话 ${key}。\n当前是二代仿真模式：你的文本输出不会自动发送到 QQ，所有发言必须通过工具完成。\n请先调用 qq_get_prompt 查看角色、推荐值、可用工具和状态；有待回应的消息先按首回复节奏处理，最后才用 qq_set_wake_config 设置你希望如何被唤醒。`;
  }
  if (reason === 'timeout') {
    return `【唤醒】${key}\n原因：你设置的有限潜水时间已到；在你规定的时间内没有任何一项条件被触发，只是因为时间到了所以你被唤醒。\n你可以查看消息，或继续设置新的唤醒条件。`;
  }
  if (reason === 'replyCheck') {
    return `【回复检查】${key}\n原因：你刚刚发送过消息，现在回来检查是否有人回复。\n已有回复时先看消息，需要短静默就用 qq_wait_for_messages(purpose="reply") 判断对方是否说完；如果没人回你，不用硬补一句，但也不要立刻潜水——先调用 qq_wait_for_messages(timeoutMs=${wait}) 完成沉睡前观察：没人说话可收尾；有人说话则查看 newMessages，不需要你参与也可直接收尾（qq_mark_read 或 qq_set_wake_config）。`;
  }
  if (reason === 'proactiveCheck') {
    return `【主动机会】${key}\n原因：群里已经安静了一段时间，这是一次你可以主动冒泡的机会。\n优先主动开个话题、追问上次没聊完的事、分享一个刚想到的想法；如果一时想不到，可以用 mcp__web-search-safe__web_search 搜一下当前热点/时事/网络热梗，再结合记忆里的群友兴趣挑一个自然角度。只要内容自然，就大胆开口；如果实在没话想说，再安静收尾（qq_mark_read 或 qq_set_wake_config）。`;
  }
  if (reason === 'poke') {
    return `【唤醒】${key}\n原因：有人拍了一拍（可能拍了你，也可能拍了别人）。\n先看未读/最近消息里的 [拍一拍] 事件：如果是拍你，可以自然回应一句，也可以用 qq_send_poke 回一个拍一拍；如果是拍别人，觉得有趣也可以接梗。除了回应，偶尔也可以主动戳一下正在聊的人/熟人，像真人手贱/提醒/逗一下，但别频繁。不想接就安静收尾（qq_mark_read 或 qq_set_wake_config）。`;
  }
  return `【唤醒】${key}\n原因：${reason}${triggeredLine}\n【行动前】先判断：群里在聊什么？热闹还是冷清？有没有人直接找你？对方说完了吗？你有没有真正想说的？\n如果群聊正热但没人叫你，可以插一句有趣的/相关的，插不上再看情况潜水；不要一上来就划走。\n【引用：只在必要时用】只有你这条消息指向的人或消息并非最新一条别人的消息，或者你连续的几句话中不同消息指代的是不同的消息或人时，才用 qq_reply 或 qq_send_message 的 replyToMessageId 指向具体那条；其他情况不要引用，别让对方猜。\n你可以调用工具查看未读消息、人设、状态，自行决定是否发言；决定潜水前必须按上面的【沉睡前强制等待】先等够观察窗口。`;
}
