import { scanEnv } from './src/env-scan.js';

// 小鲸鱼控制台：本地网页面板，统一管三个服务（SnowLuma / 桥接 / 语音识别）+ 守护。
//
// 为什么单独起一个进程而不是塞进桥接：
//   桥接挂了面板还能用 —— 面板的第一职责就是"把桥接拉起来"，它不能跟着桥接一起死。
//
// 端口 3200；只有本机访问（绑定 127.0.0.1）。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const STATE = path.join(ROOT, 'state');
const PORT = Number(process.env.QQB_PANEL_PORT || 3200);
// SnowLuma 目录：只从 config.snowluma.homeDir 读；没配置就留空，由启动逻辑提示用户去填
// （不写死任何本机路径：开源版本里每个人装的位置都不一样）
const CONFIG_SNAPSHOT = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8')); } catch { return {}; } })();
const SNOWLUMA_DIR = CONFIG_SNAPSHOT.snowluma?.homeDir || '';
const startAllScript = path.join(ROOT, 'start-all.ps1');
const SNOWLUMA_EXE = `${SNOWLUMA_DIR}\\node.exe`;
const SNOWLUMA_UI_PORT = 5099;   // SnowLuma 自带 WebUI
const SNOWLUMA_PROXY_PORT = 5098; // 面板的代理端口（剥掉防嵌套头）

// 内置守护：面板本身是常驻进程，顺手当监管者 —— 比外部脚本更不容易被会话回收。
let lastRestartAt = 0;
let restarts = 0;
let lastSuperviseAt = Date.now();

const SERVICES = {
  snowluma: { name: 'SnowLuma', port: 3000, desc: 'QQ 网关' },
  bridge: { name: '桥接', port: 3100, desc: '消息收发与 AI' },
  asr: { name: '语音识别', port: 3199, desc: '本地 ASR' }
};

// 三个日志各占一个文件，统一放 state/logs/（隔离，不再混在 state 根目录）
const LOG_DIR = path.join(STATE, 'logs');
try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch {}
const PANEL_LOG = path.join(LOG_DIR, 'panel.log');

/** 日志路径：state/logs/<name> 优先；旧位置 state/<name> 兜底（迁移期兼容）。 */
function logPath(name) {
  const next = path.join(LOG_DIR, name);
  if (fs.existsSync(next)) return next;
  const legacy = path.join(STATE, name);
  if (fs.existsSync(legacy)) return legacy;
  return next;
}

function log(...args) {
  const body = args.join(' ');
  const masked = body.replace(/\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g, (m, a, b, c, d) => `${a}.***.***.${d}`);
  const line = `[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${masked}`;
  console.log(line);
  try {
    fs.appendFileSync(PANEL_LOG, line + '\n', 'utf8');
    const st = fs.statSync(PANEL_LOG);
    if (st.size > 512 * 1024) fs.writeFileSync(PANEL_LOG, '', 'utf8'); // 512KB 截断
  } catch {}
}


// ── 账户与访问控制 ─────────────────────────────────────────────────────────
// 设计取舍：
//   · 只有本机能访问（绑 127.0.0.1 + 来源 IP 白名单），想放开得改环境变量；
//   · 密码用 scrypt + 随机盐存哈希，不存明文；
//   · 会话是内存里的随机 token（httpOnly cookie），进程重启就要重新登录——够用且简单；
//   · 登录失败按 IP 限速，防脚本撞库；
//   · 日志里的 IP 一律脱敏（保留网段，隐去主机位）。
const AUTH_FILE = path.join(STATE, 'panel-auth.json');
// ── 开发者密钥（硬编码）─────────────────────────────────────────────────
// 想换成自己的：直接改这一行，或者设环境变量 QQB_DEV_KEY 覆盖。
// 迁移时它会跟着代码一起走，所以换电脑不用重新记。
// 开发者密钥不写死在代码里：环境变量 > state/dev-key.txt > 首次运行自动生成
const DEV_KEY_FILE = path.join(STATE, 'dev-key.txt');
function resolveDevKey() {
  const fromEnv = String(process.env.QQB_DEV_KEY ?? '').trim();
  if (fromEnv) return { key: fromEnv, from: 'env' };
  try {
    const saved = String(fs.readFileSync(DEV_KEY_FILE, 'utf8')).trim();
    if (saved) return { key: saved, from: 'file' };
  } catch {}
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const key = Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  try {
    fs.mkdirSync(STATE, { recursive: true });
    fs.writeFileSync(DEV_KEY_FILE, key, 'utf8');
    fs.chmodSync(DEV_KEY_FILE, 0o600);
  } catch {}
  return { key, from: 'generated' };
}
const DEV_KEY_INFO = resolveDevKey();
const DEV_KEY = DEV_KEY_INFO.key;
// ── 开发者模式激活状态（永久，存 state/dev-mode.json）──
const DEVMODE_FILE = path.join(STATE, 'dev-mode.json');
function readDevMode() {
  try { return JSON.parse(fs.readFileSync(DEVMODE_FILE, 'utf8')); } catch { return { activated: true, at: 0 }; }
}
function writeDevMode(activated) {
  try {
    fs.mkdirSync(STATE, { recursive: true });
    fs.writeFileSync(DEVMODE_FILE, JSON.stringify({ activated: !!activated, at: Date.now() }, null, 2), 'utf8');
  } catch {}
}
function devModeActivated() { return readDevMode().activated !== false; }

let envCache = null;   // 环境扫描结果缓存（60 秒）

/** 给普通账户看的版本：去掉本机绝对路径、内部地址。 */
function redactEnv(data) {
  const clean = (v) => String(v ?? '')
    .replace(/[A-Za-z]:\\[^\s,，|]*/g, '（本机路径）')
    .replace(/https?:\/\/127\.0\.0\.1[^\s,，|]*/g, '（本机地址）');
  return {
    ...data,
    items: (data.items ?? []).map((x) => ({ ...x, found: clean(x.found), expected: clean(x.expected) }))
  };
}

// ── 外观（图标）────────────────────────────────────────────────────────
const UI_STATE = path.join(STATE, 'ui.json');
const ICON_DIR = path.join(ROOT, 'assets', 'icons');
function readUi() {
  try { return JSON.parse(fs.readFileSync(UI_STATE, 'utf8')); } catch { return { icon: 'cocoa', theme: 'auto' }; }
}
function writeUi(next) {
  try {
    fs.mkdirSync(STATE, { recursive: true });
    fs.writeFileSync(UI_STATE, JSON.stringify(next, null, 2), 'utf8');
  } catch {}
}
function iconManifest() {
  let list = [];
  try { list = JSON.parse(fs.readFileSync(path.join(ICON_DIR, 'manifest.json'), 'utf8')).icons ?? []; } catch {}
  // 自定义：用户自己丢进 assets/icons 的 png（不以 -blink 结尾）
  try {
    const known = new Set(list.map((x) => x.png));
    for (const f of fs.readdirSync(ICON_DIR)) {
      if (!/\.png$/i.test(f) || /-blink\.png$/i.test(f) || f === 'manifest.json') continue;
      if (known.has(f)) continue;
      const id = f.replace(/\.png$/i, '').replace(/[^a-zA-Z0-9_-]/g, '');
      if (!id) continue;
      list.push({ id, name: '自定义 · ' + id, png: f, blink: '', ico: '' });
    }
  } catch {}
  return list;
}
const BOOT_AT = Date.now();   // 本次面板启动时间
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 60 * 1000;
const LOGIN_MAX_FAILS = 5;
const sessions = new Map();

// 启动令牌：给静默启动脚本用（它没法走登录流程）。只放行 start/stop/restart 三个接口。
const LAUNCH_TOKEN_FILE = path.join(STATE, 'panel-launch-token');
let launchToken = '';
try {
  launchToken = fs.readFileSync(LAUNCH_TOKEN_FILE, 'utf8').trim();
} catch {}
if (!launchToken) {
  launchToken = crypto.randomBytes(16).toString('hex');
  try {
    fs.writeFileSync(LAUNCH_TOKEN_FILE, launchToken, 'utf8');
    fs.chmodSync(LAUNCH_TOKEN_FILE, 0o600);
  } catch {}
}
const loginFails = new Map();
const registerGate = new Map();
// 开发者密钥失败退避：第 n 次失败等 2^(n-1)*600ms（上限 12 秒），成功后清零
const devFailState = new Map();   // ip -> { count, until }
// 普通账户登录失败登记：只有被登记过的用户名才允许走"重置密码"
const RESET_TICKETS = path.join(STATE, 'reset-tickets.json');
function readTickets() {
  try { return JSON.parse(fs.readFileSync(RESET_TICKETS, 'utf8')); } catch { return {}; }
}
function recordTicket(user, ip) {
  const name = String(user ?? '').trim();
  if (!name) return;
  const all = readTickets();
  const prev = all[name] ?? { count: 0 };
  all[name] = { count: prev.count + 1, at: Date.now(), ip: maskIp(ip) };
  // 只留最近 50 条
  const entries = Object.entries(all).sort((a, b) => (b[1].at ?? 0) - (a[1].at ?? 0)).slice(0, 50);
  try {
    fs.mkdirSync(STATE, { recursive: true });
    fs.writeFileSync(RESET_TICKETS, JSON.stringify(Object.fromEntries(entries), null, 2), 'utf8');
  } catch {}
}
/** 这个用户名最近 15 分钟内失败过吗？ */
function hasRecentTicket(user) {
  const rec = readTickets()[String(user ?? '').trim()];
  if (!rec) return false;
  return Date.now() - Number(rec.at ?? 0) <= 15 * 60 * 1000;
}
function clearTicket(user) {
  const all = readTickets();
  delete all[String(user ?? '').trim()];
  try { fs.writeFileSync(RESET_TICKETS, JSON.stringify(all, null, 2), 'utf8'); } catch {}
}  // IP → { count, resetAt }：每小时最多 5 个注册
const LOCAL_HOSTS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const ALLOW_REMOTE = process.env.QQB_PANEL_ALLOW_REMOTE === '1';

function clientIp(req) {
  const raw = req.socket?.remoteAddress || '';
  return String(raw);
}

/** IP 脱敏：127.0.0.1 → 127.***.***.1；IPv6 只留前两段。 */
function maskIp(ip) {
  const s = String(ip ?? '');
  if (s.includes(':')) {
    const parts = s.split(':').filter(Boolean);
    return (parts.slice(0, 2).join(':') || '::') + ':***';
  }
  const p = s.split('.');
  if (p.length === 4) return `${p[0]}.***.***.${p[3]}`;
  return s || 'unknown';
}

