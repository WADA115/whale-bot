// OneBot HTTP 发送原语：只负责分段、引用、@、鉴权与错误映射。
const escapeCqText = (text) => String(text ?? '').replace(/\[CQ:/gi, '[CQ：');

export function createOneBotSender({ getCfg, knownTokens = new Set(), log = () => {} } = {}) {
  async function send(kind, id, message, replyToMessageId = null, atUserId = null) {
    const segments = [];
    if (replyToMessageId !== undefined && replyToMessageId !== null && String(replyToMessageId).trim() !== '') {
      const rid = String(replyToMessageId).trim();
      if (!/^-?[1-9]\d*$/.test(rid)) throw new Error('replyToMessageId 必须是非零整数（消息 id 可能为负数）');
      segments.push({ type: 'reply', data: { id: rid } });
    }
    if (atUserId !== undefined && atUserId !== null && String(atUserId).trim() !== '') {
      const at = String(atUserId).trim();
      if (!/^\d+$/.test(at)) throw new Error('atUserId 必须是正整数 QQ 号，且不能为 all');
      segments.push({ type: 'at', data: { qq: at } });
    }
    const rawMessage = String(message ?? '');
    const hasKnownToken = [...knownTokens].some((t) => t && rawMessage.includes(t));
    if (hasKnownToken) {
      log('发送内容包含会话令牌，已阻止发送');
      throw new Error('发送内容包含会话令牌，已阻止发送');
    }
    segments.push({ type: 'text', data: { text: escapeCqText(rawMessage) } });

    const cfg = getCfg();
    const action = kind === 'private' ? 'send_private_msg' : 'send_group_msg';
    const params = kind === 'private' ? { user_id: Number(id), message: segments } : { group_id: Number(id), message: segments };
    const httpUrl = String(cfg.snowluma?.httpUrl || 'http://127.0.0.1:3000').replace(/\/+$/, '');
    const res = await fetch(`${httpUrl}/${action}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(cfg.snowluma?.accessToken ? { authorization: `Bearer ${cfg.snowluma.accessToken}` } : {})
      },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(15000)
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.status !== 'ok' || body.retcode !== 0) {
      const hint = res.status === 426 ? '（HTTP 426：snowluma.httpUrl 可能指向了 WebSocket 端口）' : '';
      throw new Error(`OneBot ${action} 失败: ${body.wording || body.retcode || res.status}${hint}`);
    }
    return body.data;
  }
  return { send };
}
