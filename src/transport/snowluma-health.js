// SnowLuma 上游健康：事件包、自报 good、静默检测、边沿告警、兜底轮询。
export function createSnowlumaHealth({ getCfg, log = () => {}, pollMs = 60000, silenceWarnMs = 600000 } = {}) {
  const state = {
    lastPacketAt: 0, lastPacketKind: '', accountOnline: null,
    good: null, goodSource: '', goodError: '', goodCheckedAt: 0,
    degraded: false, reason: '', connected: false
  };
  let watchStarted = false;

  function noteUpstreamPacket(kind) {
    state.lastPacketAt = Date.now();
    state.lastPacketKind = String(kind ?? '');
  }

  function noteReceiveHealth(good, source) {
    if (typeof good !== 'boolean') return;
    state.good = good;
    state.goodSource = source;
    state.goodError = '';
    state.goodCheckedAt = Date.now();
  }

  function snapshot() {
    const now = Date.now();
    const agoMs = state.lastPacketAt ? now - state.lastPacketAt : null;
    const silent = state.lastPacketAt > 0 && agoMs > silenceWarnMs;
    const confirmed = state.good === false;
    let hint = null;
    if (confirmed) {
      hint = 'SnowLuma 自报接收链路异常（good=false）：它的 [Hook] 收不到 QQ 客户端的数据，消息进不来。这不是桥接的问题。请查看 SnowLuma 的 logs/snowluma-*.log 里的 [Hook] 行。';
    } else if (silent) {
      hint = `已连接但 ${Math.round(agoMs / 60000)} 分钟没有收到任何事件包；请查看 SnowLuma 的 logs/snowluma-*.log。`;
    }
    return {
      connected: state.connected,
      accountOnline: state.accountOnline,
      good: state.good,
      goodSource: state.goodSource || null,
      goodError: state.goodError || null,
      lastPacketAgoMs: agoMs,
      lastPacketKind: state.lastPacketKind || null,
      silent,
      degraded: confirmed || silent,
      hint
    };
  }

  function report() {
    const snap = snapshot();
    if (snap.degraded && !state.degraded) {
      state.degraded = true;
      state.reason = snap.hint ?? '';
      log(`⚠️ SnowLuma 上游不健康：${snap.hint}`);
    } else if (!snap.degraded && state.degraded) {
      state.degraded = false;
      state.reason = '';
      log('✅ SnowLuma 上游已恢复正常');
    }
  }

  async function poll() {
    const cfg = getCfg();
    const httpUrl = String(cfg.snowluma?.httpUrl || 'http://127.0.0.1:3000').replace(/\/+$/, '');
    try {
      const res = await fetch(`${httpUrl}/get_status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(cfg.snowluma?.accessToken ? { authorization: `Bearer ${cfg.snowluma.accessToken}` } : {}) },
        body: '{}',
        signal: AbortSignal.timeout(8000)
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.status !== 'ok') {
        state.goodError = `HTTP ${res.status}${body?.wording ? ` ${body.wording}` : ''}`;
      } else {
        noteReceiveHealth(body.data?.good, 'get_status');
        if (typeof body.data?.online === 'boolean') state.accountOnline = body.data.online;
      }
    } catch (error) {
      state.goodError = error?.message ?? String(error);
    }
    state.goodCheckedAt = Date.now();
    report();
  }

  function start() {
    if (watchStarted) return;
    watchStarted = true;
    setTimeout(() => { void poll(); }, 5000);
    setInterval(() => { void poll(); }, pollMs);
    setInterval(report, 30000);
  }

  return { state, noteUpstreamPacket, noteReceiveHealth, snapshot, report, poll, start };
}
