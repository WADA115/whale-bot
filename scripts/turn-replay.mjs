import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTurnLedger } from '../src/kernel/turn-ledger.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const chat = args.find((a) => a.startsWith('--chat='))?.slice(7) || 'private:1260304613';
const id = args.find((a) => a.startsWith('--id='))?.slice(5) || '';
const limit = Number(args.find((a) => a.startsWith('--limit='))?.slice(8)) || 10;
const ledger = createTurnLedger({ dbPath: path.join(root, 'state', 'runtime.db') });

if (id) {
  const row = ledger.get(id);
  console.log(JSON.stringify(row, null, 2));
} else {
  const rows = ledger.recent(chat, limit);
  for (const row of rows.reverse()) {
    console.log(`${row.turn_id} v${row.version} ${row.action} ${row.outcome}`);
    const got = ledger.get(row.turn_id);
    for (const e of got.events) console.log(`  ${e.seq} ${e.stage} ${String(e.payload).slice(0, 160)}`);
  }
}
ledger.close();
