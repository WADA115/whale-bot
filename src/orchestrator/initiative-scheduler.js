// 主动发言调度器：只决定“可以问一次”，不拼 prompt、不发送。
// 真正的决策/表达/标准/出口仍在 Orchestrator + Gateway。
export function createInitiativeScheduler({
  listChats = () => [],
  idleMsFor = () => Infinity,
  run = async () => false,
  intervalMs = 5 * 60 * 1000,
  idleMs = 30 * 60 * 1000,
  maxPerHour = 2,
  log = () => {},
  now = () => Date.now()
} = {}) {
  const sentAt = [];
  let timer = null;
  let running = false;

  function capacity() {
    if (!maxPerHour || maxPerHour <= 0) return true;
    const cutoff = now() - 60 * 60 * 1000;
    while (sentAt.length && sentAt[0] < cutoff) sentAt.shift();
    return sentAt.length < maxPerHour;
  }

  async function tick() {
    if (running) return { ok: false, reason: 'busy' };
    running = true;
    const fired = [];
    try {
      for (const chat of listChats()) {
        if (!capacity()) break;
        const idle = Number(idleMsFor(chat));
        if (!Number.isFinite(idle) || idle < idleMs) continue;
        try {
          const result = await run(chat, '空闲主动开话题');
          if (result === true || result?.ok === true) {
            sentAt.push(now());
            fired.push(chat);
            log(`[initiative] 主动发言 ${chat}`);
          }
        } catch (error) {
          log(`[initiative] ${chat} 失败（忽略）：${error?.message ?? error}`);
        }
      }
      return { ok: true, fired };
    } finally {
      running = false;
    }
  }

  function start() {
    if (timer) return;
    const ms = Math.max(30000, Number(intervalMs) || 300000);
    timer = setInterval(() => { void tick(); }, ms);
    if (typeof timer.unref === 'function') timer.unref();
    log(`[initiative] 已启动：每 ${Math.round(ms / 1000)}s 检查，空闲 ${Math.round(idleMs / 60000)} 分钟，最多 ${maxPerHour || '∞'}/小时`);
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { start, stop, tick, stats: () => ({ running, sentLastHour: sentAt.length }) };
}
