import crypto from 'node:crypto';

// 控制台/MCP 的令牌校验：定长比较 + 会话绑定 + 活跃 agent token 判定。
export function createAdminAuth({ getConversations, canonicalKey } = {}) {
  function tokenEq(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
    const x = Buffer.from(a, 'utf8');
    const y = Buffer.from(b, 'utf8');
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  }

  function agentTokenOk(key, token) {
    const canonical = canonicalKey(key);
    const st = getConversations().get(canonical ?? key);
    return !!st && !!st.agentToken && tokenEq(token, st.agentToken);
  }

  function isLiveAgentToken(token) {
    if (typeof token !== 'string' || !token) return false;
    for (const st of getConversations().values()) {
      if (st?.agentToken && tokenEq(token, st.agentToken)) return true;
    }
    return false;
  }

  return { tokenEq, agentTokenOk, isLiveAgentToken };
}
