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
  'test-vault.mjs',
  'test-emotion.mjs',
  'test-reply-shape.mjs',
  'test-weights.mjs',
  'test-plugin-verify.mjs',
  'test-plugin-host.mjs',
  'test-kaomoji.mjs',
  'test-growth.mjs',
  'test-growth-evolve.mjs',
  'test-growth-influence.mjs',
  'test-growth-narrative.mjs',
  'test-narrative-guard.mjs',
  'test-persona-guard.mjs',
  'test-slang-policy.mjs',
  'test-prompt-assemble.mjs',
  'test-message-parse.mjs',
  'test-send-pipeline.mjs',
  'test-prompt-context.mjs',
  'test-prompt-wake.mjs',
  'test-plugin-runtime.mjs',
  'test-wake-render.mjs',
  'test-dsh-queue.mjs',
  'test-dsh-deliver.mjs',
  'test-deliver-run.mjs',
  'test-user-id.mjs',
  'test-group-classify.mjs',
  'test-group-history.mjs',
  'test-turn-log.mjs',
  'test-dialogue-model.mjs',
  'test-dialogue-gate.mjs',
  'test-dialogue-thinker.mjs',
  'test-dialogue-speaker.mjs',
  'test-dialogue-pipeline.mjs',
  'test-auth-core.mjs',
  'test-orchestrator-autonomy.mjs',
  'test-orchestrator-predictor.mjs',
  'test-execution-gateway.mjs',
  'test-orchestrator.mjs',
  'test-orchestrator-standards.mjs',
  'check-egress.mjs',
  'check-panel.mjs',
  'check-repo-hygiene.mjs',
  'test-deepseek-tools.mjs',
  'test-group-runtime.mjs',
  'test-group-batcher.mjs',
  'test-turn-ledger.mjs',
  'test-knowledge.mjs',
  'test-knowledge-learning.mjs',
  'test-hedged.mjs',
  'test-initiative-gateway.mjs',
  'test-memory-semantic.mjs',
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
