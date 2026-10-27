import { fileURLToPath } from 'node:url';

import { ensureState } from './_setup.mjs';

ensureState();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 学习插件测试：抽词、分类、隔离（不碰记忆/设定）、限额
import fs from 'node:fs';
import path from 'node:path';
import { extractTerms, learn, summary } from '../plugins/learning/index.mjs';

const STATE = path.join(ROOT, 'state');
const LEARN = path.join(STATE, 'learning.json');
const MEM = path.join(STATE, 'memory.json');

const before = {
  learn: fs.existsSync(LEARN) ? fs.readFileSync(LEARN, 'utf8') : '',
  mem: fs.readFileSync(MEM, 'utf8')
};

let pass = 0; let fail = 0;
const ok = (m) => { console.log('  ✅ ' + m); pass += 1; };
const bad = (m) => { console.log('  ❌ ' + m); fail += 1; };

// 1. 抽词 + 分类
const t1 = extractTerms('这游戏我上号了，yyds！');
const cats1 = t1.map((x) => x.cat).join(',');
if (t1.some((x) => x.term === '上号' && x.cat === '游戏')) ok('游戏词「上号」'); else bad('没识别出游戏词：' + JSON.stringify(t1));
if (t1.some((x) => x.term === 'yyds')) ok('网络用语「yyds」'); else bad('没识别出 yyds');

const t2 = extractTerms('笑死，这个梗太抽象了');
if (t2.some((x) => x.cat === '梗' || x.cat === '网络用语')) ok('梗词识别'); else bad('没识别出梗：' + JSON.stringify(t2));

// 2. 写入 & 统计
learn(t1, '这游戏我上号了，yyds！');
learn(t1, '又上号了');
const s1 = summary();
if (s1.total > 0) ok('入库条数 ' + s1.total + '（分类：' + JSON.stringify(s1.cats) + '）');
else bad('没入库');

const item = s1.items.find((x) => x.term === '上号');
if (item && item.count >= 2) ok('重复出现计数累加（上号 ×' + item.count + '）');
else bad('计数没累加');

// 3. 共现（发散关联）
if (s1.edges.length > 0) ok('共现关联 ' + s1.edges.length + ' 对');
else bad('没有共现关联');

// 4. 隔离：记忆和设定不许被动
const memAfter = fs.readFileSync(MEM, 'utf8');
if (memAfter === before.mem) ok('记忆库 state/memory.json 未被改动');
else bad('记忆库被改了！');

const profilesDir = path.join(STATE, 'profiles');
let profileTouched = false;
if (fs.existsSync(profilesDir)) {
  for (const d of fs.readdirSync(profilesDir)) {
    const f = path.join(profilesDir, d, 'memory.json');
    if (fs.existsSync(f) && fs.readFileSync(f, 'utf8').includes('上号')) profileTouched = true;
  }
}
if (!profileTouched) ok('普通用户记忆文件未被写入'); else bad('写进了普通用户记忆！');

// 5. 只写 state/learning.json
const learnAfter = JSON.parse(fs.readFileSync(LEARN, 'utf8'));
if (Array.isArray(learnAfter.items) && learnAfter.items.length === s1.total) ok('学习数据只在 state/learning.json');
else bad('学习数据结构异常');

// 6. 还原现场（测试前没有文件就删掉）
if (!before.learn) {
  fs.unlinkSync(LEARN);
  console.log('  （已清理测试产生的 learning.json）');
} else {
  fs.writeFileSync(LEARN, before.learn, 'utf8');
}

console.log('\n' + (fail ? `❌ ${fail} 项失败` : `✅ ${pass} 项全部通过`));
process.exit(fail ? 1 : 0);
