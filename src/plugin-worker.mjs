// 插件子进程：加载一个插件，按 JSON 行接收钩子调用，把结果写回 stdout。
//
// 为什么放到子进程：
//   插件是用户自己丢进 plugins/ 的代码，原来和桥接同进程跑 —— 一个死循环、
//   一次 process.exit、一个未捕获异常，就能把整个机器人带走。子进程里跑，
//   最坏情况是它自己死掉，桥接记录日志并跳过它。
//
// 协议（stdin/stdout 每行一个 JSON）：
//   父 → 子  { id, hook, ctx }
//   子 → 父  { id, ok: true, result }  |  { id, ok: false, error }
//   启动时   { ready: true, hooks: [...] }  |  { ready: false, error }
import { pathToFileURL } from 'node:url';

const entry = process.argv[2];
let mod = null;
const hooks = [];

function send(obj) {
  try { process.stdout.write(JSON.stringify(obj) + '\n'); } catch {}
}

try {
  mod = await import(pathToFileURL(entry).href);
  for (const key of ['onInbound', 'onReply', 'onMemory']) {
    if (typeof mod[key] === 'function') hooks.push(key);
  }
  send({ ready: true, hooks });
} catch (error) {
  send({ ready: false, error: String(error?.stack || error?.message || error).slice(0, 500) });
  process.exit(0);
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    handle(msg);
  }
});

async function handle(msg) {
  const { id, hook, ctx } = msg ?? {};
  const fn = mod?.[hook];
  if (typeof fn !== 'function') {
    send({ id, ok: false, error: '钩子不存在：' + hook });
    return;
  }
  try {
    const result = await fn(ctx ?? {});
    send({ id, ok: true, result: result === undefined ? null : result });
  } catch (error) {
    send({ id, ok: false, error: String(error?.message || error).slice(0, 300) });
  }
}
