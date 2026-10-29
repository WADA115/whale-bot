// 会话：随机 token、内存存储、HttpOnly Cookie、TTL。
import crypto from 'node:crypto';

export function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers?.cookie ?? '').split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function createSessionStore({ ttlMs = 7 * 24 * 60 * 60 * 1000, cookieName = 'whale_session' } = {}) {
  const sessions = new Map();

  function current(req) {
    const token = parseCookies(req)[cookieName];
    if (!token) return null;
    const sess = sessions.get(token);
    if (!sess) return null;
    if (sess.exp < Date.now()) { sessions.delete(token); return null; }
    return sess;
  }

  function issue(req, user, role = 'user', ip = '') {
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { user: String(user ?? ''), role, exp: Date.now() + ttlMs, ip: String(ip ?? '') });
    return token;
  }

  function revoke(req) {
    const token = parseCookies(req)[cookieName];
    if (token) sessions.delete(token);
    return token;
  }

  function revokeToken(token) {
    if (token) sessions.delete(token);
  }

  function cookie(token, { secure = false } = {}) {
    return `${cookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(ttlMs / 1000)}${secure ? '; Secure' : ''}`;
  }

  function clearCookie() {
    return `${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
  }

  return { current, issue, revoke, revokeToken, cookie, clearCookie, sessions, ttlMs, cookieName };
}
