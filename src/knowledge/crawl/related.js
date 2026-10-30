import { relatedVideos, videoComments } from './bilibili.js';

function bvidOf(raw) {
  const m = /(BV[0-9A-Za-z]{10,})/.exec(String(raw ?? ''));
  return m ? m[1] : '';
}

export async function collectRelated(seeds, { maxVideos = 20, commentsPerVideo = 1, log = () => {} } = {}) {
  const ids = (Array.isArray(seeds) ? seeds : String(seeds ?? '').split(','))
    .map(bvidOf).filter(Boolean);
  const seen = new Set(ids);
  const out = [];
  for (const seed of ids) {
    try {
      const list = await relatedVideos(seed, { limit: maxVideos, log });
      for (const v of list) {
        if (!v.bvid || seen.has(v.bvid)) continue;
        seen.add(v.bvid);
        const parts = [v.title, v.description].filter(Boolean);
        if (commentsPerVideo > 0) {
          try { parts.push(...(await videoComments(v.aid, { log })).slice(0, 6)); } catch {}
        }
        const text = parts.join('\n').trim();
        if (text.length < 40) continue;
        out.push({ ...v, platform: 'bilibili', text });
      }
    } catch (error) {
      log(`[related] ${seed} 失败：${error?.message ?? error}`);
    }
  }
  log(`[related] 完成：${out.length} 条`);
  return out;
}
