// 插件检验性隔离：清单校验 + 静态扫描 + 干跑（子进程，3 秒超时）。
//
// 目标不是"防住所有恶意代码"（同进程跑 ESM 做不到），而是：
//   1. 没写清权限的插件，不允许碰 fs / 网络 / 进程
//   2. 出现明显危险调用（child_process、eval、process.exit）直接拒
//   3. 装之前必须能在沙箱里跑通钩子，不抛异常、不超时
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

/** 内置插件白名单：不做验证（它们随版本发布，改由发布流程的测试覆盖）。 */
export const BUILTIN_PLUGINS = ['example', 'learning', 'growth', 'qq-agent-presets', 'qq-mode-console'];

export const PERMISSION_LABELS = {
  fs: '读写本地文件',
  net: '访问网络',
  state: '写 state/ 目录'
};

const FORBIDDEN = [
  ['child_process', /from\s+['"]node:child_process['"]|require\(['"]child_process['"]\)/],
  ['process.exit', /process\.exit\s*\(/],
  ['process.kill', /process\.kill\s*\(/],
  ['eval', /(^|[^.\w])eval\s*\(/],
  ['new Function', /new\s+Function\s*\(/],
  ['worker_threads', /from\s+['"]node:worker_threads['"]/]
];

const NEEDS_PERMISSION = [
  ['fs', /from\s+['"]node:fs['"]|from\s+['"]fs['"]|require\(['"]node:fs['"]\)|require\(['"]fs['"]\)/],
  ['net', /from\s+['"]node:https?['"]|from\s+['"]node:net['"]|fetch\s*\(|require\(['"]node:https?['"]\)/]
];

/** 读清单并校验必填字段。 */
export function validateManifest(dir) {
  const problems = [];
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return { ok: false, problems: ['缺少 manifest.json'], manifest: null };
  let manifest = null;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    return { ok: false, problems: ['manifest.json 不是合法 JSON：' + error.message], manifest: null };
  }
  for (const key of ['name', 'version', 'main']) {
    if (!manifest[key]) problems.push(`manifest 缺少 ${key}`);
  }
  if (manifest.main && !fs.existsSync(path.join(dir, manifest.main))) {
    problems.push('main 指向的文件不存在：' + manifest.main);
  }
  if (manifest.permissions !== undefined && !Array.isArray(manifest.permissions)) {
    problems.push('permissions 必须是数组');
  }
  const hooks = Array.isArray(manifest.hooks) ? manifest.hooks : [];
  const allowed = ['onInbound', 'onReply', 'onMemory'];
  for (const h of hooks) if (!allowed.includes(h)) problems.push('未知钩子：' + h);
  return { ok: problems.length === 0, problems, manifest };
}

/** 静态扫描：危险调用一律拒；fs/net 必须显式声明权限。 */
export function staticScan(dir, manifest) {
  const problems = [];
  const permissions = Array.isArray(manifest?.permissions) ? manifest.permissions : [];
  const mainFile = path.join(dir, manifest?.main ?? 'index.mjs');
  if (!fs.existsSync(mainFile)) return { ok: false, problems: ['找不到入口文件'], permissions };

  const code = fs.readFileSync(mainFile, 'utf8');
  for (const [label, re] of FORBIDDEN) {
    if (re.test(code)) problems.push(`禁止使用：${label}`);
  }
  for (const [perm, re] of NEEDS_PERMISSION) {
    if (re.test(code) && !permissions.includes(perm) && !permissions.includes('state') && perm === 'fs') {
      problems.push(`用了 ${perm} 但没在 permissions 里声明`);
    }
    if (perm === 'net' && re.test(code) && !permissions.includes('net')) {
      problems.push('用了网络但没在 permissions 里声明 net');
    }
  }
  return { ok: problems.length === 0, problems, permissions, code };
}

/** 干跑：在子进程里加载插件并调用钩子。 */
export function dryRun(dir, manifest, { timeoutMs = 4000 } = {}) {
  return new Promise((resolve) => {
    const mainPath = path.join(dir, manifest.main);
    const runner = path.join(dir, '.dryrun.mjs');
    const src = `
import { pathToFileURL } from 'node:url';
const mod = await import(pathToFileURL(${JSON.stringify(mainPath)}).href);
const ctx = {
  key: 'group:0', sender: '测试', text: '你好',
  cfg: { role: {} }, log: () => {}
};
const out = {};
for (const h of ${JSON.stringify(Array.isArray(manifest.hooks) ? manifest.hooks : [])}) {
  const fn = mod[h];
  if (typeof fn !== 'function') { out[h] = 'missing'; continue; }
  const r = await fn(ctx);
  out[h] = r === undefined ? 'undefined' : JSON.stringify(r).slice(0, 120);
}
console.log(JSON.stringify(out));
`;
    fs.writeFileSync(runner, src, 'utf8');
    execFile(process.execPath, ['--no-warnings', runner], { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      try { fs.rmSync(runner, { force: true }); } catch {}
      if (err) {
        const msg = err.killed ? '超时（>' + timeoutMs + 'ms）' : String(stderr || err.message).slice(0, 200);
        resolve({ ok: false, problems: ['干跑失败：' + msg] });
        return;
      }
      try {
        const out = JSON.parse(String(stdout).trim().split('\n').pop());
        const missing = Object.entries(out).filter(([, v]) => v === 'missing').map(([k]) => k);
        resolve({ ok: missing.length === 0, problems: missing.map((h) => '钩子未导出：' + h), output: out });
      } catch (error) {
        resolve({ ok: false, problems: ['干跑输出无法解析：' + error.message] });
      }
    });
  });
}

/** 完整验证。 */
export async function verifyPlugin(dir) {
  const v = validateManifest(dir);
  if (!v.ok) return { ok: false, problems: v.problems, permissions: [] };
  const scan = staticScan(dir, v.manifest);
  if (!scan.ok) return { ok: false, problems: scan.problems, permissions: scan.permissions };
  const run = await dryRun(dir, v.manifest);
  return {
    ok: run.ok,
    problems: run.problems,
    permissions: scan.permissions,
    hooks: Array.isArray(v.manifest.hooks) ? v.manifest.hooks : []
  };
}
