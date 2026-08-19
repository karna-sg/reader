// Delta sync: items whose row_version > cursor, newest-version first, capped per
// page, each with its current label ids and a deleted flag (tombstone). The app
// upserts these into its offline cache and advances the cursor.
import type { Db } from "../db/db.js";
import type { ItemsTable } from "../db/schema.js";

export interface SyncItem {
  id: string;
  source_id: string;
  source_kind: string;
  url: string;
  title: string;
  author: string | null;
  body_tier: string;
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
  deleted: boolean;
  label_ids: string[];
}

export interface SyncResult {
  cursor: number;
  items: SyncItem[];
  has_more: boolean;
}

export function syncDelta(db: Db, since: number, limit = 500): SyncResult {
  const rows = db.raw
    .prepare(
      `SELECT * FROM items WHERE row_version > ? ORDER BY row_version ASC LIMIT ?`,
    )
    .all(since, limit) as unknown as ItemsTable[];

  const labelStmt = db.raw.prepare("SELECT label_id FROM item_labels WHERE item_id = ?");
  const items: SyncItem[] = rows.map((r) => {
    const labelRows = labelStmt.all(r.id) as { label_id: string }[];
    return {
      id: r.id,
      source_id: r.source_id,
      source_kind: r.source_kind,
      url: r.url,
      title: r.title,
      author: r.author,
      body_tier: r.body_tier,
      published_at: r.published_at,
      fetched_at: r.fetched_at,
      hn_points: r.hn_points,
      hn_comments: r.hn_comments,
      reddit_upvotes: r.reddit_upvotes,
      reddit_comments: r.reddit_comments,
      yt_views: r.yt_views,
      read_at: r.read_at,
      bookmarked_at: r.bookmarked_at,
      row_version: r.row_version,
      deleted: r.deleted_at !== null,
      label_ids: labelRows.map((l) => l.label_id),
    };
  });

  const cursor = items.length ? (items[items.length - 1] as SyncItem).row_version : since;
  return { cursor, items, has_more: items.length === limit };
}
