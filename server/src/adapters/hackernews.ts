// Hacker News adapter. Two keyless modes:
//   firebase-top / firebase-new: official Firebase v0 API (ids → items).
//   algolia-search: Algolia search_by_date (one request, points/keyword filter).
// Both carry real engagement (hn_points, hn_comments).
import type { Item } from "../model/item.js";
import { canonicalizeUrl, contentHash, makeItemId } from "../model/item.js";
import { htmlToText, sanitizeHtml } from "../util/html.js";
import { fetchJson } from "./http.js";
import type { Adapter, AdapterContext, AdapterResult, Source } from "./types.js";
import { parseConfig } from "./types.js";

const FIREBASE = "https://hacker-news.firebaseio.com/v0";
const ALGOLIA = "https://hn.algolia.com/api/v1/search_by_date";
const HN_ITEM_URL = (id: number): string => `https://news.ycombinator.com/item?id=${id}`;

interface FirebaseItem {
  id: number;
  type?: string;
  title?: string;
  url?: string;
  text?: string;
  by?: string;
  score?: number;
  descendants?: number;
  time?: number;
  deleted?: boolean;
  dead?: boolean;
}

interface AlgoliaHit {
  objectID: string;
  title?: string;
  url?: string;
  story_text?: string;
  author?: string;
  points?: number;
  num_comments?: number;
  created_at_i?: number;
}

function firebaseToItem(story: FirebaseItem, source: Source, now: number): Item | null {
  if (!story || story.deleted || story.dead || !story.title) return null;
  const url = story.url ?? HN_ITEM_URL(story.id);
  const bodyHtmlRaw = story.text ?? null;
  const bodyHtml = bodyHtmlRaw ? sanitizeHtml(bodyHtmlRaw) : null;
  const bodyText = bodyHtmlRaw ? htmlToText(bodyHtmlRaw) : null;
  const externalId = String(story.id);
  return {
    id: makeItemId(source.id, externalId),
    source_id: source.id,
    source_kind: "hackernews",
    external_id: externalId,
    url,
    canonical_url: canonicalizeUrl(url),
    title: story.title,
    author: story.by ?? null,
    body_html: bodyHtml,
    body_text: bodyText,
    body_tier: "excerpt",
    content_hash: contentHash(bodyText, story.title),
    published_at: story.time ? story.time * 1000 : null,
    fetched_at: now,
    hn_points: story.score ?? 0,
    hn_comments: story.descendants ?? 0,
    reddit_upvotes: null,
    reddit_comments: null,
    yt_views: null,
  };
}

function algoliaToItem(hit: AlgoliaHit, source: Source, now: number): Item | null {
  if (!hit.title) return null;
  const id = Number(hit.objectID);
  const url = hit.url ?? HN_ITEM_URL(id);
  const bodyHtmlRaw = hit.story_text ?? null;
  return {
    id: makeItemId(source.id, hit.objectID),
    source_id: source.id,
    source_kind: "hackernews",
    external_id: hit.objectID,
    url,
    canonical_url: canonicalizeUrl(url),
    title: hit.title,
    author: hit.author ?? null,
    body_html: bodyHtmlRaw ? sanitizeHtml(bodyHtmlRaw) : null,
    body_text: bodyHtmlRaw ? htmlToText(bodyHtmlRaw) : null,
    body_tier: "excerpt",
    content_hash: contentHash(bodyHtmlRaw ? htmlToText(bodyHtmlRaw) : null, hit.title),
    published_at: hit.created_at_i ? hit.created_at_i * 1000 : null,
    fetched_at: now,
    hn_points: hit.points ?? 0,
    hn_comments: hit.num_comments ?? 0,
    reddit_upvotes: null,
    reddit_comments: null,
    yt_views: null,
  };
}

async function runFirebase(
  which: "top" | "new",
  limit: number,
  source: Source,
  ctx: AdapterContext,
): Promise<Item[]> {
  const listUrl = `${FIREBASE}/${which === "top" ? "topstories" : "newstories"}.json`;
  const ids = await fetchJson<number[]>(listUrl, { userAgent: ctx.httpUserAgent, timeoutMs: ctx.timeoutMs });
  const chosen = ids.slice(0, limit);
  const items: Item[] = [];
  // Fetch item details in small concurrent batches (Firebase has no rate limit).
  const batchSize = 8;
  for (let i = 0; i < chosen.length; i += batchSize) {
    const batch = chosen.slice(i, i + batchSize);
    const stories = await Promise.all(
      batch.map((id) =>
        fetchJson<FirebaseItem>(`${FIREBASE}/item/${id}.json`, {
          userAgent: ctx.httpUserAgent,
          timeoutMs: ctx.timeoutMs,
        }).catch(() => null),
      ),
    );
    for (const s of stories) {
      if (!s) continue;
      const item = firebaseToItem(s, source, ctx.now);
      if (item) items.push(item);
    }
  }
  return items;
}

async function runAlgolia(
  cfg: { query?: string; min_points?: number; limit: number },
  source: Source,
  ctx: AdapterContext,
): Promise<Item[]> {
  const params = new URLSearchParams({ tags: "story", hitsPerPage: String(cfg.limit) });
  if (cfg.query) params.set("query", cfg.query);
  if (cfg.min_points !== undefined) params.set("numericFilters", `points>${cfg.min_points}`);
  const res = await fetchJson<{ hits: AlgoliaHit[] }>(`${ALGOLIA}?${params.toString()}`, {
    userAgent: ctx.httpUserAgent,
    timeoutMs: ctx.timeoutMs,
  });
  const items: Item[] = [];
  for (const hit of res.hits) {
    const item = algoliaToItem(hit, source, ctx.now);
    if (item) items.push(item);
  }
  return items;
}

export const hackerNewsAdapter: Adapter = {
  kind: "hackernews",
  async run(source: Source, ctx: AdapterContext): Promise<AdapterResult> {
    const cfg = parseConfig("hackernews", source.config);
    try {
      let items: Item[];
      if (cfg.mode === "algolia-search") {
        items = await runAlgolia(cfg, source, ctx);
      } else if (cfg.mode === "firebase-new") {
        items = await runFirebase("new", cfg.limit, source, ctx);
      } else {
        // firebase-top (default) and hnrss both fall back to the top list here.
        items = await runFirebase("top", cfg.limit, source, ctx);
      }
      return { status: "ok", items, etag: null, lastModified: null };
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 429) {
        return {
          status: "rate_limited",
          items: [],
          etag: null,
          lastModified: null,
          retryAfterMs: (err as { retryAfterMs?: number | null }).retryAfterMs,
        };
      }
      return { status: "error", items: [], etag: null, lastModified: null, error: (err as Error).message };
    }
  },
};
