import fs from 'node:fs';
import path from 'node:path';
import { faceName } from '../qq-face.js';

export function createFaceMedia({ stateDir, bot, log = () => {} } = {}) {
  const file = path.join(stateDir, 'face-names.json');
  let learnedFaces = {};
  try { learnedFaces = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch {}
  let dirty = false;
  let timer = null;

  function rememberFace(id, name) {
    const k = String(id);
    const v = String(name ?? '').trim().slice(0, 20);
    if (!v || learnedFaces[k] === v) return;
    learnedFaces[k] = v;
    dirty = true;
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      if (!dirty) return;
      try { fs.writeFileSync(file, JSON.stringify(learnedFaces, null, 2), 'utf8'); dirty = false; } catch {}
    }, 1000);
    timer.unref?.();
    log(`[media] 学会新表情：id=${k} → 「${v}」`);
  }

  async function fetchFaceMedia(media) {
    const faceId = Number(media.faceId);
    const fallbackText = media.summary ? `[表情:${String(media.summary).slice(0, 20)}]` : '[表情(客户端渲染，无图)]';
    if (!Number.isInteger(faceId)) return { text: fallbackText };
    const known = faceName(faceId) || String(learnedFaces[String(faceId)] ?? '') || String(media.summary ?? '').trim();
    if (known) {
      if (!faceName(faceId) && !learnedFaces[String(faceId)] && media.summary) rememberFace(faceId, media.summary);
      log(`[media] QQ 表情 id=${faceId} → 「${known}」（face 段没有图片，用名字表达）`);
      return { text: `[表情:${known}]` };
    }
    try {
      const face = await bot.fetchFaceEntity(faceId);
      if (face && typeof face === 'object') {
        const desc = String(face.q_des || (Array.isArray(face.emoji_name_alias) && face.emoji_name_alias[0]) || face.face_name || '').trim();
        if (desc) {
          rememberFace(faceId, desc);
          return { text: `[表情:${desc.slice(0, 20)}]` };
        }
      }
      log(`[media] 表情 id=${faceId} 网关没给名字（客户端渲染的表情，服务端无图可取）`);
    } catch (error) {
      log(`[media] 表情 id=${faceId} 取名失败（用编号占位）：${error?.message ?? error}`);
    }
    return { text: fallbackText };
  }

  return { fetchFaceMedia, rememberFace };
}
