import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const file = path.join(ROOT, 'state', 'watchdog', 'status.json');
if (!fs.existsSync(file)) {
  console.log('watchdog: 未运行（没有 status.json）');
  process.exit(0);
}
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const now = Date.now();
console.log('watchdog uptime:', Math.round((now - data.startedAt) / 1000) + 's');
for (const [name, st] of Object.entries(data.services || {})) {
  console.log(`${name.padEnd(10)} ${String(st.status).padEnd(12)} healthy=${st.healthy} starts=${st.starts}`);
  if (st.lastError) console.log('  error:', st.lastError);
}
