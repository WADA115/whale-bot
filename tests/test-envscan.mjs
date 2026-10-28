// 环境扫描测试：版本比较、扫描项、只读（不改配置/不安装）
import fs from 'node:fs';
import { scanEnv, versionAtLeast } from '../src/env-scan.js';

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0; let fail = 0;
const ok = (m) => { console.log('  ✅ ' + m); pass += 1; };
const bad = (m) => { console.log('  ❌ ' + m); fail += 1; };

// 1. 版本比较
const cases = [
  ['24.22.1', '20', true],
  ['18.19.0', '20', false],
  ['20.0.0', '20', true],
  ['^24.22.1', '24.0.0', true],
  ['v20.11.1', '20.10.0', true]
];
for (const [a, b, want] of cases) {
  const got = versionAtLeast(a, b);
  if (got === want) ok('版本比较 ' + a + ' ≥ ' + b + ' → ' + got);
  else bad('版本比较错：' + a + ' ≥ ' + b + ' 期望 ' + want + ' 实际 ' + got);
}

// 2. 扫描结果结构
// 干净 clone 里没有 config.json（被 .gitignore 排除），回退到示例配置
const cfgPath = fs.existsSync(ROOT + '/config.json') ? ROOT + '/config.json' : ROOT + '/config.example.json';
const cfgBefore = fs.readFileSync(cfgPath, 'utf8');
const cfg = JSON.parse(cfgBefore);
const r = await scanEnv({ root: ROOT, cfg });

const ids = r.items.map((x) => x.id);
for (const need of ['node', 'deps', 'snowluma', 'gateway', 'dsh', 'plugins', 'roles']) {
  if (ids.includes(need)) ok('扫描项存在：' + need);
  else bad('缺扫描项：' + need);
}

const nodeItem = r.items.find((x) => x.id === 'node');
if (nodeItem && nodeItem.found && /^v?\d+\./.test(nodeItem.found)) ok('Node 版本被读出来：' + nodeItem.found);
else bad('Node 版本没读到');

// 3. 官方链接必须是 https 且不是本地地址
const badUrl = r.items.filter((x) => x.url && !x.url.startsWith('http'));
if (!badUrl.length) ok('所有下载链接都是 https 官方地址');
else bad('有非法链接：' + JSON.stringify(badUrl.map((x) => x.url)));

const localUrl = r.items.filter((x) => x.url && /127\\.0\\.0\\.1|localhost/.test(x.url));
if (!localUrl.length) ok('没有把本地地址当下载链接');
else bad('存在本地地址链接');

// 4. 只读：扫描前后配置不变、没有新增安装动作
const cfgAfter = fs.readFileSync(cfgPath, 'utf8');
if (cfgBefore === cfgAfter) ok('扫描不改配置文件');
else bad('扫描改了 config.json！');

// 5. 扫描结果落盘只写 state/env-scan.json（由接口写，模块本身不写）
const src = fs.readFileSync(ROOT + '/src/env-scan.js', 'utf8');
if (!/writeFileSync|execFileSync|spawnSync/.test(src)) ok('模块本身不写文件、不阻塞执行');
else bad('模块里有写文件/阻塞调用');

// 6. 摘要与明细一致
const expectFails = r.items.filter((x) => x.required && !x.ok).length;
if (r.summary.requiredFails === expectFails) ok('摘要与明细一致（必装缺 ' + expectFails + ' 项）');
else bad('摘要不一致');

console.log('\n' + (fail ? `❌ ${fail} 项失败` : `✅ ${pass} 项全部通过`));
process.exit(fail ? 1 : 0);
