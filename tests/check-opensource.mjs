// 开源可用性检测（两种模式）
//
//   node tests/check-opensource.mjs <安装目录> <临时输出目录>   ← 本地：先打包再检查
//   node tests/check-opensource.mjs . "$RUNNER_TEMP/oss-check"  ← CI：直接查仓库，不打包
//
// 判断依据：安装目录下是否存在 qq-bridge 子目录。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [installDir, outDir] = process.argv.slice(2);
if (!installDir) {
  console.error('用法: node tests/check-opensource.mjs <安装目录|.> [临时输出目录]');
  process.exit(2);
}

const bridge = path.join(installDir, 'qq-bridge');
const packagingMode = fs.existsSync(bridge);
const root = packagingMode ? bridge : path.resolve(installDir);

const problems = [];
const fail = (msg) => problems.push(msg);

// ── 1. 打包（仅安装目录模式）────────────────────────────────────────────
let scanDir = root;
if (packagingMode) {
  if (!outDir) { console.error('安装目录模式需要输出目录'); process.exit(2); }
  const cfgPath = path.join(bridge, 'config.json');
  if (!fs.existsSync(cfgPath)) { console.error('缺少 config.json，无法打包'); process.exit(2); }
  if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true, force: true });
  execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(bridge, '开源打包.ps1'), '-Out', outDir], { stdio: 'ignore' });
  scanDir = outDir;
}

// ── 2. 收集文件 ─────────────────────────────────────────────────────────
const SKIP_DIRS = new Set(['node_modules', '.git', 'state', 'tools', 'audio', 'release', 'dist']);
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory() && SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else files.push(full);
  }
})(scanDir);

const rel = (f) => path.relative(scanDir, f);
const isText = (f) => /\.(js|mjs|json|md|html|ps1|bat|vbs|py|txt|yml|yaml|css)$/i.test(f);

// ── 3. 敏感串 ───────────────────────────────────────────────────────────
const secretPatterns = [
  ['GitHub token', /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/],
  ['OpenAI/DeepSeek key', /\bsk-[A-Za-z0-9]{16,}/],
  ['私钥', /-----BEGIN (RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/],
  ['本机绝对路径', /[A-Za-z]:\\Users\\(?!(<|x\\|someone\\|user\\|用户名|你的|你))[^\\\s]+\\/],
  ['旧安装路径', /新建文件夹\s*\(\d+\)/]
];

for (const f of files.filter(isText)) {
  const text = fs.readFileSync(f, 'utf8');
  for (const [label, re] of secretPatterns) {
    if (re.test(text)) fail(`${label} 出现在 ${rel(f)}`);
  }
}

// 本机开发者密钥（仅安装目录模式能读到）
if (packagingMode) {
  const devKeyPath = path.join(bridge, 'state', 'dev-key.txt');
  if (fs.existsSync(devKeyPath)) {
    const key = fs.readFileSync(devKeyPath, 'utf8').trim();
    if (key.length >= 8) {
      for (const f of files.filter(isText)) {
        if (fs.readFileSync(f, 'utf8').includes(key)) fail(`开发者密钥出现在 ${rel(f)}`);
      }
    }
  }
}

// ── 4. 必备文件 ─────────────────────────────────────────────────────────
for (const name of ['LICENSE', 'README.md', 'package.json', 'config.example.json', '.gitignore']) {
  if (!fs.existsSync(path.join(scanDir, name))) fail(`缺少 ${name}`);
}

// ── 5. 不该出现的文件 ───────────────────────────────────────────────────
for (const f of files) {
  const name = path.basename(f);
  if (name === 'config.json') fail(`config.json 不该出现在包里：${rel(f)}`);
  if (/\.log$/.test(name)) fail(`日志不该出现在包里：${rel(f)}`);
  if (/^dev-key/.test(name)) fail(`dev-key 不该出现在包里：${rel(f)}`);
  if (/报告/.test(name) && /\.(md|docx|html)$/.test(name)) fail(`个人报告不该出现在包里：${rel(f)}`);
}

// ── 6. 体积 ─────────────────────────────────────────────────────────────
const size = files.reduce((s, f) => s + fs.statSync(f).size, 0);
const mb = size / 1024 / 1024;
if (mb > 30) fail(`体积偏大：${mb.toFixed(1)} MB`);

// ── 7. 结果 ─────────────────────────────────────────────────────────────
console.log(`检查目录：${scanDir}`);
console.log(`文件 ${files.length} 个，共 ${mb.toFixed(1)} MB`);

if (problems.length) {
  console.error('\n❌ 发现 ' + problems.length + ' 个问题：');
  for (const p of problems.slice(0, 20)) console.error('  - ' + p);
  if (problems.length > 20) console.error(`  … 还有 ${problems.length - 20} 条`);
  process.exit(1);
}

console.log('\n✅ 开源检查通过');
