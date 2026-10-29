// 安全通知：专用通道，直接走 raw transport，避免 auditAndSend 递归。
export function createSecurityNotifier({ sendRaw, log = () => {} } = {}) {
  if (typeof sendRaw !== 'function') throw new Error('sendRaw required');
  return {
    async notifySecurity(key, text) {
      const msg = String(text || '⚠️ 安全策略拦截了一条消息。');
      log(`[security] notify ${key}`);
      try { return await sendRaw(key, msg); } catch { return false; }
    }
  };
}
