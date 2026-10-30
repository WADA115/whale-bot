// 回复形态 + 版本比较：单测
import { normalizeReplyShape, pickGapMs, REPLY_LIMITS, REPLY_DEFAULTS } from '../src/reply-shape.js';
import { compareVersions, parseRelease, buildUpdateResult } from '../src/update-check.js';

let pass = 0; let fail = 0;
const ok = (m) => { console.log('  ✅ ' + m); pass += 1; };
const bad = (m) => { console.log('  ❌ ' + m); fail += 1; };

// ── 回复形态 ───────────────────────────────────────────────────────────
const def = normalizeReplyShape({});
if (def.maxBubbles === 8 && def.maxChars === 40 && def.gapMinMs === 600 && def.gapMaxMs === 1400) {
  ok('默认值等于现有行为（8 条 / 40 字 / 600~1400ms）');
} else {
  bad('默认值变了：' + JSON.stringify(def));
}

const custom = normalizeReplyShape({ role: { reply: { bubblesMax: 3, bubbleMaxChars: 80, gapMinMs: 1000, gapMaxMs: 2000 } } });
if (custom.maxBubbles === 3 && custom.maxChars === 80) ok('自定义值生效');
else bad('自定义值没生效：' + JSON.stringify(custom));

const over = normalizeReplyShape({ role: { reply: { bubblesMax: 99, bubbleMaxChars: 9999, gapMinMs: 1, gapMaxMs: 999999 } } });
if (over.maxBubbles === REPLY_LIMITS.maxBubbles.max
  && over.maxChars === REPLY_LIMITS.maxChars.max
  && over.gapMinMs === REPLY_LIMITS.gapMinMs.min
  && over.gapMaxMs === REPLY_LIMITS.gapMaxMs.max) {
  ok('越界值被钳到上限/下限');
} else {
  bad('越界没钳住：' + JSON.stringify(over));
}

const inverted = normalizeReplyShape({ role: { reply: { gapMinMs: 5000, gapMaxMs: 1000 } } });
if (inverted.gapMaxMs >= inverted.gapMinMs) ok('min > max 时自动纠正');
else bad('min/max 反了：' + JSON.stringify(inverted));

const sendCompat = normalizeReplyShape({ socialV2: { send: { burstMaxMessages: 2, burstIntervalMinMs: 800, burstIntervalMaxMs: 1200 } } });
if (sendCompat.maxBubbles === 2 && sendCompat.gapMinMs === 800 && sendCompat.gapMaxMs === 1200) ok('兼容 socialV2.send 老字段');
else bad('老字段没兼容：' + JSON.stringify(sendCompat));

const gaps = Array.from({ length: 50 }, () => pickGapMs({ gapMinMs: 500, gapMaxMs: 700 }));
if (gaps.every((g) => g >= 500 && g <= 700)) ok('随机间隔落在区间内');
else bad('间隔越界：' + JSON.stringify(gaps.slice(0, 5)));

// ── 版本比较 ───────────────────────────────────────────────────────────
const cases = [
  ['0.4.0', '0.3.0', 1],
  ['0.3.0', '0.3.0', 0],
  ['0.3.0', '0.4.0', -1],
  ['v0.3.0', '0.3.0', 0],
  ['0.10.0', '0.9.0', 1],
  ['1.0.0', '0.99.99', 1]
];
for (const [a, b, want] of cases) {
  const got = compareVersions(a, b);
  if (got === want) ok(`compare(${a}, ${b}) = ${got}`);
  else bad(`compare(${a}, ${b}) 期望 ${want} 实际 ${got}`);
}

// ── release 解析 ───────────────────────────────────────────────────────
const rel = parseRelease({
  tag_name: 'v0.4.0',
  html_url: 'https://github.com/WADA115/whale-bot/releases/tag/v0.4.0',
  name: '小鲸鱼 v0.4.0',
  body: '更新内容',
  published_at: '2026-10-29T00:00:00Z'
});
if (rel && rel.latest === '0.4.0' && rel.url.includes('v0.4.0')) ok('release 解析正常');
else bad('release 解析失败：' + JSON.stringify(rel));

if (parseRelease(null) === null) ok('空 release 返回 null');
else bad('空 release 没返回 null');

const res1 = buildUpdateResult('0.3.0', {
  tag_name: 'v0.4.0', html_url: 'https://x/y', name: 'n', body: 'b', published_at: ''
});
if (res1.updateAvailable === true && res1.latest === '0.4.0') ok('有新版时 updateAvailable=true');
else bad('新版判断错：' + JSON.stringify(res1));

const res2 = buildUpdateResult('0.4.0', { tag_name: 'v0.4.0', html_url: 'https://x/y', name: 'n', body: 'b' });
if (res2.updateAvailable === false) ok('同版本 updateAvailable=false');
else bad('同版本判断错：' + JSON.stringify(res2));

const res3 = buildUpdateResult('0.3.0', null);
if (res3.ok && res3.error) ok('拿不到 release 时给出错误说明');
else bad('无 release 时处理不对：' + JSON.stringify(res3));

console.log('\n' + (fail ? `❌ ${fail} 项失败` : `✅ ${pass} 项全部通过`));
process.exit(fail ? 1 : 0);
