// 插件运行时单测：只测调度与跳过逻辑，不拉起子进程
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadPlugins, runPluginHook } from '../src/plugins/runtime.js';

let pass = 0; let fail = 0;
const ok = (m) => { console.log('  ✅ ' + m); pass += 1; };
const bad = (m) => { console.log('  ❌ ' + m); fail += 1; };

// 1. 依次调用，返回最后一个非空
const calls = [];
const plugins = [
  { name: 'a', host: { has: (h) => h === 'onInbound', call: async () => { calls.push('a'); return { text: 'a' }; } } },
  { name: 'b', host: { has: (h) => h === 'onInbound', call: async () => { calls.push('b'); throw new Error('boom'); } } },
  { name: 'c', host: { has: (h) => h === 'onInbound', call: async () => { calls.push('c'); return { text: 'c' }; } } }
];
const out = await runPluginHook(plugins, 'onInbound', { key: 'x' }, () => {});
if (out?.text === 'c' && calls.join(',') === 'a,b,c') ok('按顺序调用并返回最后一个结果');
else bad('调度异常：' + JSON.stringify({ out, calls }));

// 2. 插件抛错被吞掉，不影响后续
if (out?.text === 'c') ok('单个插件异常不影响后续');
else bad('异常未被吞掉');

// 3. 没实现钩子的插件跳过
const skip = await runPluginHook([{ name: 'd', host: { has: () => false, call: async () => ({ text: 'd' }) } }], 'onReply', {}, () => {});
if (skip === null) ok('未实现钩子跳过');
else bad('跳过逻辑异常');

// 4. 空插件目录
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plug-'));
const list = await loadPlugins({ dir, stateDir: dir, log: () => {} });
if (Array.isArray(list) && list.length === 0) ok('空目录返回空列表');
else bad('空目录异常');

// 5. 未验证的非内置插件被跳过
const badDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plug2-'));
fs.mkdirSync(path.join(badDir, 'myplug'));
fs.writeFileSync(path.join(badDir, 'myplug', 'manifest.json'), JSON.stringify({ enabled: true }));
fs.writeFileSync(path.join(badDir, 'myplug', 'index.mjs'), 'export async function onInbound() {}');
let logMsg = '';
const skipped = await loadPlugins({ dir: badDir, stateDir: badDir, log: (m) => { logMsg = m; } });
if (skipped.length === 0 && logMsg.includes('跳过未验证插件')) ok('未验证插件被跳过');
else bad('未验证插件未被跳过：' + JSON.stringify({ n: skipped.length, logMsg }));

fs.rmSync(dir, { recursive: true, force: true });
fs.rmSync(badDir, { recursive: true, force: true });

console.log('\n' + (fail ? `❌ ${fail} 项失败` : `✅ ${pass} 项全部通过`));
process.exit(fail ? 1 : 0);
