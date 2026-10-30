import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTurnLedger } from '../src/kernel/turn-ledger.js';

let pass = 0;
const ok = (name, cond) => { if (cond) { pass += 1; console.log('  ✅ ' + name); } else { console.log('  ❌ ' + name); process.exitCode = 1; } };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'));
const ledger = createTurnLedger({ dbPath: path.join(dir, 'runtime.db') });
const t1 = ledger.begin('private:1', { text: '在吗' });
ledger.stage(t1.id, 'context_ready', { refs: 1 });
const c1 = ledger.commit(t1.id, { action: 'reply', messages: ['在'] });
ok('begin/stage/commit', c1.ok === true && t1.version === 1);
const got = ledger.get(t1.id);
ok('事件可回放', got.events.map((e) => e.stage).join(',').includes('context_ready'));
const t2 = ledger.begin('private:1', { text: '第二句' });
const stale = ledger.commit(t1.id, { action: 'reply', messages: ['旧'] });
ok('旧 turn 被拒绝', stale.ok === false);
ok('新 turn 版本递增', t2.version === 2);
const c2 = ledger.commit(t2.id, { action: 'skip', messages: [] });
ok('skip 可提交', c2.ok === true);
ledger.applyNotes('private:1', { tone: 'playful', open_questions: ['q'] });
const notes = ledger.getNotes('private:1');
ok('状态补丁', notes.tone === 'playful' && notes.open_questions[0] === 'q');
ledger.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} 项账本测试通过`);
