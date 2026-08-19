// Kysely table interfaces for the compile-only query builder. Columns mirror the
// DDL in migrations/. `null` in engagement columns means "signal not applicable
// to this source class"; a real 0 is a rankable value.

export type SourceKindDb = "rss" | "hackernews" | "reddit" | "youtube" | "arxiv" | "github";
export type BodyTierDb = "excerpt" | "extract" | "render";
export type FullTextPolicy = "excerpt" | "extract" | "render";
export type TagOrigin = "rule" | "llm";

export interface SourcesTable {
  id: string;
  kind: SourceKindDb;
  title: string;
  /** kind-specific JSON (feed_url, ua_profile, channel_id, subreddit, …). */
  config: string;
  full_text: FullTextPolicy;
  authority: number;
  poll_interval_ms: number;
  etag: string | null;
  last_modified: string | null;
  last_fetched_at: number | null;
  last_status: string | null;
  enabled: number; // 0/1
  created_at: number;
  updated_at: number;
}

export interface LabelsTable {
  id: string;
  name: string;
  position: number;
  min_score: number;
  created_at: number;
  updated_at: number;
}

export interface SourceLabelsTable {
  source_id: string;
  label_id: string;
}

export interface ItemsTable {
  id: string;
  source_id: string;
  source_kind: SourceKindDb;
  external_id: string;
  url: string;
  canonical_url: string;
  title: string;
  author: string | null;
  body_html: string | null;
  body_text: string | null;
  body_tier: BodyTierDb;
  content_hash: string;
  published_at: number | null;
  fetched_at: number;
  hn_points: number | null;
  hn_comments: number | null;
  reddit_upvotes: number | null;
  reddit_comments: number | null;
  yt_views: number | null;
  read_at: number | null;
  bookmarked_at: number | null;
  row_version: number;
  deleted_at: number | null;
}

export interface ItemLabelsTable {
  item_id: string;
  label_id: string;
  confidence: number;
  origin: TagOrigin;
  created_at: number;
}

export interface FetchRunsTable {
  id: number;
  source_id: string;
  started_at: number;
  finished_at: number | null;
  status: string;
  items_seen: number;
  items_new: number;
  error: string | null;
}

export interface MetaTable {
  key: string;
  value: number;
}

export interface Database {
  sources: SourcesTable;
  labels: LabelsTable;
  source_labels: SourceLabelsTable;
  items: ItemsTable;
  item_labels: ItemLabelsTable;
  fetch_runs: FetchRunsTable;
  meta: MetaTable;
}
