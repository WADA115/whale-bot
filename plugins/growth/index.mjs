// 成长插件 · M1：只收集，不改变任何说话方式。
//
// 做三件事：
//   1. 去噪：单字、纯表情、纯符号、命令回执直接丢
//   2. 去重：完全重复 / 最近说过的近似文本不再记
//   3. 候选：每 30~50 条挑出「可能有点东西」的片段，写到 state/growth/raw/<日期>.jsonl
//
// 真正的模型判断在面板进程里（每天 2 次），这里只做零成本的规则筛选。
import fs from 'node:fs';
import path from 'node:path';

const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const DIR = path.join(repo, 'state', 'growth', 'raw');
const SEEN = path.join(repo, 'state', 'growth', 'seen.json');
const LIMIT_PER_DAY = 300;
const SIMILAR_KEEP = 200;

const NOISE = /^(嗯+|哦+|好+|行|可|可以|哈+|呵+|嘿+|草|6+|？+|\?+|。+|…+|收到|ok|OK)$/i;

function dayKey(ts = Date.now()) {
  return new Date(ts).toISOString().slice(0, 10);
}

function loadSeen() {
  try {
    const raw = JSON.parse(fs.readFileSync(SEEN, 'utf8'));
    return { hashes: Array.isArray(raw.hashes) ? raw.hashes.slice(-SIMILAR_KEEP) : [] };
  } catch { return { hashes: [] }; }
}

function saveSeen(seen) {
  try {
    fs.mkdirSync(path.dirname(SEEN), { recursive: true });
    fs.writeFileSync(SEEN, JSON.stringify({ hashes: seen.hashes.slice(-SIMILAR_KEEP) }), 'utf8');
  } catch {}
}

function fingerprint(text) {
  return text
    .replace(/[\s，。！？、,.!?~～…（）()【】\[\]"'“”‘’]/g, '')
    .toLowerCase()
    .slice(0, 60);
}

function countToday(file) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length;
  } catch { return 0; }
}

export function onInbound(ctx) {
  try {
    const text = String(ctx?.text ?? '').trim();
    if (!text || text.length < 6) return null;
    if (NOISE.test(text)) return null;
    if (!/[\u4e00-\u9fa5a-zA-Z]/.test(text)) return null;      // 纯表情/符号
    if (text.length > 500) return null;

    const fp = fingerprint(text);
    if (!fp) return null;
    const seen = loadSeen();
    if (seen.hashes.includes(fp)) return null;

    const file = path.join(DIR, dayKey() + '.jsonl');
    if (countToday(file) >= LIMIT_PER_DAY) return null;

    fs.mkdirSync(DIR, { recursive: true });
    fs.appendFileSync(file, JSON.stringify({
      ts: Date.now(),
      key: String(ctx?.key ?? ''),
      text: text.slice(0, 300)
    }) + '\n', 'utf8');

    seen.hashes.push(fp);
    saveSeen(seen);
  } catch {
    // 成长插件永远不能影响主流程
  }
  return null;
}
