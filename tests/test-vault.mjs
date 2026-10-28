// 记忆隐藏区：增删、关键词命中、随机回想、落盘
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMemoryCore } from '../src/memory-core.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-test-'));
const core = createMemoryCore({ file: path.join(dir, 'memory.json'), log: () => {} });

let pass = 0; let fail = 0;
const ok = (m) => { console.log('  ✅ ' + m); pass += 1; };
const bad = (m) => { console.log('  ❌ ' + m); fail += 1; };

// 1. 新增与列出
core.addVault('他小时候养过一只叫团子的猫', { keywords: ['团子', '猫'] });
core.addVault('他讨厌香菜', { keywords: ['香菜'] });
if (core.stats().vault === 2) ok('新增 2 条');
else bad('新增条数不对：' + core.stats().vault);

// 2. 去重
core.addVault('他讨厌香菜', { keywords: ['香菜'] });
if (core.stats().vault === 2) ok('重复内容不重复入库');
else bad('重复内容被重复加入了');

// 3. 关键词命中
const hit = core.matchVault('我家团子最近不爱吃饭');
if (hit.length === 1 && hit[0].text.includes('团子')) ok('命中关键词「团子」');
else bad('关键词命中失败：' + JSON.stringify(hit.map((x) => x.text)));

const miss = core.matchVault('今天天气不错');
if (miss.length === 0) ok('无关内容不命中');
else bad('无关内容误命中');

// 4. 命中次数累加
const hit2 = core.matchVault('团子呢');
if (hit2.length && hit2[0].hits >= 2) ok('命中次数累加');
else bad('命中次数没累加');

// 5. 随机回想
core.addFact('他以前住在杭州', { tier: 'long' });
const pick = core.pickRecall();
if (pick && pick.text) ok('随机回想能取出内容：' + pick.text.slice(0, 12));
else bad('随机回想取不到内容');

const excluded = core.pickRecall({ exclude: [pick.id] });
if (!excluded || excluded.id !== pick.id) ok('exclude 生效，不会重复同一条');
else bad('exclude 没生效');

// 6. 删除
const target = core.listVault()[0];
if (core.removeVault(target.id)) ok('删除成功');
else bad('删除失败');
if (core.stats().vault === 1) ok('删除后剩 1 条');
else bad('删除后条数不对');

// 7. 落盘
core.flush();
const raw = JSON.parse(fs.readFileSync(path.join(dir, 'memory.json'), 'utf8'));
if (Array.isArray(raw.vault) && raw.vault.length === 1) ok('写入文件且结构正确');
else bad('文件里的 vault 不对');

// 8. 重新加载后仍在
const core2 = createMemoryCore({ file: path.join(dir, 'memory.json'), log: () => {} });
if (core2.stats().vault === 1) ok('重新载入后隐藏区还在');
else bad('重新载入后隐藏区丢了');

fs.rmSync(dir, { recursive: true, force: true });
console.log('\n' + (fail ? `❌ ${fail} 项失败` : `✅ ${pass} 项全部通过`));
process.exit(fail ? 1 : 0);
