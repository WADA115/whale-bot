// 插件检验：清单/静态扫描/干跑，以及内置白名单
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verifyPlugin, validateManifest, staticScan, BUILTIN_PLUGINS } from '../src/plugin-verify.js';

let pass = 0; let fail = 0;
const ok = (m) => { console.log('  ✅ ' + m); pass += 1; };
const bad = (m) => { console.log('  ❌ ' + m); fail += 1; };

const make = (name, files) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plug-' + name + '-'));
  for (const [f, content] of Object.entries(files)) {
    const p = path.join(dir, f);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content, 'utf8');
  }
  return dir;
};

// 1. 内置白名单
if (BUILTIN_PLUGINS.includes('learning')) ok('内置插件在白名单里');
else bad('白名单缺 learning');

// 2. 合法插件：通过
const good = make('good', {
  'manifest.json': JSON.stringify({ name: 'good', version: '1.0.0', main: 'index.mjs', hooks: ['onInbound'], permissions: [] }),
  'index.mjs': 'export function onInbound(ctx) { return null; }\n'
});
const rGood = await verifyPlugin(good);
if (rGood.ok) ok('合法插件通过验证');
else bad('合法插件被拒：' + JSON.stringify(rGood.problems));

// 3. 缺清单
const noManifest = make('nomani', { 'index.mjs': 'export function onInbound(){}\n' });
const rNo = await verifyPlugin(noManifest);
if (!rNo.ok && rNo.problems.some((p) => p.includes('manifest'))) ok('缺 manifest 被拒');
else bad('缺 manifest 没被拒：' + JSON.stringify(rNo));

// 4. 危险调用：child_process
const evil = make('evil', {
  'manifest.json': JSON.stringify({ name: 'evil', version: '1.0.0', main: 'index.mjs', hooks: ['onInbound'], permissions: [] }),
  'index.mjs': "import { execSync } from 'node:child_process';\nexport function onInbound(){ execSync('calc'); }\n"
});
const rEvil = await verifyPlugin(evil);
if (!rEvil.ok && rEvil.problems.some((p) => p.includes('child_process'))) ok('child_process 被拒');
else bad('child_process 没被拒：' + JSON.stringify(rEvil));

// 5. 用了 fs 但没声明权限
const sneaky = make('sneaky', {
  'manifest.json': JSON.stringify({ name: 'sneaky', version: '1.0.0', main: 'index.mjs', hooks: ['onInbound'], permissions: [] }),
  'index.mjs': "import fs from 'node:fs';\nexport function onInbound(){ return fs.existsSync('C:/'); }\n"
});
const rSneaky = await verifyPlugin(sneaky);
if (!rSneaky.ok && rSneaky.problems.some((p) => p.includes('fs'))) ok('未声明 fs 权限被拒');
else bad('未声明 fs 没被拒：' + JSON.stringify(rSneaky));

// 6. 声明了 fs 权限：放行
const allowed = make('allowed', {
  'manifest.json': JSON.stringify({ name: 'allowed', version: '1.0.0', main: 'index.mjs', hooks: ['onInbound'], permissions: ['fs'] }),
  'index.mjs': "import fs from 'node:fs';\nexport function onInbound(){ return fs.existsSync('C:/'); }\n"
});
const rAllowed = await verifyPlugin(allowed);
if (rAllowed.ok) ok('声明 fs 权限后放行');
else bad('声明了还被拒：' + JSON.stringify(rAllowed.problems));

// 7. 钩子没导出：干跑报错
const missingHook = make('missing', {
  'manifest.json': JSON.stringify({ name: 'missing', version: '1.0.0', main: 'index.mjs', hooks: ['onInbound'], permissions: [] }),
  'index.mjs': 'export const nothing = 1;\n'
});
const rMissing = await verifyPlugin(missingHook);
if (!rMissing.ok && rMissing.problems.some((p) => p.includes('未导出'))) ok('钩子未导出被拒');
else bad('钩子缺失没被拒：' + JSON.stringify(rMissing));

// 8. 语法错误：干跑失败
const broken = make('broken', {
  'manifest.json': JSON.stringify({ name: 'broken', version: '1.0.0', main: 'index.mjs', hooks: ['onInbound'], permissions: [] }),
  'index.mjs': 'export function onInbound( { \n'
});
const rBroken = await verifyPlugin(broken);
if (!rBroken.ok) ok('语法错误被拒');
else bad('语法错误没被拒');

// 9. 校验函数独立可用
const vm = validateManifest(good);
if (vm.ok && vm.manifest.name === 'good') ok('validateManifest 单独可用');
else bad('validateManifest 异常');
const scan = staticScan(good, vm.manifest);
if (scan.ok) ok('staticScan 单独可用');
else bad('staticScan 异常');

for (const d of [good, noManifest, evil, sneaky, allowed, missingHook, broken]) {
  try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
}

console.log('\n' + (fail ? `❌ ${fail} 项失败` : `✅ ${pass} 项全部通过`));
process.exit(fail ? 1 : 0);
