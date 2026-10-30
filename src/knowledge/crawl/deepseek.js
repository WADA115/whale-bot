import { searchWeb, loadToolsConfig } from '../../web/deepseek-tools.js';

const PROJECT_TERMS = /(qq|机器人|deepseek|大肥鱼|dsh|qq-bridge|snowluma|桥接|api|bot)/i;

export function canonicalUrl(raw) {
  try {
    const u = new URL(String(raw));
    u.hash = '';
    return u.toString().replace(/\/$/, '');
  } catch {
    return String(raw ?? '').trim();
  }
}

export function buildQueries(topic) {
  const t = String(topic ?? '').trim();
  if (!t) return [];
  const queries = [
    `site:bilibili.com ${t}`,
    `site:tieba.baidu.com ${t}`
  ];
  if (t.includes('小鲸鱼')) {
    queries.unshift(
      'site:bilibili.com "小鲸鱼" "QQ机器人"',
      'site:bilibili.com "DeepSeek 小鲸鱼"',
      'site:bilibili.com "蓝色大肥鱼"'
    );
  }
  return [...new Set(queries)];
}

export function isRelevant(topic, row) {
  const t = String(topic ?? '').trim().toLowerCase();
  if (!t) return false;
  const title = String(row?.title ?? '').toLowerCase();
  const text = String(row?.content || row?.summary || row?.snippet || '').toLowerCase();
  const hay = `${title}\n${text}`;
  if (!hay.includes(t)) return false;
  // “小鲸鱼”也是 VTuber/动画角色名；项目语料必须同时命中工程/AI 词。
  if (t.includes('小鲸鱼') && !PROJECT_TERMS.test(hay)) return false;
  if (row?.score && row.score < 1.0) return false;
  return true;
}

export async function collectTopic(keyword, { maxResults = 10, log = () => {} } = {}) {
  const config = loadToolsConfig(process.cwd());
  const topic = String(keyword ?? '').trim();
  if (!topic) return [];
  const seen = new Set();
  const out = [];
  let rawCount = 0;
  let filtered = 0;

  for (const query of buildQueries(topic)) {
    try {
      const results = await searchWeb(query, { count: maxResults, needContent: true, config });
      log(`[deepseek] ${query}：${results.length} 条`);
      for (const r of results) {
        rawCount += 1;
        if (!isRelevant(topic, r)) { filtered += 1; continue; }
        const url = canonicalUrl(r.url);
        if (seen.has(url)) continue;
        seen.add(url);
        const text = (r.content || r.summary || r.snippet || '').trim();
        if (text.length < 80) { filtered += 1; continue; }
        out.push({
          platform: 'deepseek',
          url,
          title: r.title || url,
          author: r.siteName || '',
          publishedAt: r.date ? Date.parse(r.date) || 0 : 0,
          text: `${r.title}\n${text}`
        });
      }
    } catch (error) {
      log(`[deepseek] ${query} 失败：${error?.message ?? error}`);
    }
  }
  log(`[deepseek] 完成：${out.length} 篇（原始 ${rawCount}，过滤 ${filtered}）`);
  return out;
}
