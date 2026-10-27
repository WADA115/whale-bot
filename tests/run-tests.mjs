// 统一测试入口：跑 qq-bridge-adapt 下所有 test-*.mjs / test-*.py，汇总结果。
//
// 为什么需要：测试文件攒了十来个，每次手敲容易漏。一条命令跑全量，
// 输出 PASS/FAIL 汇总，退出码非 0 表示有失败（方便以后接 CI）。
//
// 注意：这里用 stdio:'inherit' 而不是管道。在受限沙箱里，带管道的 spawn 会 EPERM
// （不能开命名管道），继承标准输入输出是允许的。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

// 干净 clone 里没有 state/：先建好最小结构
try {
  const setup = await import('./_setup.mjs');
  setup.ensureState();
} catch {}
const python = process.env.DSH_PYTHON || 'python';
const only = process.argv[2] || '';

const files = fs.readdirSync(dir)
  .filter((f) => /^test-.*\.(mjs|py)$/.test(f))
  .filter((f) => !only || f.includes(only))
  .sort();

if (!files.length) {
  console.log('没有找到测试文件');
  process.exit(1);
}

const results = [];
for (const file of files) {
  const isPy = file.endsWith('.py');
  const cmd = isPy ? python : process.execPath;
  const args = isPy ? [path.join(dir, file)] : ['--no-warnings', path.join(dir, file)];
  console.log(`\n──── ${file} ${'─'.repeat(Math.max(0, 40 - file.length))}`);
  const r = spawnSync(cmd, args, { cwd: dir, stdio: 'inherit' });
  const ok = r.status === 0;
  results.push({ file, ok, status: r.status });
  console.log(ok ? `✅ ${file}` : `❌ ${file}（exit ${r.status}）`);
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n${'='.repeat(48)}`);
console.log(`${passed}/${results.length} 通过`);
if (passed !== results.length) {
  console.log('失败：' + results.filter((r) => !r.ok).map((r) => r.file).join('、'));
  process.exit(1);
}
