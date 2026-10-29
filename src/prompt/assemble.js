// 闭代理（closed-agent）提示词拼装：从 bridge.js 抽出的纯函数。
// 只负责顺序和分隔符，不读文件、不碰状态，方便快照测试与后续拆分。

export function buildClosedAgentPrompt(parts = {}) {
  const {
    roleHint = '',
    personaAnchor = '',
    sessionTokenLine = '',
    ctxBlock = '',
    moodBlock = '',
    emotionBlock = '',
    memoryBlock = '',
    recallBlock = '',
    groupContextBlock = '',
    isOwner = false,
    isDeveloper = false,
    kind = 'private',
    senderName = '',
    content = '',
    mediaHint = ''
  } = parts;

  return (roleHint ? roleHint + '\n\n' : '')
    + (personaAnchor ? personaAnchor + '\n\n' : '')
    + sessionTokenLine
    + ctxBlock
    + moodBlock
    + emotionBlock
    + memoryBlock
    + recallBlock
    + (groupContextBlock ? `【最近群聊】（供参考，不需要逐条回应）\n${groupContextBlock}\n\n【当前消息】` : '')
    + (isOwner ? '【管理员】' : (isDeveloper ? '【开发者】' : ''))
    + (kind === 'group' ? `${senderName}：${content}` : content)
    + mediaHint
    + (personaAnchor ? '\n\n' + personaAnchor : '');
}
