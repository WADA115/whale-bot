// 底层发送原语：只负责把文本交给网关，不审核、不决策。
export function createTransport({ sendToQQ } = {}) {
  if (typeof sendToQQ !== 'function') throw new Error('sendToQQ required');
  return {
    sendRaw(key, text) {
      return sendToQQ(key, text);
    }
  };
}
