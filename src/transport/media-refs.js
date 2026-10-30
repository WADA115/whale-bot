// 媒体引用：给上下文/工具用的“这条消息有没有图”与按消息 id 取媒体。
export function createMediaRefs({ getMode, getSocialV2State, hasV2Conversation, getMessageMediaStore } = {}) {
  function mediaHintFor(key, messageRef, mediaList) {
    if (!Array.isArray(mediaList) || mediaList.length === 0 || !messageRef) return '';
    if (getMode() === 'reserved2') {
      return `\n【图片/表情】本条消息包含 ${mediaList.length} 个图片/表情（消息ID=${messageRef}）。如需要查看/识别，请调用 mcp__snowluma__qq_get_message_images，参数 key="${key}", messageId="${messageRef}"。`;
    }
    return `\n【图片/表情】本条消息包含 ${mediaList.length} 个图片/表情（消息ID=${messageRef}）。`;
  }

  function findMessageMedia(key, ref) {
    const refStr = String(ref ?? '').trim();
    if (!refStr) return [];
    if (getMode() === 'reserved2' || hasV2Conversation(key)) {
      try {
        const st = getSocialV2State(key);
        if (st) {
          for (const messages of [st.recentMessages, st.unread]) {
            const found = (Array.isArray(messages) ? messages : []).find((m) => m && (String(m.messageId || '') === refStr || String(m.seq || '') === refStr));
            if (found && Array.isArray(found.media) && found.media.length) return found.media;
          }
        }
      } catch {}
    }
    const byRef = getMessageMediaStore().get(key);
    if (byRef) {
      const hit = byRef.get(refStr);
      if (Array.isArray(hit)) return hit;
      for (const [storedRef, media] of byRef) {
        if (String(storedRef) === refStr && Array.isArray(media)) return media;
      }
    }
    return [];
  }

  return { mediaHintFor, findMessageMedia };
}
