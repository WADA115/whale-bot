// 回放黄金集：校验格式 + 输出统计；后续在这里接新决策器。
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const group = getArg('group', '978815624');
const file = path.join(root, 'state', 'dialogue', `golden-${group}.jsonl`);

let raw;
try { raw = fs.readFileSync(file, 'utf8'); } catch {
  console.error(`❌ 找不到 ${file}；先运行 node scripts/dialogue-golden.mjs --group=${group}`);
  process.exit(1);
}
const rows = raw.split(/\r?\n/).filter(Boolean).map((line, i) => {
  try { return JSON.parse(line); } catch { throw new Error(`第 ${i + 1} 行不是 JSON`); }
});

const labelled = rows.filter((r) => typeof r.shouldReply === 'boolean');
const should = labelled.filter((r) => r.shouldReply === true).length;
console.log(`黄金集 group:${group}`);
console.log(`  总条数        ${rows.length}`);
console.log(`  已标注        ${labelled.length}（该回 ${should} / 不该回 ${labelled.length - should}）`);
console.log(`  未标注        ${rows.length - labelled.length}`);
if (!labelled.length) {
  console.log('  提示：先人工补 shouldReply=true/false，再谈准确率。');
}
if (args.includes('--json')) {
  console.log(JSON.stringify({ group, total: rows.length, labelled: labelled.length, shouldReply: should }, null, 2));
}
