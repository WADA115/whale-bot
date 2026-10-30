// 统一记忆内核：长期记忆 + 短期记忆 + 会话摘要，删除/合并/晋升都在这里。
//
// 为什么要重写（原来的 memory-store.js 只有一层）：
//   1. 一层记忆没法区分"必须永远记得"（自己的设定）和"过两天就该忘"（今天吃了啥）；
//   2. 删除逻辑散落在两处（addFacts 去重 + janitor 的 dedupeLocal），判定标准不一致；
//   3. 没有"晋级"概念：短期信息命中多次说明重要，应该沉到长期；
//   4. 没有摘要：会话变长后只能留最近几条，前面的信息全丢。
//
// 分层规则：
//   长期（long）：设定（settings，永不删）、被晋升的事实、重要关键词。注入时**始终**贴。
//   短期（short）：日常提取的事实/关键词。有 TTL、有访问计数，按分数淘汰；
//                  命中次数达标或被模型判为重要 → 晋升到长期。
//   摘要（summaries）：每个会话一条滚动摘要，由较早的对话压缩而来。
//
// 数据文件 state/memory.json（version 2，自动从 v1 迁移）。
import fs from 'node:fs';
import path from 'node:path';

const DAY = 24 * 60 * 60 * 1000;
const LIMITS = { longFacts: 300, shortFacts: 400, longKeywords: 200, shortKeywords: 300, summaries: 60 };

/** 去掉空白与标点再比较：'主人叫A，是B' 与 '主人叫A 是B' 视为同一条。 */
export function normText(text) {
  return String(text ?? '').replace(/[\s\p{P}]+/gu, '').toLowerCase();
}

