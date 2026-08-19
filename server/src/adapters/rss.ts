// Generic RSS/Atom/RDF/JSON-Feed adapter via feedsmith. Covers personal +
// company blogs, Medium /feed/@user, Substack /feed, dev.to, Lobste.rs, Figma.
// Fetch (conditional GET) + pure normalize; full-text extraction is applied
// later by the source runner, only for new items.
import { parseFeed } from "feedsmith";
import type { Item, SourceKind } from "../model/item.js";
import { canonicalizeUrl, contentHash, makeItemId } from "../model/item.js";
import { firstText, htmlToText, parseDateMs, sanitizeHtml } from "../util/html.js";
import { browserUserAgent } from "./http.js";
import { runFeedSource } from "./feed-runner.js";
import type { Adapter, AdapterContext, AdapterResult, Source } from "./types.js";
import { parseConfig } from "./types.js";

interface RawEntry {
  title?: unknown;
  link?: unknown;
  links?: { href?: string; rel?: string }[];
  url?: string;
  guid?: { value?: string } | string;
  id?: string;
  description?: string;
  summary?: string;
  content?: { encoded?: string } | string;
  content_html?: string;
  content_text?: string;
  pubDate?: string;
  published?: string;
  updated?: string;
  date_published?: string;
  author?: { name?: string } | string;
  authors?: { name?: string }[];
  dc?: { creator?: string; date?: string };
}

function str(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (v && typeof v === "object" && "value" in v) {
    const inner = (v as { value?: unknown }).value;
    return typeof inner === "string" ? inner.trim() || null : null;
  }
  return null;
}

function entryLink(e: RawEntry): string | null {
  const direct = str(e.link) ?? str(e.url);
  if (direct) return direct;
  const links = e.links ?? [];
  const alt = links.find((l) => l.rel === "alternate" && l.href) ?? links.find((l) => l.href);
  return alt?.href ?? null;
}

function entryGuid(e: RawEntry, link: string): string {
  if (typeof e.guid === "string" && e.guid.trim()) return e.guid.trim();
  if (e.guid && typeof e.guid === "object" && e.guid.value) return e.guid.value;
  if (typeof e.id === "string" && e.id.trim()) return e.id.trim();
  return link;
}

function entryAuthor(e: RawEntry): string | null {
  if (e.dc?.creator) return e.dc.creator;
  if (typeof e.author === "string") return e.author.trim() || null;
  if (e.author && typeof e.author === "object" && e.author.name) return e.author.name;
  const a0 = e.authors?.[0]?.name;
  return a0 ?? null;
}

function entryBodyHtml(e: RawEntry): string | null {
  if (e.content && typeof e.content === "object" && e.content.encoded) return e.content.encoded;
  if (typeof e.content === "string" && e.content.trim()) return e.content;
  return firstText(e.content_html, e.description, e.summary, e.content_text);
}

function entryPublished(e: RawEntry): number | null {
  return parseDateMs(e.pubDate ?? e.published ?? e.updated ?? e.date_published ?? e.dc?.date);
}

function feedLevelAuthor(feed: {
  authors?: { name?: string }[];
  author?: { name?: string } | string;
  dc?: { creator?: string };
}): string | null {
  return (
    feed.authors?.[0]?.name ??
    (typeof feed.author === "string" ? feed.author : feed.author?.name) ??
    feed.dc?.creator ??
    null
  );
}

/** Pure: map a parsed feed's entries to normalized Items with the given kind. */
export function normalizeFeedAs(
  feedXmlOrJson: string,
  source: Source,
  kind: SourceKind,
  now: number,
): Item[] {
  const parsed = parseFeed(feedXmlOrJson) as { format: string; feed: unknown };
  const feed = parsed.feed as {
    items?: RawEntry[];
    entries?: RawEntry[];
    authors?: { name?: string }[];
    author?: { name?: string } | string;
    dc?: { creator?: string };
  };
  const entries = feed.entries ?? feed.items ?? [];
  const fallbackAuthor = feedLevelAuthor(feed);
  const items: Item[] = [];
  for (const e of entries) {
    const title = str(e.title);
    const link = entryLink(e);
    if (!title || !link || !/^https?:\/\//i.test(link)) continue;
    const externalId = entryGuid(e, link);
    const bodyHtmlRaw = entryBodyHtml(e);
    const bodyHtml = bodyHtmlRaw ? sanitizeHtml(bodyHtmlRaw) : null;
    const bodyText = bodyHtmlRaw ? htmlToText(bodyHtmlRaw) : null;
    items.push({
      id: makeItemId(source.id, externalId),
      source_id: source.id,
      source_kind: kind,
      external_id: externalId,
      url: link,
      canonical_url: canonicalizeUrl(link),
      title,
      author: entryAuthor(e) ?? fallbackAuthor,
      body_html: bodyHtml,
      body_text: bodyText && bodyText.length > 0 ? bodyText : null,
      body_tier: "excerpt",
      content_hash: contentHash(bodyText, title),
      published_at: entryPublished(e),
      fetched_at: now,
      hn_points: null,
      hn_comments: null,
      reddit_upvotes: null,
      reddit_comments: null,
      yt_views: null,
    });
  }
  return items;
}

/** Back-compat wrapper: normalize as kind "rss". */
export function normalizeFeed(feedXmlOrJson: string, source: Source, now: number): Item[] {
  return normalizeFeedAs(feedXmlOrJson, source, "rss", now);
}

export const rssAdapter: Adapter = {
  kind: "rss",
  async run(source: Source, ctx: AdapterContext): Promise<AdapterResult> {
    const cfg = parseConfig("rss", source.config);
    const ua = cfg.ua_profile === "browser" ? browserUserAgent() : ctx.httpUserAgent;
    return runFeedSource(source, cfg.feed_url, "rss", ctx, ua);
  },
};
