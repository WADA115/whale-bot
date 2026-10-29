// DSH 单条 prompt 投递：模式/唤醒检查、离线排队、建会话、内容组装、退场标记、发送。
// 从 bridge.js 抽出；所有状态与回调由调用方通过 deps 注入。

import { buildDeliveryContent, deliveryErrorText, appendWakeSnapshot } from './deliver.js';
import { mdToPlain } from '../md-to-plain.js';

export async function deliverPromptNow(key, promptText, opts = {}, deps = {}) {
  const {
    isSessionAllowedInCurrentMode,
    socialWakeAllowed,
    socialV2,
    cfg,
    pendingWakeKeys,
    disarmPendingWakeLease,
    dshReady,
    queued,
    queueMax = 500,
    log = () => {},
    ensureSession,
    enqueueForRetry,
    getSocialV2State,
    buildWakePromptV2,
    buildWakeSnapshotV2,
    withSlangContext,
    resolveMediaList,
    isCurrentSession,
    exitingSessions,
    apiPrompt,
    shouldAuditKey,
    sensitiveRe,
    sendToQQ,
    canonicalV2Key,
    noteModelMessagesV2,
    socialToolsModeAllowed,
    auditAndSend
  } = deps;

  if (!isSessionAllowedInCurrentMode(key)) throw new Error(`当前模式不允许会话 ${key}`);
  const wakeBlocked = () => opts.wakeReason && (!socialWakeAllowed() || socialV2.paused || cfg.socialV2?.enabled === false);
  const skipWake = () => {
    pendingWakeKeys.delete(key);
    disarmPendingWakeLease(key);
    return { ok: true, skipped: true };
  };
  if (wakeBlocked()) return skipWake();
  if (!dshReady) {
    const items = queued.get(key) ?? [];
    if (items.length >= queueMax) {
      items.shift();
      log(`队列满（${queueMax}），丢弃最旧消息 (${key})`);
    }
    items.push({ promptText, farewell: !!opts.farewell, silent: !!opts.silent, media: opts.media ?? [], wakeReason: opts.wakeReason });
    queued.set(key, items);
    return { ok: true, queued: true };
  }
  let sessionId;
  try {
    sessionId = await ensureSession(key);
  } catch (error) {
    if (String(error?.message ?? error).includes('会话创建期间已重置')) {
      enqueueForRetry(key, promptText, opts);
      return { ok: true, retried: true };
    }
    throw error;
  }
  let wakeState;
  let wakeToken;
  let wakeSnapshot;
  if (opts.wakeReason) {
    if (wakeBlocked()) return skipWake();
    wakeState = getSocialV2State(key);
    wakeToken = wakeState.agentToken;
    promptText = buildWakePromptV2(key, opts.wakeReason);
    wakeSnapshot = buildWakeSnapshotV2(key);
    promptText = appendWakeSnapshot(promptText, wakeSnapshot);
  }
  const content = await buildDeliveryContent({
    promptText,
    media: opts.media,
    withSlangContext,
    resolveMediaList
  });
  if (!isCurrentSession(key, sessionId)) throw new Error('投递前会话已重置或权限已变化');
  if (opts.farewell) exitingSessions.add(sessionId);
  let accepted;
  try {
    accepted = await apiPrompt({ sessionId, mode: 'queue', content });
  } catch (error) {
    if (opts.farewell) exitingSessions.delete(sessionId);
    throw error;
  }
  if (!accepted.result.ok) {
    if (opts.farewell) exitingSessions.delete(sessionId);
    const errText = `${accepted.result.error.code}: ${accepted.result.error.message}`;
    const safeErrText = deliveryErrorText({
      code: accepted.result.error.code,
      message: accepted.result.error.message,
      shouldRedact: shouldAuditKey(key) && sensitiveRe.test(errText)
    });
    if (!opts.silent) await sendToQQ(key, `⚠️ 消息未被接受：${safeErrText}`);
    return { ok: false, error: safeErrText };
  }
  if (wakeSnapshot && isCurrentSession(key, sessionId)
      && socialV2.conversations.get(canonicalV2Key(key)) === wakeState
      && wakeState.agentToken === wakeToken) {
    noteModelMessagesV2(wakeState, [...wakeSnapshot.messages, ...wakeSnapshot.recent]);
  }
  if (accepted.result.value.command?.text && !opts.silent && !socialToolsModeAllowed()) {
    if (opts.farewell) exitingSessions.delete(sessionId);
    await auditAndSend(key, mdToPlain(accepted.result.value.command.text));
  } else if (accepted.result.value.command?.text && opts.silent && opts.farewell) {
    exitingSessions.delete(sessionId);
  }
  return { ok: true };
}