function isLocalRequest(req) {
  if (ALLOW_REMOTE) return true;
  return LOCAL_HOSTS.has(clientIp(req));
}

function readAuth() {
  try {
    const raw = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
    return migrateAuth(raw);
  } catch { return null; }
}

/** v1（单账户）→ v2（accounts 数组 + role）。v1 的那个账户视为开发者。 */
function migrateAuth(raw) {
  if (!raw) return null;
  if (Array.isArray(raw.accounts)) return raw;
  if (raw.user && raw.hash && raw.salt) {
    return { version: 2, accounts: [{ user: raw.user, salt: raw.salt, hash: raw.hash, role: 'developer', createdAt: raw.createdAt ?? Date.now() }] };
  }
  return null;
}

function writeAuth(data) {
  const tmp = `${AUTH_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ version: 2, ...data }, null, 2), 'utf8');
  fs.renameSync(tmp, AUTH_FILE);
  try { fs.chmodSync(AUTH_FILE, 0o600); } catch {}
}

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), String(salt), 32).toString('hex');
}

/** 创建账户；role 默认 user，第一个账户强制 developer。 */
// 各类输入上限（字节/字符），统一在这里，前端提示同源
// 临时密码：重置后统一设成这个，登录后强制改
const TEMP_PASS = '00000';

const LIMITS = { nickMin: 2, nickMax: 24, passMin: 6, passMax: 128, personaBytes: 20000, memItem: 300, accounts: 20 };

function createAccount(user, password, role = 'user') {
  const finalRole = role === 'developer' ? 'user' : role;
  const rawName = String(user ?? '').trim();
  if (rawName.length > LIMITS.nickMax) return { ok: false, msg: '用户名最多 ' + LIMITS.nickMax + ' 个字符' };
  const name = rawName.slice(0, LIMITS.nickMax);
  if (name.length < LIMITS.nickMin) return { ok: false, msg: '用户名至少 ' + LIMITS.nickMin + ' 个字符' };
  if (name.length > LIMITS.nickMax) return { ok: false, msg: '用户名最多 ' + LIMITS.nickMax + ' 个字符' };
  const pw = String(password ?? '');
  if (pw.length < LIMITS.passMin) return { ok: false, msg: '密码至少 ' + LIMITS.passMin + ' 位' };
  if (pw.length > LIMITS.passMax) return { ok: false, msg: '密码最多 ' + LIMITS.passMax + ' 位' };
  const auth = readAuth() ?? { accounts: [] };
  if (auth.accounts.some((a) => a.user === name)) return { ok: false, msg: '这个用户名已经存在了' };
  // 开发者现在靠密钥登录，不再有开发者账户；这里创建的一律是普通账户
  const salt = crypto.randomBytes(16).toString('hex');
  auth.accounts.push({ user: name, salt, hash: hashPassword(password, salt), role: finalRole, createdAt: Date.now() });
  writeAuth(auth);
  log(`已创建${finalRole === 'developer' ? '开发者' : '普通'}账户：${name}`);
  return { ok: true, msg: finalRole === 'developer' ? '开发者账户已创建' : '普通账户已创建', role: finalRole };
}

/** 校验用户名密码，成功返回账户对象。 */
function verifyAccount(user, password) {
  const auth = readAuth();
  if (!auth) return null;
  const acc = auth.accounts.find((a) => a.user === String(user ?? '').trim());
  if (!acc) return null;
  const got = Buffer.from(hashPassword(password, acc.salt), 'hex');
  const want = Buffer.from(acc.hash, 'hex');
  if (got.length !== want.length) return null;
  return crypto.timingSafeEqual(got, want) ? acc : null;
}

function deleteAccount(name) {
  const auth = readAuth();
  if (!auth) return { ok: false, msg: '还没有账户' };
  const idx = auth.accounts.findIndex((a) => a.user === name);
  if (idx < 0) return { ok: false, msg: '找不到这个账户' };
  if (auth.accounts[idx].role === 'developer' && auth.accounts.filter((a) => a.role === 'developer').length <= 1) {
    return { ok: false, msg: '至少要保留一个开发者账户' };
  }
  auth.accounts.splice(idx, 1);
  writeAuth(auth);
  log('已删除账户:', name);
  return { ok: true, msg: '已删除 ' + name };
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function currentSession(req) {
  const token = parseCookies(req).whale_session;
  if (!token) return null;
  const sess = sessions.get(token);
  if (!sess) return null;
  if (sess.exp < Date.now()) { sessions.delete(token); return null; }
  return sess;
}

function issueSession(req, user, role = 'user') {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { user, role, exp: Date.now() + SESSION_TTL_MS, ip: maskIp(clientIp(req)) });
  return token;
}

function authState(req) {
  const auth = readAuth();
  const sess = currentSession(req);
  return {
    registered: (auth?.accounts?.length ?? 0) > 0,
    accountCount: auth?.accounts?.length ?? 0,
    authed: !!sess,
    sessionUser: sess?.user ?? '',
    role: sess?.role ?? '',
    isDeveloper: sess?.role === 'developer',
    mustChange: !!(() => {
      if (!sess || sess.role === 'developer') return false;
      const acc = readAuth()?.accounts?.find((a) => a.user === sess.user);
      return acc?.mustChange === true;
    })(),
    devKeyOnly: true   // dev-key-only：开发者模式不需要账户
  };
}

/** 登录限速：同一 IP 每分钟最多 5 次失败。 */
function loginBlocked(ip) {
  const rec = loginFails.get(ip);
  if (!rec) return false;
  if (Date.now() > rec.resetAt) { loginFails.delete(ip); return false; }
  return rec.count >= LOGIN_MAX_FAILS;
}

function recordLoginFail(ip) {
  const rec = loginFails.get(ip);
  if (!rec || Date.now() > rec.resetAt) {
    loginFails.set(ip, { count: 1, resetAt: Date.now() + LOGIN_WINDOW_MS });
  } else {
    rec.count += 1;
  }
}

// ── 端口探测 ───────────────────────────────────────────────────────────────
function probe(port, timeoutMs = 600) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, '127.0.0.1');
  });
}

// ── 进程控制 ───────────────────────────────────────────────────────────────
function spawnDetached(command, args, opts = {}) {
  const child = spawn(command, args, {
    cwd: opts.cwd || ROOT,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, ...(opts.env || {}) }
  });
  child.unref();
  return child.pid;
}

/** 找到监听某端口的进程并结束它（Windows: netstat 解析）。 */
function killPort(port) {
  return new Promise((resolve) => {
    const child = spawn('netstat', ['-ano'], { windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('close', () => {
      const target = `:${port}`;
      const pids = new Set();
      for (const line of out.split('\n')) {
        if (!line.includes(target) || !line.includes('LISTENING')) continue;
        const cols = line.trim().split(/\s+/);
        const pid = Number(cols[cols.length - 1]);
        if (Number.isInteger(pid) && pid > 4) pids.add(pid);
      }
      if (!pids.size) return resolve(0);
      let killed = 0;
      for (const pid of pids) {
        try {
          spawn('taskkill', ['/F', '/PID', String(pid)], { windowsHide: true, stdio: 'ignore' });
          killed += 1;
        } catch {}
      }
      resolve(killed);
    });
  });
}

function killWatchdog() {
  return new Promise((resolve) => {
    spawn('powershell', [
      '-NoProfile', '-Command',
      "Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | Where-Object { $_.CommandLine -like '*watchdog.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
    ], { windowsHide: true, stdio: 'ignore' }).on('close', () => resolve(true));
  });
}

async function start(target) {
  const env = {};
  const key = process.env.DEEPSEEK_API_KEY || '';
  if (key) env.DEEPSEEK_API_KEY = key;

  if (target === 'snowluma' || target === 'asr') {
    // 面板进程没有控制台，直接 spawn 这两个会失败（实测），统一委托给启动脚本
    spawnDetached('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', startAllScript]);
    log('委托启动脚本：' + target);
    return { ok: true, msg: '正在通过启动脚本拉起服务…' };
  }
  if (target === 'snowluma-unused') {
    // 直接跑 SnowLuma 自带的 node.exe：不弹控制台窗口，也不走 launcher.bat 的版本检查
    if (!SNOWLUMA_DIR) return { ok: false, msg: '还没配置 SnowLuma 目录：请在 config.json 里填 snowluma.homeDir（形如 C:\\SnowLuma）' };
    spawnDetached(SNOWLUMA_EXE, ['index.mjs'], { cwd: SNOWLUMA_DIR });
    log('启动 SnowLuma');
    return { ok: true, msg: '正在启动 SnowLuma（隐藏窗口）…' };
  }
  if (target === 'asr') {
    spawnDetached('cmd.exe', ['/c', 'start', '""', '/min', path.join(ROOT, 'start-asr.bat')]);
    log('启动 ASR');
    return { ok: true, msg: '正在启动语音识别…' };
  }
  if (target === 'bridge') {
    spawnDetached('node', [path.join(ROOT, 'src', 'bridge.js')], { env });
    log('启动桥接');
    return { ok: true, msg: '正在启动桥接…' };
  }
  if (target === 'watchdog') {
    spawnDetached('cmd.exe', ['/c', 'start', '""', '/min', path.join(ROOT, '守护.bat')], { env });
    log('启动守护');
    return { ok: true, msg: '正在启动守护…' };
  }
  if (target === 'all') {
    const steps = [];
    if (!(await probe(3000))) { await start('snowluma'); steps.push('SnowLuma'); }
    if (!(await probe(3199))) { await start('asr'); steps.push('语音识别'); }
    await new Promise((r) => setTimeout(r, 3000));
    if (!(await probe(3100))) { await start('bridge'); steps.push('桥接'); }
    return { ok: true, msg: steps.length ? `已启动：${steps.join('、')}` : '全部已在运行' };
  }
  return { ok: false, msg: `未知目标：${target}` };
}

async function stop(target) {
  if (target === 'bridge') { await killPort(3100); return { ok: true, msg: '桥接已停止' }; }
  if (target === 'asr') { await killPort(3199); return { ok: true, msg: '语音识别已停止' }; }
  if (target === 'watchdog') { await killWatchdog(); return { ok: true, msg: '守护已停止' }; }
  if (target === 'snowluma') { await killPort(3000); return { ok: true, msg: 'SnowLuma 已停止' }; }
  if (target === 'all') {
    await killWatchdog();
    await killPort(3100);
    await killPort(3199);
    return { ok: true, msg: '桥接与语音识别已停止（SnowLuma 保留）' };
  }
  return { ok: false, msg: `未知目标：${target}` };
}

// ── 状态汇总 ───────────────────────────────────────────────────────────────
// ── 账户档案（普通账户的独立配置，与开发者 config.json 完全隔离）──
const PROFILE_DIR = path.join(STATE, 'profiles');
// 普通用户看到的预设（写死在代码里，与开发者的本地配置无关）
const PRESET_MODELS = [
  { id: 'deepseek-flash', label: '快速（日常聊天）' },
  { id: 'deepseek-v4-pro', label: '聪明（复杂一点的问题）' }
];
const PRESET_PERSONAS = [
  { name: '温柔', text: '说话轻一点，多解释一步，不催人。遇到不懂的先问清楚再答。' },
  { name: '简洁', text: '能一句说完就不说两句。不用列表、不加粗、不总结陈词。' },
  { name: '活泼', text: '语气轻快，可以用语气词和感叹号，偶尔开个小玩笑，但不油。' }
];

const PROFILE_DEFAULT = {
  qq: '',
  personaText: '',
  model: '',
  personaName: '',
  behavior: { groupTrigger: 'smart', chime: 0.18, expressionOn: true, stickerChance: 0.22, faceChance: 0.12, voiceReply: false },
  trusted: [],
  memory: []
};

function profilePath(user) {
  const safe = String(user ?? '').replace(/[^\w\u4e00-\u9fa5-]/g, '');
  return path.join(PROFILE_DIR, safe + '.json');
}

function readProfile(user) {
  const data = readJson(profilePath(user), null);
  if (!data) return { ...PROFILE_DEFAULT };
  return {
    ...PROFILE_DEFAULT,
    ...data,
    behavior: { ...PROFILE_DEFAULT.behavior, ...(data.behavior ?? {}) },
    trusted: Array.isArray(data.trusted) ? data.trusted : [],
    memory: Array.isArray(data.memory) ? data.memory : []
  };
}

function writeProfile(user, patch) {
  const cur = readProfile(user);
  const next = {
    ...cur,
    ...patch,
    behavior: { ...cur.behavior, ...(patch.behavior ?? {}) },
    trusted: Array.isArray(patch.trusted) ? patch.trusted.slice(0, 50) : cur.trusted,
    memory: Array.isArray(patch.memory) ? patch.memory.slice(0, 200) : cur.memory
  };
  try {
    fs.mkdirSync(PROFILE_DIR, { recursive: true });
    fs.writeFileSync(profilePath(user), JSON.stringify(next, null, 2), 'utf8');
  } catch (error) {
    return { ok: false, msg: error.message };
  }
  return { ok: true, msg: '已保存', profile: next };
}


// ── 人格卡 → 设定 联动 ────────────────────────────────────────────────────
const MEMORY_FILE = path.join(STATE, 'memory.json');
const SETTING_CATEGORIES = [
  { tag: '身份', re: /你是|我叫|名字|身份|角色|自称|称呼/ },
  { tag: '语气', re: /说话|语气|口头禅|风格|简短|傲娇|口癖|分句|标点/ },
  { tag: '禁忌', re: /不要|禁止|别|避免|不能|无需|不准/ },
  { tag: '偏好', re: /喜欢|讨厌|爱好|兴趣|爱喝|爱吃|最爱/ },
  { tag: '规则', re: /必须|总是|每次|优先|一律|默认/ }
];

/** 把人格卡文本拆成设定条目（启发式：按行分类，去重，限 12 条）。 */
function parsePersonaToSettings(text, cardName) {
  const clean = (l) => l
    .replace(/^\s*#{1,6}\s*/, '')
    .replace(/^\s*[-*>]\s*/, '')
    .replace(/^\s*\d+[.)]\s*/, '')
    .replace(/\*\*|__|`/g, '')
    .trim();

  // 跳过"标题式"行：编号大纲、短标题、没有句末标点的短行
  const looksLikeTitle = (l) => {
    if (/^[〇一二三四五六七八九十]+[、.]/.test(l)) return true;
    if (/^第[一二三四五六七八九十]+[章节]/.test(l)) return true;
    if (/^[（(]?\d+[）)]/.test(l)) return true;
    if (l.length < 10) return true;
    if (l.length < 26 && !/[。！？；…]/.test(l)) return true;
    return false;
  };

  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map(clean)
    .filter((l) => l.length >= 10 && !l.startsWith(String.fromCharCode(96).repeat(3)) && !looksLikeTitle(l));

  const out = [];
  const seen = new Set();
  for (const line of lines) {
    const cat = SETTING_CATEGORIES.find((c) => c.re.test(line))?.tag ?? '其他';
    const body = line.slice(0, 150);
    const text2 = '【人格·' + cat + '】' + body;
    if (seen.has(text2)) continue;
    seen.add(text2);
    out.push({ text: text2, ts: Date.now(), from: 'persona:' + cardName });
    if (out.length >= 12) break;
  }
  return out;
}

