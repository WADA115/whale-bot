// 目录结构检查：文档里写的结构必须和实际代码一致。
import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2] || 'E:/deepseek_qq.bot/qq-bridge';
let fails = 0;
const pass = (m) => console.log('  ✅ ' + m);
const fail = (m) => { console.log('  ❌ ' + m); fails += 1; };

const must = [
  'README.md', 'README.en.md', 'LICENSE', 'CHANGELOG.md', 'FAQ.md', 'CONTRIBUTING.md', 'SECURITY.md',
  'package.json', 'config.example.json', 'app.js', '启动.bat',
  'docs/使用手册.md', 'docs/配置说明.md', 'docs/FOLDER_MAP.md', 'docs/REFACTOR.md',
  'scripts/ops/start-all.ps1', 'scripts/ops/start-asr.bat', 'scripts/ops/watchdog.ps1', 'scripts/ops/守护.bat',
  'src/prompt/assemble.js', 'src/prompt/context.js', 'src/prompt/wake.js', 'src/prompt/wake-render.js',
  'src/message/parse.js', 'src/send/pipeline.js', 'src/plugins/runtime.js', 'src/dsh/queue.js', 'src/dsh/deliver.js'
];
for (const f of must) {
  if (fs.existsSync(path.join(root, f))) pass(f + ' 存在');
  else fail(f + ' 缺失');
}

const forbidden = ['使用手册.md', '配置说明.md', '免责声明.md', '致谢.md', 'start-all.ps1', 'start-asr.bat', 'watchdog.ps1', '守护.bat', '迁移.ps1'];
for (const f of forbidden) {
  if (!fs.existsSync(path.join(root, f))) pass('根目录不再有 ' + f);
  else fail('根目录还有旧文件 ' + f);
}

// 文档里的目录地图必须提到新的拆分模块与 scripts/ops
const map = fs.readFileSync(path.join(root, 'docs/FOLDER_MAP.md'), 'utf8');
for (const token of ['scripts/ops', 'src/prompt', 'src/message', 'src/send', 'src/plugins', 'src/dsh']) {
  if (map.includes(token)) pass('FOLDER_MAP 提到 ' + token);
  else fail('FOLDER_MAP 缺少 ' + token);
}

// 目录里不应出现误放的备份/临时文件
const srcFiles = fs.readdirSync(path.join(root, 'src'), { recursive: true, withFileTypes: true })
  .filter((e) => e.isFile())
  .map((e) => path.join(e.parentPath ?? e.path, e.name));
const junk = srcFiles.filter((f) => /\.(bak|tmp|orig)$|\.bak-/.test(f));
if (junk.length === 0) pass('src/ 无备份/临时文件');
else fail('src/ 有残留：' + junk.join(', '));

console.log('\n' + (fails ? `❌ ${fails} 处结构不一致` : '✅ 文档结构一致'));
process.exit(fails ? 1 : 0);
