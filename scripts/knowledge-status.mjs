import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readReady } from '../src/knowledge/ready.js';
import { openKnowledgeDb, knowledgeStats } from '../src/knowledge/db.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const stateDir = path.join(root, 'state');
const ready = readReady(stateDir);
console.log('READY:', ready ? JSON.stringify(ready, null, 2) : 'none');
const dbPath = ready?.dbPath || path.join(stateDir, 'knowledge', 'knowledge.db');
if (fs.existsSync(dbPath)) {
  const db = openKnowledgeDb(dbPath);
  console.log('stats:', knowledgeStats(db));
  db.close();
} else {
  console.log('db: not found', dbPath);
}