/** 读人格卡文件（找不到返回空串）。 */
function readPersonaCard(name) {
  const safe = String(name ?? '').replace(/[^\w\u4e00-\u9fa5-]/g, '');
  if (!safe) return '';
  try { return fs.readFileSync(path.join(ROOT, 'roles', safe + '.md'), 'utf8'); } catch { return ''; }
}

/** 当前在用的人格卡名（state/current-role.json）。 */
function activePersonaName() {
  try { return JSON.parse(fs.readFileSync(path.join(STATE, 'current-role.json'), 'utf8')).role ?? null; } catch { return null; }
}

/**
 * 同步设定：删掉上次由人格卡生成的条目，再写入这次的。
 * 手工添加的设定（没有 from 字段）原样保留。
 */
function syncPersonaSettings(cardName, text) {
  const card = cardName || activePersonaName();
  if (!card) return { ok: false, msg: '还没有选定人格卡' };
  const body = text ?? readPersonaCard(card);
  if (!String(body).trim()) return { ok: false, msg: '人格卡是空的，没法分析' };

  let mem = {};
  try { mem = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8')); } catch { return { ok: false, msg: '读不到 memory.json' }; }
  mem.long = mem.long ?? {};
  const before = Array.isArray(mem.long.settings) ? mem.long.settings : [];
  // 用文本前缀识别自动生成的条目（读接口可能会裁掉 from 字段）
  const isAuto = (x) => String(x?.from ?? '').startsWith('persona:') || String(x?.text ?? '').startsWith('【人格·');
  const manual = before.filter((x) => !isAuto(x));
  const generated = parsePersonaToSettings(body, card);
  // 设定总数上限 20，手工的优先保留
  mem.long.settings = [...manual, ...generated].slice(0, 20);
  try {
    fs.mkdirSync(path.dirname(MEMORY_FILE), { recursive: true });
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(mem, null, 2), 'utf8');
  } catch (error) {
    return { ok: false, msg: '写入失败：' + error.message };
  }
  log('人格卡设定已同步:', card, '+', generated.length, '条（手工保留', manual.length, '条）');
  return { ok: true, msg: '已从「' + card + '」同步 ' + generated.length + ' 条设定', count: generated.length, entries: generated };
}

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function tail(file, lines = 40) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    return text.split('\n').filter(Boolean).slice(-lines);
  } catch { return []; }
}

function watchdogAlive() {
  try {
    const st = fs.statSync(path.join(STATE, 'watchdog.beat'));
    return (Date.now() - st.mtimeMs) / 1000 < 90;
  } catch { return false; }
}


// ── 配置读写（白名单） ─────────────────────────────────────────────────────
const CFG_PATH = path.join(ROOT, 'config.json');

// 面板只允许改这些字段：模型/思考强度、群聊行为、表达、记忆压缩、审核、搜索来源
const CFG_WHITELIST = {
  'dsh.model': (v) => ['deepseek-flash', 'deepseek-v4-pro'].includes(v) ? v : null,
  'dsh.reasoningEffort': (v) => ['low', 'high', 'max'].includes(v) ? v : null,
  'webSearch.provider': (v) => ['auto', 'deepseek', 'bing'].includes(v) ? v : null,
  'role.groupTrigger': (v) => ['all', 'mention', 'smart'].includes(v) ? v : null,
  'role.randomChimeProbability': (v) => {
    const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
  },
  'role.developers': (v) => {
    const list = Array.isArray(v) ? v : String(v ?? '').split(/[,，\s]+/);
    const out = [];
    for (const item of list) {
      const t = String(item ?? '').trim();
      if (/^\d{5,12}$/.test(t) && !out.includes(t)) out.push(t);
      if (out.length >= 20) break;
    }
    return out.length ? out : null;
  },
  'role.expression.enabled': (v) => (typeof v === 'boolean' ? v : null),
  'role.expression.stickerChance': (v) => {
    const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
  },
  'role.expression.faceChance': (v) => {
    const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
  },
  'role.expression.cooldownMs': (v) => {
    const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null;
  },
  'role.memory.compressAfterTurns': (v) => {
    const n = Number(v); return Number.isInteger(n) && n >= 4 && n <= 200 ? n : null;
  },
  'role.memory.compressKeepLast': (v) => {
    const n = Number(v); return Number.isInteger(n) && n >= 2 && n <= 50 ? n : null;
  },
  'role.memory.autoRemember': (v) => (typeof v === 'boolean' ? v : null),
  'safety.enabled': (v) => (typeof v === 'boolean' ? v : null)
};

function setPath(obj, dotted, value) {
  const parts = dotted.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve) => {
    let size = 0;
    let raw = '';
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) { req.destroy(); return; }
      raw += chunk;
    });
    req.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