/** 实体（拉丁/数字）重叠 + 字符二元组 Dice + 包含关系。 */
export function similarity(a, b) {
  const na = normText(a);
  const nb = normText(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const latin = (s) => new Set(String(s).toLowerCase().match(/[a-z0-9_]{2,}/g) || []);
  const la = latin(a);
  const lb = latin(b);
  let entityScore = 0;
  if (la.size && lb.size) {
    let inter = 0;
    for (const t of la) if (lb.has(t)) inter += 1;
    entityScore = (inter / Math.min(la.size, lb.size)) * 0.7;
  }

  const bigrams = (s) => {
    const out = [];
    for (let i = 0; i + 2 <= s.length; i += 1) out.push(s.slice(i, i + 2));
    return new Set(out);
  };
  const ba = bigrams(na);
  const bb = bigrams(nb);
  let inter = 0;
  for (const t of ba) if (bb.has(t)) inter += 1;
  const dice = ba.size + bb.size > 0 ? (2 * inter) / (ba.size + bb.size) : 0;
  const contains = na.includes(nb) || nb.includes(na) ? 0.3 : 0;
  return Math.min(1, Math.max(dice + contains, entityScore));
}

function tokenize(text) {
  const s = String(text ?? '').toLowerCase();
  const latin = s.match(/[a-z0-9_]{2,}/g) ?? [];
  const cjk = [];
  for (const run of s.match(/[\u4e00-\u9fa5]+/g) ?? []) {
    if (run.length === 1) { cjk.push(run); continue; }
    for (let i = 0; i + 2 <= run.length; i += 1) cjk.push(run.slice(i, i + 2));
  }
  return [...new Set([...latin, ...cjk])];
}

function emptyState() {
  return {
    version: 2,
    long: { facts: [], keywords: [], settings: [] },
    short: { facts: [], keywords: [] },
    summaries: {},
    vault: [],   // 隐藏区：平时不注入，命中关键词才被检索
  };
}

/** 旧版（v1: {facts, keywords}）迁移到 v2 的短期层。 */
function migrate(raw) {
  if (!raw || typeof raw !== 'object') return emptyState();
  if (raw.version === 2 && raw.long && raw.short) {
    if (!Array.isArray(raw.vault)) raw.vault = [];
    return raw;
  }
  const state = emptyState();
  const facts = Array.isArray(raw.facts) ? raw.facts : [];
  const keywords = Array.isArray(raw.keywords) ? raw.keywords : [];
  for (const f of facts) {
    const text = String(f?.text ?? '').trim();
    if (!text) continue;
    state.short.facts.push({
      id: f.id || `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      ts: f.ts || Date.now(), key: f.key || '', text: text.slice(0, 200),
      tags: Array.isArray(f.tags) ? f.tags.slice(0, 6) : [], weight: Number(f.weight ?? 1) || 1,
      accessCount: 0, lastAccessAt: 0,
    });
  }
  for (const k of keywords) {
    const word = String(k?.word ?? '').trim();
    if (!word) continue;
    state.short.keywords.push({ word, meaning: String(k?.meaning ?? '').slice(0, 120), key: k.key || '', ts: k.ts || Date.now(), hits: Number(k.hits ?? 1) || 1 });
  }
  return state;
}

export function createMemoryCore({ file, log = () => {}, embed = null } = {}) {
  let state = emptyState();
  let dirty = false;
  let saveTimer = null;
  let idSeq = 0;
  let embedFn = typeof embed === 'function' ? embed : null;
  const embedCache = new Map();

  function newId(prefix) {
    idSeq += 1;
    return `${prefix}${Date.now().toString(36)}${idSeq}${Math.random().toString(36).slice(2, 4)}`;
  }

  function load() {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      state = migrate(raw);
      log(`[mem] 载入：长期 ${state.long.facts.length} 条 / 短期 ${state.short.facts.length} 条 / 关键词 ${state.long.keywords.length + state.short.keywords.length} / 摘要 ${Object.keys(state.summaries).length}`);
    } catch (error) {
      if (error?.code !== 'ENOENT') log(`[mem] 读取失败（按空库处理）：${error?.message ?? error}`);
    }
  }

  function scheduleSave() {
    dirty = true;
    if (saveTimer) return;
    saveTimer = setTimeout(() => { saveTimer = null; flush(); }, 800);
    if (typeof saveTimer.unref === 'function') saveTimer.unref();
  }

  function flush() {
    if (!dirty) return;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
      fs.renameSync(tmp, file);
      dirty = false;
    } catch (error) {
      log(`[mem] 保存失败：${error?.message ?? error}`);
    }
  }

  function cap(list, n) {
    if (list.length > n) list.splice(0, list.length - n);
  }

  // ── 写入 ────────────────────────────────────────────────────────────────
  function addFact(text, { tier = 'short', key = '', tags = [], weight = 1, id = '' } = {}) {
    const body = String(text ?? '').trim();
    if (body.length < 2 || body.length > 200) return null;
    const bag = tier === 'long' ? state.long.facts : state.short.facts;
    if (bag.some((f) => normText(f.text) === normText(body))) return null;
    const rec = {
      id: id || newId(tier === 'long' ? 'L' : 'S'),
      ts: Date.now(), key: String(key || ''), text: body,
      tags: Array.isArray(tags) ? tags.slice(0, 6).map(String) : [],
      weight: Number(weight) || 1, accessCount: 0, lastAccessAt: 0,
    };
    bag.push(rec);
    cap(state.long.facts, LIMITS.longFacts);
    cap(state.short.facts, LIMITS.shortFacts);
    scheduleSave();
    log(`[mem] +${tier === 'long' ? '长期' : '短期'}记忆：${body.slice(0, 26)}`);
    return rec;
  }

  function addKeyword(word, meaning, { tier = 'short', key = '' } = {}) {
    const w = String(word ?? '').trim();
    const m = String(meaning ?? '').trim();
    if (!w || !m) return null;
    const bag = tier === 'long' ? state.long.keywords : state.short.keywords;
    const exist = bag.find((k) => normText(k.word) === normText(w));
    if (exist) { exist.meaning = m.slice(0, 120); exist.ts = Date.now(); exist.hits = (exist.hits ?? 1) + 1; scheduleSave(); return exist; }
    const rec = { word: w.slice(0, 40), meaning: m.slice(0, 120), key: String(key || ''), ts: Date.now(), hits: 1 };
    bag.push(rec);
    cap(state.long.keywords, LIMITS.longKeywords);
    cap(state.short.keywords, LIMITS.shortKeywords);
    scheduleSave();
    log(`[mem] +${tier === 'long' ? '长期' : '短期'}关键词「${w}」`);
    return rec;
  }

  /** 设定类记忆：永远注入、永不自动删。 */
  function addSetting(text) {
    const body = String(text ?? '').trim();
    if (!body) return null;
    if (state.long.settings.some((s) => normText(s.text) === normText(body))) return null;
    const rec = { text: body.slice(0, 200), ts: Date.now() };
    state.long.settings.push(rec);
    cap(state.long.settings, 40);
    scheduleSave();
    return rec;
  }

  // ── 查询 ────────────────────────────────────────────────────────────────
  function search(query, { tier = 'both', limit = 6, key = '', markAccess = true } = {}) {
    const tokens = tokenize(query);
    const now = Date.now();
    const bags = [];
    if (tier === 'long' || tier === 'both') bags.push(['long', state.long.facts]);
    if (tier === 'short' || tier === 'both') bags.push(['short', state.short.facts]);

    const scored = [];
    for (const [tierName, list] of bags) {
      for (const f of list) {
        let score = 0;
        if (tokens.length) {
          const target = f.text.toLowerCase();
          let hit = 0;
          for (const t of tokens) if (target.includes(t)) hit += 1;
          score = hit / tokens.length;
        }
        if (score <= 0) continue;
        if (key && f.key === key) score += 0.25;
        score *= Math.max(0.35, 1 - (now - (f.ts ?? now)) / (45 * DAY));
        score += Math.min(0.3, (f.accessCount ?? 0) * 0.05);
        scored.push({ fact: f, tier: tierName, score });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, limit);
    if (markAccess) {
      for (const s of top) { s.fact.accessCount = (s.fact.accessCount ?? 0) + 1; s.fact.lastAccessAt = now; }
      if (top.length) scheduleSave();
    }
    return top;
  }

  function cosine(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length) return 0;
    let dot = 0; let na = 0; let nb = 0;
    for (let i = 0; i < a.length; i += 1) {
      const x = Number(a[i]) || 0;
      const y = Number(b[i]) || 0;
      dot += x * y; na += x * x; nb += y * y;
    }
    return na && nb ? dot / Math.sqrt(na * nb) : 0;
  }

  async function embedMany(texts) {
    if (!embedFn || !texts.length) return [];
    const out = [];
    for (let i = 0; i < texts.length; i += 16) {
      const chunk = texts.slice(i, i + 16);
      const vectors = await embedFn(chunk);
      if (!Array.isArray(vectors) || vectors.length !== chunk.length) throw new Error('embedding count mismatch');
      out.push(...vectors);
    }
    return out;
  }

  /** 语义召回：bge-m3 向量，失败返回空数组，不影响关键词检索。 */
  async function semanticSearch(query, { tier = 'both', limit = 4, key = '', markAccess = true, minScore = 0.55 } = {}) {
    if (!embedFn || !String(query ?? '').trim()) return [];
    const bags = [];
    if (tier === 'long' || tier === 'both') bags.push(['long', state.long.facts]);
    if (tier === 'short' || tier === 'both') bags.push(['short', state.short.facts]);
    const all = [];
    for (const [tierName, list] of bags) for (const f of list) all.push({ tier: tierName, fact: f });
    if (!all.length) return [];
    const cacheKey = (f) => String(f.id ?? normText(f.text));
    const missing = [];
    for (const { fact } of all) {
      const k = cacheKey(fact);
      if (!embedCache.has(k)) missing.push({ k, text: fact.text });
    }
    const queryVec = (await embedMany([String(query)]))[0] ?? [];
    if (!queryVec.length) return [];
    if (missing.length) {
      const vecs = await embedMany(missing.map((m) => m.text));
      missing.forEach((m, i) => { if (vecs[i]?.length) embedCache.set(m.k, vecs[i]); });
    }
    const scored = [];
    for (const { tier: tierName, fact } of all) {
      const vec = embedCache.get(cacheKey(fact));
      if (!vec?.length) continue;
      let score = cosine(queryVec, vec);
      if (key && fact.key === key) score += 0.04;
      if (score < minScore) continue;
      scored.push({ fact, tier: tierName, score });
    }
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, limit);
    if (markAccess) {
      for (const s of top) { s.fact.accessCount = (s.fact.accessCount ?? 0) + 1; s.fact.lastAccessAt = Date.now(); }
      if (top.length) scheduleSave();
    }
    return top;
  }

  async function buildSemanticBlock(query, { key = '', limit = 3, maxChars = 700 } = {}) {
    try {
      const hits = await semanticSearch(query, { key, limit });
      if (!hits.length) return '';
      const lines = hits.map((h) => `- [${h.tier === 'long' ? '长期' : '短期'}] ${h.fact.text}`);
      let block = `【语义相关】\n${lines.join('\n')}\n`;
      if (block.length > maxChars) block = block.slice(0, maxChars) + '\n';
      return block;
    } catch (error) {
      log(`[mem] 语义检索失败（忽略）：${error?.message ?? error}`);
      return '';
    }
  }

  function setEmbedder(fn) {
    embedFn = typeof fn === 'function' ? fn : null;
    embedCache.clear();
  }

  function similarFacts(text, { tier = 'both', limit = 3, minSimilarity = 0.35 } = {}) {
    const bags = [];
    if (tier !== 'short') bags.push(['long', state.long.facts]);
    if (tier !== 'long') bags.push(['short', state.short.facts]);
    const out = [];
    for (const [tierName, list] of bags) {
      for (const f of list) {
        const s = similarity(f.text, text);
        if (s >= minSimilarity) out.push({ fact: f, tier: tierName, similarity: s });
      }
    }
    out.sort((a, b) => b.similarity - a.similarity);
    return out.slice(0, limit);
  }

  /** 命中的关键词（按词面包含关系匹配，命中即注入含义）。 */
  function matchKeywords(text, { tier = 'both', limit = 6 } = {}) {
    const lower = String(text ?? '').toLowerCase();
    if (!lower) return [];
    const bags = [];
    if (tier !== 'short') bags.push(state.long.keywords);
    if (tier !== 'long') bags.push(state.short.keywords);
    const out = [];
    for (const bag of bags) {
      for (const k of bag) {
        const w = String(k.word ?? '');
        if (w && lower.includes(w.toLowerCase())) { out.push(k); if (out.length >= limit) return out; }
      }
    }
    return out;
  }

  // ── 合并 / 删除 / 晋升 ───────────────────────────────────────────────────
  /** 合并：保留 keepId（可改文本），删掉 dropIds；跨层也能合（保留在 keep 所在层）。 */
  function mergeFacts(keepId, dropIds = [], mergedText = '') {
    const all = [['long', state.long.facts], ['short', state.short.facts]];
    let keep = null;
    let keepTier = '';
    for (const [tierName, list] of all) {
      const hit = list.find((f) => f.id === keepId);
      if (hit) { keep = hit; keepTier = tierName; break; }
    }
    if (!keep) return null;
    if (String(mergedText ?? '').trim()) { keep.text = String(mergedText).trim().slice(0, 200); keep.ts = Date.now(); }
    const drop = new Set(dropIds);
    let removed = 0;
    for (const [, list] of all) {
      for (let i = list.length - 1; i >= 0; i -= 1) {
        if (list[i].id !== keepId && drop.has(list[i].id)) { list.splice(i, 1); removed += 1; }
      }
    }
    if (removed) { scheduleSave(); log(`[mem] 合并 ${removed} 条到「${keep.text.slice(0, 20)}」（留 ${keepTier}）`); }
    return { kept: keep, removed, tier: keepTier };
  }

  /** 本地兜底去重：同层内相似度 ≥ threshold 合并（长的/访问多的优先保留）。 */
  function dedupeLocal({ threshold = 0.88 } = {}) {
    let removed = 0;
    for (const list of [state.long.facts, state.short.facts]) {
      const sorted = [...list].sort((a, b) => (b.accessCount ?? 0) - (a.accessCount ?? 0) || (b.text.length - a.text.length));
      const keep = [];
      for (const f of sorted) {
        const hit = keep.find((k) => similarity(k.text, f.text) >= threshold);
        if (hit) {
          if (f.text.length > hit.text.length) hit.text = f.text;
          hit.accessCount = (hit.accessCount ?? 0) + (f.accessCount ?? 0);
          list.splice(list.indexOf(f), 1);
          removed += 1;
        } else keep.push(f);
      }
    }
    if (removed) { scheduleSave(); log(`[mem] 本地去重合并 ${removed} 条`); }
    return removed;
  }

  /** 晋升：短期 → 长期。 */
  function promoteFact(id, reason = '') {
    const idx = state.short.facts.findIndex((f) => f.id === id);
    if (idx < 0) return null;
    const [rec] = state.short.facts.splice(idx, 1);
    if (state.long.facts.some((f) => normText(f.text) === normText(rec.text))) { scheduleSave(); return null; }
    rec.weight = Math.max(2, Number(rec.weight) || 1);
    state.long.facts.push(rec);
    cap(state.long.facts, LIMITS.longFacts);
    scheduleSave();
    log(`[mem] 晋升到长期：${rec.text.slice(0, 26)}${reason ? `（${reason}）` : ''}`);
    return rec;
  }

  function promoteKeyword(word) {
    const idx = state.short.keywords.findIndex((k) => normText(k.word) === normText(word));
    if (idx < 0) return null;
    const [rec] = state.short.keywords.splice(idx, 1);
    if (!state.long.keywords.some((k) => normText(k.word) === normText(rec.word))) state.long.keywords.push(rec);
    scheduleSave();
    log(`[mem] 关键词晋升到长期：${rec.word}`);
    return rec;
  }

  /** 按访问次数自动晋升（命中 ≥ 2 次的短期事实说明常用）。 */
  function autoPromote({ minAccess = 2 } = {}) {
    const promoted = [];
    for (const f of [...state.short.facts]) {
      if ((f.accessCount ?? 0) >= minAccess) {
        const r = promoteFact(f.id, `命中 ${f.accessCount} 次`);
        if (r) promoted.push(r);
      }
    }
    return promoted;
  }

  /** 短期淘汰：过 TTL 且访问少的先走；最近命中/权重高的留下。 */
  function pruneShortTerm({ ttlMs = 3 * DAY, keepTop = 40 } = {}) {
    const now = Date.now();
    const before = state.short.facts.length;
    state.short.facts = state.short.facts.filter((f) => {
      const age = now - (f.lastAccessAt || f.ts || now);
      const score = (f.weight ?? 1) + (f.accessCount ?? 0) * 0.5;
      if (age <= ttlMs) return true;
      return score >= 2; // 老但重要的留着（等下一次晋升）
    });
    const removed = before - state.short.facts.length;
    // 关键词同理：TTL 更宽松
    const kb = state.short.keywords.length;
    state.short.keywords = state.short.keywords.filter((k) => now - (k.ts || now) <= ttlMs * 4);
    const kRemoved = kb - state.short.keywords.length;
    if (removed || kRemoved) {
      scheduleSave();
      log(`[mem] 短期淘汰：事实 ${removed} 条 / 关键词 ${kRemoved} 个`);
    }
    // 超量时按分数砍
    if (state.short.facts.length > LIMITS.shortFacts) {
      state.short.facts.sort((a, b) => (b.weight ?? 1) - (a.weight ?? 1));
      state.short.facts.length = LIMITS.shortFacts;
    }
    return { facts: removed, keywords: kRemoved };
  }

  // ── 会话摘要 ────────────────────────────────────────────────────────────
  function setSummary(key, text, meta = {}) {
    const k = String(key);
    state.summaries[k] = {
      text: String(text ?? '').slice(0, 1200),
      upTo: Number(meta.upTo ?? Date.now()),
      turns: Number(meta.turns ?? 0),
      updatedAt: Date.now(),
    };
    const keys = Object.keys(state.summaries);
    if (keys.length > LIMITS.summaries) {
      keys.sort((a, b) => (state.summaries[a].updatedAt ?? 0) - (state.summaries[b].updatedAt ?? 0));
      for (const k2 of keys.slice(0, keys.length - LIMITS.summaries)) delete state.summaries[k2];
    }
    scheduleSave();
    log(`[mem] 更新会话摘要 ${k}（${state.summaries[k].text.length} 字）`);
    return state.summaries[k];
  }

  function getSummary(key) {
    return state.summaries[String(key)] ?? null;
  }

  // ── 注入 ────────────────────────────────────────────────────────────────
  /**
   * 组装给模型的记忆块。分两段：
   *   always  —— 设定 + 长期关键词 + 高价值长期事实（始终贴）
   *   relevant—— 与当前这句话相关的长期/短期条目 + 命中关键词
   */
  function buildPromptBlocks(query, { key = '', maxAlwaysChars = 500, maxRelevantChars = 500, hitLimit = 6, strongLimit = 10, cfg = {} } = {}) {
    const linesAlways = [];
    if (state.long.settings.length) {
      linesAlways.push(`【你的设定（始终遵守）】`);
      for (const s of state.long.settings.slice(0, 8)) linesAlways.push(`- ${s.text}`);
    }
    if (state.long.keywords.length) {
      const kws = state.long.keywords.slice(-12).map((k) => `「${k.word}」=${k.meaning}`);
      if (kws.length) linesAlways.push(`【长期关键词】${kws.join('；')}`);
    }
    const strongFacts = state.long.facts
      .filter((f) => (f.weight ?? 1) >= 2 || (f.tags ?? []).includes('important'))
      .slice(-Math.max(1, Math.min(20, strongLimit)));
    if (strongFacts.length) {
      linesAlways.push(`【长期记忆】`);
      for (const f of strongFacts) linesAlways.push(`- ${f.text}`);
    }
    let always = linesAlways.length ? `${linesAlways.join('\n')}\n\n` : '';
    if (always.length > maxAlwaysChars) always = `${always.slice(0, maxAlwaysChars)}\n\n`;

    const linesRel = [];
    const hits = search(query, { limit: Math.max(1, Math.min(12, hitLimit)), key, markAccess: true });
    if (hits.length) {
      linesRel.push(`【相关记忆】`);
      for (const h of hits) linesRel.push(`- ${h.fact.text}${h.tier === 'long' ? '' : ''}`);
    }
    const kws = matchKeywords(query, { limit: 5 });
    if (kws.length) linesRel.push(`【这些词你知道】${kws.map((k) => `「${k.word}」=${k.meaning}`).join('；')}`);
    const summary = getSummary(key);
    if (summary?.text) linesRel.push(`【之前聊过】${summary.text}`);
    let relevant = linesRel.length ? `${linesRel.join('\n')}\n\n` : '';
    if (relevant.length > maxRelevantChars) relevant = `${relevant.slice(0, maxRelevantChars)}\n\n`;

    return { always, relevant, hits, keywords: kws };
  }

  // ── 隐藏区：平时不注入，命中关键词才被检索出来 ──────────────────────
  function addVault(text, { keywords = [], tags = [] } = {}) {
    const t = normText(text).slice(0, 300);
    if (!t) return null;
    if (!Array.isArray(state.vault)) state.vault = [];
    if (state.vault.some((v) => normText(v.text) === t)) return null;
    const item = {
      id: newId('v'),
      ts: Date.now(),
      text: t,
      keywords: (Array.isArray(keywords) ? keywords : []).map((k) => String(k).trim()).filter(Boolean).slice(0, 8),
      tags: (Array.isArray(tags) ? tags : []).map(String).slice(0, 6),
      hits: 0,
      lastHitAt: 0,
    };
    state.vault.push(item);
    if (state.vault.length > 200) state.vault.splice(0, state.vault.length - 200);
    scheduleSave();
    return item;
  }

  function listVault() {
    return (state.vault ?? []).map((v) => ({ ...v }));
  }

  function removeVault(id) {
    const before = (state.vault ?? []).length;
    state.vault = (state.vault ?? []).filter((v) => v.id !== id);
    if (state.vault.length !== before) { scheduleSave(); return true; }
    return false;
  }

  /** 关键词命中：返回命中的隐藏区条目（命中的关键词越多越靠前）。 */
  function matchVault(text, limit = 3) {
    const t = String(text ?? '');
    if (!t || !Array.isArray(state.vault) || !state.vault.length) return [];
    const hits = [];
    for (const v of state.vault) {
      let score = 0;
      for (const kw of v.keywords ?? []) if (kw && t.includes(kw)) score += 1;
      if (score > 0) hits.push({ item: v, score });
    }
    if (!hits.length) return [];
    hits.sort((a, b) => b.score - a.score);
    const picked = hits.slice(0, limit).map((h) => h.item);
    for (const it of picked) { it.hits = (it.hits ?? 0) + 1; it.lastHitAt = Date.now(); }
    scheduleSave();
    return picked;
  }

  /** 随机挑一条旧事（长期事实 + 隐藏区），用于「忽然想起」式的主动回忆。 */
  function pickRecall({ exclude = [] } = {}) {
    const vault = Array.isArray(state.vault) ? state.vault : [];
    const pool = [
      ...state.long.facts.map((f) => ({ id: f.id, text: f.text, from: 'long' })),
      ...vault.map((v) => ({ id: v.id, text: v.text, from: 'vault' })),
    ].filter((x) => x && x.text);
    if (!pool.length) return null;
    const skip = new Set((exclude ?? []).map((x) => String(x)));
    const cand = pool.filter((x) => !skip.has(String(x.id ?? x.text)));
    if (!cand.length) return null;
    const pick = cand[Math.floor(Math.random() * cand.length)];
    return { id: pick.id ?? '', text: pick.text, from: pick.from };
  }

  load();

  return {
    addFact, addKeyword, addSetting,
    addVault, listVault, removeVault, matchVault, pickRecall,
    search, similarFacts, matchKeywords,
    semanticSearch, buildSemanticBlock, setEmbedder,
    mergeFacts, dedupeLocal, promoteFact, promoteKeyword, autoPromote, pruneShortTerm,
    setSummary, getSummary,
    buildPromptBlocks,
    flush,
    stats: () => ({
      longFacts: state.long.facts.length,
      shortFacts: state.short.facts.length,
      longKeywords: state.long.keywords.length,
      shortKeywords: state.short.keywords.length,
      settings: state.long.settings.length,
      summaries: Object.keys(state.summaries).length,
      vault: (state.vault ?? []).length,
    }),
    snapshot: () => JSON.parse(JSON.stringify(state)),
    list: () => ({
      settings: state.long.settings.map((s) => s.text),
      long: state.long.facts.map((f) => ({ text: f.text, weight: f.weight, access: f.accessCount })),
      short: state.short.facts.map((f) => ({ text: f.text, access: f.accessCount, ts: f.ts })),
      keywords: [...state.long.keywords.map((k) => ({ ...k, tier: 'long' })), ...state.short.keywords.map((k) => ({ ...k, tier: 'short' }))],
      vault: (state.vault ?? []).map((v) => ({ id: v.id, text: v.text, keywords: v.keywords, hits: v.hits ?? 0 })),
      summaries: Object.fromEntries(Object.entries(state.summaries).map(([k, v]) => [k, v.text.slice(0, 80)])),
    }),
  };
}

// ── 多租户：按身份读写各自独立的记忆文件 ──────────────────────────────────
/** 用户名清洗：只留安全字符，防止 ../ 之类穿越到别的目录。 */
export function safeUserName(name) {
  return String(name ?? '').replace(/[^\w\u4e00-\u9fa5-]/g, '').slice(0, 32);
}

/**
 * 记忆仓库：一个进程里管多份记忆。
 *   owner = 'developer'          → <stateDir>/memory.json
 *   owner = { user: '张三' }     → <stateDir>/profiles/张三/memory.json
 * 不传 owner 一律当开发者，避免默认走到别人目录。
 */
export function createMemoryStore({ stateDir, log = () => {}, embed = null } = {}) {
  const cache = new Map();

  function ownerKey(owner) {
    if (!owner || owner === 'developer') return 'developer';
    const name = safeUserName(typeof owner === 'string' ? owner : owner.user);
    return name ? 'user:' + name : 'developer';
  }

  function pathFor(owner) {
    const key = ownerKey(owner);
    if (key === 'developer') return path.join(stateDir, 'memory.json');
    return path.join(stateDir, 'profiles', key.slice(5), 'memory.json');
  }

  /** 老版本把记忆塞在 state/profiles/<user>.json 的 memory 数组里，这里一次性迁过来。 */
  function migrateLegacyProfile(name, core) {
    const legacyPath = path.join(stateDir, 'profiles', name + '.json');
    if (!fs.existsSync(legacyPath)) return;
    try {
      const legacy = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
      const list = Array.isArray(legacy.memory) ? legacy.memory : [];
      if (!list.length) return;
      for (const item of list) {
        const text = String(item?.text ?? '').trim();
        if (!text) continue;
        if (item.tier === 'long') core.addFact(text, { tier: 'long', tags: ['imported'] });
        else core.addFact(text, { tier: 'short' });
      }
      core.flush();
      delete legacy.memory;
      fs.writeFileSync(legacyPath, JSON.stringify(legacy, null, 2), 'utf8');
      log('[mem] 已把 ' + name + ' 的旧档案记忆迁到 profiles/' + name + '/memory.json（' + list.length + ' 条）');
    } catch (error) {
      log('[mem] 迁移旧档案记忆失败（忽略）：' + (error?.message ?? error));
    }
  }

  function forOwner(owner) {
    const key = ownerKey(owner);
    if (cache.has(key)) return cache.get(key);
    const target = pathFor(owner);
    const core = createMemoryCore({ file: target, log, embed });
    if (key.startsWith('user:')) migrateLegacyProfile(key.slice(5), core);
    cache.set(key, core);
    return core;
  }

  return { for: forOwner, pathFor, ownerKey, keys: () => [...cache.keys()] };
}
