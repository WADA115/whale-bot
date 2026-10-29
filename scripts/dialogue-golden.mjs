// 从真实群聊生成黄金集骨架（需要人工补 label/shouldReply）。
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const group = getArg('group', '978815624');
const limit = Math.max(1, Math.min(500, Number(getArg('limit', '200')) || 200));
const force = args.includes('--force');

const src = path.join(root, 'state', 'context.json');
const outDir = path.join(root, 'state', 'dialogue');
const out = path.join(outDir, `golden-${group}.jsonl`);

if (fs.existsSync(out) && !force) {
  console.error(`❌ 已存在 ${out}；要重建请加 --force`);
  process.exit(1);
}

let ctx;
try { ctx = JSON.parse(fs.readFileSync(src, 'utf8')); } catch (e) {
  console.error('读取 state/context.json 失败：' + e.message);
  process.exit(1);
}
const turns = ctx?.convs?.[`group:${group}`]?.turns;
if (!Array.isArray(turns) || !turns.length) {
  console.error(`没有找到 group:${group} 的聊天记录`);
  process.exit(1);
}

const rows = turns.slice(-limit).map((t, i) => ({
  id: `${group}-${i + 1}`,
  ts: Number(t.at) || 0,
  sender: String(t.sender ?? ''),
  text: String(t.text ?? '').slice(0, 300),
  addressed: !!t.addressed,
  shouldReply: null,   // 人工标注：true / false
  replyTo: null,       // 可选：要回复哪条 id
  note: ''
}));

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(out, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
const yes = rows.filter((r) => r.addressed).length;
console.log(`✅ 已生成 ${rows.length} 条：${out}`);
console.log(`   其中上下文标为“对 AI” ${yes} 条；其余 ${rows.length - yes} 条需要人工标 shouldReply`);
