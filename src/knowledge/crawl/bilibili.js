import { fetchJson, stripHtml } from './policy.js';

const SEARCH = 'https://api.bilibili.com/x/web-interface/search/type';
const VIEW = 'https://api.bilibili.com/x/web-interface/view';
const REPLY = 'https://api.bilibili.com/x/v2/reply';
const POPULAR = 'https://api.bilibili.com/x/web-interface/popular';

function safeText(value) {
  return stripHtml(String(value ?? '')).trim();
}

export async function searchVideos(keyword, { page = 1, log = () => {} } = {}) {
  const url = `${SEARCH}?search_type=video&keyword=${encodeURIComponent(keyword)}&page=${page}`;
  const json = await fetchJson(url);
  if (json?.code !== 0) throw new Error(`bilibili search code=${json?.code}`);
  const list = json?.data?.result ?? [];
  log(`[bili] 搜索「${keyword}」第 ${page} 页：${list.length} 条`);
  return list.map((item) => ({
    platform: 'bilibili',
    bvid: String(item.bvid ?? ''),
    aid: String(item.aid ?? ''),
    title: safeText(item.title),
    description: safeText(item.description),
    author: safeText(item.author),
    url: item.arcurl || (item.bvid ? `https://www.bilibili.com/video/${item.bvid}` : ''),
    publishedAt: Number(item.pubdate) ? Number(item.pubdate) * 1000 : 0
  })).filter((x) => x.bvid && x.title);
}

export async function videoDetail(bvid, { log = () => {} } = {}) {
  const json = await fetchJson(`${VIEW}?bvid=${encodeURIComponent(bvid)}`);
  if (json?.code !== 0) throw new Error(`bilibili view code=${json?.code}`);
  const v = json?.data ?? {};
  log(`[bili] 详情 ${bvid}：${safeText(v.title).slice(0, 30)}`);
  return {
    bvid,
    aid: String(v.aid ?? ''),
    title: safeText(v.title),
    description: safeText(v.desc),
    url: `https://www.bilibili.com/video/${bvid}`,
    publishedAt: Number(v.pubdate) ? Number(v.pubdate) * 1000 : 0
  };
}

export async function videoComments(aid, { page = 1, log = () => {} } = {}) {
  if (!aid) return [];
  const json = await fetchJson(`${REPLY}?type=1&oid=${encodeURIComponent(aid)}&sort=2&ps=20&pn=${page}`);
  if (json?.code !== 0) throw new Error(`bilibili reply code=${json?.code}`);
  const replies = json?.data?.replies ?? [];
  log(`[bili] 评论 aid=${aid}：${replies.length} 条`);
  return replies.map((r) => safeText(r?.content?.message ?? '')).filter((x) => x.length >= 4);
}

export async function collectPopular({ maxVideos = 10, keyword = '', log = () => {} } = {}) {
  const json = await fetchJson(`${POPULAR}?ps=20&pn=1`);
  if (json?.code !== 0) throw new Error(`bilibili popular code=${json?.code}`);
  const list = (json?.data?.list ?? []).slice(0, maxVideos);
  log(`[bili] 热门兜底：${list.length} 条`);
  const out = [];
  for (const item of list) {
    try {
      const detail = await videoDetail(item.bvid, { log });
      const parts = [detail.title, detail.description].filter(Boolean);
      try { parts.push(...(await videoComments(detail.aid, { log })).slice(0, 10)); } catch {}
      const text = parts.join('\n').trim();
      if (text.length >= 20 && (!keyword || text.includes(keyword))) out.push({ ...detail, platform: 'bilibili', author: item.owner?.name ?? '', text });
    } catch (error) {
      log(`[bili] 热门详情失败 ${item.bvid}：${error?.message ?? error}`);
    }
  }
  return out;
}

export async function relatedVideos(bvid, { limit = 20, log = () => {} } = {}) {
  const json = await fetchJson(`https://api.bilibili.com/x/web-interface/archive/related?bvid=${encodeURIComponent(bvid)}`);
  if (json?.code !== 0) throw new Error(`bilibili related code=${json?.code}`);
  const list = (json?.data ?? []).slice(0, Math.max(1, limit));
  log(`[bili] related ${bvid}：${list.length} 条`);
  return list.map((v) => ({
    bvid: String(v.bvid ?? ''),
    aid: String(v.aid ?? ''),
    title: safeText(v.title),
    description: safeText(v.desc ?? ''),
    author: safeText(v.owner?.name ?? ''),
    url: v.bvid ? `https://www.bilibili.com/video/${v.bvid}` : '',
    publishedAt: Number(v.pubdate) ? Number(v.pubdate) * 1000 : 0
  })).filter((v) => v.bvid && v.title);
}
export async function collectTopic(keyword, { maxVideos = 20, commentsPerVideo = 1, log = () => {} } = {}) {
  let videos;
  try {
    videos = await searchVideos(keyword, { log });
  } catch (error) {
    log(`[bili] 搜索失败，改用热门：${error?.message ?? error}`);
    return collectPopular({ maxVideos, keyword, log });
  }
  const out = [];
  for (const v of videos.slice(0, maxVideos)) {
    try {
      const detail = await videoDetail(v.bvid, { log });
      const parts = [detail.title, detail.description].filter(Boolean);
      if (commentsPerVideo > 0) {
        try {
          const comments = await videoComments(detail.aid, { log });
          parts.push(...comments.slice(0, 10));
        } catch (error) {
          log(`[bili] 评论失败 ${v.bvid}：${error?.message ?? error}`);
        }
      }
      const text = parts.join('\n').trim();
      if (text.length >= 20) out.push({ ...detail, platform: 'bilibili', author: v.author, text });
    } catch (error) {
      log(`[bili] 详情失败 ${v.bvid}：${error?.message ?? error}`);
    }
  }
  return out;
}
