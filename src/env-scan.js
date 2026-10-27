// 环境扫描：只看、只报，不动任何东西。
//
// 设计约束（按需求）：
//   · 只扫描，不做决策、不自动安装、不改配置
//   · 每项给出：是否满足、要求什么、实际什么、缺了怎么办、官方地址
//   · 版本要能对上：Node 要求 ≥ 20；SnowLuma 若声明 engines.node 就一起比
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

const OFFICIAL = {
  node: 'https://nodejs.org/zh-cn/download',
  git: 'https://git-scm.com/download/win',
  python: 'https://www.python.org/downloads/',
  ffmpeg: 'https://ffmpeg.org/download.html',
  pillow: 'https://pypi.org/project/pillow/',
  sherpa: 'https://github.com/k2-fsa/sherpa-onnx',
  edgeTts: 'https://github.com/rany2/edge-tts',
  deepseek: 'https://platform.deepseek.com/',
  napcat: 'https://github.com/NapNeko/NapCatQQ',
  llonebot: 'https://github.com/LLOneBot/LLOneBot',
  lagrange: 'https://github.com/KonataDev/Lagrange.Core',
  snowluma: 'https://github.com/SnowLuma/SnowLuma',
  upstream: 'https://github.com/Derpyu520/qq-bridge'
};

/** 版本比较：a >= b ？支持 "24.22.1" / "20" / "^24.22.1" / ">=20" */
export function versionAtLeast(a, b) {
  const norm = (v) => String(v ?? '').replace(/^[^\d]*/, '').split(/[.\-+]/).slice(0, 3).map((x) => parseInt(x, 10) || 0);
  const A = norm(a); const B = norm(b);
  for (let i = 0; i < 3; i += 1) {
    if ((A[i] ?? 0) > (B[i] ?? 0)) return true;
    if ((A[i] ?? 0) < (B[i] ?? 0)) return false;
  }
  return true;
}

const run = (cmd, args, timeout = 4000) => new Promise((resolve) => {
  try {
    execFile(cmd, args, { timeout, windowsHide: true }, (err, stdout) => {
      resolve({ ok: !err, out: String(stdout ?? '').trim(), err: err ? String(err.message ?? err) : '' });
    });
  } catch (error) {
    resolve({ ok: false, out: '', err: String(error?.message ?? error) });
  }
});

const probe = async (url, timeout = 1500) => {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeout) });
    return { ok: res.ok || res.status < 500, status: res.status };
  } catch (error) {
    return { ok: false, status: 0, err: String(error?.message ?? error) };
  }
};

const item = (o) => ({
  id: o.id, name: o.name, required: !!o.required, ok: !!o.ok,
  found: o.found ?? '', expected: o.expected ?? '',
  hint: o.hint ?? '', url: o.url ?? '', urlLabel: o.urlLabel ?? '官方下载'
});

/**
 * 扫描环境。
 * @param {{root:string, cfg:object, checks?:object}} opts  root = qq-bridge 目录
 */
