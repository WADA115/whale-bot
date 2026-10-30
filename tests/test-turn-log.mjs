// 对话回合日志测试
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendTurnLog, readTurnLogs, turnLogFile } from '../src/dialogue/turn-log.js';

let pass = 0; let fail = 0;
const ok = (m) => { console.log('  ✅ ' + m); pass += 1; };
const bad = (m) => { console.log('  ❌ ' + m); fail += 1; };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'turnlog-'));
const now = new Date('2026-10-30T01:00:00+08:00');
const rec = appendTurnLog({
  turnId: 't1', chat: 'group:978815624', trigger: 'smart-gate',
  sender: '甲', text: '题呢', at: ['你'],
  gate: { addressed: false, reason: '否', latencyMs: 120 },
  action: 'skip', reason: '两个人在接梗'
}, { dir, now });

if (rec.chat === 'group:978815624' && rec.action === 'skip' && rec.gate.addressed === false) ok('写入字段');
else bad('写入字段异常');
const y = now.getFullYear();
const m = String(now.getMonth() + 1).padStart(2, '0');
const d = String(now.getDate()).padStart(2, '0');
if (turnLogFile(dir, now).endsWith(`turns-${y}-${m}-${d}.jsonl`)) ok('按日期分文件');
else bad('日期文件异常');

appendTurnLog({ turnId: 't2', chat: 'group:978815624', action: 'reply' }, { dir, now });
const logs = readTurnLogs({ dir, date: now, limit: 10 });
if (logs.length === 2 && logs[1].action === 'reply') ok('读取最近回合');
else bad('读取异常：' + logs.length);

// 长文本截断
const long = appendTurnLog({ text: 'x'.repeat(1000), action: 'reply' }, { dir, now });
if (long.text.length <= 240) ok('长文本截断');
else bad('长文本未截断');

// 空目录
if (readTurnLogs({ dir: path.join(dir, 'nope'), date: now }).length === 0) ok('无日志返回空');
else bad('无日志异常');

fs.rmSync(dir, { recursive: true, force: true });

console.log('\n' + (fail ? `❌ ${fail} 项失败` : `✅ ${pass} 项全部通过`));
process.exit(fail ? 1 : 0);
