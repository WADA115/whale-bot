// 面板结构检查：重复 ID / 关键容器 / 新旧入口。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const file = path.join(root, 'public', 'panel.html');
const html = fs.readFileSync(file, 'utf8');

const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
const dups = [...new Set(ids.filter((x, i) => ids.indexOf(x) !== i))];
const required = ['plugin-list', 'view-dialogue', 'nav-dialogue', 'ds-cards', 'ds-predictor', 'ds-recent', 'frame-hint'];
const missing = required.filter((id) => !ids.includes(id));

const checks = [
  ['无重复 ID', dups.length === 0, dups.join(',')],
  ['关键容器存在', missing.length === 0, missing.join(',')],
  ['对话页 API 已接', html.includes('/api/dialogue')],
  ['插件列表容器已补', html.includes('id="plugin-list"')],
  ['主题样式已加载', html.includes('2026 新壳')]
];

let fail = 0;
for (const [name, ok, detail] of checks) {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail && !ok ? '：' + detail : ''}`);
  if (!ok) fail += 1;
}
console.log(fail ? `❌ ${fail} 项未通过` : `✅ ${checks.length} 项面板结构检查通过`);
process.exit(fail ? 1 : 0);
