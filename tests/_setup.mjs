// 测试公共初始化：确保 state/ 和最小 memory.json 存在（干净 clone 也能跑）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const EMPTY_MEMORY = {
  long: { facts: [], keywords: [], settings: [] },
  short: { facts: [], keywords: [] },
  summaries: {}
};

export function ensureState() {
  const dir = path.join(ROOT, 'state');
  fs.mkdirSync(dir, { recursive: true });
  const mem = path.join(dir, 'memory.json');
  if (!fs.existsSync(mem)) {
    fs.writeFileSync(mem, JSON.stringify(EMPTY_MEMORY, null, 2), 'utf8');
  }
  return dir;
}
