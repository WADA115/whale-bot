// 学习插件：从聊天里收集"游戏 / 梗 / 网络用语 / 其他"词条，
// 独立存放在 state/learning.json，绝不写记忆库和设定库。
import fs from 'node:fs';
import path from 'node:path';

const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const STORE = path.join(repo, 'state', 'learning.json');
const LIMIT_PER_CAT = 80;
const LIMIT_TOTAL = 200;

const RULES = [
  { cat: '游戏', re: /上号|开黑|打野|中路|下路|辅助|推塔|抽卡|氪金|满命|保底|副本|boss|buff|nerf|段位|皮肤|深渊|团本|版本更新|打不过|通关|连麦|四排|单排/i },
  { cat: '网络用语', re: /\b(yyds|xswl|awsl|nb|tql|emo|dd|cp|u1s1|srds|xs)\b|栓Q|绝绝子|破防|躺平|内卷|整活|绷不住|笑不活|乐子|显眼包|city不city|尊嘟|窝囊废/i },
  { cat: '梗', re: /梗|名场面|复读|名台词|梗图|抽象|地狱笑话|段子|玩梗|接梗|老梗|新梗|梗王/ }
];

function emptyStore() { return { version: 1, items: [], edges: [], updatedAt: 0 }; }

function readStore() {
  try {
    const raw = JSON.parse(fs.readFileSync(STORE, 'utf8'));
    if (!Array.isArray(raw.items)) return emptyStore();
    raw.edges = Array.isArray(raw.edges) ? raw.edges : [];
    return raw;
  } catch { return emptyStore(); }
}

function writeStore(store) {
  try {
    fs.mkdirSync(path.dirname(STORE), { recursive: true });
    store.updatedAt = Date.now();
    fs.writeFileSync(STORE, JSON.stringify(store, null, 2), 'utf8');
  } catch {}
}

/** 从一句话里抽候选词条（启发式，不调模型、不花 token）。 */
export function extractTerms(text) {
  const body = String(text ?? '').trim();
  if (!body || body.length > 300) return [];
  const out = [];

  // 1) 引号里的短语：「梗」「yyds」"xxx"
  for (const m of body.matchAll(/[「『“"]([^」』”"]{2,16})[」』”"]/g)) {
    out.push({ term: m[1].trim(), cat: '其他' });
  }
  // 2) 规则命中：把命中的关键词本身收进去
  for (const rule of RULES) {
    for (const m of body.matchAll(new RegExp(rule.re.source, 'gi'))) {
      out.push({ term: m[0].toLowerCase(), cat: rule.cat });
    }
  }
  // 3) 英文缩写/流行词（2~8 个字母，独立成词）
  for (const m of body.matchAll(/\b([a-z]{2,8})\b/gi)) {
    const w = m[1].toLowerCase();
    if (/(yyds|xswl|awsl|nb|tql|emo|dd|cp|u1s1|srds|xs|led|gg|wp)/.test(w)) out.push({ term: w, cat: '网络用语' });
  }

  // 去重 + 去太泛的词
  const seen = new Set();
  const noise = new Set(['这个', '那个', '什么', '就是', '然后', '可以', '不是', '没有', '知道', '感觉']);
  return out.filter((x) => {
    const t = x.term.trim();
    if (!t || t.length < 2 || t.length > 16 || noise.has(t)) return false;
    if (seen.has(t)) return false;
    seen.add(t);
    return true;
  });
}

/** 合并进库：按分类计数，保留最多两条例句；同时记共现（发散关联）。 */
export function learn(terms, context, now = Date.now()) {
  const store = readStore();
  const byTerm = new Map(store.items.map((it) => [it.term, it]));
  const learned = [];

  for (const { term, cat } of terms) {
    let item = byTerm.get(term);
    if (!item) {
      item = { term, cat, count: 1, firstAt: now, lastAt: now, examples: [] };
      store.items.push(item);
      byTerm.set(term, item);
    } else {
      item.count += 1;
      item.lastAt = now;
      if (cat && cat !== '其他') item.cat = cat;
    }
    if (context && item.examples.length < 2 && !item.examples.includes(context)) {
      item.examples.push(String(context).slice(0, 40));
    }
    learned.push(term);
  }

  // 共现：同一条消息里出现的词两两连边（"发散"的轻量版：靠上下文关联扩展）
  for (let i = 0; i < learned.length; i++) {
    for (let j = i + 1; j < learned.length; j++) {
      const a = learned[i]; const b = learned[j];
      const edge = store.edges.find((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));
      if (edge) edge.count += 1;
      else store.edges.push({ a, b, count: 1 });
    }
  }

  // 限额：每类最多 80，总数最多 200（超了丢最久没出现的）
  const keep = [];
  const byCat = new Map();
  for (const it of store.items.sort((x, y) => y.lastAt - x.lastAt)) {
    const n = byCat.get(it.cat) ?? 0;
    if (n >= LIMIT_PER_CAT) continue;
    byCat.set(it.cat, n + 1);
    keep.push(it);
  }
  store.items = keep.slice(0, LIMIT_TOTAL);
  store.edges = store.edges.sort((x, y) => y.count - x.count).slice(0, 400);

  writeStore(store);
  return learned;
}

/** 为面板准备统计。 */
export function summary() {
  const store = readStore();
  const cats = { 游戏: 0, 梗: 0, 网络用语: 0, 其他: 0 };
  for (const it of store.items) cats[it.cat] = (cats[it.cat] ?? 0) + 1;
  return {
    total: store.items.length,
    cats,
    items: store.items.slice().sort((a, b) => b.count - a.count).slice(0, 60),
    edges: store.edges.slice(0, 20),
    updatedAt: store.updatedAt
  };
}

/** 收到消息：抽词 → 入库（只写 state/learning.json）。 */
export async function onInbound(ctx) {
  try {
    if (!ctx?.text) return null;
    const terms = extractTerms(ctx.text);
    if (!terms.length) return null;
    const learned = learn(terms, ctx.text);
    if (learned.length) ctx.log?.('学到', learned.join('、'));
  } catch (error) {
    ctx.log?.('学习失败（忽略）', error?.message ?? error);
  }
  return null;   // 绝不改动消息本身
}
