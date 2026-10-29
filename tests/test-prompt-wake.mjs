// 唤醒模板快照：身份行 + 唤醒原因收尾
import { selfIdentityText, buildWakeReasonSuffix } from '../src/prompt/wake.js';

let pass = 0; let fail = 0;
const ok = (m) => { console.log('  ✅ ' + m); pass += 1; };
const bad = (m) => { console.log('  ❌ ' + m); fail += 1; };

// 1. 身份行
const id = selfIdentityText('鱼鱼', '12345');
if (id.includes('「鱼鱼」') && id.includes('QQ 12345') && id.includes('不要当成别人')) ok('身份行');
else bad('身份行异常：' + id);
if (selfIdentityText('', '') === '') ok('无身份返回空');
else bad('无身份未返回空');

// 2. 各唤醒原因
const key = 'group:978815624';
const cases = [
  ['bootstrap', '【引导唤醒】'],
  ['timeout', '有限潜水时间已到'],
  ['replyCheck', '【回复检查】'],
  ['proactiveCheck', '【主动机会】'],
  ['poke', '拍了一拍']
];
for (const [reason, needle] of cases) {
  const s = buildWakeReasonSuffix({ reason, key, preSleepMs: 300000 });
  if (s.includes(key) && s.includes(needle)) ok('唤醒模板：' + reason);
  else bad('模板异常：' + reason + ' → ' + s.slice(0, 60));
}

// 3. 默认（mention 等通用原因）
const generic = buildWakeReasonSuffix({ reason: 'atMention@seq194', key, triggeredLine: '（触发这条是 2 分钟前发的）' });
if (generic.includes('atMention@seq194') && generic.includes('2 分钟前') && generic.includes('【行动前】')) ok('通用唤醒模板');
else bad('通用模板异常');

// 4. 沉睡前等待秒数写进 replyCheck
const rc = buildWakeReasonSuffix({ reason: 'replyCheck', key, preSleepMs: 123456 });
if (rc.includes('timeoutMs=123456')) ok('等待时长注入');
else bad('等待时长未注入');

console.log('\n' + (fail ? `❌ ${fail} 项失败` : `✅ ${pass} 项全部通过`));
process.exit(fail ? 1 : 0);
