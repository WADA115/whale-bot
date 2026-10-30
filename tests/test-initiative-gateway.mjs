import { createExecutionGateway } from '../src/execution/gateway.js';
import { createInitiativeScheduler } from '../src/orchestrator/initiative-scheduler.js';

let pass = 0;
const ok = (name, cond) => { if (cond) { pass += 1; console.log('  ✅ ' + name); } else { console.log('  ❌ ' + name); process.exitCode = 1; } };

const sent = [];
const gateway = createExecutionGateway({
  sendOne: async (chat, msg) => { sent.push({ type: 'text', chat, msg }); },
  sendExpression: async (chat, action) => { sent.push({ type: 'expression', chat, action: action.expression }); }
});

const res = await gateway.execute({
  actionId: 'expr-1',
  source: 'system',
  type: 'expression',
  chat: 'group:1',
  expression: { kind: 'face', value: '14' }
});
ok('expression 通过 Gateway', res.ok === true && res.expression === true);
ok('expression 到达 handler', sent.length === 1 && sent[0].type === 'expression' && sent[0].action.kind === 'face');

const dup = await gateway.execute({
  actionId: 'expr-1',
  source: 'system',
  type: 'expression',
  chat: 'group:1',
  expression: { kind: 'face', value: '14' }
});
ok('expression 幂等', dup.ok === false && dup.reason === 'duplicate');

const bad = await gateway.execute({ actionId: 'expr-2', source: 'system', type: 'expression', chat: 'group:1', expression: { kind: 'nope', value: 'x' } });
ok('非法 expression 拒绝', bad.ok === false && bad.reason === 'invalid');

let ran = 0;
const scheduler = createInitiativeScheduler({
  listChats: () => ['group:1'],
  idleMsFor: () => 40 * 60 * 1000,
  run: async () => { ran += 1; return true; },
  intervalMs: 60000,
  idleMs: 30 * 60 * 1000,
  maxPerHour: 1,
  now: () => 1000000
});
const t1 = await scheduler.tick();
const t2 = await scheduler.tick();
ok('空闲触发一次', t1.fired.length === 1 && ran === 1);
ok('每小时上限生效', t2.fired.length === 0 && ran === 1);

console.log(`\n${pass} 项 Initiative/Gateway 测试通过`);
