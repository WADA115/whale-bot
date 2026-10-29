// 思维层 prompt/解析/调用测试
import { buildThinkerPrompt, parseThought, think } from '../src/dialogue/thinker.js';

let pass = 0; let fail = 0;
const ok = (m) => { console.log('  ✅ ' + m); pass += 1; };
const bad = (m) => { console.log('  ❌ ' + m); fail += 1; };

const cfg = { role: { displayName: '鱼鱼', smartTrigger: { otherBots: ['肥鱼'] } } };
const prompt = buildThinkerPrompt({
  event: { sender: { name: '甲' }, at: ['你'], text: '题呢' },
  thread: { events: [{ sender: { name: '鱼鱼', isSelf: true }, text: '你出题' }] },
  roleHint: '【角色】小鲸鱼',
  cfg
});
if (prompt.system.includes('思维层') && prompt.user.includes('[你] 鱼鱼') && prompt.system.includes('肥鱼')) ok('prompt 带线程/其他 bot');
else bad('prompt 异常');

const thought = parseThought('```json\n{"shouldReply":true,"target":"甲","intent":"answer_question","keyPoints":["题是外甥打灯笼","接照旧"],"emotion":{"valence":0.3,"arousal":0.5,"stance":"playful"},"constraints":["一句话"],"confidence":0.9}\n```');
if (thought?.shouldReply === true && thought.keyPoints.length === 2 && thought.emotion.stance === 'playful' && thought.confidence === 0.9) ok('JSON 解析');
else bad('JSON 解析异常：' + JSON.stringify(thought));

const badJson = parseThought('我觉得应该回，但是 JSON 坏了 {');
if (badJson === null) ok('坏 JSON 返回 null');
else bad('坏 JSON 未拒');

const clamped = parseThought('{"shouldReply":false,"confidence":5,"emotion":{"valence":-9,"arousal":9},"keyPoints":["a","b","c","d","e","f"],"constraints":[]}');
if (clamped.confidence === 1 && clamped.emotion.valence === -1 && clamped.emotion.arousal === 1 && clamped.keyPoints.length === 5) ok('字段裁剪');
else bad('裁剪异常：' + JSON.stringify(clamped));

let asked = 0;
const out = await think({
  event: { text: '在吗' }, thread: {}, cfg,
  ask: async () => { asked += 1; return { content: '{"shouldReply":true,"target":"你","confidence":0.4}' }; }
});
if (asked === 1 && out?.shouldReply === true && out.target === '你') ok('think 调用');
else bad('think 调用异常');

if (await think({ event: {}, thread: {}, cfg }) === null) ok('无 ask 返回 null');
else bad('无 ask 异常');

console.log('\n' + (fail ? `❌ ${fail} 项失败` : `✅ ${pass} 项全部通过`));
process.exit(fail ? 1 : 0);
