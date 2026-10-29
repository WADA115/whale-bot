// 登录/开发者密钥退避：集中公式，方便审计和测试。
export function createThrottle({
  windowMs = 60 * 1000,
  maxFails = 5,
  devBaseMs = 600,
  devCapMs = 12000
} = {}) {
  const loginFails = new Map();
  const devFails = new Map();

  function loginBlocked(ip) {
    const rec = loginFails.get(ip);
    if (!rec) return false;
    if (Date.now() > rec.resetAt) { loginFails.delete(ip); return false; }
    return rec.count >= maxFails;
  }

  function recordLoginFail(ip) {
    const rec = loginFails.get(ip);
    if (!rec || Date.now() > rec.resetAt) loginFails.set(ip, { count: 1, resetAt: Date.now() + windowMs });
    else rec.count += 1;
  }

  function clearLogin(ip) {
    loginFails.delete(ip);
  }

  function devGate(ip) {
    const rec = devFails.get(ip);
    if (!rec) return { blocked: false, waitMs: 0, count: 0 };
    const waitMs = Math.max(0, rec.until - Date.now());
    return { blocked: waitMs > 0, waitMs, count: rec.count };
  }

  function recordDevFail(ip) {
    const prev = devFails.get(ip) ?? { count: 0, until: 0 };
    const count = prev.count + 1;
    const delayMs = Math.min(2 ** Math.min(count - 1, 5) * devBaseMs, devCapMs);
    devFails.set(ip, { count, until: Date.now() + delayMs });
    return { count, delayMs, until: Date.now() + delayMs };
  }

  function clearDev(ip) {
    devFails.delete(ip);
  }

  return { loginBlocked, recordLoginFail, clearLogin, devGate, recordDevFail, clearDev, loginFails, devFails };
}
