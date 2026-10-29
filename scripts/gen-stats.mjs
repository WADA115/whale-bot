// 测试数量单一真源：跑离线测试，把结果写进 README 的标记块；--check 只校验不写。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const checkOnly = process.argv.includes('--check');

const run = spawnSync(process.execPath, [path.join(root, 'tests', 'run-offline.mjs')], {
  cwd: root,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe']
});
const output = `${run.stdout || ''}${run.stderr || ''}`;
process.stdout.write(output);
const m = output.match(/离线测试 (\d+)\/(\d+) 通过/);
if (!m) {
  console.error('❌ 无法从离线测试输出里解析数量');
  process.exit(1);
}
const [passed, total] = [Number(m[1]), Number(m[2])];

const blocks = [
  ['README.md', `离线测试：${passed}/${total} 项通过（CI 生成）`],
  ['README.en.md', `Offline tests: ${passed}/${total} passing (CI-generated)`]
];

let changed = 0;
for (const [file, text] of blocks) {
  const p = path.join(root, file);
  let s = fs.readFileSync(p, 'utf8');
  const re = /(<!-- STATS:OFFLINE:START -->)[\s\S]*?(<!-- STATS:OFFLINE:END -->)/;
  if (!re.test(s)) {
    console.error(`❌ ${file} 缺少 STATS:OFFLINE 标记块`);
    process.exit(1);
  }
  const next = s.replace(re, `$1\n${text}\n$2`);
  if (next !== s) {
    changed += 1;
    if (!checkOnly) fs.writeFileSync(p, next, 'utf8');
  }
}

if (checkOnly) {
  if (changed) {
    console.error(`❌ 测试数量已过期（需要更新 ${changed} 个文件）；运行 node scripts/gen-stats.mjs`);
    process.exit(1);
  }
  console.log(`✅ 测试数量一致：${passed}/${total}`);
} else {
  console.log(`✅ 已写入测试数量：${passed}/${total}（更新 ${changed} 个文件）`);
}
