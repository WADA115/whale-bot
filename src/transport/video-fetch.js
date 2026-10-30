import fs from 'node:fs';

export function createVideoFetch({ getCfg, onebotHttpAction, log = () => {} } = {}) {
  async function fetchOneBotVideo(media) {
    const cfg = getCfg();
    const max = Number(cfg.socialV2?.media?.maxBytes ?? 8 * 1024 * 1024) * 4;
    const failures = [];
    const downloadRaw = async (rawUrl) => {
      const res = await fetch(rawUrl, { redirect: 'follow', signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const len = Number(res.headers.get('content-length') ?? 0);
      if (len > max) throw new Error(`视频 ${(len / 1048576).toFixed(1)}MB 超过上限`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length) throw new Error('空响应');
      if (buf.length > max) throw new Error('视频超过大小上限');
      return buf;
    };
    const url = String(media?.url ?? '').trim();
    if (/^https?:\/\//i.test(url)) {
      try {
        const buf = await downloadRaw(url);
        log(`[media] 视频下载成功 ${(buf.length / 1024).toFixed(0)} KB`);
        return { buffer: buf, mimeType: 'video/mp4' };
      } catch (error) {
        failures.push(`直链: ${error?.message ?? error}`);
      }
    }
    const file = String(media?.file ?? '').trim();
    if (!file) return null;
    for (const action of ['get_video', 'get_file', 'get_record']) {
      try {
        const body = await onebotHttpAction(action, { file }, { timeoutMs: 30000 });
        const target = String(body?.data?.file ?? body?.data?.url ?? '');
        if (!target) continue;
        if (/^https?:\/\//i.test(target)) {
          const buf = await downloadRaw(target);
          return { buffer: buf, mimeType: 'video/mp4' };
        }
        if (/^[A-Za-z0-9+/=]+$/.test(target) && target.length > 512) {
          const buf = Buffer.from(target, 'base64');
          if (buf.length) return { buffer: buf, mimeType: 'video/mp4' };
        }
        if (fs.existsSync(target)) return { buffer: fs.readFileSync(target), mimeType: 'video/mp4' };
      } catch (error) {
        failures.push(`${action}: ${error?.message ?? error}`);
      }
    }
    log(`[media] 视频获取失败（${failures.slice(0, 3).join('；')}）`);
    return null;
  }

  function resolveFfmpegPath() {
    const cfg = getCfg();
    const configured = String(cfg.socialV2?.voice?.ffmpegPath || process.env.FFMPEG_PATH || '').trim();
    if (configured && fs.existsSync(configured)) return configured;
    return configured || 'ffmpeg';
  }

  return { fetchOneBotVideo, resolveFfmpegPath };
}
