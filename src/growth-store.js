// 成长 · 存储与概览（M1）
//
// 目录：state/growth/
//   raw/<date>.jsonl        插件收集的候选
//   kept/<date>.json        模型筛完保留的片段（30 天）
//   digests/<date>.json     日摘要（长期）
//   state.json              演化状态（M1 只有基座，不参与说话）
//   runs.json               判断运行记录（每天 2 次）
import fs from 'node:fs';
import path from 'node:path';

export const GROWTH_DIR = (root) => path.join(root, 'state', 'growth');
export const KEEP_DAYS = 30;

export function defaultState() {
  return {
    version: 1,
    traits: { openness: 3, conscientiousness: 3, extraversion: 3, agreeableness: 3, neuroticism: 3 },
    base: { openness: 3, conscientiousness: 3, extraversion: 3, agreeableness: 3, neuroticism: 3 },
    needs: { autonomy: 50, competence: 50, relatedness: 50 },
    attachment: { safety: 50, trust: 50, intimacy: 50 },
    energy: 60,
    mood: 0,
    stage: { id: 'new', since: Date.now(), progress: 0 },
    influence: { toneBias: 0, initiative: 0, expressiveness: 0, memoryWarmth: 0 },
    updatedAt: 0
  };
}

export function ensureDirs(root) {
  const base = GROWTH_DIR(root);
  for (const d of ['raw', 'kept', 'digests']) {
    fs.mkdirSync(path.join(base, d), { recursive: true });
  }
  return base;
}

export function readState(root) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(GROWTH_DIR(root), 'state.json'), 'utf8'));
    return { ...defaultState(), ...raw };
  } catch { return defaultState(); }
}

export function writeState(root, state) {
  try {
    ensureDirs(root);
    fs.writeFileSync(path.join(GROWTH_DIR(root), 'state.json'), JSON.stringify({ ...state, updatedAt: Date.now() }, null, 2), 'utf8');
  } catch {}
}

export function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

export function readRaw(root, date) {
  const file = path.join(GROWTH_DIR(root), 'raw', date + '.jsonl');
  const items = [];
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { items.push(JSON.parse(line)); } catch {}
    }
  } catch {}
  return items;
}

export function readKept(root, date) {
  return readJson(path.join(GROWTH_DIR(root), 'kept', date + '.json'), []);
}

export function readDigest(root, date) {
  return readJson(path.join(GROWTH_DIR(root), 'digests', date + '.json'), null);
}

export function listDates(root, kind) {
  try {
    return fs.readdirSync(path.join(GROWTH_DIR(root), kind))
      .map((f) => f.replace(/\.(json|jsonl)$/, ''))
      .filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x))
      .sort()
      .reverse();
  } catch { return []; }
}

/** 清掉超过 KEEP_DAYS 的 kept 原文（日摘要保留）。 */
export function pruneKept(root, days = KEEP_DAYS) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const date of listDates(root, 'kept')) {
    if (new Date(date + 'T00:00:00Z').getTime() < cutoff) {
      try {
        fs.rmSync(path.join(GROWTH_DIR(root), 'kept', date + '.json'), { force: true });
        removed += 1;
      } catch {}
    }
  }
  return removed;
}

export function readRuns(root) {
  return readJson(path.join(GROWTH_DIR(root), 'runs.json'), { runs: [] });
}

export function writeRuns(root, data) {
  try {
    ensureDirs(root);
    fs.writeFileSync(path.join(GROWTH_DIR(root), 'runs.json'), JSON.stringify(data, null, 2), 'utf8');
  } catch {}
}

/** 最近 N 天的 kept（缺的日期跳过）。 */
export function readWeekKept(root, days = 7) {
  const out = {};
  const now = Date.now();
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const items = readKept(root, d);
    if (items.length || i === 0) out[d] = items;
  }
  return out;
}

/** 历史累计：最早日期、总条数。 */
export function readTotals(root) {
  const dates = listDates(root, 'kept');
  let events = 0;
  for (const d of dates) events += readKept(root, d).length;
  return {
    days: dates.length,
    events,
    firstDate: dates.length ? dates[dates.length - 1] : null
  };
}

export function listSnapshots(root) {
  try {
    const dir = path.join(GROWTH_DIR(root), 'snapshots');
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''))
      .sort()
      .reverse();
  } catch { return []; }
}

export function writeSnapshot(root, state, meta = {}) {
  try {
    const dir = path.join(GROWTH_DIR(root), 'snapshots');
    fs.mkdirSync(dir, { recursive: true });
    const id = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(path.join(dir, id + '.json'), JSON.stringify({ id, at: Date.now(), state, meta }, null, 2), 'utf8');
    return id;
  } catch { return null; }
}

export function readSnapshot(root, id) {
  if (!/^[\w.-]+$/.test(String(id))) return null;
  return readJson(path.join(GROWTH_DIR(root), 'snapshots', id + '.json'), null);
}

export function readEvolutions(root) {
  return readJson(path.join(GROWTH_DIR(root), 'evolutions.json'), { list: [] });
}

export function writeEvolutions(root, data) {
  try {
    ensureDirs(root);
    fs.writeFileSync(path.join(GROWTH_DIR(root), 'evolutions.json'), JSON.stringify(data, null, 2), 'utf8');
  } catch {}
}

export function overview(root) {
  const state = readState(root);
  const today = new Date().toISOString().slice(0, 10);
  const rawToday = readRaw(root, today);
  const keptToday = readKept(root, today);
  const digestToday = readDigest(root, today);
  const keptDates = listDates(root, 'kept').slice(0, 7);
  const recentKept = keptDates.flatMap((d) => readKept(root, d).slice(0, 10).map((x) => ({ ...x, date: d }))).slice(0, 30);
  const digests = listDates(root, 'digests').slice(0, 7).map((d) => readDigest(root, d)).filter(Boolean);
  const runs = readRuns(root).runs.slice(-5);
  return {
    ok: true,
    date: today,
    stats: {
      rawToday: rawToday.length,
      keptToday: keptToday.length,
      keptAll: listDates(root, 'kept').length,
      digestChars: digestToday?.text?.length ?? 0,
      pruneDays: KEEP_DAYS
    },
    state,
    kept: recentKept,
    digests,
    runs
  };
}
