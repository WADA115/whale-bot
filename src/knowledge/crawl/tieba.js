import { fetchText, stripHtml } from './policy.js';

const BASE = 'https://tieba.baidu.com';

export async function collectTopic(keyword, { maxThreads = 3, log = () => {} } = {}) {
  const listUrl = `${BASE}/f?kw=${encodeURIComponent(keyword)}&ie=utf-8`;
  let html;
  try {
    html = await fetchText(listUrl, { minGapMs: 3000 });
  } catch (error) {
    log(`[tieba] 列表失败：${error?.message ?? error}`);
    return [];
  }
  const links = [...html.matchAll(/href="(\/p\/\d+)"/g)]
    .map((m) => `${BASE}${m[1]}`)
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, maxThreads);
  const out = [];
  for (const url of links) {
    try {
      const page = await fetchText(url, { minGapMs: 3000 });
      const title = stripHtml(page.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? '');
      const body = stripHtml(page).slice(0, 8000);
      if (body.length >= 40) out.push({ platform: 'tieba', url, title, text: `${title}\n${body}` });
    } catch (error) {
      log(`[tieba] 帖子失败 ${url}：${error?.message ?? error}`);
    }
  }
  log(`[tieba] 完成：${out.length} 帖`);
  return out;
}

/**
 * 贴吧直连 403 时的索引兜底：用百度搜索结果里的贴吧标题/摘要。
 * 不抓正文，只收索引入口和可读摘要。
 */
export async function collectIndexed(keyword, { maxThreads = 4, log = () => {} } = {}) {
  const q = 'site:tieba.baidu.com ' + String(keyword ?? '').trim();
  const url = 'https://www.baidu.com/s?wd=' + encodeURIComponent(q);
  let html;
  try {
    html = await fetchText(url, {
      minGapMs: 2500,
      timeoutMs: 20000,
      headers: { 'accept-language': 'zh-CN,zh;q=0.9', referer: 'https://www.baidu.com/' }
    });
  } catch (error) {
    log('[tieba-index] 搜索失败：' + (error?.message ?? error));
    return [];
  }
  const out = [];
  const seen = new Set();
  for (const part of html.split('mu="').slice(1)) {
    const m = part.match(/^https?:\/\/tieba\.baidu\.com\/p\/\d+/);
    if (!m || seen.has(m[0])) continue;
    seen.add(m[0]);
    const text = stripHtml(part).slice(0, 1600);
    if (text.length < 40) continue;
    const title = text.split(/\s+/).slice(0, 18).join(' ').slice(0, 80);
    out.push({ platform: 'tieba', url: m[0], title: title || keyword, text: '贴吧索引：' + keyword + '\n' + text });
    if (out.length >= maxThreads) break;
  }
  log('[tieba-index] ' + keyword + ' 完成：' + out.length + ' 条');
  return out;
}
