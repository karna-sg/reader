// The normalized Item every adapter maps to, plus the pure identity/dedup
// helpers (stable id, content hash, URL canonicalization). Engagement signals
// are nullable: null = "not applicable to this source class"; 0 = a real zero.
import { createHash } from "node:crypto";
import { z } from "zod";

export const SourceKind = {
  Rss: "rss",
  HackerNews: "hackernews",
  Reddit: "reddit",
  YouTube: "youtube",
  Arxiv: "arxiv",
  GitHub: "github",
} as const;
export type SourceKind = (typeof SourceKind)[keyof typeof SourceKind];

export const BodyTier = {
  Excerpt: "excerpt",
  Extract: "extract",
  Render: "render",
} as const;
export type BodyTier = (typeof BodyTier)[keyof typeof BodyTier];

export const ItemSchema = z.object({
  id: z.string().length(64),
  source_id: z.string().min(1),
  source_kind: z.enum(["rss", "hackernews", "reddit", "youtube", "arxiv", "github"]),
  external_id: z.string().min(1),
  url: z.string().url(),
  canonical_url: z.string().min(1),
  title: z.string().min(1),
  author: z.string().nullable(),
  body_html: z.string().nullable(),
  body_text: z.string().nullable(),
  body_tier: z.enum(["excerpt", "extract", "render"]),
  content_hash: z.string().length(64),
  published_at: z.number().int().nullable(),
  fetched_at: z.number().int(),
  hn_points: z.number().int().nullable(),
  hn_comments: z.number().int().nullable(),
  reddit_upvotes: z.number().int().nullable(),
  reddit_comments: z.number().int().nullable(),
  yt_views: z.number().int().nullable(),
});
export type Item = z.infer<typeof ItemSchema>;

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** Stable primary key for an item: sha256(source_id ":" external_id). */
export function makeItemId(sourceId: string, externalId: string): string {
  return sha256Hex(`${sourceId}:${externalId}`);
}

/** Collapse whitespace for stable content hashing / search. */
export function normalizeText(input: string | null | undefined): string {
  return (input ?? "").replace(/\s+/g, " ").trim();
}

/** Content hash over normalized body text, falling back to the title. */
export function contentHash(bodyText: string | null | undefined, title: string): string {
  const basis = normalizeText(bodyText) || normalizeText(title);
  return sha256Hex(basis.toLowerCase());
}

const TRACKING_PARAM_RE =
  /^(utm_|mc_|mkt_|ns_|hsa_|_hs)|^(fbclid|gclid|dclid|gclsrc|gbraid|wbraid|msclkid|igshid|ref|ref_src|ref_url|source|cmpid|campaign|amp|spm|scid|yclid|twclid|__twitter_impression)$/i;

/**
 * Canonicalize a URL for dedup: lowercase scheme+host, drop default ports,
 * strip tracking query params + fragment, drop a trailing slash on non-root
 * paths. Redirect resolution happens before this (adapters follow redirects and
 * pass the final URL).
 */
export function canonicalizeUrl(input: string): string {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return input.trim();
  }
  u.protocol = u.protocol.toLowerCase();
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
  if (
    (u.protocol === "http:" && u.port === "80") ||
    (u.protocol === "https:" && u.port === "443")
  ) {
    u.port = "";
  }
  u.hash = "";
  const kept: [string, string][] = [];
  for (const [k, v] of u.searchParams) {
    if (!TRACKING_PARAM_RE.test(k)) kept.push([k, v]);
  }
  kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  u.search = "";
  for (const [k, v] of kept) u.searchParams.append(k, v);
  // Drop trailing slash on non-root paths (…/foo/ -> …/foo); keep root "/".
  if (u.pathname !== "/") u.pathname = u.pathname.replace(/\/+$/, "");
  return u.toString();
}
