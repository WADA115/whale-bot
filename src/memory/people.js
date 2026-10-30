import fs from 'node:fs';
import path from 'node:path';

// 轻量“人物簿”：记录 QQ 号、群名片/昵称、最近出现时间与群。
// 只保存说话人主动公开的群名片/昵称，不保存聊天内容。
export function rememberPerson({ file, userId, name, group, owner = false, now = Date.now() }) {
  const id = String(userId ?? '').trim();
  if (!/^\d{1,20}$/.test(id)) return;
  let data = {};
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch {}
  const prev = data[id] ?? { id, names: [], groups: [], firstSeen: now };
  const display = String(name ?? '').trim().slice(0, 40);
  const names = new Set([...(prev.names ?? []), ...(display ? [display] : [])]);
  const groups = new Set([...(prev.groups ?? []), ...(group ? [String(group)] : [])]);
  data[id] = {
    ...prev,
    id,
    name: display || prev.name || '',
    names: [...names].slice(-6),
    groups: [...groups].slice(-20),
    owner: prev.owner === true || owner === true,
    lastSeen: now
  };
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  } catch {}
}

export function peopleLine({ file, key = '', ownerQQ = '', botQQ = '', limit = 10 } = {}) {
  let data = {};
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { return ''; }
  const group = String(key).startsWith('group:') ? String(key).slice(6) : '';
  const all = Object.values(data).filter((p) => p && p.id && String(p.id) !== String(botQQ));
  const relevant = all.filter((p) => p.owner || (group && Array.isArray(p.groups) && p.groups.includes(group)));
  const picked = (relevant.length ? relevant : all)
    .sort((a, b) => Number(b.owner) - Number(a.owner) || (b.lastSeen ?? 0) - (a.lastSeen ?? 0))
    .slice(0, Math.max(1, limit));
  if (!picked.length) return '';
  const lines = picked.map((p) => {
    const name = p.name || p.names?.[0] || '没记名字';
    const owner = p.owner || String(p.id) === String(ownerQQ);
    return `- ${name}（QQ ${p.id}）${owner ? '：主人' : ''}`;
  });
  return `【认识的人】\n${lines.join('\n')}\n（这些是你在群里见过的人；别硬套近乎，也别把别人的信息往外说。）\n`;
}
