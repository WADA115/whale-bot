// 语境引擎单测：记录、话题、待回应、情境块、清理。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createContextEngine } from '../src/context-engine.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-test-'));
const file = path.join(dir, 'context.json');
const ctx = createContextEngine({ file, log: () => {} });

// 1. 记录发言 + 在场人
ctx.observe('group:1', { sender: '阿伟', text: '今天打游戏吗' });
ctx.observe('group:1', { sender: '小红', text: '我不玩那个' });
ctx.observe('group:1', { sender: '阿伟', text: '小鲸鱼你会玩吗', addressed: true });
assert.deepEqual(ctx.activeSpeakers('group:1').sort(), ['小红', '阿伟'].sort());
console.log('OK 在场人 →', ctx.activeSpeakers('group:1').join('、'));

// 2. 待回应：问句且不是对机器人说的
ctx.observe('group:1', { sender: '小红', text: '几点开服?' });
const pend = ctx.pendingQuestions('group:1');
assert.ok(pend.some((p) => p.text.includes('几点开服')), '应记下待回应的问句');
console.log('OK 待回应 →', pend.map((p) => p.text).join(' | '));

// 3. 话题 + 情境块
ctx.setTopic('group:1', '在聊今晚开服时间');
const block = ctx.buildBlock('group:1', { maxChars: 600 });
assert.ok(block.includes('【当前话题】'), '应含话题');
assert.ok(block.includes('【在场】'), '应含在场人');
assert.ok(block.includes('【还没回应】'), '应含待回应');
assert.ok(block.includes('【刚才的对话】'), '应含对话');
assert.ok(block.length <= 640, `块长度应受控，实际 ${block.length}`);
console.log('OK 情境块 →', block.length, '字符');

// 4. 回答后清掉待回应
ctx.markAnswered('group:1', { sender: '小红' });
assert.equal(ctx.pendingQuestions('group:1').length, 0, '回答后应清空该发送者的待回应');
console.log('OK 已回答 → 待回应清空');

// 5. 持久化
ctx.flush();
const ctx2 = createContextEngine({ file });
assert.equal(ctx2.stats('group:1').turns, 4, '重载后轮数一致');
assert.equal(ctx2.stats('group:1').topic, '在聊今晚开服时间');
console.log('OK 持久化 →', JSON.stringify(ctx2.stats('group:1')));

// 6. 空会话不产生块
assert.equal(ctx.buildBlock('group:999'), '', '空会话应返回空串');
console.log('OK 空会话 → 空串');

fs.rmSync(dir, { recursive: true, force: true });
console.log('\n全部通过');
