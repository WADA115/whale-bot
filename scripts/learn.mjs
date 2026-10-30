import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runLearning } from '../src/knowledge/learn.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const get = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const minutes = Number(get('minutes', '90')) || 90;
const topics = String(get('topics', '小鲸鱼,QQ机器人,DeepSeek')).split(',').map((s) => s.trim()).filter(Boolean);
const maxVideos = Number(get('max-videos', '20')) || 20;
const relatedSeeds = String(get('related', '')).split(',').map((s) => s.trim()).filter(Boolean);
const platforms = String(get('platforms', 'deepseek')).split(',').map((s) => s.trim()).filter(Boolean);
const stateDir = path.join(root, 'state');
const enable = args.includes('--enable');
const manualPath = get('manual', '');
const manualDocs = [];
if (manualPath && fs.existsSync(manualPath)) {
  const stat = fs.statSync(manualPath);
  const files = stat.isDirectory()
    ? fs.readdirSync(manualPath).filter((f) => /\.(txt|md|json)$/i.test(f)).map((f) => path.join(manualPath, f))
    : [manualPath];
  for (const file of files) {
    if (/(^|[\\\\/])(config\\.json|secrets\\.json|\\.env.*)$/i.test(file)) { console.log('[learn] skip secret-like file: ' + file); continue; }
    try {
      const text = fs.readFileSync(file, 'utf8');
      if (text.trim()) manualDocs.push({ platform: 'manual', url: 'file:///' + file.split('\\').join('/'), title: path.basename(file), text });
    } catch {}
  }
  console.log('[learn] manual docs=' + manualDocs.length);
}
const dbPath = path.join(stateDir, 'knowledge', 'knowledge.db');

console.log(`[learn] topics=${topics.join(' / ')} minutes=${minutes} platforms=${platforms.join(',')}`);
const result = await runLearning({
  stateDir,
  dbPath,
  topics,
  minutes,
  maxVideos,
  platforms,
  manualDocs,
  relatedSeeds,
  log: (line) => console.log(line)
});
console.log(JSON.stringify(result, null, 2));
if (result.ok && enable) {
  const cfgPath = path.join(root, 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.knowledge = { ...(cfg.knowledge ?? {}), enabled: true, ...(result.dbPath ? { dbPath: result.dbPath } : {}) };
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  console.log('[learn] 已启用 knowledge.enabled=true');
}
process.exit(result.ok ? 0 : 1);
