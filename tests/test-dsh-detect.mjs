// 验证「DSH 端口自愈」用的探测逻辑（与 bridge.js 里的 detectLiveDshUrl 同源）。
import { execFileSync } from 'node:child_process';

function detectLiveDshUrl() {
  try {
    const tasks = execFileSync('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8', timeout: 8000, windowsHide: true });
    const pids = new Set();
    for (const line of String(tasks).split(/\r?\n/)) {
      const m = /^"([^"]+)","(\d+)"/.exec(line.trim());
      if (m && /DeepSeek Harness/i.test(m[1])) pids.add(Number(m[2]));
    }
    if (!pids.size) return { url: null, pids: [], ports: [] };
    const net = execFileSync('netstat', ['-ano'], { encoding: 'utf8', timeout: 8000, windowsHide: true });
    const ports = [];
    for (const line of String(net).split(/\r?\n/)) {
      const m = /^\s*TCP\s+127\.0\.0\.1:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i.exec(line);
      if (!m) continue;
      const port = Number(m[1]);
      if (port < 1024 || port === 3000 || port === 3001 || port === 3100) continue;
      if (!pids.has(Number(m[2]))) continue;
      ports.push(port);
    }
    return { url: ports.length ? `http://127.0.0.1:${ports[0]}` : null, pids: [...pids], ports };
  } catch (error) {
    return { url: null, error: String(error?.message ?? error) };
  }
}

const r = detectLiveDshUrl();
console.log('探测结果:', JSON.stringify(r));
console.log('当前 DSH_WEB_URL:', process.env.DSH_WEB_URL || '(未设置)');
console.log(r.url && r.url === (process.env.DSH_WEB_URL || '').replace(/\/+$/, '') ? '✅ 一致' : '⚠️ 不一致或未探测到');
