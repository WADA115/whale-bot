// DSH prompt 串行队列：同一 QQ 会话按提交顺序投递，切换模式时可整体取消。
// 从 bridge.js 抽出；实际投递函数由调用方注入。

export function createPromptQueue({ deliver } = {}) {
  const queues = new Map(); // key -> { queue: [], running: false }

  function state(key) {
    const e = queues.get(key);
    return { running: !!e?.running, queued: e?.queue.length ?? 0 };
  }

  async function run(key) {
    const entry = queues.get(key);
    if (!entry || entry.running) return;
    const item = entry.queue.shift();
    if (!item) {
      if (entry.queue.length === 0) queues.delete(key);
      return;
    }
    entry.running = true;
    try {
      item.resolve(await deliver(key, item.promptText, item.opts));
    } catch (error) {
      item.reject(error);
    } finally {
      entry.running = false;
      if (queues.get(key) === entry) {
        if (entry.queue.length) void run(key);
        else queues.delete(key);
      }
    }
  }

  function enqueue(key, promptText, opts = {}) {
    return new Promise((resolve, reject) => {
      let entry = queues.get(key);
      if (!entry) {
        entry = { queue: [], running: false };
        queues.set(key, entry);
      }
      entry.queue.push({ promptText, opts, resolve, reject });
      void run(key);
    });
  }

  function drain(key, errorMsg) {
    const entry = queues.get(key);
    if (!entry) return;
    for (const item of entry.queue) item.reject(new Error(errorMsg));
    entry.queue = [];
    queues.delete(key);
  }

  function drainAll(errorMsg) {
    for (const [, entry] of queues) {
      for (const item of entry.queue) item.reject(new Error(errorMsg));
    }
    queues.clear();
  }

  return { enqueue, drain, drainAll, state, size: () => queues.size };
}
