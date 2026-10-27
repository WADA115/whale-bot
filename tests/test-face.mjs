// QQ 表情映射单测：常见 id 能翻译、未知 id 有兜底、标签格式正确。
import assert from 'node:assert/strict';

import { faceName, faceLabel, FACE_COUNT } from '../src/qq-face.js';

assert.ok(FACE_COUNT > 100, `表情表应覆盖 100+ 个 id，实际 ${FACE_COUNT}`);
console.log('OK 覆盖数量 →', FACE_COUNT);

const cases = [[14, '微笑'], [13, '呲牙'], [178, '右亲亲'], [147, 'doge'], [182, '白眼'], [48, '鄙视']];
for (const [id, want] of cases) {
  assert.equal(faceName(id), want, `id ${id} 应为 ${want}`);
  assert.equal(faceLabel(id), `[表情:${want}]`);
}
console.log('OK 常见 id 翻译正确');

// 未知 id：用 summary 兜底，再不行用编号
assert.equal(faceLabel(9999, '某个表情'), '[表情:某个表情]');
assert.equal(faceLabel(9999), '[表情#9999]');
assert.equal(faceName('abc'), '');
console.log('OK 未知 id 兜底');

console.log('\n全部通过');
