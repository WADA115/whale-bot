// 示例插件：演示三个钩子怎么写。
//
// 这个插件默认只做"观察"——数一数收到多少条消息、回改写过多少次，
// 把统计写进 state/plugin-example.json，不改动任何行为，适合当模板抄。
//
// 想真改行为，看 index.mjs 里 return { text: ... } 和 return { skip: true } 两处注释。
import fs from 'node:fs';
import path from 'node:path';

const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const statFile = path.join(repo, 'state', 'plugin-example.json');

function bump(field) {
  let stat = { inbound: 0, rewritten: 0, lastAt: 0 };
  try { stat = JSON.parse(fs.readFileSync(statFile, 'utf8')); } catch {}
  stat[field] = (stat[field] ?? 0) + 1;
  stat.lastAt = Date.now();
  try { fs.writeFileSync(statFile, JSON.stringify(stat, null, 2), 'utf8'); } catch {}
  return stat;
}

/** 收到消息时调用；返回 { skip: true } 可以吃掉这条消息。 */
export async function onInbound(ctx) {
  bump('inbound');
  ctx.log?.('收到', ctx.sender || '?', String(ctx.text ?? '').slice(0, 20));
  // 想拦下某类消息，可以打开下面这行：
  // if (/广告/.test(ctx.text ?? '')) return { skip: true };
  return null;
}

/** 回复生成后调用；返回 { text: '...' } 可以整段替换。 */
export async function onReply(ctx) {
  // 例子：把太长的话截短（这里故意不启用，只示范写法）
  // if ((ctx.text ?? '').length > 400) return { text: ctx.text.slice(0, 400) + '…' };
  return null;
}

/** 记忆写完时调用（观察用）。 */
export async function onMemory(ctx) {
  ctx.log?.('记得了:', String(ctx.memory ?? '').slice(0, 30));
  return null;
}
