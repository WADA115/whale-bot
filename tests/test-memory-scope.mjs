// 记忆隔离测试（不依赖服务）：
//   · 开发者记忆 → state/memory.json
//   · 普通用户记忆 → state/profiles/<用户名>/memory.json
//   · A 的 store 读不到 B 的，也读不到全局记忆
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMemoryStore } from '../src/memory-core.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE = path.join(ROOT, 'state');
fs.mkdirSync(path.join(STATE, 'profiles'), { recursive: true });

let pass = 0; let fail = 0;
const ok = (m) => { console.log('  ✅ ' + m); pass += 1; };
const bad = (m) => { console.log('  ❌ ' + m); fail += 1; };

const store = createMemoryStore({ stateDir: STATE, log: () => {} });

// 1. 路径分流
const devPath = store.pathFor('developer');
const aPath = store.pathFor({ user: 'memA' });
const bPath = store.pathFor({ user: 'memB' });

if (devPath === path.join(STATE, 'memory.json')) ok('开发者记忆 → state/memory.json');
else bad('开发者路径不对：' + devPath);

if (aPath === path.join(STATE, 'profiles', 'memA', 'memory.json')) ok('普通用户记忆 → state/profiles/<用户名>/memory.json');
else bad('普通用户路径不对：' + aPath);

if (aPath !== bPath) ok('不同用户路径不同');
else bad('两个用户共用了同一个文件');

// 2. 写入后各自独立
const storeA = store.for({ user: 'memA' });
const storeB = store.for({ user: 'memB' });
const storeDev = store.for('developer');

storeA.addFact('普通用户A的记忆：他养了一只叫团子的猫', { tier: 'long' });
storeB.addFact('普通用户B的秘密：他其实怕猫', { tier: 'long' });

// 保存是防抖的（800ms），测试里主动落盘
storeA.flush();
storeB.flush();

const aText = JSON.stringify(storeA.list());
const bText = JSON.stringify(storeB.list());
const devText = JSON.stringify(storeDev.list());

if (aText.includes('团子')) ok('A 能读到自己的记忆');
else bad('A 读不到自己的记忆');

if (aText.includes('怕猫')) bad('A 读到了 B 的记忆！');
else ok('A 读不到 B 的记忆');

if (bText.includes('团子')) bad('B 读到了 A 的记忆！');
else ok('B 读不到 A 的记忆');

if (devText.includes('团子') || devText.includes('怕猫')) bad('开发者记忆里混进了普通用户内容！');
else ok('开发者记忆与普通用户隔离');

// 3. 文件确实分开
if (fs.existsSync(aPath) && fs.existsSync(bPath) && aPath !== bPath) ok('两个用户的文件各自存在');
else bad('用户记忆文件缺失');

// 4. 清理测试数据
for (const dir of ['memA', 'memB']) {
  fs.rmSync(path.join(STATE, 'profiles', dir), { recursive: true, force: true });
}
ok('已清理测试用户记忆');

console.log('\n' + (fail ? `❌ ${fail} 项失败` : `✅ ${pass} 项全部通过`));
process.exit(fail ? 1 : 0);
