import fs from 'node:fs';

/**
 * 媒体抓取：只负责“拿到可用的图片字节”，不负责模型归一化或发送。
 * 依赖全部注入，避免再和 bridge 闭包绑死。
 */
export function createMediaFetcher({
  bot, getCfg, getSelfUserId, safeFetchBuffer, acceptImageBuffer,
  emojiCdnCandidates, emojiIdFromFileName, mimeFromUrl,
  isProbablySafeImageFileRef, base64FromMaybe, isSafeLocalMediaPath, log,
  maxBytes = 8 * 1024 * 1024
} = {}) {
  async function fetchOneBotImage(media) {
    const emojiId = String(media.emojiId || emojiIdFromFileName(media.file) || '');
    const isSticker = media.kind === 'sticker' || !!emojiId || String(media.subType || '') === '1';
    const label = isSticker ? '表情' : '图片';
    const failures = [];
    const urls = [];
    const pushUrl = (raw) => {
      const s = String(raw ?? '').trim();
      if (!/^https?:\/\//i.test(s) || urls.includes(s)) return;
      urls.push(s);
    };
    pushUrl(media.url);
    for (const candidate of emojiCdnCandidates(emojiId, getSelfUserId())) pushUrl(candidate);

    const tryUrls = async () => {
      for (const url of urls) {
        try {
          const fetched = await safeFetchBuffer(url, maxBytes);
          const accepted = acceptImageBuffer(fetched.buffer, `${label} URL `);
          if (accepted) return { ...accepted, mimeType: accepted.mimeType || mimeFromUrl(url) };
          failures.push(`${url} 不是有效图片`);
        } catch (error) {
          failures.push(`${url}: ${error?.message ?? error}`);
        }
      }
      return null;
    };

    const tryGetImage = async () => {
      if (!(media.kind === 'image' || media.kind === 'sticker')) return null;
      if (!media.file || !isProbablySafeImageFileRef(media.file)) return null;
      try {
        const info = await bot.getImage({ file: String(media.file) });
        const obj = info && typeof info === 'object' ? info : {};
        const base64 = base64FromMaybe(obj.data) || base64FromMaybe(obj.base64) || base64FromMaybe(obj.file);
        if (base64) {
          if (base64.length * 3 / 4 <= maxBytes) {
            const accepted = acceptImageBuffer(Buffer.from(base64, 'base64'), 'get_image 返回的图片');
            if (accepted) return accepted;
          } else {
            log(`get_image 返回的图片 base64 超限，已跳过（${Math.round(base64.length * 3 / 4 / 1024)}KB）`);
          }
        }
        if (obj.url) {
          try {
            const fetched = await safeFetchBuffer(String(obj.url), maxBytes);
            const accepted = acceptImageBuffer(fetched.buffer, 'get_image URL 图片');
            if (accepted) return { ...accepted, mimeType: accepted.mimeType || mimeFromUrl(obj.url) };
          } catch (error) {
            failures.push(`get_image url: ${error?.message ?? error}`);
          }
        }
        if (typeof obj.file === 'string' && !obj.file.startsWith('base64://') && fs.existsSync(obj.file) && isSafeLocalMediaPath(obj.file)) {
          const stat = fs.statSync(obj.file);
          if (stat.size > maxBytes) {
            log(`本地图片文件超限，已跳过（${Math.round(stat.size / 1024)}KB）`);
          } else {
            const accepted = acceptImageBuffer(fs.readFileSync(obj.file), '本地图片');
            if (accepted) return accepted;
          }
        }
      } catch (error) {
        failures.push(`get_image: ${error?.message ?? error}`);
      }
      return null;
    };

    const result = isSticker
      ? (await tryUrls()) ?? (await tryGetImage())
      : (await tryGetImage()) ?? (await tryUrls());
    if (result) return result;
    if (failures.length) log(`[media] ${label}获取失败（${failures.length} 次尝试）：${failures.slice(0, 3).join(' | ')}`);
    return null;
  }

  return { fetchOneBotImage };
}
