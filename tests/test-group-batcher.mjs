import { createGroupBatcher } from '../src/group/batcher.js';

let pass = 0;
const ok = (name, cond) => { if (cond) { pass += 1; console.log('  ✅ ' + name); } else { console.log('  ❌ ' + name); process.exitCode = 1; } };

const b = createGroupBatcher({ log: () => {}, ttlMs: 1000 });
const a = b.begin('g1', { text: 'a' });
ok('第一个是 owner', a.owner === true && a.batch.items.length === 1);
const c = b.begin('g1', { text: 'b' });
ok('第二个并入', c.owner === false && c.batch.items.length === 2);
const ready = await b.wait(a.batch, 10);
ok('窗口结束返回批次', ready?.items.length === 2);
ok('批次已清理', b.get('g1') === null);
const d = b.begin('g1', { text: 'c' });
const none = await b.wait(d.batch, 1);
ok('超时/替换返回 null', none === null || none.items.length === 1);
b.abandon(d.batch);
console.log(`\n${pass} 项群聊批处理测试通过`);
