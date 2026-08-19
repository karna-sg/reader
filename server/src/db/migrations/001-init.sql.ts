// Initial schema as a single idempotent DDL string. Executed via db.exec() on
// startup. FTS5 (items_fts) is external-content over items, kept in sync by
// triggers. Default labels are seeded with INSERT OR IGNORE.
export const INIT_SQL = /* sql */ `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
INSERT OR IGNORE INTO meta(key, value) VALUES ('row_version', 0);

CREATE TABLE IF NOT EXISTS sources (
  id               TEXT PRIMARY KEY,
  kind             TEXT NOT NULL,
  title            TEXT NOT NULL,
  config           TEXT NOT NULL,
  full_text        TEXT NOT NULL DEFAULT 'excerpt',
  authority        REAL NOT NULL DEFAULT 0.6,
  poll_interval_ms INTEGER NOT NULL DEFAULT 900000,
  etag             TEXT,
  last_modified    TEXT,
  last_fetched_at  INTEGER,
  last_status      TEXT,
  enabled          INTEGER NOT NULL DEFAULT 1,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS labels (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  min_score  REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS source_labels (
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  label_id  TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  PRIMARY KEY (source_id, label_id)
);

CREATE TABLE IF NOT EXISTS items (
  id              TEXT PRIMARY KEY,
  source_id       TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  source_kind     TEXT NOT NULL,
  external_id     TEXT NOT NULL,
  url             TEXT NOT NULL,
  canonical_url   TEXT NOT NULL,
  title           TEXT NOT NULL,
  author          TEXT,
  body_html       TEXT,
  body_text       TEXT,
  body_tier       TEXT NOT NULL DEFAULT 'excerpt',
  content_hash    TEXT NOT NULL,
  published_at    INTEGER,
  fetched_at      INTEGER NOT NULL,
  hn_points       INTEGER,
  hn_comments     INTEGER,
  reddit_upvotes  INTEGER,
  reddit_comments INTEGER,
  yt_views        INTEGER,
  read_at         INTEGER,
  bookmarked_at   INTEGER,
  row_version     INTEGER NOT NULL,
  deleted_at      INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_items_canonical ON items(canonical_url);
CREATE INDEX IF NOT EXISTS idx_items_content_hash ON items(content_hash);
CREATE INDEX IF NOT EXISTS idx_items_source ON items(source_id);
CREATE INDEX IF NOT EXISTS idx_items_row_version ON items(row_version);
CREATE INDEX IF NOT EXISTS idx_items_published ON items(published_at);

CREATE TABLE IF NOT EXISTS item_labels (
  item_id    TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  label_id   TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  confidence REAL NOT NULL DEFAULT 0,
  origin     TEXT NOT NULL DEFAULT 'rule',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (item_id, label_id)
);
CREATE INDEX IF NOT EXISTS idx_item_labels_label ON item_labels(label_id);

CREATE TABLE IF NOT EXISTS fetch_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id   TEXT NOT NULL,
  started_at  INTEGER NOT NULL,
  finished_at INTEGER,
  status      TEXT NOT NULL DEFAULT 'ok',
  items_seen  INTEGER NOT NULL DEFAULT 0,
  items_new   INTEGER NOT NULL DEFAULT 0,
  error       TEXT
);

-- Full-text search over items (title + body_text), external content.
CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
  title,
  body,
  content='items',
  content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS items_ai AFTER INSERT ON items BEGIN
  INSERT INTO items_fts(rowid, title, body)
  VALUES (new.rowid, new.title, coalesce(new.body_text, ''));
END;
CREATE TRIGGER IF NOT EXISTS items_ad AFTER DELETE ON items BEGIN
  INSERT INTO items_fts(items_fts, rowid, title, body)
  VALUES ('delete', old.rowid, old.title, coalesce(old.body_text, ''));
END;
CREATE TRIGGER IF NOT EXISTS items_au AFTER UPDATE ON items BEGIN
  INSERT INTO items_fts(items_fts, rowid, title, body)
  VALUES ('delete', old.rowid, old.title, coalesce(old.body_text, ''));
  INSERT INTO items_fts(rowid, title, body)
  VALUES (new.rowid, new.title, coalesce(new.body_text, ''));
END;

-- Default labels (wireframe taxonomy). Idempotent.
INSERT OR IGNORE INTO labels(id, name, position, min_score, created_at, updated_at) VALUES
  ('startup',     'Startup',             1, 0, 0, 0),
  ('ai-ml',       'AI / ML',             2, 0, 0, 0),
  ('engineering', 'Engineering',         3, 0, 0, 0),
  ('product',     'Product',             4, 0, 0, 0),
  ('design',      'Design',              5, 0, 0, 0),
  ('investing',   'Investing',           6, 0, 0, 0),
  ('career',      'Career',              7, 0, 0, 0),
  ('science',     'Science',             8, 0, 0, 0);
`;
