// 表达层测试
import { buildSpeakerPrompt, parseSpeaker, speak } from '../src/dialogue/speaker.js';

let pass = 0; let fail = 0;
const ok = (m) => { console.log('  ✅ ' + m); pass += 1; };
const bad = (m) => { console.log('  ❌ ' + m); fail += 1; };

const cfg = { role: { displayName: '鱼鱼' } };
const thought = { shouldReply: true, target: '甲', keyPoints: ['题是外甥打灯笼', '接照旧'], constraints: ['一句话'], confidence: 0.8 };
const prompt = buildSpeakerPrompt({
  event: { sender: { name: '甲' }, at: ['你'], text: '题呢' },
  thread: { events: [] },
  thought,
  roleHint: '【角色】小鲸鱼',
  cfg
});
if (prompt.system.includes('表达层') && prompt.user.includes('外甥打灯笼') && prompt.system.includes('小鲸鱼')) ok('prompt 带 thought/人格');
else bad('prompt 异常');

const parsed = parseSpeaker('```json\n{"messages":["接照旧","简单吧"],"replyTo":"194","delayMs":[1000,2000]}\n```');
if (parsed?.messages.length === 2 && parsed.replyTo === '194' && parsed.delayMs[1] === 2000) ok('JSON 解析');
else bad('解析异常：' + JSON.stringify(parsed));

if (parseSpeaker('{"messages":[]}') === null) ok('空消息拒绝');
else bad('空消息未拒');
if (parseSpeaker('随便说说') === null) ok('非 JSON 拒绝');
else bad('非 JSON 未拒');

let asked = 0;
const out = await speak({ event: {}, thread: {}, thought, cfg, ask: async () => { asked += 1; return { content: '{"messages":["一句"]}' }; } });
if (asked === 1 && out?.messages[0] === '一句') ok('speak 调用');
else bad('speak 调用异常');

if (await speak({ event: {}, thought: null, ask: async () => ({ content: 'x' }) }) === null) ok('无 thought 返回 null');
else bad('无 thought 异常');

console.log('\n' + (fail ? `❌ ${fail} 项失败` : `✅ ${pass} 项全部通过`));
process.exit(fail ? 1 : 0);
