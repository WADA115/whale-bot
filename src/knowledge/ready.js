import fs from 'node:fs';
import path from 'node:path';

export function readReady(stateDir) {
  try {
    const file = path.join(stateDir, 'knowledge', 'READY.json');
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { return null; }
}

export function writeReady(stateDir, payload) {
  const dir = path.join(stateDir, 'knowledge');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'READY.json');
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

export function clearReady(stateDir) {
  try { fs.unlinkSync(path.join(stateDir, 'knowledge', 'READY.json')); } catch {}
}
