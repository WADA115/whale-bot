// 事件 / 线程 / 动作契约测试
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendEvent, readEvents } from '../src/dialogue/events.js';
import { createThreadStore } from '../src/dialogue/thread-store.js';
import { normalizeAction } from '../src/dialogue/actions.js';

let pass = 0; let fail = 0;
const ok = (m) => { console.log('  ✅ ' + m); pass += 1; };
const bad = (m) => { console.log('  ❌ ' + m); fail += 1; };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dialogue-'));
const now = new Date();

// events
const e1 = appendEvent({ chat: 'group:1', sender: { id: 'u1', name: '甲' }, text: '题呢', at: ['你'] }, { dir });
if (e1.id.startsWith('evt_') && e1.text === '题呢') ok('事件写入');
else bad('事件写入异常');
const loaded = readEvents({ dir, date: now, limit: 10 });
if (loaded.length === 1 && loaded[0].sender.name === '甲') ok('事件读取');
else bad('事件读取异常');

// thread
const store = createThreadStore({ dir });
store.observe({ chat: 'group:1', sender: { name: '甲', isSelf: false, isBot: false }, text: '题呢', ts: 1, id: 'e1' });
store.observe({ chat: 'group:1', sender: { name: '乙', isSelf: false, isBot: true }, text: '我先出', ts: 2, id: 'e2' });
let snap = store.snapshot('group:1');
if (snap.counters.human === 1 && snap.counters.bot === 1) ok('线程计数');
else bad('线程计数异常：' + JSON.stringify(snap.counters));
if (snap.openQuestions.length === 0) ok('其他 bot 发言会清掉开放问题');
else bad('开放问题未清');
store.observe({ chat: 'group:1', sender: { name: '鱼鱼', isSelf: true }, text: '我来', ts: 3, id: 'e3' });
snap = store.snapshot('group:1');
if (snap.lastSelf?.text === '我来' && snap.counters.self === 1) ok('机器人上一轮');
else bad('机器人上一轮异常');
store.observe({ chat: 'group:1', sender: { name: '甲' }, text: '你接下半句？', ts: 4, id: 'e4' });
if (store.snapshot('group:1').openQuestions.length === 1) ok('开放问题识别');
else bad('开放问题异常');

// actions
const a1 = normalizeAction({ action: 'reply', messages: ['a', ' ', 'b'], replyTo: 194, interject: true });
if (a1.ok && a1.action.messages.length === 2 && a1.action.replyTo === '194' && a1.action.interject) ok('reply 契约');
else bad('reply 契约异常：' + JSON.stringify(a1));
if (!normalizeAction({ action: 'reply', messages: [] }).ok) ok('空 reply 拒绝');
else bad('空 reply 未拒');
if (normalizeAction({ action: 'skip', reason: '接梗' }).action.action === 'skip') ok('skip 契约');
else bad('skip 异常');
if (normalizeAction({ action: 'wait', waitMs: 8000 }).action.waitMs === 8000) ok('wait 契约');
else bad('wait 异常');
if (!normalizeAction({ action: 'dance' }).ok) ok('未知动作拒绝');
else bad('未知动作未拒');

fs.rmSync(dir, { recursive: true, force: true });

console.log('\n' + (fail ? `❌ ${fail} 项失败` : `✅ ${pass} 项全部通过`));
process.exit(fail ? 1 : 0);
