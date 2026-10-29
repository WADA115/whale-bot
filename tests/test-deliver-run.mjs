// deliverPromptNow 编排单测：模式、离线排队、成功、拒绝、重试
import { deliverPromptNow } from '../src/dsh/deliver-run.js';

let pass = 0; let fail = 0;
const ok = (m) => { console.log('  ✅ ' + m); pass += 1; };
const bad = (m) => { console.log('  ❌ ' + m); fail += 1; };

function baseDeps(over = {}) {
  const calls = { sent: [], audited: [], retried: [], queue: new Map() };
  const deps = {
    isSessionAllowedInCurrentMode: () => true,
    socialWakeAllowed: () => true,
    socialV2: { paused: false, conversations: new Map() },
    cfg: { socialV2: { enabled: true } },
    pendingWakeKeys: new Set(['k']),
    disarmPendingWakeLease: () => { calls.disarmed = true; },
    dshReady: true,
    queued: calls.queue,
    queueMax: 3,
    log: () => {},
    ensureSession: async () => 'sid-1',
    enqueueForRetry: (key, text) => calls.retried.push({ key, text }),
    getSocialV2State: () => ({ agentToken: 't', unread: [], recentMessages: [] }),
    buildWakePromptV2: () => 'wake',
    buildWakeSnapshotV2: () => null,
    withSlangContext: (s) => s,
    resolveMediaList: async () => [],
    isCurrentSession: () => true,
    exitingSessions: new Set(),
    apiPrompt: async () => ({ result: { ok: true, value: {} } }),
    shouldAuditKey: () => false,
    sensitiveRe: /secret/,
    sendToQQ: async (key, text) => calls.sent.push(text),
    canonicalV2Key: (k) => k,
    noteModelMessagesV2: () => { calls.noted = true; },
    socialToolsModeAllowed: () => false,
    auditAndSend: async (key, text) => calls.audited.push(text),
    ...over
  };
  return { deps, calls };
}

// 1. 模式不允许
try {
  const { deps } = baseDeps({ isSessionAllowedInCurrentMode: () => false });
  await deliverPromptNow('k', 'hi', {}, deps);
  bad('模式不允许未抛错');
} catch (e) {
  if (/当前模式不允许/.test(e.message)) ok('模式不允许抛错'); else bad('错误信息异常');
}

// 2. 唤醒被暂停 → skipped
{
  const { deps, calls } = baseDeps({ socialWakeAllowed: () => false });
  const r = await deliverPromptNow('k', 'hi', { wakeReason: 'atMention' }, deps);
  if (r.skipped && calls.disarmed && !deps.pendingWakeKeys.has('k')) ok('唤醒被暂停 → 跳过并清理');
  else bad('唤醒跳过异常：' + JSON.stringify(r));
}

// 3. DSH 未就绪 → 离线排队，超过上限丢最旧
{
  const { deps, calls } = baseDeps({ dshReady: false });
  await deliverPromptNow('k', 'a', {}, deps);
  await deliverPromptNow('k', 'b', {}, deps);
  await deliverPromptNow('k', 'c', {}, deps);
  const r = await deliverPromptNow('k', 'd', {}, deps);
  const items = calls.queue.get('k');
  if (r.queued && items.length === 3 && items[items.length - 1].promptText === 'd') ok('离线排队 + 丢最旧');
  else bad('离线队列异常：' + JSON.stringify(r));
}

// 4. 成功投递
{
  const { deps, calls } = baseDeps();
  const r = await deliverPromptNow('k', 'hi', {}, deps);
  if (r.ok && calls.sent.length === 0) ok('成功投递');
  else bad('成功路径异常');
}

// 5. 建会话被重置 → 重试
{
  const { deps, calls } = baseDeps({
    ensureSession: async () => { throw new Error('会话创建期间已重置'); }
  });
  const r = await deliverPromptNow('k', 'hi', {}, deps);
  if (r.retried && calls.retried.length === 1) ok('会话重置 → 重试排队');
  else bad('重试路径异常：' + JSON.stringify(r));
}

// 6. 被拒绝 → 错误脱敏 + 通知
{
  const { deps, calls } = baseDeps({
    shouldAuditKey: () => true,
    apiPrompt: async () => ({ result: { ok: false, error: { code: 'E', message: 'secret' } } })
  });
  const r = await deliverPromptNow('k', 'hi', {}, deps);
  if (!r.ok && r.error === '（含敏感信息，已隐藏）' && calls.sent.length === 1) ok('拒绝 + 脱敏');
  else bad('拒绝路径异常：' + JSON.stringify(r));
}

// 7. 命令文本 → 审核发送
{
  const { deps, calls } = baseDeps({
    apiPrompt: async () => ({ result: { ok: true, value: { command: { text: 'hi' } } } })
  });
  const r = await deliverPromptNow('k', 'x', {}, deps);
  if (r.ok && calls.audited.length === 1) ok('命令文本走 auditAndSend');
  else bad('命令文本路径异常');
}

console.log('\n' + (fail ? `❌ ${fail} 项失败` : `✅ ${pass} 项全部通过`));
process.exit(fail ? 1 : 0);
