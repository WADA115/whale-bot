// 密码哈希：显式 scrypt 参数、版本化存储、旧哈希自动升级。
import crypto from 'node:crypto';

export const SCRYPT = Object.freeze({ N: 32768, r: 8, p: 1, keylen: 32, saltBytes: 16, maxmem: 64 * 1024 * 1024 });
export const LEGACY_SCRYPT = Object.freeze({ N: 16384, r: 8, p: 1, keylen: 32 });

export function newSalt() {
  return crypto.randomBytes(SCRYPT.saltBytes).toString('hex');
}

export function normalizeParams(params) {
  const p = params && typeof params === 'object' ? params : LEGACY_SCRYPT;
  return {
    N: Number(p.N) || LEGACY_SCRYPT.N,
    r: Number(p.r) || LEGACY_SCRYPT.r,
    p: Number(p.p) || LEGACY_SCRYPT.p,
    keylen: Number(p.keylen) || SCRYPT.keylen
  };
}

export function hashPassword(password, salt, params = SCRYPT) {
  const p = normalizeParams(params);
  return crypto.scryptSync(String(password), String(salt), p.keylen, {
    N: p.N, r: p.r, p: p.p, maxmem: SCRYPT.maxmem
  }).toString('hex');
}

export function verifyPassword(password, salt, expectedHex, params = LEGACY_SCRYPT) {
  try {
    const p = normalizeParams(params);
    const got = Buffer.from(hashPassword(password, salt, p), 'hex');
    const want = Buffer.from(String(expectedHex || ''), 'hex');
    if (!got.length || got.length !== want.length) return false;
    return crypto.timingSafeEqual(got, want);
  } catch {
    return false;
  }
}

export function needsRehash(params) {
  const p = normalizeParams(params);
  return p.N < SCRYPT.N || p.r !== SCRYPT.r || p.p !== SCRYPT.p || p.keylen !== SCRYPT.keylen;
}

// 未知用户也跑一次，降低用户名枚举的时序差异。
export function dummyVerify(password) {
  hashPassword(String(password ?? ''), '0'.repeat(32), SCRYPT);
  return false;
}