function collectConfig() {
  const cfg = readJson(CFG_PATH, {});
  const roleState = readJson(path.join(STATE, 'current-role.json'), { role: null, mode: 'active' });
  const personas = (() => {
    try {
      return fs.readdirSync(path.join(ROOT, 'roles'))
        .filter((f) => f.endsWith('.md') && f !== 'README.md')
        .map((f) => f.slice(0, -3))
        .sort((a, b) => a.localeCompare(b, 'zh-CN'));
    } catch { return []; }
  })();
  return {
    dsh: {
      baseUrl: cfg.dsh?.baseUrl ?? '',
      provider: cfg.dsh?.provider ?? '',
      model: cfg.dsh?.model ?? '',
      reasoningEffort: cfg.dsh?.reasoningEffort ?? '',
      models: ['deepseek-flash', 'deepseek-v4-pro'],
      efforts: ['low', 'high', 'max']
    },
    webSearch: { provider: cfg.webSearch?.provider ?? 'auto', keyEnv: cfg.webSearch?.apiKeyEnv ?? '' },
    role: {
      groupTrigger: cfg.role?.groupTrigger ?? 'smart',
      developers: Array.isArray(cfg.role?.developers) ? cfg.role.developers : [],
      chime: cfg.role?.randomChimeProbability ?? 0,
      expression: cfg.role?.expression ?? {},
      memory: cfg.role?.memory ?? {}
    },
    safety: { enabled: cfg.safety?.enabled !== false },
    persona: { active: roleState.role ?? null, mode: roleState.mode ?? 'active', list: personas }
  };
}

function saveConfig(patch) {
  const cfg = readJson(CFG_PATH, {});
  const applied = [];
  const rejected = [];
  for (const [key, raw] of Object.entries(patch ?? {})) {
    const validator = CFG_WHITELIST[key];
    if (!validator) { rejected.push(key); continue; }
    const value = validator(raw);
    if (value === null || value === undefined) { rejected.push(key); continue; }
    setPath(cfg, key, value);
    applied.push(key);
  }
  if (applied.length) {
    const tmp = `${CFG_PATH}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, CFG_PATH);
    log('配置已更新:', applied.join(', '));
  }
  return { ok: applied.length > 0, applied, rejected };
}

// ── 人格切换 ───────────────────────────────────────────────────────────────
function setPersona(name) {
  const safe = String(name ?? '').replace(/[^\w\u4e00-\u9fff-]/g, '');
  const file = path.join(ROOT, 'roles', `${safe}.md`);
  if (!safe || !fs.existsSync(file)) return { ok: false, msg: '找不到这张人格卡：' + safe };
  const target = path.join(STATE, 'current-role.json');
  fs.writeFileSync(target, JSON.stringify({ role: safe, mode: 'active' }, null, 2), 'utf8');
  log('人格切换为:', safe);
  return { ok: true, msg: `已切换到「${safe}」（下一条消息生效）` };
}

// ── 记忆管理 ───────────────────────────────────────────────────────────────
const MEM_PATH = path.join(STATE, 'memory.json');

/** 当前会话该用哪份记忆文件：开发者用全局，普通用户用自己目录下的。 */
function memoryPathFor(sess) {
  if (!sess || sess.role === 'developer') return MEM_PATH;
  const name = String(sess.user ?? '').replace(/[^\w\u4e00-\u9fa5-]/g, '').slice(0, 32);
  if (!name) return MEM_PATH;
  return path.join(STATE, 'profiles', name, 'memory.json');
}

function readMemory(file = MEM_PATH) {
  const mem = readJson(file, { long: {}, short: {}, summaries: {} });
  const strip = (f) => ({ id: f.id, text: f.text, ts: f.ts, weight: f.weight ?? 1, access: f.accessCount ?? 0, key: f.key ?? '' });
  return {
    settings: (mem.long?.settings ?? []).map((s) => ({ text: s.text, ts: s.ts, from: s.from ?? '' })),
    long: (mem.long?.facts ?? []).map((f) => ({ ...strip(f), tier: 'long' })),
    short: (mem.short?.facts ?? []).map((f) => ({ ...strip(f), tier: 'short' })),
    keywords: [
      ...(mem.long?.keywords ?? []).map((k) => ({ ...k, tier: 'long' })),
      ...(mem.short?.keywords ?? []).map((k) => ({ ...k, tier: 'short' }))
    ],
    summaries: Object.entries(mem.summaries ?? {}).map(([k, v]) => ({ key: k, text: v.text, turns: v.turns, updatedAt: v.updatedAt }))
  };
}

function memoryAction(op, payload, file = MEM_PATH) {
  // 记忆文件可能还不存在（普通用户第一次写）：先建目录
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); } catch {}
  const mem = readJson(file, { long: { settings: [], facts: [], keywords: [] }, short: { facts: [], keywords: [] }, summaries: {} });
  mem.long ??= { settings: [], facts: [], keywords: [] };
  mem.short ??= { facts: [], keywords: [] };
  const { tier, id, text } = payload ?? {};

  if (op === 'delete') {
    const bag = tier === 'long' ? mem.long.facts : mem.short.facts;
    const idx = bag.findIndex((f) => f.id === id);
    if (idx < 0) return { ok: false, msg: '找不到这条记忆' };
    const [gone] = bag.splice(idx, 1);
    fs.writeFileSync(file, JSON.stringify(mem, null, 2), 'utf8');
    return { ok: true, msg: `已删除：${gone.text.slice(0, 20)}` };
  }
  if (op === 'promote' || op === 'demote') {
    const from = op === 'promote' ? mem.short.facts : mem.long.facts;
    const to = op === 'promote' ? mem.long.facts : mem.short.facts;
    const idx = from.findIndex((f) => f.id === id);
    if (idx < 0) return { ok: false, msg: '找不到这条记忆' };
    const [rec] = from.splice(idx, 1);
    rec.weight = op === 'promote' ? Math.max(2, rec.weight ?? 1) : 1;
    to.push(rec);
    fs.writeFileSync(file, JSON.stringify(mem, null, 2), 'utf8');
    return { ok: true, msg: `已${op === 'promote' ? '升级为长期' : '降级为短期'}：${rec.text.slice(0, 20)}` };
  }
  if (op === 'add') {
    const body = String(text ?? '').trim();
    if (!body) return { ok: false, msg: '内容不能为空' };
    mem[tier === 'long' ? 'long' : 'short'].facts.push({
      id: 'p' + Date.now().toString(36), ts: Date.now(), key: '', text: body.slice(0, 200),
      tags: [], weight: tier === 'long' ? 2 : 1, accessCount: 0, lastAccessAt: 0
    });
    fs.writeFileSync(file, JSON.stringify(mem, null, 2), 'utf8');
    return { ok: true, msg: '已添加' };
  }
  if (op === 'keyword-delete') {
    for (const bag of [mem.long.keywords, mem.short.keywords]) {
      const idx = bag.findIndex((k) => k.word === id);
      if (idx >= 0) { bag.splice(idx, 1); fs.writeFileSync(file, JSON.stringify(mem, null, 2), 'utf8'); return { ok: true, msg: '已删除关键词 ' + id }; }
    }
    return { ok: false, msg: '找不到这个词' };
  }
  return { ok: false, msg: '未知操作：' + op };
}

// ── 性能统计 ───────────────────────────────────────────────────────────────
function collectStats() {
  const out = { turns: 0, input: 0, output: 0, reasoning: 0, hit: 0, miss: 0, byModel: {}, last24h: 0, lastTurnAt: 0 };
  try {
    const lines = fs.readFileSync(path.join(STATE, 'token-usage.jsonl'), 'utf8').split('\n').filter(Boolean);
    const dayAgo = Date.now() - 86400000;
    for (const line of lines) {
      let r;
      try { r = JSON.parse(line); } catch { continue; }
      if (r.k !== 'turn') continue;
      const b = r.b ?? {};
      out.turns += 1;
      out.input += (b.cacheMiss ?? 0) + (b.cacheHit ?? 0);
      out.output += b.output ?? 0;
      out.reasoning += b.reasoning ?? 0;
      out.hit += b.cacheHit ?? 0;
      out.miss += b.cacheMiss ?? 0;
      const model = r.model ?? 'unknown';
      out.byModel[model] = (out.byModel[model] ?? 0) + 1;
      if (r.t > dayAgo) out.last24h += 1;
      if (r.t > out.lastTurnAt) out.lastTurnAt = r.t;
    }
  } catch {}
  // 桥接日志里的错误数（最近 500 行）
  try {
    const tail = fs.readFileSync(logPath('bridge.log'), 'utf8').split('\n').filter(Boolean).slice(-500);
    out.errors = tail.filter((l) => /失败|错误|ERROR|panic/.test(l)).length;
  } catch { out.errors = 0; }
  return out;
}

// ── 插件列表 ───────────────────────────────────────────────────────────────
function listPlugins() {
  const dir = path.join(ROOT, 'plugins');
  const out = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifest = readJson(path.join(dir, entry.name, 'manifest.json'), null);
      out.push({
        name: entry.name,
        title: manifest?.title ?? entry.name,
        version: manifest?.version ?? '-',
        description: manifest?.description ?? '',
        enabled: manifest?.enabled !== false
      });
    }
  } catch {}
  return out;
}

/** 重启桥接：杀掉 3100 再拉起来（改模型/人格后需要）。 */
async function restartBridge() {
  await killPort(3100);
  await new Promise((r) => setTimeout(r, 1500));
  const res = await start('bridge');
  return { ...res, msg: '桥接已重启' + (res.ok ? '' : '（失败，看日志）') };
}

async function status() {
  const cfg = readJson(path.join(ROOT, 'config.json'), {});
  const mem = readJson(path.join(STATE, 'memory.json'), {});
  const ctx = readJson(path.join(STATE, 'context.json'), {});
  const beatPath = path.join(STATE, 'watchdog.beat');
  let beatAge = null;
  try { beatAge = Math.round((Date.now() - fs.statSync(beatPath).mtimeMs) / 1000); } catch {}

  const ports = {};
  for (const [key, svc] of Object.entries(SERVICES)) ports[key] = await probe(svc.port);
  // 5099 是 SnowLuma 的 WebUI：进程活着但没登录时，3000 不开而 5099 开着
  const snowlumaUiUp = await probe(SNOWLUMA_UI_PORT);

  const convs = Object.entries(ctx.convs ?? {}).map(([k, v]) => ({
    key: k,
    turns: (v.turns ?? []).length,
    topic: v.topic || '',
    pending: (v.pending ?? []).length
  }));

  return {
    at: Date.now(),
    ports,
    snowlumaUiUp,
    bootAt: BOOT_AT,
    services: SERVICES,
    snowlumaUi: { proxyPort: SNOWLUMA_PROXY_PORT, uiPort: SNOWLUMA_UI_PORT, url: `http://127.0.0.1:${SNOWLUMA_PROXY_PORT}` },
    watchdog: {
      alive: Date.now() - lastSuperviseAt < 90 * 1000,
      beatAge: Math.round((Date.now() - lastSuperviseAt) / 1000),
      restarts,
      external: watchdogAlive()
    },
    dsh: cfg.dsh?.baseUrl ?? '',
    model: `${cfg.dsh?.model ?? ''} / ${cfg.dsh?.reasoningEffort ?? ''}`,
    switches: {
      trigger: cfg.role?.groupTrigger ?? '',
      chime: cfg.role?.randomChimeProbability ?? 0,
      expression: cfg.role?.expression?.enabled !== false,
      stickerChance: cfg.role?.expression?.stickerChance ?? 0,
      safety: cfg.safety?.enabled !== false,
      compress: cfg.role?.memory?.compress !== false,
      voice: cfg.socialV2?.voice?.enabled !== false
    },
    memory: {
      autoRemember: cfg.role?.memory?.autoRemember !== false,
      settings: (mem.long?.settings ?? []).length,
      longFacts: (mem.long?.facts ?? []).length,
      shortFacts: (mem.short?.facts ?? []).length,
      keywords: (mem.long?.keywords ?? []).length + (mem.short?.keywords ?? []).length,
      summaries: Object.keys(mem.summaries ?? {}).length,
      settingsText: (mem.long?.settings ?? []).map((s) => s.text),
      topFacts: [...(mem.long?.facts ?? []), ...(mem.short?.facts ?? [])].slice(-6).map((f) => f.text)
    },
    context: convs,
    logs: {
      bridge: tail(logPath('bridge.log'), 30),
      watchdog: tail(logPath('watchdog.log'), 15),
      panel: tail(logPath('panel.log'), 30)
    }
  };
}

