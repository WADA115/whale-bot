// 生成/校验依赖报告：只读 package-lock，不联网。
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const rootPkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const packages = lock.packages ?? {};
const direct = rootPkg.dependencies ?? {};
const lines = [];
lines.push('# 依赖清单（自动生成）', '');
lines.push(`lockfileVersion: ${lock.lockfileVersion}`, `总包数: ${Object.keys(packages).length - 1}`, '');
lines.push('| 包 | 声明 | 锁定 | License |', '| --- | --- | --- | --- |');
for (const [name, range] of Object.entries(direct)) {
  const meta = packages[`node_modules/${name}`] ?? {};
  lines.push(`| \`${name}\` | ${range} | ${meta.version ?? '?'} | ${meta.license ?? '?'} |`);
}
const report = lines.join('\n') + '\n';
if (process.argv.includes('--check')) {
  const target = path.join(root, 'docs', 'DEPENDENCIES.md');
  const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  if (current.replace(/\r\n/g, '\n') !== report.replace(/\r\n/g, '\n')) { console.error('❌ docs/DEPENDENCIES.md 与 package-lock 不一致'); process.exit(1); }
  console.log('✅ 依赖报告一致');
} else {
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'DEPENDENCIES.md'), report, 'utf8');
  console.log('✅ 已写入 docs/DEPENDENCIES.md');
}
