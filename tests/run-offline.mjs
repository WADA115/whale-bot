// 只跑「不需要面板、不需要网络」的测试，给 CI 用。
//
// 依赖 127.0.0.1:3200 的四个端到端测试不在这里：
//   test-persona-sync / test-reset-button / test-selfreset / test-temp-password
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

// 干净 clone 里没有 state/：先建最小结构
try {
  const setup = await import('./_setup.mjs');
  setup.ensureState();
} catch {}

const pick = [
  'test-memcore.mjs',
  'test-memory-scope.mjs',
  'test-automem.mjs',
  'test-learn'.replace('test-learn', 'test-learning') + '.mjs',
  'test-context.mjs',
  'test-expression.mjs',
  'test-face.mjs',
  'test-filter.mjs',
  'test-gateway.mjs',
  'test-guard.mjs',
  'test-envscan.mjs',
  'test-mdrender.mjs',
  'test-dsh-detect.mjs'
].filter((f) => fs.existsSync(path.join(dir, f)));

if (!pick.length) { console.log('没有可跑的离线测试'); process.exit(1); }

const results = [];
for (const file of pick) {
  console.log(`\n──── ${file} ${'─'.repeat(Math.max(0, 40 - file.length))}`);
  const r = spawnSync(process.execPath, ['--no-warnings', path.join(dir, file)], { cwd: dir, stdio: 'inherit' });
  results.push({ file, ok: r.status === 0, status: r.status });
  console.log(r.status === 0 ? `✅ ${file}` : `❌ ${file}（exit ${r.status}）`);
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n${'='.repeat(48)}`);
console.log(`离线测试 ${passed}/${results.length} 通过`);
if (passed !== results.length) {
  console.log('失败：' + results.filter((r) => !r.ok).map((r) => r.file).join('、'));
}
process.exit(passed === results.length ? 0 : 1);
