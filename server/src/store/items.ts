// Item persistence: dedup-enforcing upsert (id / canonical_url / content_hash),
// body upgrade after extraction, label assignment, user-state mutations, feed
// candidate selection, item detail, and FTS search. Single-writer; row_version
// is bumped whenever the app needs to observe a change via /sync.
import type { Db } from "../db/db.js";
import type { ItemsTable } from "../db/schema.js";
import type { Item, SourceKind } from "../model/item.js";

export type UpsertOutcome = "new" | "updated" | "unchanged" | "duplicate";

interface ExistingEngagement {
  title: string;
  hn_points: number | null;
  hn_comments: number | null;
  reddit_upvotes: number | null;
  reddit_comments: number | null;
  yt_views: number | null;
}

export function upsertItem(db: Db, item: Item): UpsertOutcome {
  const existing = db.raw
    .prepare(
      `SELECT title, hn_points, hn_comments, reddit_upvotes, reddit_comments, yt_views
       FROM items WHERE id = ?`,
    )
    .get(item.id) as ExistingEngagement | undefined;

  if (existing) {
    const changed =
      existing.title !== item.title ||
      existing.hn_points !== item.hn_points ||
      existing.hn_comments !== item.hn_comments ||
      existing.reddit_upvotes !== item.reddit_upvotes ||
      existing.reddit_comments !== item.reddit_comments ||
      existing.yt_views !== item.yt_views;
    if (!changed) return "unchanged";
    const rv = db.nextRowVersion();
    db.raw
      .prepare(
        `UPDATE items SET title = ?, hn_points = ?, hn_comments = ?, reddit_upvotes = ?,
           reddit_comments = ?, yt_views = ?, row_version = ? WHERE id = ?`,
      )
      .run(
        item.title,
        item.hn_points,
        item.hn_comments,
        item.reddit_upvotes,
        item.reddit_comments,
        item.yt_views,
        rv,
        item.id,
      );
    return "updated";
  }

  // Cross-source duplicate by canonical URL or content hash → skip (keep first).
  const dup = db.raw
    .prepare("SELECT id FROM items WHERE canonical_url = ? OR content_hash = ? LIMIT 1")
    .get(item.canonical_url, item.content_hash) as { id: string } | undefined;
  if (dup) return "duplicate";

  const rv = db.nextRowVersion();
  db.raw
    .prepare(
      `INSERT INTO items
        (id, source_id, source_kind, external_id, url, canonical_url, title, author,
         body_html, body_text, body_tier, content_hash, published_at, fetched_at,
         hn_points, hn_comments, reddit_upvotes, reddit_comments, yt_views,
         read_at, bookmarked_at, row_version, deleted_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,?,NULL)`,
    )
    .run(
      item.id,
      item.source_id,
      item.source_kind,
      item.external_id,
      item.url,
      item.canonical_url,
      item.title,
      item.author,
      item.body_html,
      item.body_text,
      item.body_tier,
      item.content_hash,
      item.published_at,
      item.fetched_at,
      item.hn_points,
      item.hn_comments,
      item.reddit_upvotes,
      item.reddit_comments,
      item.yt_views,
      rv,
    );
  return "new";
}

/** Upgrade an item's body after full-text extraction. */
export function updateItemBody(
  db: Db,
  itemId: string,
  body: { body_html: string | null; body_text: string | null; body_tier: "extract" | "render"; content_hash: string },
): void {
  const rv = db.nextRowVersion();
  db.raw
    .prepare(
      "UPDATE items SET body_html = ?, body_text = ?, body_tier = ?, content_hash = ?, row_version = ? WHERE id = ?",
    )
    .run(body.body_html, body.body_text, body.body_tier, body.content_hash, rv, itemId);
}

/** Assign labels to an item. `bump` re-versions the item so /sync re-sends it. */
export function assignItemLabels(
  db: Db,
  itemId: string,
  labels: { labelId: string; confidence: number; origin: "rule" | "llm" }[],
  opts: { bump?: boolean } = {},
): void {
  const now = Date.now();
  const stmt = db.raw.prepare(
    `INSERT INTO item_labels(item_id, label_id, confidence, origin, created_at)
     VALUES (?,?,?,?,?)
     ON CONFLICT(item_id, label_id) DO UPDATE SET confidence = excluded.confidence, origin = excluded.origin`,
  );
  for (const l of labels) stmt.run(itemId, l.labelId, l.confidence, l.origin, now);
  if (opts.bump) {
    db.raw.prepare("UPDATE items SET row_version = ? WHERE id = ?").run(db.nextRowVersion(), itemId);
  }
}

export function removeItemLabels(db: Db, itemId: string, labelIds: string[]): void {
  const stmt = db.raw.prepare("DELETE FROM item_labels WHERE item_id = ? AND label_id = ?");
  for (const id of labelIds) stmt.run(itemId, id);
  if (labelIds.length) {
    db.raw.prepare("UPDATE items SET row_version = ? WHERE id = ?").run(db.nextRowVersion(), itemId);
  }
}