export async function scanEnv({ root, cfg = {} }) {
  const items = [];
  const add = (x) => items.push(item(x));

  // 1. Node 版本
  const nodeOk = versionAtLeast(process.version, '20.0.0');
  add({
    id: 'node', name: 'Node.js', required: true, ok: nodeOk,
    found: process.version, expected: '≥ 20',
    hint: nodeOk ? '版本满足' : '版本过低，请装 20 或更新',
    url: OFFICIAL.node
  });

  // 2. 依赖是否安装
  const nm = path.join(root, 'node_modules');
  const nmCount = (() => { try { return fs.readdirSync(nm).length; } catch { return 0; } })();
  add({
    id: 'deps', name: '项目依赖（node_modules）', required: true, ok: nmCount > 0,
    found: nmCount ? nmCount + ' 个包' : '未安装', expected: '已安装',
    hint: nmCount ? '已安装' : '在项目目录执行 npm install',
    url: OFFICIAL.node
  });

  // 3. git（可选）
  const git = await run('git', ['--version']);
  add({
    id: 'git', name: 'Git', required: false, ok: git.ok,
    found: git.ok ? git.out.replace(/^git version\s*/i, '') : '未安装', expected: '可选',
    hint: git.ok ? '可用于开源推送' : '不装也能用；要推开源代码再装',
    url: OFFICIAL.git
  });

  // 4. Python
  const py = await run('python', ['--version']).then(async (r) => (r.ok ? r : run('py', ['--version'])));
  add({
    id: 'python', name: 'Python', required: false, ok: py.ok,
    found: py.ok ? py.out.split('\n')[0] : '未检测到', expected: '3.10+（简笔画 / 语音识别要用）',
    hint: py.ok ? '已安装' : '要用简笔画或本地语音识别才需要',
    url: OFFICIAL.python
  });

  // 5. ffmpeg
  const ffCandidates = [
    path.join(root, 'tools', 'ffmpeg', 'ffmpeg.exe'),
    path.join(root, 'tools', 'ffmpeg', 'ffmpeg')
  ];
  const ffLocal = ffCandidates.find((p) => fs.existsSync(p));
  const ffPath = ffLocal || (await run('ffmpeg', ['-version'])).ok ? (ffLocal || 'PATH') : '';
  add({
    id: 'ffmpeg', name: 'FFmpeg', required: false, ok: !!ffPath,
    found: ffPath || '未找到', expected: 'tools/ffmpeg/ 或系统 PATH',
    hint: ffPath ? '已就绪' : '视频抽帧、音频转码需要',
    url: OFFICIAL.ffmpeg
  });

  // 6. 语音识别（本地端口或模型目录）
  const asrPort = await probe('http://127.0.0.1:3199/', 1200);
  add({
    id: 'asr', name: '语音识别服务', required: false, ok: asrPort.ok,
    found: asrPort.ok ? '3199 在线' : '未运行', expected: '3199 在线',
    hint: asrPort.ok ? '已就绪' : '不用语音可以忽略；启动时面板会拉起',
    url: OFFICIAL.sherpa
  });

  // 7. SnowLuma 目录与版本
  const snowDir = String(cfg.snowluma?.homeDir ?? '');
  const snowPkgPath = path.join(snowDir, 'package.json');
  let snowVersion = '';
  let snowEngines = '';
  try {
    const pkg = JSON.parse(fs.readFileSync(snowPkgPath, 'utf8'));
    snowVersion = pkg.version ?? '';
    snowEngines = pkg.engines?.node ?? '';
  } catch {}
  const snowDirOk = !!snowDir && fs.existsSync(snowDir);
  add({
    id: 'snowluma', name: 'SnowLuma（QQ 网关）', required: true, ok: snowDirOk,
    found: snowDirOk ? (snowVersion ? 'v' + snowVersion : '已安装') : (snowDir || '未配置'),
    expected: snowEngines ? 'engines.node ' + snowEngines : '已安装',
    hint: snowDirOk ? (snowEngines && !versionAtLeast(process.version, snowEngines) ? '注意：当前 Node 低于它声明的版本' : '目录存在') : '在设置里填 SnowLuma 目录',
    url: OFFICIAL.snowluma, urlLabel: '项目地址'
  });

  // 8. 网关端口
  const gw = await probe('http://127.0.0.1:3000/', 1500);
  add({
    id: 'gateway', name: 'QQ 网关端口（3000）', required: true, ok: gw.ok,
    found: gw.ok ? '在线' : '未开放', expected: '在线（登录 QQ 后自动开放）',
    hint: gw.ok ? '已连接' : '进程在跑但没登录 QQ 时，这个端口不会开',
    url: OFFICIAL.snowluma, urlLabel: '项目地址'
  });

  // 9. DSH 可达性
  const dshBase = String(cfg.dsh?.baseUrl ?? '');
  const dsh = dshBase ? await probe(dshBase, 1500) : { ok: false, status: 0 };
  add({
    id: 'dsh', name: 'DSH（模型接入）', required: true, ok: dsh.ok,
    found: dsh.ok ? dshBase : (dshBase ? '连不上 ' + dshBase : '未配置'),
    expected: '可访问',
    hint: dsh.ok ? '已连通' : '面板设置里能看到探测到的地址；这里是只读检查',
    url: OFFICIAL.deepseek, urlLabel: 'DeepSeek 官网'
  });

  // 10. 插件
  const pluginDir = path.join(root, 'plugins');
  let pluginCount = 0;
  try {
    for (const e of fs.readdirSync(pluginDir, { withFileTypes: true })) {
      if (e.isDirectory() && fs.existsSync(path.join(pluginDir, e.name, 'manifest.json'))) pluginCount += 1;
    }
  } catch {}
  add({
    id: 'plugins', name: '插件目录', required: false, ok: pluginCount > 0,
    found: pluginCount + ' 个', expected: '至少 1 个',
    hint: pluginCount ? '已加载' : 'plugins/ 下没有可用插件',
    url: OFFICIAL.upstream, urlLabel: '上游项目'
  });

  // 11. 人格卡目录
  const rolesDir = path.join(root, 'roles');
  let roleCount = 0;
  try { roleCount = fs.readdirSync(rolesDir).filter((f) => f.endsWith('.md')).length; } catch {}
  add({
    id: 'roles', name: '人格卡', required: false, ok: roleCount > 0,
    found: roleCount + ' 张', expected: '至少 1 张',
    hint: roleCount ? '已就绪' : 'roles/ 下没有 .md',
    url: '', urlLabel: ''
  });

  const requiredFails = items.filter((x) => x.required && !x.ok).length;
  const optionalFails = items.filter((x) => !x.required && !x.ok).length;

  return {
    ok: requiredFails === 0,
    summary: { total: items.length, requiredFails, optionalFails },
    items,
    scannedAt: Date.now()
  };
}

export { OFFICIAL };
