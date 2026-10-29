// 验证面板里那段极简 markdown 渲染器：拿真实使用手册跑一遍，检查结构是否正常。
//
// 路径：默认用仓库根（本文件上一级），也可用 QQB_BRIDGE_DIR 或命令行参数覆盖。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function pickBridgeDir() {
  const candidates = [process.env.QQB_BRIDGE_DIR, ROOT].filter(Boolean);
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'public', 'panel.html'))) return dir;
  }
  return ROOT;
}

const bridgeDir = process.argv[2] ? path.dirname(path.dirname(process.argv[2])) : pickBridgeDir();
const panelPath = process.argv[2] || path.join(bridgeDir, 'public', 'panel.html');
const mdPath = process.argv[3] || path.join(bridgeDir, 'docs', '使用手册.md');
const html = fs.readFileSync(panelPath, 'utf8');
const md = fs.readFileSync(mdPath, 'utf8');

const start = html.indexOf('function mdToHtml');
const end = html.indexOf('async function loadHelp');
if (start < 0 || end < 0) { console.error('找不到渲染函数'); process.exit(1); }
const code = html.slice(start, end);

const fn = new Function('md', `${code}; return mdToHtml(md);`);
const out = fn(md);

const count = (re) => (out.match(re) ?? []).length;
console.log('渲染输出:', out.length, '字符');
console.log('  h1:', count(/<h1>/g), '| h2:', count(/<h2>/g), '| h3:', count(/<h3>/g));
console.log('  表格:', count(/<table>/g), '| 代码块:', count(/<pre><code>/g), '| 列表项:', count(/<li>/g));
console.log('  残留未解析的代码围栏:', out.includes('```'));
console.log('  残留未解析的表格竖线行:', /^\s*\|/m.test(out));
console.log('  首 100 字:', out.slice(0, 100).replace(/\n/g, ' '));

if (count(/<h2>/g) < 5) { console.error('标题数量异常'); process.exit(1); }
if (count(/<table>/g) < 2) { console.error('表格数量异常'); process.exit(1); }
console.log('渲染器 OK');
