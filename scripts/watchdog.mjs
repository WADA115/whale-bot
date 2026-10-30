// 服务看门狗：只负责“发现不在 → 启动”，不杀正在启动的进程。
// 运行：node scripts/watchdog.mjs
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readSecret } from '../src/secrets.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const STATE = path.join(ROOT, 'state', 'watchdog');
const LOG = path.join(ROOT, 'state', 'logs', 'watchdog.log');
const PID = path.join(STATE, 'watchdog.pid');
const STATUS = path.join(STATE, 'status.json');
fs.mkdirSync(STATE, { recursive: true });
if (!process.env.DEEPSEEK_API_KEY) {
  const secret = readSecret(ROOT);
  if (secret) process.env.DEEPSEEK_API_KEY = secret;
}

function log(line) {
  const text = `[${new Date().toISOString()}] ${line}`;
  try { fs.appendFileSync(LOG, text + '\n', 'utf8'); } catch {}
  console.log(text);
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

if (fs.existsSync(PID)) {
  const old = Number(fs.readFileSync(PID, 'utf8'));
  if (old && alive(old)) { console.log('watchdog already running', old); process.exit(0); }
}
fs.writeFileSync(PID, String(process.pid));

function portOpen(port, host = '127.0.0.1', timeoutMs = 800) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    let done = false;
    const finish = (ok) => { if (done) return; done = true; socket.destroy(); resolve(ok); };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

async function httpOk(url, timeoutMs = 3000) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch { return false; }
}

function startProcess(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd || ROOT,
    env: { ...process.env, ...(options.env || {}) },
    detached: true,
    windowsHide: true,
    stdio: 'ignore'
  });
  child.unref();
  return child;
}

const services = [
  {
    name: 'snowluma',
    label: 'SnowLuma',
    check: async () => (await portOpen(3000)) && (await portOpen(3001)),
    start: () => startProcess('cmd.exe', ['/c', 'launcher.bat'], { cwd: 'E:\\新建文件夹 (3)' }),
    graceMs: 300000,
    minGapMs: 30000
  },
  {
    name: 'ollama',
    label: 'Ollama',
    check: async () => await httpOk('http://127.0.0.1:11434/api/version'),
    start: () => startProcess('E:\\ollama\\app\\ollama.exe', ['serve'], { env: { OLLAMA_MODELS: 'E:\\ollama\\models' } }),
    graceMs: 45000,
    minGapMs: 20000
  },
  {
    name: 'panel',
    label: 'panel',
    check: async () => await portOpen(3200),
    start: () => startProcess(process.execPath, ['app.js'], { cwd: ROOT }),
    graceMs: 60000,
    minGapMs: 30000
  },
  {
    name: 'bridge',
    label: 'bridge',
    check: async () => await portOpen(3100),
    start: null, // 桥接由 app.js 内置守护负责，避免双守护抢启动
    graceMs: 60000,
    minGapMs: 20000
  }
];

const state = {
  startedAt: Date.now(),
  services: Object.fromEntries(services.map((s) => [s.name, {
    status: 'unknown', healthy: false, lastCheckAt: 0, lastHealthyAt: 0,
    lastStartAt: 0, starts: 0, lastError: ''
  }]))
};

function save() {
  try { fs.writeFileSync(path.join(ROOT, 'state', 'watchdog.beat'), String(Date.now()), 'utf8'); } catch {}
  try {
    fs.writeFileSync(STATUS + '.tmp', JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(STATUS + '.tmp', STATUS);
  } catch {}
}

async function tick() {
  const now = Date.now();
  for (const svc of services) {
    const st = state.services[svc.name];
    st.lastCheckAt = now;
    let healthy = false;
    try { healthy = await svc.check(); } catch (error) { st.lastError = String(error?.message ?? error); }
    if (healthy) {
      if (!st.healthy) log(`${svc.label} 恢复`);
      st.healthy = true;
      st.status = 'up';
      st.lastHealthyAt = now;
      st.lastError = '';
      continue;
    }
    st.healthy = false;
    const sinceStart = now - st.lastStartAt;
    if (sinceStart < svc.graceMs) {
      st.status = 'starting';
      continue;
    }
    if (sinceStart < svc.minGapMs) { st.status = 'backoff'; continue; }
    if (!svc.start) { st.status = 'monitored'; continue; }
    try {
      svc.start();
      st.lastStartAt = now;
      st.starts += 1;
      st.status = 'started';
      log(`${svc.label} 不在，已启动（第 ${st.starts} 次）`);
    } catch (error) {
      st.lastError = String(error?.message ?? error);
      st.status = 'start-failed';
      log(`${svc.label} 启动失败：${st.lastError}`);
    }
  }
  save();
}

log('watchdog started');
await tick();
const interval = Math.max(5000, Number(process.env.WATCHDOG_INTERVAL_MS) || 15000);
setInterval(() => { void tick(); }, interval);
process.on('SIGINT', () => { try { fs.unlinkSync(PID); } catch {} process.exit(0); });
process.on('SIGTERM', () => { try { fs.unlinkSync(PID); } catch {} process.exit(0); });
