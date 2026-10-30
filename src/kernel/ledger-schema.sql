-- 对话账本：每轮一个 turn，事件追加，提交带乐观锁。
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS chat_state (
  chat TEXT PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS turn_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  turn_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  stage TEXT NOT NULL,
  payload TEXT DEFAULT '',
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_turn_events_turn ON turn_events(turn_id, seq);

CREATE TABLE IF NOT EXISTS chat_notes (
  chat TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(chat, key)
);

CREATE TABLE IF NOT EXISTS turns (
  turn_id TEXT PRIMARY KEY,
  chat TEXT NOT NULL,
  version INTEGER NOT NULL,
  action TEXT NOT NULL,
  messages TEXT DEFAULT '',
  evidence TEXT DEFAULT '',
  standards TEXT DEFAULT '',
  outcome TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_turns_chat_version ON turns(chat, version);
CREATE INDEX IF NOT EXISTS idx_turns_chat_created ON turns(chat, created_at);
