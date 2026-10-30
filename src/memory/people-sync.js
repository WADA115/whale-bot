import fs from 'node:fs';
import { rememberPerson } from './people.js';

export function identityLine({ file, ownerQQ = '', selfName = '小鲸鱼' } = {}) {
  let data = {};
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch {}
  const owner = data[String(ownerQQ)] ?? null;
  const ownerText = owner?.name
    ? `「${owner.name}」（QQ ${ownerQQ}）`
    : (ownerQQ ? `QQ ${ownerQQ}` : '未识别');
  return `【你的身份】你是「${selfName || '小鲸鱼'}」，群友也叫你鱼鱼；你的主人是${ownerText}。别人是群友，不是主人。\n`;
}

export async function syncPeopleDirectory({
  file, groups = [], fetchMembers, ownerQQ = '', selfUserId = '', selfName = '', log = () => {}
} = {}) {
  let updated = 0;
  const owner = String(ownerQQ || '');
  const self = String(selfUserId || '');
  for (const group of groups) {
    const gid = String(group ?? '').trim();
    if (!gid) continue;
    try {
      const members = await fetchMembers(gid);
      for (const m of Array.isArray(members) ? members : []) {
        const id = String(m?.user_id ?? m?.userId ?? '').trim();
        if (!id || id === self) continue;
        const name = String(m?.card || m?.nickname || m?.name || '').trim();
        rememberPerson({ file, userId: id, name, group: gid, owner: id === owner });
        updated += 1;
      }
    } catch (error) {
      log(`[people] 同步群 ${gid} 失败：${error?.message ?? error}`);
    }
  }
  if (updated) log(`[people] 已自动同步 ${updated} 条成员：${selfName || self || '本机'}`);
  return updated;
}
