-- 群聊运行态：每群版本、最近消息、图片引用、发言冷却。
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS group_state (
  group_id TEXT PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 0,
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
