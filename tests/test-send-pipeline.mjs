// 发送前文本规划快照：抽取自 bridge.js
import { singleLineForQQ, splitLongSegment, splitByCjkSpaces, splitReplyIntoBubbles, planSocialTimeline } from '../src/send/pipeline.js';

let pass = 0; let fail = 0;
const ok = (m) => { console.log('  ✅ ' + m); pass += 1; };
const bad = (m) => { console.log('  ❌ ' + m); fail += 1; };

// 1. 单行化
if (singleLineForQQ('a\n b  c') === 'a b c') ok('单行化');
else bad('单行化异常：' + JSON.stringify(singleLineForQQ('a\n b  c')));

// 2. 短文本不拆
if (JSON.stringify(splitLongSegment('你好', 10)) === JSON.stringify(['你好'])) ok('短文本不拆');
else bad('短文本被拆');

// 3. 超长按标点拆
const long = '第一段，第二段，第三段';
const parts = splitLongSegment(long, 6);
if (parts.length > 1 && parts.join('') === long) ok('超长按标点拆且不丢字');
else bad('拆分丢字：' + JSON.stringify(parts));

// 4. URL 不拆断
const withUrl = '看这个 https://example.com/a/very/long/path?x=1 很好';
const urlParts = splitLongSegment(withUrl, 10);
if (urlParts.some((p) => p.includes('https://example.com/a/very/long/path?x=1'))) ok('URL 完整保留');
else bad('URL 被拆断：' + JSON.stringify(urlParts));

// 5. emoji 不切半
const emoji = '😀'.repeat(20);
const emojiParts = splitLongSegment(emoji, 5);
if (emojiParts.every((p) => !/[\uD800-\uDBFF]$/.test(p))) ok('emoji 不切半');
else bad('emoji 切半');

// 6. 空格分条（中文）
const cjk = splitByCjkSpaces('你好 世界');
if (cjk.length === 2 && cjk[0] === '你好') ok('中文空格分条：' + JSON.stringify(cjk));
else bad('空格分条异常：' + JSON.stringify(cjk));

// 7. 颜文字空格保护
const kao = splitByCjkSpaces('(工 ^ 工 🌸) 好的');
if (kao.length === 2 && kao[0].includes('工 ^ 工')) ok('颜文字不被拆碎：' + JSON.stringify(kao));
else bad('颜文字被拆：' + JSON.stringify(kao));

// 8. 气泡切分：极短不拆
if (JSON.stringify(splitReplyIntoBubbles('草')) === JSON.stringify(['草'])) ok('极短不拆');
else bad('极短被拆');

// 9. 气泡切分：按句号
const bubbles = splitReplyIntoBubbles('你好呀。今天不错！');
if (bubbles.length === 2) ok('按句读切气泡：' + JSON.stringify(bubbles));
else bad('气泡切分异常：' + JSON.stringify(bubbles));

// 10. 分条计划：关闭分条
const off = planSocialTimeline('你好 世界', { burstEnabled: false, maxReplyChars: 50 });
if (off.main.length === 1 && off.main[0] === '你好 世界') ok('关闭分条整条发');
else bad('关闭分条异常：' + JSON.stringify(off));

// 11. 分条计划：开启分条
const on = planSocialTimeline('你好 世界', { burstEnabled: true, maxReplyChars: 50 });
if (on.main.length === 2) ok('开启分条按空格切：' + JSON.stringify(on.main));
else bad('开启分条异常：' + JSON.stringify(on.main));

console.log('\n' + (fail ? `❌ ${fail} 项失败` : `✅ ${pass} 项全部通过`));
process.exit(fail ? 1 : 0);
