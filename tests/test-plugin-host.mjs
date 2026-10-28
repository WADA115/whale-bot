// 插件子进程隔离：正常调用 / 抛错 / 超时
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPluginHost } from '../src/plugin-host.js';

let pass = 0; let fail = 0;
const ok = (m) => { console.log('  ✅ ' + m); pass += 1; };
const bad = (m) => { console.log('  ❌ ' + m); fail += 1; };

const make = (name, code, manifest = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-' + name + '-'));
  fs.writeFileSync(path.join(dir, 'index.mjs'), code, 'utf8');
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ name, version: '1.0.0', main: 'index.mjs', hooks: ['onInbound', 'onReply'], ...manifest }), 'utf8');
  return dir;
};

// 1. 正常返回
const dir1 = make('good', `export function onInbound(ctx) { return { skip: true, seen: ctx.text }; }\nexport function onReply(ctx) { return { text: '改写:' + ctx.text }; }\n`);
const h1 = createPluginHost({ name: 'good', dir: dir1, main: 'index.mjs', timeoutMs: 2000 });
const info1 = await h1.ready;
if (info1.hooks.includes('onInbound') && info1.hooks.includes('onReply')) ok('能识别钩子：' + info1.hooks.join(','));
else bad('钩子识别失败：' + JSON.stringify(info1));

const r1 = await h1.call('onReply', { text: '你好' });
if (r1 && r1.text === '改写:你好') ok('onReply 返回值正确');
else bad('onReply 返回异常：' + JSON.stringify(r1));

const r2 = await h1.call('onInbound', { text: '在吗' });
if (r2 && r2.skip === true && r2.seen === '在吗') ok('ctx 能传进子进程');
else bad('ctx 传递失败：' + JSON.stringify(r2));
h1.kill();

// 2. 抛异常不拖垮宿主
const dir2 = make('boom', `export function onInbound() { throw new Error('插件炸了'); }\n`);
const h2 = createPluginHost({ name: 'boom', dir: dir2, main: 'index.mjs', timeoutMs: 2000 });
await h2.ready;
try {
  await h2.call('onInbound', {});
  bad('异常没有抛出');
} catch (error) {
  if (String(error.message).includes('插件炸了')) ok('异常被隔离并回报');
  else bad('异常信息不对：' + error.message);
}
h2.kill();

// 3. 超时会杀掉子进程
const dir3 = make('slow', `export function onInbound() { return new Promise((r) => setTimeout(() => r({ ok: 1 }), 5000)); }\n`);
const h3 = createPluginHost({ name: 'slow', dir: dir3, main: 'index.mjs', timeoutMs: 500 });
await h3.ready;
const t0 = Date.now();
try {
  await h3.call('onInbound', {});
  bad('超时没有抛出');
} catch (error) {
  const cost = Date.now() - t0;
  if (cost < 2000 && String(error.message).includes('超时')) ok('超时被截断（' + cost + 'ms）');
  else bad('超时处理不对：' + cost + 'ms / ' + error.message);
}
h3.kill();

// 4. 加载失败：ready 会 reject
const dir4 = make('broken', 'export function onInbound( {\n');
const h4 = createPluginHost({ name: 'broken', dir: dir4, main: 'index.mjs', timeoutMs: 1000 });
try {
  await h4.ready;
  bad('坏插件竟然启动成功');
} catch (error) {
  ok('坏插件启动失败并报错：' + String(error.message).slice(0, 40));
}
h4.kill();

for (const d of [dir1, dir2, dir3, dir4]) {
  try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
}

console.log('\n' + (fail ? `❌ ${fail} 项失败` : `✅ ${pass} 项全部通过`));
process.exit(fail ? 1 : 0);
