// DSH 投递队列单测：串行、失败继续、取消
import { createPromptQueue } from '../src/dsh/queue.js';

let pass = 0; let fail = 0;
const ok = (m) => { console.log('  ✅ ' + m); pass += 1; };
const bad = (m) => { console.log('  ❌ ' + m); fail += 1; };

// 1. 同一会话严格串行
const order = [];
const q = createPromptQueue({
  deliver: async (key, text) => {
    order.push('start:' + text);
    await new Promise((r) => setTimeout(r, text === 'a' ? 30 : 1));
    order.push('end:' + text);
    return { ok: true, text };
  }
});
const p1 = q.enqueue('k', 'a');
const p2 = q.enqueue('k', 'b');
await Promise.all([p1, p2]);
if (order.join(',') === 'start:a,end:a,start:b,end:b') ok('同会话串行');
else bad('串行异常：' + order.join(','));

// 2. 不同会话可并行
const order2 = [];
const q2 = createPromptQueue({
  deliver: async (key, text) => { order2.push(key + ':' + text); return { ok: true }; }
});
await Promise.all([q2.enqueue('a', '1'), q2.enqueue('b', '2')]);
if (order2.length === 2) ok('不同会话独立');
else bad('不同会话异常');

// 3. 失败后继续处理下一条
let calls = 0;
const q3 = createPromptQueue({
  deliver: async (key, text) => {
    calls += 1;
    if (text === 'bad') throw new Error('boom');
    return { ok: true, text };
  }
});
const badP = q3.enqueue('k', 'bad').catch((e) => 'err:' + e.message);
const goodP = q3.enqueue('k', 'good');
const [badRes, goodRes] = await Promise.all([badP, goodP]);
if (badRes === 'err:boom' && goodRes?.text === 'good' && calls === 2) ok('失败不阻塞后续');
else bad('失败处理异常：' + JSON.stringify({ badRes, goodRes, calls }));

// 4. 状态
if (q3.state('k').running === false && q3.state('k').queued === 0) ok('队列清空后状态正确');
else bad('状态异常：' + JSON.stringify(q3.state('k')));

// 5. drain 拒绝排队项
let release;
const q4 = createPromptQueue({
  deliver: () => new Promise((resolve) => { release = resolve; })
});
const running = q4.enqueue('k', 'run');
const waiting = q4.enqueue('k', 'wait').catch((e) => 'err:' + e.message);
q4.drain('k', '切换模式');
release({ ok: true });
await running;
const drained = await waiting;
if (drained === 'err:切换模式') ok('drain 取消排队项');
else bad('drain 异常：' + drained);

// 6. drainAll
let releaseA;
const q5 = createPromptQueue({ deliver: () => new Promise((resolve) => { releaseA = resolve; }) });
const a5 = q5.enqueue('a', '1').catch((e) => 'err:' + e.message);
await Promise.resolve();
const w2 = q5.enqueue('a', '2').catch((e) => 'err:' + e.message);
await Promise.resolve();
q5.drainAll('全清');
if ((await w2) === 'err:全清') ok('drainAll 全清');
else bad('drainAll 异常');
releaseA({ ok: true });
await a5;

console.log('\n' + (fail ? `❌ ${fail} 项失败` : `✅ ${pass} 项全部通过`));
process.exit(fail ? 1 : 0);
