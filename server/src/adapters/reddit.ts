// Reddit adapter. Anonymous .rss/.json is throttled to ~1 req/min since mid-2025,
// so OAuth (100 qpm, free for personal use) is preferred when configured. Falls
// back to the keyless public .json (still carries upvotes/comments) or a
// user=/feed= token .rss URL. Unique User-Agent + 429 backoff throughout.
// Credentials come from env only (never logged; the logger masks them).
import type { Item } from "../model/item.js";
import { canonicalizeUrl, contentHash, makeItemId } from "../model/item.js";
import { htmlToText } from "../util/html.js";
import { fetchJson, fetchText } from "./http.js";
import { normalizeFeedAs } from "./rss.js";
import type { Adapter, AdapterContext, AdapterResult, Source } from "./types.js";
import { parseConfig } from "./types.js";
import { log } from "../logging/logger.js";

interface RedditChild {
  data: {
    id: string;
    name?: string;
    title?: string;
    url?: string;
    permalink?: string;
    author?: string;
    ups?: number;
    num_comments?: number;
    created_utc?: number;
    selftext?: string;
    stickied?: boolean;
  };
}
interface RedditListing {
  data?: { children?: RedditChild[] };
}

// Module-level app-only token cache keyed by client id.
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function getAppToken(
  clientId: string,
  clientSecret: string,
  userAgent: string,
  timeoutMs: number,
): Promise<string> {
  const cached = tokenCache.get(clientId);
  if (cached && cached.expiresAt > Date.now() + 30_000) return cached.token;
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        authorization: `Basic ${basic}`,
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": userAgent,
      },
      body: "grant_type=client_credentials",
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`reddit token HTTP ${res.status}`);
    const json = (await res.json()) as { access_token: string; expires_in: number };
    tokenCache.set(clientId, {
      token: json.access_token,
      expiresAt: Date.now() + json.expires_in * 1000,
    });
    return json.access_token;
  } finally {
    clearTimeout(t);
  }
}

function childToItem(child: RedditChild, source: Source, now: number): Item | null {
  const d = child.data;
  if (!d.title) return null;
  const externalId = d.name ?? `t3_${d.id}`;
  const permalink = d.permalink ? `https://www.reddit.com${d.permalink}` : undefined;
  const url = d.url ?? permalink ?? `https://www.reddit.com/comments/${d.id}`;
  const bodyText = d.selftext ? htmlToText(d.selftext) : null;
  return {
    id: makeItemId(source.id, externalId),
    source_id: source.id,
    source_kind: "reddit",
    external_id: externalId,
    url,
    canonical_url: canonicalizeUrl(url),
    title: d.title,
    author: d.author ? `u/${d.author}` : null,
    body_html: null,
    body_text: bodyText && bodyText.length > 0 ? bodyText : null,
    body_tier: "excerpt",
    content_hash: contentHash(bodyText, d.title),
    published_at: d.created_utc ? Math.round(d.created_utc * 1000) : null,
    fetched_at: now,
    hn_points: null,
    hn_comments: null,
    reddit_upvotes: d.ups ?? 0,
    reddit_comments: d.num_comments ?? 0,
    yt_views: null,
  };
}

export function listingToItems(listing: RedditListing, source: Source, now: number): Item[] {
  const children = listing.data?.children ?? [];
  const items: Item[] = [];
  for (const c of children) {
    if (c.data.stickied) continue;
    const item = childToItem(c, source, now);
    if (item) items.push(item);
  }
  return items;
}

/**
 * Fallback: parse a user=/feed= token .rss URL. Reddit serves Atom, so reuse the
 * generic normalizer (handles atom links/guid/author) but tag it as kind reddit.
 * No structured engagement is available on this path.
 */
export function rssToItems(xml: string, source: Source, now: number): Item[] {
  return normalizeFeedAs(xml, source, "reddit", now);
}

export const redditAdapter: Adapter = {
  kind: "reddit",
  async run(source: Source, ctx: AdapterContext): Promise<AdapterResult> {
    const cfg = parseConfig("reddit", source.config);
    const ua = ctx.redditUserAgent;
    try {
      // 1) OAuth JSON (preferred) when creds + subreddit are present.
      const oauthReady = cfg.subreddit && (ctx.redditBearer || (ctx.redditClientId && ctx.redditClientSecret));
      if (cfg.subreddit && oauthReady) {
        const bearer =
          ctx.redditBearer ??
          (await getAppToken(ctx.redditClientId!, ctx.redditClientSecret!, ua, ctx.timeoutMs));
        const url = `https://oauth.reddit.com/r/${cfg.subreddit}/${cfg.listing}?limit=${cfg.limit}&t=${cfg.timeframe}&raw_json=1`;
        const listing = await fetchJson<RedditListing>(url, {
          userAgent: ua,
          timeoutMs: ctx.timeoutMs,
          headers: { authorization: `Bearer ${bearer}` },
        });
        return { status: "ok", items: listingToItems(listing, source, ctx.now), etag: null, lastModified: null };
      }
      // 2) user=/feed= token .rss URL (keyless, full-rate).
      if (cfg.rss_url) {
        const res = await fetchText(cfg.rss_url, { userAgent: ua, timeoutMs: ctx.timeoutMs });
        if (res.status === 429) {
          return { status: "rate_limited", items: [], etag: null, lastModified: null, retryAfterMs: res.retryAfterMs };
        }
        if (!res.ok || !res.body) {
          return { status: "error", items: [], etag: null, lastModified: null, error: `HTTP ${res.status}` };
        }
        return { status: "ok", items: rssToItems(res.body, source, ctx.now), etag: null, lastModified: null };
      }
      // No keyless path: anonymous Reddit .json/.rss is now blocked/HTML-only.
      // Require OAuth creds (REDDIT_CLIENT_ID/SECRET → 100 qpm) or a user=/feed=
      // token .rss URL in config.rss_url. See plan §2.1.
      return {
        status: "error",
        items: [],
        etag: null,
        lastModified: null,
        error:
          "Reddit not configured: set REDDIT_CLIENT_ID/REDDIT_CLIENT_SECRET (OAuth, 100 qpm) " +
          "or provide a user=/feed= token URL as config.rss_url. Anonymous access is blocked.",
      };
    } catch (err) {
      const status = (err as { status?: number }).status;
      // 403 = anonymous access blocked; 429 = throttled. Both → back off.
      if (status === 429 || status === 403) {
        log("reddit").warn("blocked/rate-limited", { source: source.id, status });
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