// ── HTTP ───────────────────────────────────────────────────────────────────
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  try {

  // ── 访问控制 + 账户 ───────────────────────────────────────────────────
  if (url.pathname.startsWith('/api/auth/')) {
    if (!isLocalRequest(req)) return send(res, 403, JSON.stringify({ ok: false, msg: '只允许本机访问' }));
    if (url.pathname === '/api/auth/status') return send(res, 200, JSON.stringify(authState(req)));

    if (url.pathname === '/api/auth/register' && req.method === 'POST') {
      // register-open：普通用户自助注册（只能注册普通账户，不能注册开发者）
      const ip = clientIp(req);
      const now = Date.now();
      const gate = registerGate.get(ip) ?? { count: 0, resetAt: now + 60 * 60 * 1000 };
      if (now > gate.resetAt) { gate.count = 0; gate.resetAt = now + 60 * 60 * 1000; }
      // 上限可配：config.panel.registerPerHour（默认 20；本机自用别太苛刻）
      const perHour = Math.max(1, Math.min(200, Number(readJson(path.join(ROOT, 'config.json'), {})?.panel?.registerPerHour ?? 20)));
      if (gate.count >= perHour) {
        const mins = Math.max(1, Math.ceil((gate.resetAt - now) / 60000));
        return send(res, 429, JSON.stringify({ ok: false, msg: '注册次数已用完（每小时 ' + perHour + ' 个），约 ' + mins + ' 分钟后可再试' }));
      }
      const existing = readAuth()?.accounts?.length ?? 0;
      if (existing >= LIMITS.accounts) {
        return send(res, 400, JSON.stringify({ ok: false, msg: '普通账户数量已达上限（' + LIMITS.accounts + '），请让开发者清理' }));
      }
      const body = await readBody(req);
      const result = createAccount(body.user, body.pass, 'user');
      if (!result.ok) return send(res, 400, JSON.stringify(result));
      gate.count += 1;
      registerGate.set(ip, gate);
      const token = issueSession(req, String(body.user).trim(), 'user');
      res.setHeader('set-cookie', `whale_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}`);
      log('普通账户自助注册:', maskIp(ip), String(body.user ?? '').trim());
      return send(res, 200, JSON.stringify({ ok: true, msg: '注册成功，已用普通账户登录', role: 'user' }));
    }

    if (url.pathname === '/api/auth/login' && req.method === 'POST') {
      const ip = clientIp(req);
      if (loginBlocked(ip)) return send(res, 429, JSON.stringify({ ok: false, msg: '错太多次了，等一分钟再试' }));
      const body = await readBody(req);
      const mode = body.mode === 'dev' ? 'dev' : 'user';

      // ── 开发者模式：dev-key-only，只验密钥，不需要账户 ──
      if (mode === 'dev') {
        if (!devModeActivated()) {
          log('开发者登录被拒（模式未激活）:', maskIp(ip));
          return send(res, 403, JSON.stringify({ ok: false, msg: '开发者模式未激活，需要用 开发者模式.ps1 激活' }));
        }
        const gate = devFailState.get(ip);
        if (gate && gate.until > Date.now()) {
          const waitMs = gate.until - Date.now();
          log('开发者登录仍在退避中:', maskIp(ip), waitMs + 'ms');
          return send(res, 429, JSON.stringify({ ok: false, msg: '稍后再试' }));
        }
        const given = Buffer.from(String(body.devKey ?? '').trim());
        const want = Buffer.from(DEV_KEY);
        const okKey = given.length === want.length && crypto.timingSafeEqual(given, want);
        if (!okKey) {
          recordLoginFail(ip);
          const prev = devFailState.get(ip) ?? { count: 0, until: 0 };
          const count = prev.count + 1;
          const delayMs = Math.min(2 ** Math.min(count - 1, 5) * 600, 12000);
          devFailState.set(ip, { count, until: Date.now() + delayMs });
          log('开发者登录失败（密钥不对）:', maskIp(ip), '第 ' + count + ' 次，退避 ' + delayMs + 'ms');
          await new Promise((r) => setTimeout(r, delayMs));
          return send(res, 403, JSON.stringify({ ok: false, msg: '开发者密钥不对' }));
        }
        devFailState.delete(ip);
        loginFails.delete(ip);
        const token = issueSession(req, '开发者', 'developer');
        res.setHeader('set-cookie', `whale_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}`);
        log('开发者登录成功（密钥）:', maskIp(ip));
        return send(res, 200, JSON.stringify({ ok: true, msg: '已进入开发者模式', role: 'developer' }));
      }

      // ── 普通模式：用户名 + 密码 ──
      const acc = verifyAccount(body.user, body.pass);
      if (!acc) {
        recordLoginFail(ip);
        recordTicket(body.user, ip);   // 记下失败的用户名，供"重置密码"用
        const hasAccounts = (readAuth()?.accounts?.length ?? 0) > 0;
        log('普通登录失败:', maskIp(ip), 'user=' + String(body.user ?? '').slice(0, 24));
        return send(res, 401, JSON.stringify({ ok: false, msg: hasAccounts ? '用户名或密码不对' : '还没有普通账户，请先用开发者密钥登录后创建' }));
      }
      loginFails.delete(ip);
      const token = issueSession(req, acc.user, acc.role ?? 'user');
      res.setHeader('set-cookie', `whale_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}`);
      log('普通登录成功:', acc.user, maskIp(ip), acc.mustChange ? '(临时密码，待改)' : '');
      return send(res, 200, JSON.stringify({
        ok: true,
        msg: acc.mustChange ? '已用临时密码登录，请设置新密码' : '登录成功',
        role: acc.role ?? 'user',
        mustChange: !!acc.mustChange
      }));
    }

    // ── 账户管理（仅开发者）────────────────────────────────────────────
    if (url.pathname === '/api/auth/accounts' && req.method === 'GET') {
      const sess = currentSession(req);
      if (sess?.role !== 'developer') return send(res, 403, JSON.stringify({ ok: false, msg: '仅开发者可管理账户' }));
      const auth = readAuth();
      return send(res, 200, JSON.stringify({
        accounts: (auth?.accounts ?? []).map((a) => ({ user: a.user, role: a.role, createdAt: a.createdAt }))
      }));
    }
    if (url.pathname === '/api/auth/accounts' && req.method === 'POST') {
      const sess = currentSession(req);
      if (sess?.role !== 'developer') return send(res, 403, JSON.stringify({ ok: false, msg: '仅开发者可管理账户' }));
      const body = await readBody(req);
      if (body.op === 'delete') return send(res, 200, JSON.stringify(deleteAccount(String(body.user ?? ''))));
      const result = createAccount(body.user, body.pass, 'user');
      return send(res, result.ok ? 200 : 400, JSON.stringify(result));
    }

    // RESET_ROUTES：密码重置（普通账户专属，且必须先失败过一次）
    if (url.pathname === '/api/auth/reset' && req.method === 'POST') {
      const ip = clientIp(req);
      const body = await readBody(req);
      const user = String(body.user ?? '').trim();
      if (!user) return send(res, 400, JSON.stringify({ ok: false, msg: '要填用户名' }));
      const auth = readAuth();
      const acc = auth?.accounts?.find((a) => a.user === user);
      if (!acc) return send(res, 404, JSON.stringify({ ok: false, msg: '没有这个账户' }));
      // 只能在普通账户上生效：开发者走密钥，不参与重置
      if (acc.role === 'developer') {
        return send(res, 403, JSON.stringify({ ok: false, msg: '开发者账户不能在这里重置，用「改密钥.ps1」' }));
      }
      // 本机自用：允许直接重置（不再要求"先失败一次"）。
      // 仍然只对普通账户生效，开发者走密钥，不受影响。
      if (!hasRecentTicket(user)) {
        log('自助重置（无失败记录，本机自用）:', user, maskIp(ip));
      }
      const salt = crypto.randomBytes(16).toString('hex');
      acc.salt = salt;
      acc.hash = hashPassword(TEMP_PASS, salt);
      acc.resetAt = Date.now();
      acc.mustChange = true;   // 登录后强制改密码
      writeAuth(auth);
      clearTicket(user);
      log('普通账户密码已重置为临时密码:', user, maskIp(ip));
      return send(res, 200, JSON.stringify({
        ok: true,
        tempPassword: TEMP_PASS,
        mustChange: true,
        msg: '已重置为临时密码 ' + TEMP_PASS + '，登录后必须设置新密码'
      }));
    }

// CHANGE_PASS：用临时密码登录后设置新密码（不校验旧密码，但要求已登录）
    if (url.pathname === '/api/auth/change-password' && req.method === 'POST') {
      const sess = currentSession(req);
      if (!sess) return send(res, 401, JSON.stringify({ ok: false, msg: '需要登录' }));
      if (sess.role === 'developer') return send(res, 400, JSON.stringify({ ok: false, msg: '开发者用改密钥脚本，不走这里' }));
      const body = await readBody(req);
      const newPass = String(body.newPass ?? '');
      if (newPass === TEMP_PASS) return send(res, 400, JSON.stringify({ ok: false, msg: '不能再用临时密码' }));
      if (newPass.length < LIMITS.passMin || newPass.length > LIMITS.passMax) {
        return send(res, 400, JSON.stringify({ ok: false, msg: '新密码 ' + LIMITS.passMin + '~' + LIMITS.passMax + ' 位' }));
      }
      const auth = readAuth();
      const acc = auth?.accounts?.find((a) => a.user === sess.user);
      if (!acc) return send(res, 404, JSON.stringify({ ok: false, msg: '账户不存在' }));
      const salt = crypto.randomBytes(16).toString('hex');
      acc.salt = salt;
      acc.hash = hashPassword(newPass, salt);
      delete acc.mustChange;
      acc.changedAt = Date.now();
      writeAuth(auth);
      log('普通账户已设置新密码:', sess.user, maskIp(clientIp(req)));
      return send(res, 200, JSON.stringify({ ok: true, msg: '新密码已生效' }));
    }

    if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
      const token = parseCookies(req).whale_session;
      if (token) sessions.delete(token);
      res.setHeader('set-cookie', 'whale_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
      return send(res, 200, JSON.stringify({ ok: true, msg: '已退出' }));
    }

    return send(res, 404, JSON.stringify({ ok: false, msg: '未知的 auth 接口' }));
  }

  // 其余接口一律要求登录（本机 + 有效会话）；静态文件由下面的门禁单独处理
  if (url.pathname.startsWith('/api/')) {
    if (!isLocalRequest(req)) return send(res, 403, JSON.stringify({ ok: false, msg: '只允许本机访问' }));
    // 本机启动脚本：带正确令牌可调启停接口（否则它没法登录）
    const launchOk = launchToken
      && req.headers['x-launch-token'] === launchToken
      && ['/api/start', '/api/stop', '/api/restart-bridge'].includes(url.pathname);
    const sess = currentSession(req);
    // 外观清单允许未登录读取（登录页也要显示图标）
    const publicUi = url.pathname === '/api/ui' && req.method === 'GET';
    if (!sess && !launchOk && !publicUi) return send(res, 401, JSON.stringify({ ok: false, msg: '需要登录' }));
    // 写操作（以及账户管理）只认开发者账户；普通账户只能看
    // 普通账户连"读"都不行：这些是开发者的私有配置与全局记忆
    const OWNER_ONLY_READ = new Set(['/api/config']);
    if (!launchOk && sess && sess.role !== 'developer' && OWNER_ONLY_READ.has(url.pathname)) {
      return send(res, 403, JSON.stringify({ ok: false, msg: '这是开发者配置，普通账户看不到' }));
    }
    const DEV_ONLY = new Set(['/api/config', '/api/persona', '/api/start', '/api/stop', '/api/restart-bridge',
  '/api/personas/save', '/api/personas/delete', '/api/devmode', '/api/profiles/manage', '/api/persona/sync', '/api/learning/clear']);
    const isWrite = req.method !== 'GET';
    if (!launchOk && sess && sess.role !== 'developer' && DEV_ONLY.has(url.pathname) && isWrite) {
      return send(res, 403, JSON.stringify({ ok: false, msg: '这是全局设置，普通账户改不了；你自己的设置在「我的设置」里' }));
    }
  }

    if (url.pathname === '/api/status') return send(res, 200, JSON.stringify(await status()));

    if (url.pathname === '/api/start' && req.method === 'POST') {
      const target = url.searchParams.get('target') ?? 'all';
      return send(res, 200, JSON.stringify(await start(target)));
    }

    if (url.pathname === '/api/config' && req.method === 'GET') {
      return send(res, 200, JSON.stringify(collectConfig()));
    }
    if (url.pathname === '/api/config' && req.method === 'POST') {
      const body = await readBody(req);
      return send(res, 200, JSON.stringify(saveConfig(body)));
    }

    // PERSONA_ROUTES：人格卡列表 / 读取 / 新建 / 保存 / 删除

    // PROFILE_ROUTES：当前账户自己的档案（普通账户用；开发者走 config）



    // 开发者模式激活状态
    if (url.pathname === '/api/devmode' && req.method === 'GET') {
      return send(res, 200, JSON.stringify({ ok: true, ...readDevMode(), activated: devModeActivated() }));
    }
    if (url.pathname === '/api/devmode' && req.method === 'POST') {
      const sess = currentSession(req);
      if (sess?.role !== 'developer') return send(res, 403, JSON.stringify({ ok: false, msg: '仅开发者可改' }));
      const body = await readBody(req);
      const activated = body.activated !== false;
      writeDevMode(activated);
      log('开发者模式' + (activated ? '已激活' : '已停用'), maskIp(clientIp(req)));
      return send(res, 200, JSON.stringify({ ok: true, activated, msg: activated ? '已激活（永久）' : '已停用（永久，可用 开发者模式.ps1 恢复）' }));
    }

    // 本地管理：列出所有普通账户档案
    if (url.pathname === '/api/profiles' && req.method === 'GET') {
      const sess = currentSession(req);
      if (sess?.role !== 'developer') return send(res, 403, JSON.stringify({ ok: false, msg: '仅开发者可看' }));
      const list = [];
      try {
        for (const f of fs.readdirSync(PROFILE_DIR)) {
          if (!f.endsWith('.json')) continue;
          try {
            const p = JSON.parse(fs.readFileSync(path.join(PROFILE_DIR, f), 'utf8'));
            list.push({
              user: f.replace(/\.json$/, ''),
              qq: p.qq ?? '',
              personaChars: String(p.personaText ?? '').length,
              personaPreview: String(p.personaText ?? '').replace(/\s+/g, ' ').slice(0, 40),
              trigger: p.behavior?.groupTrigger ?? 'smart',
              chime: p.behavior?.chime ?? 0.18,
              trusted: Array.isArray(p.trusted) ? p.trusted.length : 0,
              memory: Array.isArray(p.memory) ? p.memory.length : 0
            });
          } catch {}
        }
      } catch {}
      return send(res, 200, JSON.stringify({ ok: true, list }));
    }

    // 本地管理：读取单个档案全文
    if (url.pathname === '/api/profiles/detail' && req.method === 'GET') {
      const sess = currentSession(req);
      if (sess?.role !== 'developer') return send(res, 403, JSON.stringify({ ok: false, msg: '仅开发者可看' }));
      const user = String(url.searchParams.get('user') ?? '').replace(/[^\w\u4e00-\u9fa5-]/g, '');
      const p = profilePath(user);
      if (!user || !fs.existsSync(p)) return send(res, 404, JSON.stringify({ ok: false, msg: '没有这个档案' }));
      return send(res, 200, JSON.stringify({ ok: true, user, profile: JSON.parse(fs.readFileSync(p, 'utf8')) }));
    }

    // 本地管理：删除档案 / 关联 QQ / 导入人格
    if (url.pathname === '/api/profiles/manage' && req.method === 'POST') {
      const sess = currentSession(req);
      if (sess?.role !== 'developer') return send(res, 403, JSON.stringify({ ok: false, msg: '仅开发者可改' }));
      const body = await readBody(req);
      const user = String(body.user ?? '').replace(/[^\w\u4e00-\u9fa5-]/g, '');
      const target = profilePath(user);

      // 重置密码只看账户，不要求档案存在（防死锁：管理员永远能把人放进来）
      if (body.op === 'reset-password') {
        const auth = readAuth();
        const acc = auth?.accounts?.find((a) => a.user === user);
        if (!acc) return send(res, 404, JSON.stringify({ ok: false, msg: '账户不存在' }));
        const salt = crypto.randomBytes(16).toString('hex');
        acc.salt = salt;
        acc.hash = hashPassword(TEMP_PASS, salt);
        acc.mustChange = true;
        writeAuth(auth);
        log('开发者重置了普通账户密码:', user);
        return send(res, 200, JSON.stringify({ ok: true, tempPassword: TEMP_PASS, msg: '已设为临时密码 ' + TEMP_PASS + '，让他登录后自己改' }));
      }

      if (!user || !fs.existsSync(target)) return send(res, 404, JSON.stringify({ ok: false, msg: '没有这个档案' }));


      if (body.op === 'delete') {
        fs.unlinkSync(target);
        log('开发者删除了档案:', user);
        return send(res, 200, JSON.stringify({ ok: true, msg: '已删除档案「' + user + '」' }));
      }

      if (body.op === 'link') {
        const qq = String(body.qq ?? '').replace(/\D/g, '').slice(0, 12);
        const data = JSON.parse(fs.readFileSync(target, 'utf8'));
        data.qq = qq;
        fs.writeFileSync(target, JSON.stringify(data, null, 2), 'utf8');
        log('开发者关联 QQ:', user, '→', qq || '(清空)');
        return send(res, 200, JSON.stringify({ ok: true, msg: qq ? '已关联到 ' + qq : '已解除关联' }));
      }

      if (body.op === 'import-persona') {
        const data = JSON.parse(fs.readFileSync(target, 'utf8'));
        const text = String(data.personaText ?? '').trim();
        if (text.length < 10) return send(res, 400, JSON.stringify({ ok: false, msg: '这个档案没有自设人格' }));
        const dir = path.join(ROOT, 'roles');
        fs.mkdirSync(dir, { recursive: true });
        const name = (String(body.name ?? '').trim() || ('来自-' + user)).replace(/[^\w\u4e00-\u9fa5-]/g, '');
        fs.writeFileSync(path.join(dir, name + '.md'), text, 'utf8');
        log('开发者导入了人格卡:', name, '来自档案', user);
        return send(res, 200, JSON.stringify({ ok: true, msg: '已导入为「' + name + '」' }));
      }

      return send(res, 400, JSON.stringify({ ok: false, msg: '未知操作' }));
    }




    // ── 插件管理 ─────────────────────────────────────────────────────────
    if (url.pathname === '/api/plugins/list' && req.method === 'GET') {
      const sess = currentSession(req);
      if (!sess) return send(res, 401, JSON.stringify({ ok: false, msg: '需要登录' }));
      const dir = path.join(ROOT, 'plugins');
      const list = [];
      try {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (!e.isDirectory()) continue;
          const mf = path.join(dir, e.name, 'manifest.json');
          try {
            const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
            list.push({
              name: e.name,
              title: m.title || e.name,
              version: m.version || '',
              description: m.description || '',
              enabled: m.enabled !== false,
              risk: m.risk || '',
              hooks: m.hooks || []
            });
          } catch {}
        }
      } catch {}
      return send(res, 200, JSON.stringify({ ok: true, list }));
    }

    if (url.pathname === '/api/plugins/toggle' && req.method === 'POST') {
      const sess = currentSession(req);
      if (!sess) return send(res, 401, JSON.stringify({ ok: false, msg: '需要登录' }));
      const body = await readBody(req);
      const name = String(body.name ?? '').replace(/[^\w-]/g, '');
      const mf = path.join(ROOT, 'plugins', name, 'manifest.json');
      if (!name || !fs.existsSync(mf)) return send(res, 404, JSON.stringify({ ok: false, msg: '没有这个插件' }));
      try {
        const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
        m.enabled = body.enabled !== false;
        fs.writeFileSync(mf, JSON.stringify(m, null, 2), 'utf8');
        log('插件' + (m.enabled ? '启用' : '停用') + ':', name);
        return send(res, 200, JSON.stringify({ ok: true, enabled: m.enabled, msg: m.enabled ? '已启用，重启桥接后生效' : '已停用' }));
      } catch (error) {
        return send(res, 500, JSON.stringify({ ok: false, msg: error.message }));
      }
    }

    // ── 学习数据（只读/清空，普通账户看不到）────────────────────────────
    if (url.pathname === '/api/learning' && req.method === 'GET') {
      const sess = currentSession(req);
      if (sess?.role !== 'developer') return send(res, 403, JSON.stringify({ ok: false, msg: '仅开发者可看' }));
      const file = path.join(STATE, 'learning.json');
      let data = { version: 1, items: [], edges: [], updatedAt: 0 };
      try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
      const cats = { 游戏: 0, 梗: 0, 网络用语: 0, 其他: 0 };
      for (const it of data.items || []) cats[it.cat] = (cats[it.cat] ?? 0) + 1;
      return send(res, 200, JSON.stringify({
        ok: true,
        total: (data.items || []).length,
        cats,
        items: (data.items || []).slice().sort((x, y) => (y.count ?? 0) - (x.count ?? 0)).slice(0, 60),
        edges: (data.edges || []).slice(0, 20),
        updatedAt: data.updatedAt || 0
      }));
    }

    if (url.pathname === '/api/learning/clear' && req.method === 'POST') {
      const sess = currentSession(req);
      if (sess?.role !== 'developer') return send(res, 403, JSON.stringify({ ok: false, msg: '仅开发者可操作' }));
      try {
        fs.writeFileSync(path.join(STATE, 'learning.json'), JSON.stringify({ version: 1, items: [], edges: [], updatedAt: Date.now() }, null, 2), 'utf8');
        log('学习数据已清空');
        return send(res, 200, JSON.stringify({ ok: true, msg: '已清空学习记录' }));
      } catch (error) {
        return send(res, 500, JSON.stringify({ ok: false, msg: error.message }));
      }
    }


    // ── 环境扫描（只读，不做任何改动）────────────────────────────────────
    if (url.pathname === '/api/env/scan' && req.method === 'GET') {
      const sess = currentSession(req);
      // 普通账户也能看，只是结果脱敏
      const isDev = sess?.role === 'developer';
      const force = url.searchParams.get('force') === '1';
      const now = Date.now();
      if (!force && envCache && now - envCache.at < 60 * 1000) {
        return send(res, 200, JSON.stringify(envCache.data));
      }
      try {
        const cfg = readJson(path.join(ROOT, 'config.json'), {});
        const data = await scanEnv({ root: ROOT, cfg });
        try { fs.writeFileSync(path.join(STATE, 'env-scan.json'), JSON.stringify(data, null, 2), 'utf8'); } catch {}
        log('环境扫描：' + data.items.filter((x) => !x.ok).length + ' 项未满足');
        envCache = { at: now, data };
        return send(res, 200, JSON.stringify(isDev ? data : redactEnv(data)));
      } catch (error) {
        return send(res, 500, JSON.stringify({ ok: false, msg: '扫描失败：' + error.message }));
      }
    }


    // ── 外观：公开读取，开发者切换 ───────────────────────────────────────
    if (url.pathname === '/api/ui' && req.method === 'GET') {
      const ui = readUi();
      return send(res, 200, JSON.stringify({ ok: true, icon: ui.icon || 'cocoa', icons: iconManifest() }));
    }

    if (url.pathname === '/api/ui' && req.method === 'POST') {
      const sess = currentSession(req);
      if (sess?.role !== 'developer') return send(res, 403, JSON.stringify({ ok: false, msg: '仅开发者可切换' }));
      const body = await readBody(req);
      const id = String(body.icon ?? '').replace(/[^a-z0-9-]/g, '');
      const found = iconManifest().find((x) => x.id === id);
      if (!found) return send(res, 400, JSON.stringify({ ok: false, msg: '没有这个图标' }));
      writeUi({ ...readUi(), icon: id });
      log('外观图标切换为:', found.name);

      // 同步桌面快捷方式（失败不影响面板）
      let shortcutOk = false;
      try {
        const ico = path.join(ICON_DIR, found.id + '.ico');
        const ps = [
          '$ws = New-Object -ComObject WScript.Shell',
          '$desk = [Environment]::GetFolderPath("Desktop")',
          '$lnk = $ws.CreateShortcut((Join-Path $desk "小鲸鱼.lnk"))',
          '$lnk.IconLocation = "' + ico.replace(/"/g, '') + ',0"',
          '$lnk.Save()',
          'Write-Output "ok"'
        ].join('; ');
        const { execFile } = await import('node:child_process');
        await new Promise((resolve) => {
          execFile('powershell', ['-NoProfile', '-Command', ps], { timeout: 8000, windowsHide: true }, (err, out) => {
            shortcutOk = !err && String(out).includes('ok');
            resolve();
          });
        });
      } catch {}

      return send(res, 200, JSON.stringify({ ok: true, icon: id, shortcutOk, msg: '已切换为「' + found.name + '」' + (shortcutOk ? '' : '（桌面快捷方式没更新成功，可手动右键改）') }));
    }

    // 更新日志（登录后可看）
    if (url.pathname === '/api/changelog' && req.method === 'GET') {
      let md = '';
      try { md = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8'); } catch { md = '# 更新日志\n\n还没有记录。'; }
      return send(res, 200, JSON.stringify({ markdown: md }));
    }

    if (url.pathname === '/api/profile' && req.method === 'GET') {
      const sess = currentSession(req);
      if (!sess) return send(res, 401, JSON.stringify({ ok: false, msg: '需要登录' }));
      if (sess.role === 'developer') return send(res, 200, JSON.stringify({ ok: true, developer: true, profile: null }));
      return send(res, 200, JSON.stringify({
        ok: true, developer: false, user: sess.user,
        profile: readProfile(sess.user),
        presets: { models: PRESET_MODELS, personas: PRESET_PERSONAS }
      }));
    }

    if (url.pathname === '/api/profile' && req.method === 'POST') {
      const sess = currentSession(req);
      if (!sess) return send(res, 401, JSON.stringify({ ok: false, msg: '需要登录' }));
      if (sess.role === 'developer') return send(res, 400, JSON.stringify({ ok: false, msg: '开发者请用「设置」里的全局配置' }));
      const body = await readBody(req);
      // 只接受白名单字段，且内容审核不可关（始终跟随全局）
      const patch = {};
      if (typeof body.personaText === 'string') {
        const bytes = Buffer.byteLength(body.personaText, 'utf8');
        if (bytes > LIMITS.personaBytes) {
          return send(res, 400, JSON.stringify({ ok: false, msg: '人格卡太大（' + bytes + ' 字节，上限 ' + LIMITS.personaBytes + '）' }));
        }
        patch.personaText = body.personaText;
      }
      if (body.behavior && typeof body.behavior === 'object') {
        const b = body.behavior;
        patch.behavior = {};
        if (['smart', 'mention', 'all'].includes(b.groupTrigger)) patch.behavior.groupTrigger = b.groupTrigger;
        if (Number.isFinite(Number(b.chime))) patch.behavior.chime = Math.max(0, Math.min(1, Number(b.chime)));
        if (typeof b.expressionOn === 'boolean') patch.behavior.expressionOn = b.expressionOn;
        if (Number.isFinite(Number(b.stickerChance))) patch.behavior.stickerChance = Math.max(0, Math.min(1, Number(b.stickerChance)));
        if (Number.isFinite(Number(b.faceChance))) patch.behavior.faceChance = Math.max(0, Math.min(1, Number(b.faceChance)));
        if (typeof b.voiceReply === 'boolean') patch.behavior.voiceReply = b.voiceReply;
      }
      if (typeof body.model === 'string') patch.model = PRESET_MODELS.some((m) => m.id === body.model) ? body.model : '';
      if (typeof body.personaName === 'string') patch.personaName = body.personaName.slice(0, 24);
      if (typeof body.qq === 'string') patch.qq = body.qq.replace(/\D/g, '').slice(0, 12);
      if (Array.isArray(body.trusted)) {
        patch.trusted = [...new Set(body.trusted.map((x) => String(x).replace(/\D/g, '')).filter((x) => x.length >= 5 && x.length <= 12))];
      }
      // memory 不再存进档案：统一写到 state/profiles/<用户名>/memory.json（/api/memory）
      const result = writeProfile(sess.user, patch);
      log('账户档案已更新:', sess.user);
      return send(res, result.ok ? 200 : 500, JSON.stringify(result));
    }

    if (url.pathname === '/api/personas' && req.method === 'GET') {
      const dir = path.join(ROOT, 'roles');
      const list = fs.existsSync(dir)
        ? fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => {
            const full = path.join(dir, f);
            const text = fs.readFileSync(full, 'utf8');
            return {
              name: f.replace(/\.md$/, ''),
              size: text.length,
              preview: text.replace(/\s+/g, ' ').slice(0, 60)
            };
          })
        : [];
      return send(res, 200, JSON.stringify({ list, active: readJson(path.join(STATE, 'current-role.json'), {}).role ?? null }));
    }

    if (url.pathname === '/api/personas/get' && req.method === 'GET') {
      const name = String(url.searchParams.get('name') ?? '').replace(/[^\w\u4e00-\u9fa5-]/g, '');
      const full = path.join(ROOT, 'roles', name + '.md');
      if (!name || !fs.existsSync(full)) return send(res, 404, JSON.stringify({ ok: false, msg: '没有这个人格卡' }));
      return send(res, 200, JSON.stringify({ ok: true, name, content: fs.readFileSync(full, 'utf8') }));
    }

    if (url.pathname === '/api/personas/save' && req.method === 'POST') {
      const body = await readBody(req);
      const name = String(body.name ?? '').trim().replace(/[^\w\u4e00-\u9fa5-]/g, '');
      const content = String(body.content ?? '');
      if (!name) return send(res, 400, JSON.stringify({ ok: false, msg: '人格卡要有个名字' }));
      if (content.trim().length < 10) return send(res, 400, JSON.stringify({ ok: false, msg: '内容太短了（至少 10 个字）' }));
      const bytes = Buffer.byteLength(content, 'utf8');
      if (bytes > LIMITS.personaBytes) {
        return send(res, 400, JSON.stringify({ ok: false, msg: '太长了（' + bytes + ' 字节，上限 ' + LIMITS.personaBytes + '）' }));
      }
      const dir = path.join(ROOT, 'roles');
      fs.mkdirSync(dir, { recursive: true });
      const full = path.join(dir, name + '.md');
      fs.writeFileSync(full, content, 'utf8');
      log('人格卡已保存:', name, content.length + ' 字');
      // 与「设定」联动：正在用的卡改了，设定跟着更新
      let synced = null;
      if (activePersonaName() === name) {
        synced = syncPersonaSettings(name, content);
      }
      return send(res, 200, JSON.stringify({
        ok: true,
        msg: '已保存「' + name + '」' + (synced?.ok ? '，' + synced.msg : (activePersonaName() === name ? '' : '（不是当前在用的卡，未同步设定）')),
        name,
        sync: synced
      }));
    }

    if (url.pathname === '/api/personas/delete' && req.method === 'POST') {
      const body = await readBody(req);
      const name = String(body.name ?? '').trim().replace(/[^\w\u4e00-\u9fa5-]/g, '');
      const full = path.join(ROOT, 'roles', name + '.md');
      if (!name || !fs.existsSync(full)) return send(res, 404, JSON.stringify({ ok: false, msg: '没有这个人格卡' }));
      const active = readJson(path.join(STATE, 'current-role.json'), {}).role;
      if (active === name) return send(res, 400, JSON.stringify({ ok: false, msg: '正在用这张卡，先切走再删' }));
      fs.unlinkSync(full);
      log('人格卡已删除:', name);
      return send(res, 200, JSON.stringify({ ok: true, msg: '已删除「' + name + '」' }));
    }

    if (url.pathname === '/api/persona' && req.method === 'GET') {
      const cfg = collectConfig();
      return send(res, 200, JSON.stringify(cfg.persona));
    }
    // 手动重跑"人格卡 → 设定"分析
    if (url.pathname === '/api/persona/sync' && req.method === 'POST') {
      const body = await readBody(req);
      const target = String(body.name ?? '').trim() || activePersonaName();
      const result = syncPersonaSettings(target, undefined);
      return send(res, result.ok ? 200 : 400, JSON.stringify(result));
    }

    if (url.pathname === '/api/persona' && req.method === 'POST') {
      const body = await readBody(req);
      const result = setPersona(body.name);
      const synced = result.ok ? syncPersonaSettings(body.name, undefined) : null;
      return send(res, 200, JSON.stringify({ ...result, sync: synced }));
    }
    if (url.pathname === '/api/memory' && req.method === 'GET') {
      // owner 只认会话：普通账户只能读自己的文件
      return send(res, 200, JSON.stringify(readMemory(memoryPathFor(currentSession(req)))));
    }
    if (url.pathname === '/api/memory' && req.method === 'POST') {
      const body = await readBody(req);
      // 忽略 body 里任何用户名字段，只用会话身份定位文件，防止 A 写 B
      return send(res, 200, JSON.stringify(memoryAction(body.op, body, memoryPathFor(currentSession(req)))));
    }
    if (url.pathname === '/api/stats') {
      const sess = currentSession(req);
      if (sess && sess.role !== 'developer') {
        // 普通用户只看自己的档案统计，看不到主人的 token 用量
        const p = readProfile(sess.user);
        return send(res, 200, JSON.stringify({
          ok: true, local: true, user: sess.user,
          mine: {
            memory: (p.memory ?? []).length,
            trusted: (p.trusted ?? []).length,
            personaChars: String(p.personaText ?? '').length,
            model: p.model || '',
            trigger: p.behavior?.groupTrigger ?? 'smart',
            chime: p.behavior?.chime ?? 0.18
          }
        }));
      }
      return send(res, 200, JSON.stringify(collectStats()));
    }
    if (url.pathname === '/api/help') {
      const mdPath = path.join(ROOT, '使用手册.md');
      let md = '';
      try { md = fs.readFileSync(mdPath, 'utf8'); } catch { md = '# 使用说明\n\n还没生成使用手册.md'; }
      return send(res, 200, JSON.stringify({ markdown: md }));
    }
    if (url.pathname === '/api/plugins') {
      return send(res, 200, JSON.stringify(listPlugins()));
    }
    if (url.pathname === '/api/restart-bridge' && req.method === 'POST') {
      return send(res, 200, JSON.stringify(await restartBridge()));
    }

    if (url.pathname === '/api/stop' && req.method === 'POST') {
      const target = url.searchParams.get('target') ?? 'bridge';
      return send(res, 200, JSON.stringify(await stop(target)));
    }

    // 静态文件：没登录只能看登录页（登录页自身不依赖登录）
  
  // 外观图片等静态资源（assets/ 下），公开只读
  if (url.pathname.startsWith('/assets/') && req.method === 'GET') {
    const rel = decodeURIComponent(url.pathname.slice('/assets/'.length));
    const full = path.join(ROOT, 'assets', rel);
    if (!full.startsWith(path.join(ROOT, 'assets'))) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(full) && fs.statSync(full).isFile()) {
      const ext = path.extname(full).toLowerCase();
      const type = ext === '.png' ? 'image/png' : ext === '.ico' ? 'image/x-icon' : ext === '.json' ? 'application/json' : 'application/octet-stream';
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' });
      return fs.createReadStream(full).pipe(res);
    }
    res.writeHead(404); return res.end();
  }

  const PUBLIC_FILES = new Set(['/login.html', '/guide.html']);
    if (!PUBLIC_FILES.has(url.pathname) && !currentSession(req)) {
      res.writeHead(302, { location: '/login.html' });
      return res.end();
    }
    let file = url.pathname === '/' ? '/panel.html' : url.pathname;
    file = path.join(ROOT, 'public', path.normalize(file).replace(/^([/\\])+/, ''));
    if (!file.startsWith(path.join(ROOT, 'public'))) return send(res, 403, 'forbidden', 'text/plain');
    if (!fs.existsSync(file)) return send(res, 404, 'not found', 'text/plain');
    return send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] ?? 'application/octet-stream');
  } catch (error) {
    log('请求出错:', error?.message ?? error);
    return send(res, 500, JSON.stringify({ ok: false, msg: String(error?.message ?? error) }));
  }
});

