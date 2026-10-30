import { sampleFrames, extractAudio } from '../video-sample.js';

export function createMediaResolver({
  faceMedia, toModelMedia, mediaFetcher, fetchOneBotVideo, resolveFfmpegPath,
  getCfg, getStickerEntries, emojiIdFromFileName, log = () => {},
  maxCount = 5, maxBytes = 8 * 1024 * 1024
} = {}) {
  async function resolveMediaList(mediaList) {
    const parts = [];
    let index = 0;
    let totalBytes = 0;
    const cfg = getCfg();
    for (const media of Array.isArray(mediaList) ? mediaList : []) {
      index += 1;
      if (index > maxCount) {
        parts.push({ type: 'text', text: `[图片/表情 ${index}（超过单条上限 ${maxCount}，已跳过）]` });
        continue;
      }
      if (!media || typeof media !== 'object') continue;
      if (media.kind === 'face') {
        const face = await faceMedia.fetchFaceMedia(media);
        const prep = face.buffer ? await toModelMedia(face.buffer, face.mimeType, `表情#${media.faceId ?? index}`) : null;
        if (prep?.ok) {
          if (totalBytes + prep.buffer.length > maxBytes) {
            parts.push({ type: 'text', text: `[表情${index}（图片总大小超限，已跳过）]` });
            continue;
          }
          totalBytes += prep.buffer.length;
          if (face.text) parts.push({ type: 'text', text: face.text });
          if (prep.note) parts.push({ type: 'text', text: `（${prep.note}）` });
          parts.push({ type: 'image', mediaType: prep.mimeType, data: prep.buffer.toString('base64'), name: `face-${media.faceId}.${(prep.mimeType || 'png').split('/')[1]}` });
        } else if (prep && !prep.ok) {
          parts.push({ type: 'text', text: `[表情${index}（${prep.error}）]` });
        } else {
          parts.push({ type: 'text', text: face.text || `[表情#${media.faceId}]` });
        }
      } else if (media.kind === 'video') {
        const vid = await fetchOneBotVideo(media);
        if (!vid?.buffer?.length) {
          parts.push({ type: 'text', text: `[视频${index}（获取失败）]` });
          continue;
        }
        parts.push({ type: 'text', text: `[视频${index}]` });
        try {
          const ffmpegPath = resolveFfmpegPath();
          const sampled = ffmpegPath
            ? await sampleFrames({ buffer: vid.buffer, ffmpegPath, count: Number(cfg.socialV2?.media?.videoFrames ?? 4) })
            : { ok: false, error: '没有 ffmpeg' };
          if (sampled.ok) {
            parts.push({ type: 'text', text: `（抽了 ${sampled.frames.length} 帧，按时间顺序）` });
            for (let fi = 0; fi < sampled.frames.length; fi += 1) {
              const prep = await toModelMedia(sampled.frames[fi], 'image/jpeg', `第${fi + 1}帧`);
              if (prep?.ok) {
                if (totalBytes + prep.buffer.length > maxBytes) break;
                totalBytes += prep.buffer.length;
                parts.push({ type: 'image', mediaType: prep.mimeType, data: prep.buffer.toString('base64'), name: `video${index}-f${fi + 1}.jpg` });
              }
            }
          } else {
            parts.push({ type: 'text', text: `（抽帧失败：${sampled.error}）` });
          }
          const audio = ffmpegPath ? await extractAudio({ buffer: vid.buffer, ffmpegPath }) : { ok: false, error: '没有 ffmpeg' };
          if (audio.ok) {
            const pcm = audio.wav.subarray(44);
            const asrUrl = String(cfg.socialV2?.voice?.asrUrl || 'http://127.0.0.1:3199').replace(/\/+$/, '');
            try {
              const res = await fetch(`${asrUrl}/asr`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ pcm16: pcm.toString('base64'), rate: 16000 }),
                signal: AbortSignal.timeout(60000)
              });
              const json = await res.json().catch(() => ({}));
              const text = String(json?.text ?? '').trim();
              if (text) parts.push({ type: 'text', text: `（视频里的说话，转写）：${text}` });
            } catch (error) {
              parts.push({ type: 'text', text: `（音轨转写失败：${error?.message ?? error}）` });
            }
          } else {
            parts.push({ type: 'text', text: '（这个视频没有可用音轨）' });
          }
        } catch (error) {
          parts.push({ type: 'text', text: `[视频${index}处理失败：${error?.message ?? error}]` });
        }
      } else {
        const img = await mediaFetcher.fetchOneBotImage(media);
        const sticker = media.kind === 'sticker';
        let stickerHintText = '';
        if (sticker) {
          const emojiId = String(media.emojiId || emojiIdFromFileName(media.file) || '');
          if (emojiId) {
            const hit = (getStickerEntries() ?? []).find((e) => String(e.id || e.resId || '') === emojiId || String(e.md5 || '').toUpperCase() === emojiId.toUpperCase());
            if (hit) stickerHintText = String(hit.localNote || hit.desc || '').trim().slice(0, 40);
          }
        }
        const summary = sticker && media.summary ? `:${String(media.summary).slice(0, 20)}` : '';
        const label = sticker ? (summary ? `[表情${summary}]` : `[表情${index}]`) : `[图片${index}]`;
        const prep = img?.buffer ? await toModelMedia(img.buffer, img.mimeType, `${label}`) : null;
        if (prep?.ok) {
          if (totalBytes + prep.buffer.length > maxBytes) {
            parts.push({ type: 'text', text: `${label}（图片总大小超限，已跳过）` });
            continue;
          }
          totalBytes += prep.buffer.length;
          parts.push({ type: 'text', text: stickerHintText ? `${label}（表情含义：${stickerHintText}）` : label });
          if (prep.note) parts.push({ type: 'text', text: `（${prep.note}）` });
          parts.push({ type: 'image', mediaType: prep.mimeType, data: prep.buffer.toString('base64'), name: `qq-${sticker ? 'sticker' : 'image'}-${index}.${(prep.mimeType || 'image/jpeg').split('/')[1]}` });
        } else if (prep && !prep.ok) {
          parts.push({ type: 'text', text: `${label}（${prep.error}）` });
        } else {
          parts.push({ type: 'text', text: `${label}（获取失败）` });
        }
      }
    }
    return parts;
  }
  return { resolveMediaList };
}
