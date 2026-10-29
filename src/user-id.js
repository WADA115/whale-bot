// 用户名校验与档案文件命名。
// 目标：禁止路径字符/Windows 保留名，大小写与 Unicode 归一化后唯一。

import crypto from 'node:crypto';

export const USER_LIMITS = Object.freeze({ min: 2, max: 24 });

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** NFKC 归一化 + trim；只用于校验/查重，不直接当文件名。 */
export function normalizeUserName(raw) {
  return String(raw ?? '').normalize('NFKC').trim();
}

/** 大小写不敏感的唯一键（Windows 文件名也不区分大小写）。 */
export function userKey(raw) {
  return normalizeUserName(raw).toLocaleLowerCase('en-US');
}

/**
 * @returns {{ok:true,name:string,key:string}|{ok:false,msg:string}}
 */
export function validateUserName(raw) {
  const name = normalizeUserName(raw);
  const chars = [...name].length;
  if (chars < USER_LIMITS.min) return { ok: false, msg: `用户名至少 ${USER_LIMITS.min} 个字符` };
  if (chars > USER_LIMITS.max) return { ok: false, msg: `用户名最多 ${USER_LIMITS.max} 个字符` };
  if (!/^[\p{L}\p{N}_-]+$/u.test(name)) {
    return { ok: false, msg: '用户名只能用文字、数字、下划线或短横线' };
  }
  if (RESERVED.test(name)) return { ok: false, msg: '这个用户名是系统保留名，换一个' };
  if (/[. ]$/.test(name)) return { ok: false, msg: '用户名不能以点或空格结尾' };
  return { ok: true, name, key: userKey(name) };
}

/** 档案文件名：用 key 的哈希，避免字符集/大小写/保留名问题。 */
export function profileFileName(raw) {
  const key = userKey(raw);
  return crypto.createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 16) + '.json';
}
