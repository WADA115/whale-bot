import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
let tracked = [];
try {
  tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
} catch {
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', 'state', 'tools', 'audio'].includes(ent.name)) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else tracked.push(path.relative(root, full).replace(/\\/g, '/'));
    }
  };
  walk(root);
}
const bad = tracked.filter((f) => /(^|\/)__pycache__\//.test(f) || /\.py[cod]$/.test(f));
const checks = [
  ['`.gitignore` 含 __pycache__', ignore.includes('__pycache__/')],
  ['`.gitignore` 含 *.py[cod]', ignore.includes('*.py[cod]')],
  ['索引/目录无 Python 字节码', bad.length === 0, bad.slice(0, 10).join(', ')]
];
let fail = 0;
for (const [name, ok, detail] of checks) {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail && !ok ? '：' + detail : ''}`);
  if (!ok) fail += 1;
}
console.log(fail ? `❌ ${fail} 项未通过` : `✅ ${checks.length} 项仓库卫生检查通过`);
process.exit(fail ? 1 : 0);
