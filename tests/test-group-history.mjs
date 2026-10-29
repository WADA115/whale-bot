// 群聊线程格式化测试
import { formatRecentLine, formatCurrentLine, atLabel } from '../src/group-history.js';

let pass = 0; let fail = 0;
const ok = (m) => { console.log('  ✅ ' + m); pass += 1; };
const bad = (m) => { console.log('  ❌ ' + m); fail += 1; };

if (formatRecentLine({ name: '甲', text: '在吗' }) === '甲：在吗') ok('普通行');
else bad('普通行异常');
if (formatRecentLine({ name: '甲', text: '在吗', at: ['你'] }) === '甲（@ 你）：在吗') ok('@ 标注');
else bad('@ 标注异常');
if (formatRecentLine({ name: '鱼鱼', text: '出题', self: true }) === '[你] 鱼鱼：出题') ok('自己发言标记');
else bad('自己发言异常');
if (formatRecentLine({ name: '甲', text: '接', at: ['乙'], replyTo: '丙' }) === '甲（@ 乙；回复 丙）：接') ok('@ + 回复');
else bad('@+回复异常');

if (formatCurrentLine({ senderName: '甲', at: ['你'], text: '题呢' }) === '甲（@ 你）：题呢') ok('当前行');
else bad('当前行异常');

if (atLabel('999', '999', () => 'x') === '你') ok('@自己 → 你');
else bad('@自己异常');
if (atLabel('123', '999', () => '肥鱼') === '肥鱼') ok('@别人 → 名字');
else bad('@别人异常');
if (atLabel('123', '999', () => '') === 'QQ123') ok('解析失败用 QQ 号');
else bad('解析失败异常');

console.log('\n' + (fail ? `❌ ${fail} 项失败` : `✅ ${pass} 项全部通过`));
process.exit(fail ? 1 : 0);
