// 完整唤醒组装快照：bridge 传状态，render 只拼字符串
import { renderWakePromptV2 } from '../src/prompt/wake-render.js';

let pass = 0; let fail = 0;
const ok = (m) => { console.log('  ✅ ' + m); pass += 1; };
const bad = (m) => { console.log('  ❌ ' + m); fail += 1; };

const st = {
  agentToken: 'tok-123',
  unread: [{ seq: 1 }],
  recentMessages: [{ seq: 1, isSelf: false, sender: '群友A', text: '在吗', time: Date.now() - 120000 }],
  lastAiReplyAt: Date.now() - 5 * 60000,
  wakeConfig: { mode: 'diving', infinite: true, triggers: { atMention: true, keywords: ['原神'] } }
};

const deps = {
  readRoleState: () => ({ role: '小鲸鱼' }),
  selfIdentityTextV2: () => '【你的身份】鱼鱼\n\n',
  getSocialV2State: () => st,
  formatMemoryV2: () => '【记忆】主人喜欢猫',
  formatParticipationV2: () => '【参与度】一般',
  stickerCfg: { enabled: true, includeInPrompt: true },
  stickerEntries: [],
  buildStickerStrategyHint: () => '【表情策略】偶尔用',
  buildStickerContext: () => '【可用表情】狗头',
  preSleepMs: 300000,
  replyTimingV2: () => ({ quietMs: 10000, remainingQuietMs: 4000 }),
  describeAge: (t) => (t ? '2 分钟' : ''),
  looksLikeUnfinished: () => false,
  formatInitialPromptV2: () => '【初始提示词】这是一个原神群',
  buildTimeSenseLine: () => '【时间】晚上',
  wakeReasonSeq: (r) => (r === 'atMention@seq1' ? 1 : null),
  findV2MessageBySeq: () => ({ time: Date.now() - 60000, sender: '群友A' })
};

const out = renderWakePromptV2({ key: 'group:1', reason: 'timeout', deps });
const order = ['【当前角色】', '【你的身份】', '【会话令牌】', '【反AI味】', '【首回复节奏】', '【此刻状态】', '【当前唤醒】', '【记忆】', '【参与度】', '【沉睡前强制等待】', '【时间】', '【唤醒】'];
let ordered = true;
for (let i = 1; i < order.length; i += 1) if (!(out.indexOf(order[i - 1]) < out.indexOf(order[i]))) ordered = false;
if (ordered) ok('段落顺序正确'); else bad('段落顺序异常');

// 令牌、状态、等待秒数
if (out.includes('tok-123') && out.includes('未读 1 条') && out.includes('timeoutMs=300000')) ok('令牌/状态/等待注入');
else bad('关键字段缺失');
if (out.includes('群友A') && out.includes('2 分钟')) ok('最近消息与时间');
else bad('最近消息缺失');

// 唤醒原因是 timeout
if (out.includes('有限潜水时间已到')) ok('超时文案');
else bad('超时文案缺失');

// bootstrap 才带初始提示词
const boot = renderWakePromptV2({ key: 'group:1', reason: 'bootstrap', deps });
if (boot.includes('【初始提示词】')) ok('bootstrap 带初始提示词');
else bad('bootstrap 缺初始提示词');
if (!out.includes('【初始提示词】')) ok('非 bootstrap 不带初始提示词');
else bad('非 bootstrap 误带');

// 触发消息多旧
const mentioned = renderWakePromptV2({ key: 'group:1', reason: 'atMention@seq1', deps });
if (mentioned.includes('触发这条是 2 分钟')) ok('触发消息时间说明');
else bad('触发消息时间缺失');

// 纯函数
if (renderWakePromptV2({ key: 'g', reason: 'timeout', deps }) === renderWakePromptV2({ key: 'g', reason: 'timeout', deps })) ok('同输入同输出');
else bad('输出不稳定');

console.log('\n' + (fail ? `❌ ${fail} 项失败` : `✅ ${pass} 项全部通过`));
process.exit(fail ? 1 : 0);
