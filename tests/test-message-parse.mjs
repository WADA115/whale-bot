// 消息解析快照：抽取自 bridge.js，行为必须与原来一致
import { sanitizeMediaSummary, extractMediaFromSegments, isDirectedAtAi, isDirectAddress, isMustReplyText, isSelfMessage } from '../src/message/parse.js';

let pass = 0; let fail = 0;
const ok = (m) => { console.log('  ✅ ' + m); pass += 1; };
const bad = (m) => { console.log('  ❌ ' + m); fail += 1; };

// 1. 图片/表情/视频/表情段
const media = extractMediaFromSegments([
  { type: 'image', data: { file: 'a.png', url: 'http://x/a.png', sub_type: 1, summary: ' 一只猫\n' } },
  { type: 'mface', data: { emoji_id: 'e1', emoji_package_id: 'p1', key: 'k1', summary: '狗头' } },
  { type: 'face', data: { id: '14', summary: '微笑' } },
  { type: 'video', data: { file: 'v.mp4', url: 'http://x/v.mp4', summary: '视频' } },
  { type: 'text', data: { text: 'hi' } }
]);
if (media.length === 4 && media[0].kind === 'image' && media[0].subType === '1') ok('图片段解析');
else bad('图片段异常：' + JSON.stringify(media));
if (media[1].kind === 'sticker' && media[1].emojiId === 'e1' && media[1].emojiPackageId === 'p1') ok('市场表情字段保留');
else bad('表情字段丢失');
if (media[2].kind === 'face' && media[2].faceId === '14') ok('face 段解析');
else bad('face 段异常');
if (media[3].kind === 'video') ok('视频段解析');
else bad('视频段异常');

// 2. summary 清洗
if (sanitizeMediaSummary(' a\u0000b\nc ', 5) === 'a b c') ok('summary 清洗与截断');
else bad('summary 异常：' + JSON.stringify(sanitizeMediaSummary(' a\u0000b\nc ', 5)));

// 3. 直接针对 AI
if (isDirectedAtAi('你有claude一半强吗') && isDirectedAtAi('小鲸鱼是不是笨') && isDirectedAtAi('你是人还是ai')) ok('针对 AI 判断');
else bad('针对 AI 判断异常');
if (!isDirectedAtAi('今天天气不错')) ok('普通聊天不误判');
else bad('普通聊天误判');

// 4. 群聊直接点名
const ev = { self_id: '999' };
if (isDirectAddress('@999 在吗', ev, 'group') && isDirectAddress('小鲸鱼你好', ev, 'group', { selfNickname: '小鲸鱼' })) ok('群聊 @/昵称');
else bad('群聊点名异常');
if (isDirectAddress('随便说一句', ev, 'group') === false) ok('群聊普通消息不算点名');
else bad('群聊普通消息误判');
if (isDirectAddress('随便说一句', ev, 'private')) ok('私聊默认算点名');
else bad('私聊点名异常');

// 5. 必须回
if (isMustReplyText('小鲸鱼在吗', { selfNickname: '小鲸鱼' }) && isMustReplyText('触发词', { mustReplyKeywords: ['触发词'] })) ok('必须回判断');
else bad('必须回异常');
if (!isMustReplyText('嗯嗯', { selfNickname: '小鲸鱼' })) ok('普通消息不必须回');
else bad('普通消息误判必须回');

// 6. 自己发的消息
if (isSelfMessage({ self_id: 999, sender: { user_id: 999 } }) && !isSelfMessage({ self_id: 999, sender: { user_id: 1 } })) ok('自己消息识别');
else bad('自己消息识别异常');

console.log('\n' + (fail ? `❌ ${fail} 项失败` : `✅ ${pass} 项全部通过`));
process.exit(fail ? 1 : 0);
