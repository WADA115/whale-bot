// 发送前的文本规划：单行化、超长拆分、按空格分条、气泡切分。
// 从 bridge.js 抽出；只处理字符串，不发网络请求。

export function singleLineForQQ(s) {
  return String(s ?? '')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** 超长段落：先按次要标点拆，再按字符硬拆；URL 作为不可拆原子。 */
export function splitLongSegment(segment, max) {
  const s = String(segment ?? '').trim();
  if (!s) return [];
  const safeMax = Number.isFinite(max) && max >= 1 ? Math.floor(max) : 500;
  if (s.length <= safeMax) return [s];

  const urlRe = /https?:\/\/[^\s，。；、]+/g;
  const urls = [];
  const masked = s.replace(urlRe, (m) => {
    urls.push(m);
    return `\u0000URL${urls.length - 1}\u0000`;
  });

  const raw = masked.split(/([，、；：,;:])/);
  const tokens = [];
  for (let i = 0; i < raw.length; i += 2) {
    tokens.push(((raw[i] ?? '') + (raw[i + 1] ?? '')).trim());
  }
  const out = [];
  let cur = '';
  const PLACEHOLDER_ALL = /\u0000URL\d+\u0000/g;
  const splitByPlaceholder = (tok) => {
    const parts = [];
    let last = 0;
    let m;
    PLACEHOLDER_ALL.lastIndex = 0;
    while ((m = PLACEHOLDER_ALL.exec(tok)) !== null) {
      if (m.index > last) parts.push({ text: tok.slice(last, m.index), isPlaceholder: false });
      parts.push({ text: m[0], isPlaceholder: true });
      last = m.index + m[0].length;
    }
    if (last < tok.length) parts.push({ text: tok.slice(last), isPlaceholder: false });
    return parts;
  };
  for (const tok of tokens) {
    if (!tok) continue;
    if (tok.length > safeMax) {
      if (cur) { out.push(cur); cur = ''; }
      for (const piece of splitByPlaceholder(tok)) {
        if (piece.isPlaceholder) { out.push(piece.text); continue; }
        for (let i = 0; i < piece.text.length;) {
          let end = Math.min(i + safeMax, piece.text.length);
          // 绝不在代理对（emoji）中间下刀
          if (end < piece.text.length && end - i > 1) {
            const last = piece.text.charCodeAt(end - 1);
            if (last >= 0xd800 && last <= 0xdbff) end -= 1;
          }
          out.push(piece.text.slice(i, end));
          i += end > i ? end - i : safeMax;
        }
      }
    } else if (cur.length + tok.length <= safeMax) {
      cur += tok;
    } else {
      out.push(cur);
      cur = tok;
    }
  }
  if (cur) out.push(cur);

  return out
    .map((chunk) => chunk.replace(/\u0000URL(\d+)\u0000/g, (_, i) => urls[Number(i)] ?? ''))
    .filter(Boolean);
}

export function isCjkChar(ch) {
  if (!ch) return false;
  const code = ch.codePointAt(0);
  return (
    (code >= 0x4E00 && code <= 0x9FFF) ||
    (code >= 0x3400 && code <= 0x4DBF) ||
    (code >= 0xF900 && code <= 0xFAFF)
  );
}

/** 把括号内的空格换成占位符，避免颜文字被按空格拆碎。 */
export function protectKaomojiSpaces(src) {
  let out = '';
  let depth = 0;
  for (const ch of String(src ?? '')) {
    if ('([{（【<╭'.includes(ch)) depth += 1;
    else if (')]}）】>╮'.includes(ch)) depth = Math.max(0, depth - 1);
    if (/\s/.test(ch) && depth > 0) out += '\u0001';
    else out += ch;
  }
  return out;
}

export function splitByCjkSpaces(src) {
  const protectedText = protectKaomojiSpaces(src);
  const tokens = protectedText.split(/\s+/).map((t) => t.trim()).filter(Boolean);
  if (tokens.length <= 1) return tokens.map((t) => t.replace(/\u0001/g, ' '));

  const isSymbolOnly = (t) => /^[^\p{L}\p{N}]+$/u.test(t);
  const groups = [];
  let cur = tokens[0];
  for (let i = 1; i < tokens.length; i += 1) {
    const prevLast = [...cur].pop() || '';
    const currFirst = [...tokens[i]][0] || '';
    if (isSymbolOnly(tokens[i]) || isSymbolOnly(cur)) {
      cur = cur + ' ' + tokens[i];
      continue;
    }
    if (isCjkChar(prevLast) || isCjkChar(currFirst)) {
      groups.push(cur);
      cur = tokens[i];
    } else {
      cur = cur + ' ' + tokens[i];
    }
  }
  if (cur) groups.push(cur);
  return groups.map((g) => g.replace(/\u0001/g, ' '));
}

/** 把整段回复切成 1~N 个气泡；极短句不拆。 */
export function splitReplyIntoBubbles(text, { maxBubbles = 20, maxLen = 40 } = {}) {
  const raw = String(text ?? '').trim();
  if (!raw) return [];
  const flat = raw.replace(/\r?\n+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (flat.length <= 6) return [flat];

  let parts = flat.split(/(?<=[。！？!?~～…])/).map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 1) {
    parts = flat.split(/(?<=[，,；;])/).map((s) => s.trim()).filter(Boolean);
  }
  if (parts.length <= 1) {
    parts = protectKaomojiSpaces(flat)
      .split(/\s+/)
      .map((s) => s.replace(/\u0001/g, ' ').trim())
      .filter(Boolean);
  }
  if (parts.length <= 1) return [flat];

  const out = parts.slice(0, maxBubbles);
  if (parts.length > maxBubbles) out[maxBubbles - 1] += parts.slice(maxBubbles).join('');
  return out.filter((s) => s.trim().length > 0);
}

/** 仿真分条计划：AI 用空格分条；关闭分条则只做安全硬拆。 */
export function planSocialTimeline(text, socialCfg) {
  const src = String(text ?? '').replace(/\r\n/g, '\n').trim();
  const rawMaxChars = Number(socialCfg?.maxReplyChars ?? 500);
  const maxChars = Number.isFinite(rawMaxChars) && rawMaxChars >= 1 ? Math.floor(rawMaxChars) : 500;
  const enabled = socialCfg?.burstEnabled !== false;
  if (!src) return { main: [], followUp: null };

  if (!enabled) {
    return { main: splitLongSegment(src, maxChars).map(singleLineForQQ), followUp: null };
  }

  const parts = splitByCjkSpaces(src);
  if (parts.length <= 1) {
    return { main: splitLongSegment(parts[0] || src, maxChars).map(singleLineForQQ), followUp: null };
  }

  const main = [];
  for (const part of parts) {
    main.push(...splitLongSegment(part, maxChars).map(singleLineForQQ));
  }
  return { main: main.filter(Boolean), followUp: null };
}
