// 执行层 Action + Gateway 测试
import { createExecutionGateway } from '../src/execution/gateway.js';
import { normalizeExecutionAction } from '../src/execution/action.js';

let pass = 0; let fail = 0;
const ok = (m) => { console.log('  ✅ ' + m); pass += 1; };
const bad = (m) => { console.log('  ❌ ' + m); fail += 1; };

if (normalizeExecutionAction({ source: 'dialogue', messages: ['a'] }).ok) ok('action 合法');
else bad('action 契约异常');
if (normalizeExecutionAction({ source: 'dialogue', messages: [] }).ok === false) ok('空消息拒绝');
else bad('空消息未拒');
if (normalizeExecutionAction({ source: 'system', messages: ['x'] }).ok) ok('system 合法');
else bad('system 异常');

const sent = [];
const gw = createExecutionGateway({
  sendOne: async (chat, msg) => { sent.push(chat + ':' + msg); },
  audit: async () => true,
  sleep: async () => {}
});

const r1 = await gw.execute({ source: 'dialogue', chat: 'g1', actionId: 'a1', messages: ['hi', 'there'], delayMs: [10], standards: { pass: true } });
if (r1.ok && sent.length === 2) ok('正常发送两条');
else bad('发送异常：' + JSON.stringify(r1));

const r2 = await gw.execute({ source: 'dialogue', chat: 'g1', actionId: 'a1', messages: ['dup'], standards: { pass: true } });
if (r2.reason === 'duplicate') ok('幂等去重');
else bad('幂等异常：' + JSON.stringify(r2));

const r3 = await gw.execute({ source: 'dialogue', chat: 'g1', actionId: 'a2', messages: ['x'], standards: { pass: false } });
if (r3.reason === 'standards') ok('四标准不过 → 拒发');
else bad('标准异常：' + JSON.stringify(r3));

const system = await gw.execute({ source: 'system', chat: 'g1', actionId: 'a3', messages: ['sys'], standards: { pass: false } });
if (system.ok) ok('system 可绕过标准');
else bad('system 异常');

const r4 = await gw.execute({ source: 'dialogue', chat: 'g1', actionId: 'a4', messages: ['x'], expiresAt: 1, standards: { pass: true } });
if (r4.reason === 'expired') ok('过期拒发');
else bad('过期异常：' + JSON.stringify(r4));

const sent2 = [];
const gw2 = createExecutionGateway({ sendOne: async (c, m) => sent2.push(m), audit: async () => true, sleep: async () => {} });
const p = gw2.execute({ source: 'system', chat: 'g2', actionId: 'a5', messages: ['1', '2', '3'], delayMs: [10, 10] });
gw2.cancelChat('g2');
const r5 = await p;
if (r5.reason === 'cancelled' && sent2.length < 3) ok('取消后停止发送');
else bad('取消异常：' + JSON.stringify(r5));

const gw3 = createExecutionGateway({ sendOne: async () => {}, audit: async () => false });
const r6 = await gw3.execute({ source: 'system', chat: 'g3', actionId: 'a6', messages: ['x'] });
if (r6.reason === 'audit') ok('审核拦截');
else bad('审核异常');

console.log('\n' + (fail ? `❌ ${fail} 项失败` : `✅ ${pass} 项全部通过`));
process.exit(fail ? 1 : 0);
