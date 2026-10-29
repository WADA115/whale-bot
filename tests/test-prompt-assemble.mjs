// 提示词拼装快照：拆分 bridge.js 前先钉住行为
import { buildClosedAgentPrompt } from '../src/prompt/assemble.js';

let pass = 0; let fail = 0;
const ok = (m) => { console.log('  ✅ ' + m); pass += 1; };
const bad = (m) => { console.log('  ❌ ' + m); fail += 1; };
const eq = (a, b) => a === b;

const anchor = '【人设锚点】保持角色';
const base = {
  roleHint: '【角色卡】小鲸鱼',
  personaAnchor: anchor,
  sessionTokenLine: '[SESSION]abc\n',
  ctxBlock: '【语境】在聊代码\n',
  moodBlock: '[心情]平静\n',
  emotionBlock: '[情绪]3\n',
  memoryBlock: '[记忆]主人喜欢猫\n',
  recallBlock: '[忽然想起]上次聊到杭州\n',
  groupContextBlock: 'A：早\nB：早啊',
  isOwner: false,
  isDeveloper: false,
  kind: 'group',
  senderName: '群友A',
  content: '今天写了好多代码',
  mediaHint: '\n[图片]'
};

const out = buildClosedAgentPrompt(base);

// 1. 锚点在首尾
if (out.startsWith(base.roleHint + '\n\n' + anchor + '\n\n')) ok('锚点开头');
else bad('锚点开头异常');
if (out.endsWith('\n\n' + anchor)) ok('锚点结尾');
else bad('锚点结尾异常');

// 2. 顺序：角色 → 锚点 → token → 语境 → 心情 → 情绪 → 记忆 → 想起 → 群聊 → 管理员 → 正文
const idx = (s) => out.indexOf(s);
const order = ['【角色卡】', '【人设锚点】', '[SESSION]', '【语境】', '[心情]', '[情绪]', '[记忆]', '[忽然想起]', '【最近群聊】', '群友A：', '[图片]'];
let ordered = true;
for (let i = 1; i < order.length; i += 1) if (!(idx(order[i - 1]) < idx(order[i]))) ordered = false;
if (ordered) ok('所有段落顺序不变');
else bad('段落顺序变了');

// 3. 群聊带发言人
if (out.includes('群友A：今天写了好多代码')) ok('群聊发言人行');
else bad('群聊发言人行缺失');

// 4. 私聊不带发言人
const priv = buildClosedAgentPrompt({ ...base, kind: 'private', groupContextBlock: '', senderName: '群友A' });
if (priv.includes('今天写了好多代码') && !priv.includes('群友A：')) ok('私聊不带发言人行');
else bad('私聊发言人行异常');

// 5. 管理员标记
const owner = buildClosedAgentPrompt({ ...base, isOwner: true });
if (owner.includes('【管理员】')) ok('管理员标记');
else bad('管理员标记缺失');

// 6. 关闭锚点
const noAnchor = buildClosedAgentPrompt({ ...base, personaAnchor: '' });
if (!noAnchor.includes('【人设锚点】')) ok('锚点可关闭');
else bad('锚点关闭无效');

// 7. 空输入不产生 undefined
const empty = buildClosedAgentPrompt({ content: 'hi' });
if (eq(empty, 'hi')) ok('空输入只留正文');
else bad('空输入异常：' + JSON.stringify(empty));

// 8. 纯函数：同输入同输出
if (buildClosedAgentPrompt(base) === out) ok('同输入同输出');
else bad('输出不稳定');

console.log('\n' + (fail ? `❌ ${fail} 项失败` : `✅ ${pass} 项全部通过`));
process.exit(fail ? 1 : 0);
