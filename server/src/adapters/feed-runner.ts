// Shared fetch→normalize for every Atom/RSS-shaped source (rss, youtube, arxiv,
// github). Handles conditional GET (304), 429 backoff, and parse errors.
import type { SourceKind } from "../model/item.js";
import { fetchText } from "./http.js";
import { normalizeFeedAs } from "./rss.js";
import type { AdapterContext, AdapterResult, Source } from "./types.js";
import { log } from "../logging/logger.js";

export async function runFeedSource(
  source: Source,
  feedUrl: string,
  kind: SourceKind,
  ctx: AdapterContext,
  userAgent: string,
): Promise<AdapterResult> {
  const res = await fetchText(feedUrl, {
    userAgent,
    etag: source.etag,
    lastModified: source.last_modified,
    timeoutMs: ctx.timeoutMs,
  });
  if (res.notModified) {
    return { status: "not_modified", items: [], etag: res.etag, lastModified: res.lastModified };
  }
  if (res.status === 429) {
    return {
      status: "rate_limited",
      items: [],
      etag: source.etag,
      lastModified: source.last_modified,
      retryAfterMs: res.retryAfterMs,
    };
  }
  if (!res.ok || !res.body) {
    return {
      status: "error",
      items: [],
      etag: source.etag,
      lastModified: source.last_modified,
      error: `HTTP ${res.status}`,
    };
  }
  try {
    const items = normalizeFeedAs(res.body, source, kind, ctx.now);
    return { status: "ok", items, etag: res.etag, lastModified: res.lastModified };
  } catch (err) {
    log(kind).warn("parse failed", { source: source.id, err: (err as Error).message });
    return {
      status: "error",
      items: [],
      etag: res.etag,
      lastModified: res.lastModified,
      error: `parse: ${(err as Error).message}`,
    };
  }
}