// ── 内置守护循环 ──────────────────────────────────────────────────────────
async function supervise() {
  lastSuperviseAt = Date.now();
  try {
    if (await probe(3100)) return;
    if (Date.now() - lastRestartAt < 60 * 1000) return;
    lastRestartAt = Date.now();
    restarts += 1;
    log('守护：桥接未运行，第 ' + restarts + ' 次拉起');
    await start('bridge');
  } catch (error) {
    log('守护检查出错:', error?.message ?? error);
  }
}
setInterval(supervise, 30 * 1000);


// ── SnowLuma WebUI 反代 ────────────────────────────────────────────────────
// 为什么要反代：SnowLuma 的 WebUI 返回 X-Frame-Options: DENY 和 frame-ancestors 'none'，
// 浏览器会拒绝把它放进 iframe。这里做一层同机反代，剥掉这两个头，前端就能内嵌。
const proxy = http.createServer((req, res) => {
  const upstream = http.request(
    { host: '127.0.0.1', port: SNOWLUMA_UI_PORT, path: req.url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${SNOWLUMA_UI_PORT}` } },
    (up) => {
      const headers = { ...up.headers };
      delete headers['x-frame-options'];
      delete headers['content-security-policy'];
      delete headers['content-security-policy-report-only'];
      res.writeHead(up.statusCode ?? 502, headers);
      up.pipe(res);
    }
  );
  upstream.on('error', (err) => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<div style="font:14px/1.7 微软雅黑;padding:28px;color:#456">SnowLuma 控制台没连上（${err.message}）。<br>先在面板上把 SnowLuma 启动起来。</div>`);
  });
  req.pipe(upstream);
});

