import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMemoryCore } from '../src/memory-core.js';

const file = path.join(os.tmpdir(), 'whale-memory-semantic-' + process.pid + '.json');
const embed = async (texts) => texts.map((t) => [
  String(t).includes('雨') ? 1 : 0,
  String(t).includes('火') ? 1 : 0,
  String(t).includes('端口') ? 1 : 0
]);

let pass = 0;
const ok = (name, cond) => { if (cond) { pass += 1; console.log('  ✅ ' + name); } else { console.log('  ❌ ' + name); process.exitCode = 1; } };

try {
  try { fs.unlinkSync(file); } catch {}
  const core = createMemoryCore({ file, embed });
  core.addFact('小鲸鱼最喜欢在雨天听歌', { tier: 'long' });
  core.addFact('主人今天说想吃火锅', { tier: 'short' });
  core.addFact('面板端口是 3200', { tier: 'long' });
  const block = await core.buildSemanticBlock('下雨的时候喜欢做什么', { limit: 2 });
  ok('语义命中雨天', block.includes('雨天'));
  ok('不把火锅排第一', block.indexOf('雨天') < (block.indexOf('火锅') === -1 ? Infinity : block.indexOf('火锅')));
  const hits = await core.semanticSearch('端口是多少', { limit: 1 });
  ok('语义命中端口', hits.length === 1 && hits[0].fact.text.includes('端口'));
  core.addFact('换一条新的雨天记忆', { tier: 'long' });
  const after = await core.buildSemanticBlock('雨天', { limit: 3 });
  ok('新增事实可被召回', after.includes('新的雨天'));
  console.log(`\n${pass} 项语义记忆测试通过`);
} finally {
  try { fs.unlinkSync(file); } catch {}
}