export function setItemState(
  db: Db,
  itemId: string,
  state: { read?: boolean; bookmarked?: boolean },
): boolean {
  const now = Date.now();
  const sets: string[] = [];
  const params: (number | null)[] = [];
  if (state.read !== undefined) {
    sets.push("read_at = ?");
    params.push(state.read ? now : null);
  }
  if (state.bookmarked !== undefined) {
    sets.push("bookmarked_at = ?");
    params.push(state.bookmarked ? now : null);
  }
  if (!sets.length) return false;
  const rv = db.nextRowVersion();
  sets.push("row_version = ?");
  params.push(rv);
  const info = db.raw
    .prepare(`UPDATE items SET ${sets.join(", ")} WHERE id = ? AND deleted_at IS NULL`)
    .run(...params, itemId);
  return Number(info.changes) > 0;
}

export function getItem(db: Db, itemId: string): ItemsTable | undefined {
  return db.raw.prepare("SELECT * FROM items WHERE id = ?").get(itemId) as ItemsTable | undefined;
}

export interface ItemWithSource extends ItemsTable {
  source_title: string;
}

export function getItemWithSource(db: Db, itemId: string): ItemWithSource | undefined {
  return db.raw
    .prepare(
      `SELECT i.*, s.title AS source_title FROM items i
       JOIN sources s ON s.id = i.source_id WHERE i.id = ?`,
    )
    .get(itemId) as ItemWithSource | undefined;
}

export interface ItemLabelRow {
  label_id: string;
  confidence: number;
  origin: string;
}

export function getItemLabels(db: Db, itemId: string): ItemLabelRow[] {
  return db.raw
    .prepare("SELECT label_id, confidence, origin FROM item_labels WHERE item_id = ?")
    .all(itemId) as unknown as ItemLabelRow[];
}

// ── feed candidate selection ────────────────────────────────────────────────
const KIND_FILTER: Record<string, SourceKind[] | null> = {
  all: null,
  hn: ["hackernews"],
  reddit: ["reddit"],
  blogs: ["rss", "arxiv", "github", "youtube"],
};

export interface FeedCandidate extends ItemsTable {
  authority: number;
  confidence: number;
  source_title: string;
}

/**
 * Candidate items for a label's feed, joined with source authority + the tag
 * confidence for THIS label. Ordered newest-first and capped; the caller scores
 * + sorts in JS (score is time-dependent).
 */
export function labelFeedCandidates(
  db: Db,
  labelId: string,
  opts: { kind?: string; sinceRowVersion?: number; limit?: number },
): FeedCandidate[] {
  const kinds = KIND_FILTER[opts.kind ?? "all"] ?? null;
  const params: (string | number)[] = [labelId];
  let kindClause = "";
  if (kinds) {
    kindClause = ` AND i.source_kind IN (${kinds.map(() => "?").join(",")})`;
    params.push(...kinds);
  }
  let sinceClause = "";
  if (opts.sinceRowVersion !== undefined) {
    sinceClause = " AND i.row_version > ?";
    params.push(opts.sinceRowVersion);
  }
  const limit = opts.limit ?? 500;
  params.push(limit);
  return db.raw
    .prepare(
      `SELECT i.*, s.authority AS authority, s.title AS source_title, il.confidence AS confidence
       FROM items i
       JOIN item_labels il ON il.item_id = i.id AND il.label_id = ?
       JOIN sources s ON s.id = i.source_id
       WHERE i.deleted_at IS NULL${kindClause}${sinceClause}
       ORDER BY COALESCE(i.published_at, i.fetched_at) DESC
       LIMIT ?`,
    )
    .all(...params) as unknown as FeedCandidate[];
}

export function bookmarkedItems(db: Db, limit = 200): ItemWithSource[] {
  return db.raw
    .prepare(
      `SELECT i.*, s.title AS source_title FROM items i
       JOIN sources s ON s.id = i.source_id
       WHERE i.bookmarked_at IS NOT NULL AND i.deleted_at IS NULL
       ORDER BY i.bookmarked_at DESC LIMIT ?`,
    )
    .all(limit) as unknown as ItemWithSource[];
}

// ── full-text search (FTS5) ─────────────────────────────────────────────────
export function searchItems(db: Db, query: string, limit = 50): ItemWithSource[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  // Prefix-match each token; escape double quotes for the FTS string.
  const ftsQuery = trimmed
    .split(/\s+/)
    .map((t) => `"${t.replace(/"/g, '""')}"*`)
    .join(" ");
  return db.raw
    .prepare(
      `SELECT i.*, s.title AS source_title FROM items i
       JOIN items_fts f ON f.rowid = i.rowid
       JOIN sources s ON s.id = i.source_id
       WHERE items_fts MATCH ? AND i.deleted_at IS NULL
       ORDER BY bm25(items_fts) ASC
       LIMIT ?`,
    )
    .all(ftsQuery, limit) as unknown as ItemWithSource[];
}
