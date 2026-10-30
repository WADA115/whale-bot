import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const state = path.join(root, 'state');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = path.join(state, `memory-backup-${stamp}`);
fs.mkdirSync(backup, { recursive: true });

const files = ['memory.json', 'context.json', 'social-v2.json', 'learning.json', 'sessions.json'];
for (const name of files) {
  const src = path.join(state, name);
  if (!fs.existsSync(src)) continue;
  fs.renameSync(src, path.join(backup, name));
  console.log('cleared', name);
}
for (const name of ['group-runtime.db', 'group-runtime.db-wal', 'group-runtime.db-shm']) {
  const src = path.join(state, name);
  try { if (fs.existsSync(src)) fs.unlinkSync(src); } catch {}
}
const dialogue = path.join(state, 'dialogue');
if (fs.existsSync(dialogue)) {
  const dest = path.join(backup, 'dialogue');
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(dialogue)) {
    if (!/^(events|turns)-.*\.jsonl$/.test(name)) continue;
    fs.renameSync(path.join(dialogue, name), path.join(dest, name));
    console.log('cleared dialogue/' + name);
  }
}
console.log('backup:', backup);
