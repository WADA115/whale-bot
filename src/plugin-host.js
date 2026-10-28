// 插件宿主（父进程侧）：起一个子进程跑插件，用 JSON 行做 RPC。
//
// 对外接口：
//   createPluginHost({ name, dir, main, log, timeoutMs }) → Promise<host>
//   host.ready  { hooks }
//   host.has(hook) → boolean
//   host.call(hook, ctx) → Promise<result>
//   host.kill()
//
// 超时或崩溃都会杀掉子进程；下一次调用直接返回 null，不让主流程卡住。
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKER = path.join(HERE, 'plugin-worker.mjs');

function serialize(value) {
  try {
    return JSON.stringify(value, (k, v) => (typeof v === 'function' ? undefined : v));
  } catch {
    return null;
  }
}

export function createPluginHost({ name, dir, main, log = () => {}, timeoutMs = 3000, readyTimeoutMs = 6000 } = {}) {
  const entry = path.join(dir, main);
  const child = spawn(process.execPath, ['--no-warnings', WORKER, entry], {
    cwd: dir,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let alive = true;
  let nextId = 1;
  const pending = new Map();
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  ready.catch(() => {});

  const hooks = new Set();

  const cleanup = (reason) => {
    alive = false;
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(new Error(reason));
    }
    pending.clear();
  };

  const readyTimer = setTimeout(() => {
    rejectReady(new Error('插件启动超时'));
    try { child.kill(); } catch {}
  }, readyTimeoutMs);

  let buf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.ready !== undefined) {
        clearTimeout(readyTimer);
        if (msg.ready) {
          for (const h of msg.hooks ?? []) hooks.add(h);
          resolveReady({ hooks: [...hooks] });
        } else {
          rejectReady(new Error(String(msg.error ?? '插件加载失败')));
        }
        continue;
      }
      const slot = pending.get(msg.id);
      if (!slot) continue;
      pending.delete(msg.id);
      clearTimeout(slot.timer);
      if (msg.ok) slot.resolve(msg.result ?? null);
      else slot.reject(new Error(String(msg.error ?? '插件调用失败')));
    }
  });

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    const text = String(chunk).trim();
    if (text) log(`[plugin:${name}] ${text.slice(0, 300)}`);
  });

  child.on('exit', (code) => {
    clearTimeout(readyTimer);
    cleanup('插件进程已退出');
    if (code !== 0) log(`[plugin:${name}] 子进程退出（code=${code}），后续钩子跳过`);
    try { rejectReady(new Error('插件进程提前退出')); } catch {}
  });

  child.on('error', (error) => {
    cleanup('插件进程启动失败');
    try { rejectReady(error); } catch {}
  });

  return {
    name,
    ready,
    has: (hook) => hooks.has(hook),
    get hooks() { return [...hooks]; },
    call(hook, ctx) {
      if (!alive) return Promise.reject(new Error('插件进程不可用'));
      if (!hooks.has(hook)) return Promise.resolve(null);
      const id = nextId++;
      const payload = serialize({ id, hook, ctx });
      if (!payload) return Promise.reject(new Error('参数无法序列化'));
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          log(`[plugin:${name}] ${hook} 超时（>${timeoutMs}ms），已终止子进程`);
          try { child.kill(); } catch {}
          reject(new Error('钩子超时'));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        try { child.stdin.write(payload + '\n'); }
        catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
      });
    },
    kill() {
      alive = false;
      try { child.kill(); } catch {}
    }
  };
}
