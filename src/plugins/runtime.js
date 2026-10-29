// 插件运行时：扫描 plugins/、验证、子进程加载、依次调用钩子。
// 从 bridge.js 抽出；路径与日志由调用方传入。

import fs from 'node:fs';
import path from 'node:path';
import { BUILTIN_PLUGINS } from '../plugin-verify.js';
import { createPluginHost } from '../plugin-host.js';

/**
 * 加载 plugins/ 下所有启用且通过验证的插件。
 * @returns {Promise<Array<{name:string, manifest:object, host:object}>>}
 */
export async function loadPlugins({ dir, stateDir, log = () => {} } = {}) {
  const loaded = [];
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return loaded; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const base = path.join(dir, entry.name);
    const manifest = (() => { try { return JSON.parse(fs.readFileSync(path.join(base, 'manifest.json'), 'utf8')); } catch { return null; } })();
    if (!manifest || manifest.enabled === false) continue;

    if (!BUILTIN_PLUGINS.includes(entry.name)) {
      let verified = null;
      try {
        const all = JSON.parse(fs.readFileSync(path.join(stateDir, 'plugins-verified.json'), 'utf8'));
        verified = all[entry.name];
      } catch {}
      if (!verified || !verified.ok) {
        log(`[plugin] 跳过未验证插件：${entry.name}（先在面板里验证）`);
        continue;
      }
    }

    const entryFile = path.join(base, manifest.main ?? 'index.mjs');
    if (!fs.existsSync(entryFile)) continue;
    try {
      const host = createPluginHost({ name: entry.name, dir: base, main: manifest.main ?? 'index.mjs', log });
      const info = await host.ready;
      loaded.push({ name: entry.name, manifest, host });
      log(`[plugin] 已加载 ${entry.name} v${manifest.version ?? '?'}（${(info.hooks ?? []).join('/') || '无钩子'}，子进程隔离）`);
    } catch (error) {
      log(`[plugin] ${entry.name} 加载失败：${error?.message ?? error}`);
    }
  }
  return loaded;
}

/** 依次调用插件的某个钩子；返回最后一个非空结果（用于 onReply 改写）。 */
export async function runPluginHook(plugins, hookName, ctx, log = () => {}) {
  let last = null;
  for (const p of plugins) {
    if (!p.host?.has?.(hookName)) continue;
    try {
      const result = await p.host.call(hookName, ctx);
      if (result) last = result;
    } catch (error) {
      log(`[plugin:${p.name}] ${hookName} 出错（忽略）：${error?.message ?? error}`);
    }
  }
  return last;
}
