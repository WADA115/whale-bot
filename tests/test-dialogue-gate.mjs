// 新 gate 规则/模型回退测试
import { ruleGate, buildGatePrompt, evaluateGate } from '../src/dialogue/gate.js';

let pass = 0; let fail = 0;
const ok = (m) => { console.log('  ✅ ' + m); pass += 1; };
const bad = (m) => { console.log('  ❌ ' + m); fail += 1; };
const cfg = { role: { displayName: '鱼鱼', smartTrigger: { otherBots: ['肥鱼'] } } };

if (ruleGate({ event: { at: ['你'], text: '在吗' }, cfg }).candidate === true) ok('@ 自己 → 是');
else bad('@ 自己异常');
if (ruleGate({ event: { at: ['肥鱼'], text: '题呢' }, cfg }).candidate === false) ok('@ 别人 → 否');
else bad('@ 别人异常');
if (ruleGate({ event: { sender: { isBot: true }, text: '我先出' }, cfg }).candidate === false) ok('其他 bot → 否');
else bad('其他 bot 异常');
if (ruleGate({ event: { media: ['image'], text: '' }, cfg }).candidate === true) ok('媒体 → 是');
else bad('媒体异常');
if (ruleGate({ event: { text: '' }, cfg }).candidate === false) ok('空消息 → 否');
else bad('空消息异常');
if (ruleGate({ event: { text: '今天好累' }, cfg }).candidate === null) ok('普通闲聊 → 需模型');
else bad('普通闲聊异常');

const prompt = buildGatePrompt({
  event: { sender: { name: '甲' }, at: ['你'], text: '题呢' },
  thread: { events: [{ name: '鱼鱼', text: '你出题', self: true }] },
  cfg
});
if (prompt.system.includes('其他机器人') && prompt.user.includes('[你] 鱼鱼')) ok('prompt 带线程与 otherBots');
else bad('prompt 异常');

let asked = 0;
const yes = await evaluateGate({
  event: { text: '题呢' },
  thread: {},
  cfg,
  ask: async () => { asked += 1; return { content: '是' }; }
});
if (yes.candidate === true && yes.source === 'model' && asked === 1) ok('模型路径');
else bad('模型路径异常：' + JSON.stringify(yes));

const noAsk = await evaluateGate({ event: { text: '题呢' }, thread: {}, cfg });
if (noAsk.candidate === false && noAsk.source === 'fallback') ok('无模型安全回退');
else bad('无模型回退异常：' + JSON.stringify(noAsk));

console.log('\n' + (fail ? `❌ ${fail} 项失败` : `✅ ${pass} 项全部通过`));
process.exit(fail ? 1 : 0);
