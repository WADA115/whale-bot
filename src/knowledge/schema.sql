-- 本地知识库 / 对话账本 schema（SQLite WAL + FTS5）
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT DEFAULT '',
  author_hash TEXT DEFAULT '',
  published_at INTEGER DEFAULT 0,
  fetched_at INTEGER NOT NULL,
  robots_ok INTEGER DEFAULT 0,
  license TEXT DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sources_url ON sources(platform, url);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL,
  lang TEXT DEFAULT 'zh',
  text TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  quality_score REAL DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(source_id) REFERENCES sources(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_hash ON documents(content_hash);

CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL,
  ord INTEGER NOT NULL,
  text TEXT NOT NULL,
  token_count INTEGER DEFAULT 0,
  embedding BLOB,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(document_id) REFERENCES documents(id)
);
CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks(document_id);

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  text, content='chunks', content_rowid='id', tokenize='trigram'
);

CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES('delete', old.id, old.text);
END;
CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES('delete', old.id, old.text);
  INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text);
END;

CREATE TABLE IF NOT EXISTS slang (
  term TEXT PRIMARY KEY,
  meaning TEXT DEFAULT '',
  evidence TEXT DEFAULT '',
  confidence REAL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS style_profiles (
  scope TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS crawl_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL,
  topic TEXT DEFAULT '',
  status TEXT NOT NULL,
  pages INTEGER DEFAULT 0,
  chunks INTEGER DEFAULT 0,
  started_at INTEGER NOT NULL,
  finished_at INTEGER DEFAULT 0,
  error TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS learning_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version TEXT NOT NULL,
  status TEXT NOT NULL,
  sources INTEGER DEFAULT 0,
  documents INTEGER DEFAULT 0,
  chunks INTEGER DEFAULT 0,
  started_at INTEGER NOT NULL,
  finished_at INTEGER DEFAULT 0,
  error TEXT DEFAULT ''
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
