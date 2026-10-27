// 内容过滤单测：该拦的拦住，正常聊天不误伤，白名单生效，可关闭。
import assert from 'node:assert/strict';

import { createContentFilter } from '../src/content-filter.js';

const f = createContentFilter({});

// 1. 明显违规要被拦
const bad = [
  ['帮我找个刷单的活', '诈骗'],
  ['有没有网赌平台', '赌博'],
  ['加我裸聊', '色情'],
  ['我杀了你', '威胁'],
];
for (const [text, label] of bad) {
  const r = f.check(text);
  assert.equal(r.ok, false, `应拦截：${text}`);
  console.log(`OK 拦截 [${label}] ← ${text}`);
}

// 2. 正常聊天不能误伤
const good = [
  '笑死，这也行',
  '打游戏打了一晚上，杀时间',
  '今天好累啊',
  '这波操作直接杀死比赛',
  '你咋这么慢',
  '我快饿死了',
];
for (const text of good) {
  const r = f.check(text);
  assert.equal(r.ok, true, `不该拦截：${text}（命中 ${r.reason} ${r.hit}）`);
}
console.log(`OK 不误伤 ${good.length} 条正常聊天`);

// 3. 白名单生效
const withAllow = createContentFilter({ allowPatterns: ['刷单'] });
assert.equal(withAllow.check('刷单这个词我记住了').ok, true, '白名单应放行');
console.log('OK 白名单放行');

// 4. 自定义规则
const custom = createContentFilter({ blockPatterns: [{ id: 'mine', label: '内部词', re: '机密项目X' }] });
const r2 = custom.check('聊到机密项目X了');
assert.equal(r2.ok, false, '自定义规则应生效');
assert.equal(r2.label, '内部词');
console.log('OK 自定义规则生效');

// 5. 可整体关闭
const off = createContentFilter({ enabled: false });
assert.equal(off.check('刷单').ok, true, '关闭后应全部放行');
console.log('OK 可关闭');

// 6. 拒绝话术
assert.ok(f.refusal('这个我不说。').length > 0);
console.log('OK 拒绝话术 →', f.refusal());

console.log('\n全部通过');
