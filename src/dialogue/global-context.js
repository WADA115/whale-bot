import fs from 'node:fs';
import path from 'node:path';

function clock(ts) {
  const d = new Date(Number(ts));
  if (!Number.isFinite(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function chatLabel(chat) {
  const s = String(chat || '');
  if (s.startsWith('group:')) return `群${s.slice(6)}`;
  if (s.startsWith('private:')) return `私聊${s.slice(8)}`;
  return s;
}

/** 全局近况：跨群取每个会话最后一两条，用于分析和上下文，不拼整段聊天。 */
export function buildGlobalDigest({ dir, key = '', kind = '', limit = 16, maxChars = 1600 } = {}) {
  if (!dir) return '';
  let files = [];
  try {
    files = fs.readdirSync(dir)
      .filter((f) => /^events-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
      .sort()
      .slice(-2);
  } catch { return ''; }
  const rows = [];
  for (const f of files) {
    let text = '';
    try { text = fs.readFileSync(path.join(dir, f), 'utf8'); } catch { continue; }
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        if (!e?.chat || !e?.text) continue;
        const chat = String(e.chat);
        const isGroup = chat.startsWith('group:');
        if (kind === 'group' && !isGroup) continue;
        if (kind === 'private' && !isGroup && chat !== key) continue;
        rows.push(e);
      } catch {}
    }
  }
  rows.sort((a, b) => Number(a.ts ?? 0) - Number(b.ts ?? 0));
  const lastByChat = new Map();
  for (const e of rows) {
    const chat = String(e.chat);
    const arr = lastByChat.get(chat) ?? [];
    arr.push(e);
    while (arr.length > 2) arr.shift();
    lastByChat.set(chat, arr);
  }
  const picked = [...lastByChat.entries()]
    .flatMap(([chat, arr]) => arr.map((e) => ({ chat, e })))
    .sort((a, b) => Number(b.e.ts ?? 0) - Number(a.e.ts ?? 0))
    .slice(0, Math.max(2, limit))
    .reverse();
  if (!picked.length) return '';
  const lines = picked.map(({ chat, e }) => {
    const who = e.sender?.isSelf ? '你' : (e.sender?.name || e.sender?.id || '某人');
    const t = clock(e.ts);
    return `- ${t ? `[${t}] ` : ''}${chatLabel(chat)}｜${who}：${String(e.text).replace(/\s+/g, ' ').slice(0, 120)}`;
  });
  let out = `【全局近况】\n${lines.join('\n')}\n（这是跨会话的最近动态；只在合适时自然提起，不要逐条复述，也不要把私聊内容带到别的群。）\n`;
  if (out.length > maxChars) out = out.slice(0, maxChars) + '…\n';
  return out;
}
