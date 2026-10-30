// 群聊消息窗口：同一群的消息先合并，再由第一个调用者统一处理。
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createGroupBatcher({ log = () => {}, ttlMs = 60000 } = {}) {
  const batches = new Map();

  function begin(key, item) {
    const existing = batches.get(key);
    if (existing) {
      existing.items.push(item);
      log(`[group] ${key} 并入批次（${existing.items.length} 条）`);
      return { owner: false, batch: existing };
    }
    const batch = { key, items: [item], startedAt: Date.now(), timer: null };
    batch.timer = setTimeout(() => {
      if (batches.get(key) === batch) batches.delete(key);
    }, ttlMs);
    batch.timer.unref?.();
    batches.set(key, batch);
    return { owner: true, batch };
  }

  async function wait(batch, windowMs) {
    if (!batch?.timer) return null;
    await sleep(Math.max(300, Math.min(6000, Number(windowMs) || 800)));
    if (batches.get(batch.key) !== batch) return null;
    clearTimeout(batch.timer);
    batches.delete(batch.key);
    return batch;
  }

  function abandon(batch) {
    if (!batch) return;
    if (batches.get(batch.key) === batch) batches.delete(batch.key);
    clearTimeout(batch.timer);
  }

  function get(key) { return batches.get(key) ?? null; }
  function size() { return batches.size; }

  return { begin, wait, abandon, get, size };
}
