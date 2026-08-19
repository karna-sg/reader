// Persistence for sources: upsert (idempotent re-import preserves cache/fetch
// state), label assignment, due-source selection, and fetch-state updates.
import type { Db } from "../db/db.js";
import { allRows } from "../db/kysely-sync.js";
import type { SourcesTable } from "../db/schema.js";
import type { SourceKind } from "../model/item.js";
import type { SourceSpec } from "../model/source.js";
import type { Source } from "../adapters/types.js";

export function upsertSource(db: Db, spec: SourceSpec, defaultPollMs: number): void {
  const now = Date.now();
  db.raw
    .prepare(
      `INSERT INTO sources
         (id, kind, title, config, full_text, authority, poll_interval_ms, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         config = excluded.config,
         full_text = excluded.full_text,
         authority = excluded.authority,
         poll_interval_ms = excluded.poll_interval_ms,
         enabled = 1,
         updated_at = excluded.updated_at`,
    )
    .run(
      spec.id,
      spec.kind,
      spec.title,
      JSON.stringify(spec.config),
      spec.full_text,
      spec.authority,
      spec.poll_interval_ms ?? defaultPollMs,
      now,
      now,
    );
  setSourceLabels(db, spec.id, spec.label_ids);
}

export function setSourceLabels(db: Db, sourceId: string, labelIds: string[]): void {
  db.raw.prepare("DELETE FROM source_labels WHERE source_id = ?").run(sourceId);
  const stmt = db.raw.prepare(
    "INSERT OR IGNORE INTO source_labels(source_id, label_id) VALUES (?, ?)",
  );
  for (const labelId of labelIds) stmt.run(sourceId, labelId);
}

export function getSourceLabelIds(db: Db, sourceId: string): string[] {
  const rows = db.raw
    .prepare("SELECT label_id FROM source_labels WHERE source_id = ?")
    .all(sourceId) as { label_id: string }[];
  return rows.map((r) => r.label_id);
}

function toRuntime(row: SourcesTable): Source {
  return {
    id: row.id,
    kind: row.kind as SourceKind,
    title: row.title,
    config: JSON.parse(row.config) as unknown,
    full_text: row.full_text,
    authority: row.authority,
    poll_interval_ms: row.poll_interval_ms,
    etag: row.etag,
    last_modified: row.last_modified,
  };
}

export function listAllSources(db: Db): Source[] {
  const rows = allRows(db.raw, db.qb.selectFrom("sources").selectAll());
  return (rows as unknown as SourcesTable[]).map(toRuntime);
}

/** Sources whose poll interval has elapsed (or never fetched). */
export function listDueSources(db: Db, now: number): Source[] {
  const rows = db.raw
    .prepare(
      `SELECT * FROM sources
       WHERE enabled = 1
         AND (last_fetched_at IS NULL OR last_fetched_at + poll_interval_ms <= ?)
       ORDER BY last_fetched_at IS NULL DESC, last_fetched_at ASC`,
    )
    .all(now) as unknown as SourcesTable[];
  return rows.map(toRuntime);
}

export function countSources(db: Db): number {
  const r = db.raw.prepare("SELECT COUNT(*) AS n FROM sources").get() as { n: number };
  return r.n;
}

export interface SourceStatus {
  id: string;
  kind: string;
  title: string;
  enabled: boolean;
  full_text: string;
  authority: number;
  last_status: string | null;
  last_fetched_at: number | null;
  item_count: number;
  label_ids: string[];
}

export function listSourcesWithStatus(db: Db): SourceStatus[] {
  const rows = db.raw
    .prepare(
      `SELECT s.id, s.kind, s.title, s.enabled, s.full_text, s.authority, s.last_status, s.last_fetched_at,
              (SELECT COUNT(*) FROM items i WHERE i.source_id = s.id AND i.deleted_at IS NULL) AS item_count
       FROM sources s ORDER BY s.kind, s.title`,
    )
    .all() as unknown as (Omit<SourceStatus, "enabled" | "label_ids"> & { enabled: number })[];
  const labelStmt = db.raw.prepare("SELECT label_id FROM source_labels WHERE source_id = ?");
  return rows.map((r) => ({
    ...r,
    enabled: r.enabled === 1,
    label_ids: (labelStmt.all(r.id) as { label_id: string }[]).map((x) => x.label_id),
  }));
}

export function deleteSource(db: Db, id: string): boolean {
  // FK ON DELETE CASCADE removes items / item_labels / source_labels.
  const info = db.raw.prepare("DELETE FROM sources WHERE id = ?").run(id);
  return Number(info.changes) > 0;
}

export function setSourceEnabled(db: Db, id: string, enabled: boolean): boolean {
  const info = db.raw
    .prepare("UPDATE sources SET enabled = ?, updated_at = ? WHERE id = ?")
    .run(enabled ? 1 : 0, Date.now(), id);
  return Number(info.changes) > 0;
}

export interface FetchStateUpdate {
  etag: string | null;
  lastModified: string | null;
  status: string;
  fetchedAt: number;
}

export function updateFetchState(db: Db, sourceId: string, u: FetchStateUpdate): void {
  db.raw
    .prepare(
      `UPDATE sources
         SET etag = ?, last_modified = ?, last_status = ?, last_fetched_at = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(u.etag, u.lastModified, u.status, u.fetchedAt, Date.now(), sourceId);
}

/** Push a source's next poll out (429 backoff): pretend it was fetched later. */
export function deferSource(db: Db, sourceId: string, untilMs: number): void {
  const now = Date.now();
  // last_fetched_at is set forward so (last_fetched_at + poll_interval_ms) > now.
  db.raw
    .prepare("UPDATE sources SET last_fetched_at = ?, last_status = '429', updated_at = ? WHERE id = ?")
    .run(untilMs, now, sourceId);
}

export function recordFetchRun(
  db: Db,
  run: {
    sourceId: string;
    startedAt: number;
    finishedAt: number;
    status: string;
    itemsSeen: number;
    itemsNew: number;
    error: string | null;
  },
): void {
  db.raw
    .prepare(
      `INSERT INTO fetch_runs(source_id, started_at, finished_at, status, items_seen, items_new, error)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      run.sourceId,
      run.startedAt,
      run.finishedAt,
      run.status,
      run.itemsSeen,
      run.itemsNew,
      run.error,
    );
}
