// 消息解析：从 OneBot 事件/消息段里提取纯数据。
// 从 bridge.js 抽出的纯函数；不读全局状态，昵称/关键词由调用方传入。

import { truncateText } from '../md-to-plain.js';

export function sanitizeMediaSummary(value, max = 60) {
  const s = String(value ?? '').replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').trim();
  return s ? truncateText(s, max) : '';
}

/**
 * 从 OneBot 消息段中提取图片/表情元数据（不下载字节，仅记录定位信息）。
 * 字段尽量保留：SnowLuma 的收藏/市场表情是 image 段 + emoji_id 等字段。
 */
export function extractMediaFromSegments(segments) {
  const media = [];
  for (const seg of segments ?? []) {
    if (!seg || typeof seg !== 'object') continue;
    const d = seg.data ?? {};
    const emojiFields = {
      emojiId: String(d.emoji_id ?? d.emojiId ?? ''),
      emojiPackageId: String(d.emoji_package_id ?? d.emojiPackageId ?? ''),
      emojiKey: String(d.key ?? '')
    };
    if (seg.type === 'image') {
      media.push({
        kind: 'image',
        file: String(d.file ?? ''),
        url: String(d.url ?? ''),
        subType: (d.sub_type ?? d.subType) != null ? String(d.sub_type ?? d.subType) : '',
        summary: sanitizeMediaSummary(d.summary),
        ...emojiFields
      });
    } else if (seg.type === 'mface') {
      media.push({
        kind: 'sticker',
        file: String(d.file ?? ''),
        url: String(d.url ?? ''),
        subType: '1',
        summary: sanitizeMediaSummary(d.summary),
        ...emojiFields
      });
    } else if (seg.type === 'face') {
      media.push({
        kind: 'face',
        faceId: String(d.id ?? ''),
        url: String(d.url ?? ''),
        summary: sanitizeMediaSummary(d.summary)
      });
    } else if (seg.type === 'video') {
      media.push({
        kind: 'video',
        file: String(d.file ?? ''),
        url: String(d.url ?? ''),
        summary: sanitizeMediaSummary(d.summary)
      });
    }
  }
  return media;
}

/** 是否“直接针对 AI”的提问/挑战。 */
export function isDirectedAtAi(textContent) {
  const lower = String(textContent ?? '').toLowerCase();
  const aiMention = /deepseek|claude|chatgpt|gpt|大肥鱼|小鲸鱼|鲸鱼|d指导|d老师|d师傅|深度求索|\bds\b|ai|人工智障|机器人|模型/.test(lower);
  const challenge = /强|弱|行不行|能不能|会不会|是不是|一半|水平|垃圾|废物|白嫖|菜|不如|厉害|赢|输|比.*强|比.*弱/.test(lower);
  const question = /[?？吗呢吧]|怎么|为什么|哪|谁/.test(lower);
  if (aiMention && (question || challenge)) return true;
  if (/(你|您).{0,10}(吗|呢|？|\?|怎么|是不是|能不能|行不行|有没有|有|没有|比|不如|强|弱|一半|厉害|垃圾|菜|赢|输)/.test(lower)) return true;
  if (/^(你|您)(是不是|行不行|能不能|会不会|觉得|有|没有)/.test(lower)) return true;
  if (/(你|您)是[^？?。！!]{0,14}(还是|或者|吗|么|？|\?)/.test(lower)) return true;
  if (/怎么不说话|人呢|回我|说话啊|理我|别装死|在不在|装死|说话/.test(lower)) return true;
  return false;
}

export function isDirectAddress(textContent, event, kind, { selfNickname = '', mustReplyKeywords = [] } = {}) {
  if (kind !== 'group') return true;
  const lower = String(textContent ?? '').toLowerCase();
  const selfId = String(event?.self_id ?? '');
  if (selfId && lower.includes('@' + selfId)) return true;
  if (selfNickname && (lower.includes('@' + selfNickname) || lower.includes(selfNickname))) return true;
  for (const kw of mustReplyKeywords) {
    if (lower.includes(String(kw).toLowerCase())) return true;
  }
  return isDirectedAtAi(textContent);
}

/** 活跃期批量检测用：不依赖 event，只认昵称/关键词/直接针对 AI。 */
export function isMustReplyText(textContent, { selfNickname = '', mustReplyKeywords = [] } = {}) {
  const lower = String(textContent ?? '').toLowerCase();
  if (selfNickname && (lower.includes('@' + selfNickname) || lower.includes(selfNickname))) return true;
  for (const kw of mustReplyKeywords) {
    if (lower.includes(String(kw).toLowerCase())) return true;
  }
  return isDirectedAtAi(textContent);
}

export function isSelfMessage(event) {
  return String(event?.sender?.user_id ?? event?.user_id ?? '') === String(event?.self_id ?? '');
}
