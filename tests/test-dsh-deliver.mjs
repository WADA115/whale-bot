// 投递内容组装单测：快照后缀、text/图片 parts、错误脱敏
import { appendWakeSnapshot, buildDeliveryContent, deliveryErrorText } from '../src/dsh/deliver.js';

let pass = 0; let fail = 0;
const ok = (m) => { console.log('  ✅ ' + m); pass += 1; };
const bad = (m) => { console.log('  ❌ ' + m); fail += 1; };

// 1. 无快照原样返回
if (appendWakeSnapshot('hi', null) === 'hi') ok('无快照不追加');
else bad('无快照被改');

// 2. 有快照追加 JSON 与说明
const withSnap = appendWakeSnapshot('hi', { messages: [{ seq: 1 }], partial: true });
if (withSnap.startsWith('hi\n\n【本次消息快照】') && withSnap.includes('"seq":1') && withSnap.includes('partial=true')) ok('快照追加');
else bad('快照追加异常');

// 3. 纯文本投递
const text = await buildDeliveryContent({
  promptText: 'p',
  withSlangContext: (s) => '[黑话]' + s,
  resolveMediaList: async () => { throw new Error('不该调用'); }
});
if (text.length === 1 && text[0].type === 'text' && text[0].text === '[黑话]p') ok('纯文本 parts');
else bad('纯文本异常：' + JSON.stringify(text));

// 4. 带图片：先文本后图片，且黑话上下文只包文本
const parts = await buildDeliveryContent({
  promptText: 'p',
  media: [{ file: 'a.png' }],
  withSlangContext: (s) => '[黑话]' + s,
  resolveMediaList: async (m) => [{ type: 'image', data: { file: m[0].file } }]
});
if (parts.length === 2 && parts[0].text === '[黑话]p' && parts[1].type === 'image') ok('图片 parts 顺序');
else bad('图片 parts 异常：' + JSON.stringify(parts));

// 5. 错误脱敏
if (deliveryErrorText({ code: 'E', message: 'bad' }) === 'E: bad') ok('错误文案');
else bad('错误文案异常');
if (deliveryErrorText({ code: 'E', message: 'secret', shouldRedact: true }) === '（含敏感信息，已隐藏）') ok('敏感错误脱敏');
else bad('脱敏异常');

console.log('\n' + (fail ? `❌ ${fail} 项失败` : `✅ ${pass} 项全部通过`));
process.exit(fail ? 1 : 0);
