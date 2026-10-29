// 叙事对外审核单测
import { reviewNarrative, reviewReport } from '../src/narrative-guard.js';

let pass = 0; let fail = 0;
const ok = (m) => { console.log('  ✅ ' + m); pass += 1; };
const bad = (m) => { console.log('  ❌ ' + m); fail += 1; };

// 1. 正常叙事保留
const a = reviewNarrative('这周他夸了我两次。我们一起聊到很晚。');
if (a && a.includes('夸了我') && a.length <= 60) ok('正常叙事保留：' + a);
else bad('正常叙事异常：' + a);

// 2. 秘密/密码整句丢弃
const b = reviewNarrative('这周他夸了我两次。他告诉我一个秘密。我们还聊到很晚。');
if (b && b.includes('夸了我') && !b.includes('秘密')) ok('秘密句被丢弃');
else bad('秘密句没丢：' + b);

// 3. 号码/手机号打码且丢句
const c = reviewNarrative('他手机号是 13812345678。我们聊得很开心。');
if (c && !c.includes('13812345678')) ok('手机号没泄漏：' + c);
else bad('手机号泄漏：' + c);

// 4. 地址/银行卡句丢弃
const d = reviewNarrative('他说了家庭住址。我们说好周末见。');
if (d && !d.includes('住址') && d.includes('周末')) ok('地址句被丢弃');
else bad('地址句没丢：' + d);

// 5. 全是敏感 → null
const e = reviewNarrative('他告诉了我密码。还说了银行卡号。');
if (e === null) ok('全敏感 → null');
else bad('全敏感没返回 null：' + e);

// 6. 太短 → null
if (reviewNarrative('嗯。') === null) ok('太短 → null');
else bad('太短没 null');

// 7. 长度上限
const long = reviewNarrative('今天很开心。明天也开心。后天也开心。大后天也开心。');
if (long && long.length <= 60) ok('长度 ≤60');
else bad('超长：' + (long || '').length);

// 8. 报告
const rep = reviewReport('夸了我。说了秘密。给了手机号 13812345678。');
if (rep.total === 3 && rep.dropped >= 2) ok('审核报告正确：' + JSON.stringify(rep));
else bad('报告异常：' + JSON.stringify(rep));

console.log('\n' + (fail ? `❌ ${fail} 项失败` : `✅ ${pass} 项全部通过`));
process.exit(fail ? 1 : 0);