// WebSocket 透传：SnowLuma 控制台靠 WS 推实时数据，不做这一步页面会一直转圈
proxy.on('upgrade', (req, socket, head) => {
  const target = net.connect(SNOWLUMA_UI_PORT, '127.0.0.1', () => {
    const headers = Object.entries(req.headers)
      .filter(([k]) => k !== 'host')
      .map(([k, v]) => `${k}: ${v}`)
      .join('\r\n');
    socket.write(`${req.method} ${req.url} HTTP/1.1\r\nhost: 127.0.0.1:${SNOWLUMA_UI_PORT}\r\n${headers}\r\n\r\n`);
    if (head && head.length) target.write(head);
    target.pipe(socket);
    socket.pipe(target);
  });
  target.on('error', () => socket.destroy());
  socket.on('error', () => target.destroy());
});

proxy.listen(SNOWLUMA_PROXY_PORT, '127.0.0.1', () => {
  log(`SnowLuma 控制台已内嵌：http://127.0.0.1:${SNOWLUMA_PROXY_PORT}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    log('端口 ' + PORT + ' 已被占用：面板可能已经在运行了（看托盘或任务管理器），本次退出');
  } else {
    log('面板启动失败：' + err.message);
  }
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  log(`控制台已启动：http://127.0.0.1:${PORT}`);
});
