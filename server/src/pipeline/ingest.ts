// Ingest one source: adapter fetch/normalize → dedup upsert → (new items only)
// full-text extraction → Phase-1 rule tagging (item inherits its source's
// labels) → persist fetch state + run log. Every stage is failure-isolated and
// re-runs are idempotent (dedup makes re-ingest a no-op).
import type { Db } from "../db/db.js";
import type { AdapterContext, Source } from "../adapters/types.js";
import { getAdapter } from "../adapters/registry.js";
import { contentHash } from "../model/item.js";
import {
  deferSource,
  getSourceLabelIds,
  recordFetchRun,
  updateFetchState,
} from "../store/sources.js";
import { assignItemLabels, updateItemBody, upsertItem } from "../store/items.js";
import { log } from "../logging/logger.js";

const DEFAULT_BACKOFF_MS = 15 * 60 * 1000;

export interface IngestResult {
  sourceId: string;
  status: string;
  seen: number;
  created: number;
  error?: string;
}

export async function runSource(
  db: Db,
  source: Source,
  ctx: AdapterContext,
): Promise<IngestResult> {
  const startedAt = Date.now();
  const adapter = getAdapter(source.kind);
  const labelIds = getSourceLabelIds(db, source.id);
  let created = 0;
  let result;
  try {
    result = await adapter.run(source, { ...ctx, now: Date.now() });
  } catch (err) {
    const finishedAt = Date.now();
    const message = (err as Error).message;
    updateFetchState(db, source.id, {
      etag: source.etag,
      lastModified: source.last_modified,
      status: "error",
      fetchedAt: finishedAt,
    });
    recordFetchRun(db, {
      sourceId: source.id,
      startedAt,
      finishedAt,
      status: "error",
      itemsSeen: 0,
      itemsNew: 0,
      error: message,
    });
    log("ingest").warn("source run threw", { source: source.id, err: message });
    return { sourceId: source.id, status: "error", seen: 0, created: 0, error: message };
  }

  if (result.status === "ok") {
    for (const item of result.items) {
      const outcome = upsertItem(db, item);
      if (outcome !== "new") continue;
      created++;
      if (source.full_text !== "excerpt" && ctx.extract) {
        try {
          const ex = await ctx.extract(item.url, source.full_text);
          if (ex?.body_text) {
            updateItemBody(db, item.id, {
              body_html: ex.body_html,
              body_text: ex.body_text,
              body_tier: ex.tier,
              content_hash: contentHash(ex.body_text, item.title),
            });
          }
        } catch (err) {
          log("ingest").debug("extract failed", { source: source.id, id: item.id, err: (err as Error).message });
        }
      }
      if (labelIds.length) {
        assignItemLabels(
          db,
          item.id,
          labelIds.map((labelId) => ({ labelId, confidence: 0.9, origin: "rule" as const })),
        );
      }
    }
  }

  const finishedAt = Date.now();
  if (result.status === "rate_limited") {
    deferSource(db, source.id, finishedAt + (result.retryAfterMs ?? DEFAULT_BACKOFF_MS));
  } else {
    updateFetchState(db, source.id, {
      etag: result.etag,
      lastModified: result.lastModified,
      status: result.status,
      fetchedAt: finishedAt,
    });
  }
  recordFetchRun(db, {
    sourceId: source.id,
    startedAt,
    finishedAt,
    status: result.status,
    itemsSeen: result.items.length,
    itemsNew: created,
    error: result.error ?? null,
  });
  return {
    sourceId: source.id,
    status: result.status,
    seen: result.items.length,
    created,
    error: result.error,
  };
}
