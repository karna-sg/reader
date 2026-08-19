// Runtime Source model (a parsed DB `sources` row) + the Adapter contract.
// Two-phase design: an adapter fetches (the only I/O, cacheable/mockable) and
// normalizes (pure) into the shared Item model.
import { z } from "zod";
import type { Item, SourceKind } from "../model/item.js";
import type { FullTextPolicy } from "../db/schema.js";

// ── kind-specific config (stored as JSON in sources.config) ────────────────
export const RssConfig = z.object({
  feed_url: z.string().url(),
  ua_profile: z.enum(["default", "browser"]).default("default"),
});
export const HackerNewsConfig = z.object({
  mode: z.enum(["firebase-top", "firebase-new", "algolia-search", "hnrss"]).default("hnrss"),
  query: z.string().optional(),
  min_points: z.number().int().optional(),
  hnrss_path: z.string().optional(), // e.g. "frontpage", "newest?points=100"
  limit: z.number().int().positive().max(200).default(30),
});
export const RedditConfig = z.object({
  subreddit: z.string().optional(), // e.g. "SaaS" (preferred; enables OAuth path)
  listing: z.enum(["hot", "new", "top", "rising"]).default("hot"),
  timeframe: z.enum(["hour", "day", "week", "month", "year", "all"]).default("day"),
  limit: z.number().int().positive().max(100).default(50),
  // Fallback keyless path: a full .rss URL, optionally with user=/feed= tokens.
  rss_url: z.string().url().optional(),
});
export const YouTubeConfig = z.object({
  channel_id: z.string().min(1), // UC...
});
export const ArxivConfig = z.object({
  categories: z.array(z.string().min(1)).min(1), // ["cs.LG","cs.CL"]
});
export const GitHubConfig = z.object({
  // Full .atom URL (releases/commits/tags/<user>). Kept explicit for clarity.
  atom_url: z.string().url(),
});

export const SourceConfigSchemas = {
  rss: RssConfig,
  hackernews: HackerNewsConfig,
  reddit: RedditConfig,
  youtube: YouTubeConfig,
  arxiv: ArxivConfig,
  github: GitHubConfig,
} as const;

export type RssConfig = z.infer<typeof RssConfig>;
export type HackerNewsConfig = z.infer<typeof HackerNewsConfig>;
export type RedditConfig = z.infer<typeof RedditConfig>;
export type YouTubeConfig = z.infer<typeof YouTubeConfig>;
export type ArxivConfig = z.infer<typeof ArxivConfig>;
export type GitHubConfig = z.infer<typeof GitHubConfig>;

/** Runtime source: a DB row with typed, parsed config. */
export interface Source {
  id: string;
  kind: SourceKind;
  title: string;
  config: unknown; // validate per-kind inside the adapter
  full_text: FullTextPolicy;
  authority: number;
  poll_interval_ms: number;
  etag: string | null;
  last_modified: string | null;
}

/** Shared context passed to every adapter run. */
export interface AdapterContext {
  httpUserAgent: string;
  redditUserAgent: string;
  timeoutMs: number;
  /** Reddit OAuth app credentials (Phase 2); when present, the adapter mints a
   *  client-credentials token (100 qpm) instead of the throttled keyless path. */
  redditClientId?: string | null;
  redditClientSecret?: string | null;
  /** Pre-fetched Reddit bearer (overrides minting); mainly for tests. */
  redditBearer?: string | null;
  /** Called by adapters to fetch full text when policy requires it. */
  extract?: (url: string, policy: FullTextPolicy) => Promise<ExtractResult | null>;
  now: number;
}

export interface ExtractResult {
  body_html: string | null;
  body_text: string | null;
  tier: "extract" | "render";
}

/** Result of running one source: items + updated cache validators. */
export interface AdapterResult {
  status: "ok" | "not_modified" | "error" | "rate_limited";
  items: Item[];
  etag: string | null;
  lastModified: string | null;
  error?: string;
  retryAfterMs?: number | null;
}

export interface Adapter {
  kind: SourceKind;
  run(source: Source, ctx: AdapterContext): Promise<AdapterResult>;
}

export function parseConfig<K extends SourceKind>(
  kind: K,
  raw: unknown,
): z.infer<(typeof SourceConfigSchemas)[K]> {
  return SourceConfigSchemas[kind].parse(raw) as z.infer<(typeof SourceConfigSchemas)[K]>;
}
