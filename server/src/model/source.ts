// A SourceSpec is the importable/creatable description of a source, before it is
// persisted to the `sources` table. `makeSourceId` derives a stable, readable id
// so re-importing the same feed upserts the same row.
import type { SourceKind } from "./item.js";
import { sha256Hex } from "./item.js";
import type { FullTextPolicy } from "../db/schema.js";

export interface SourceSpec {
  id: string;
  kind: SourceKind;
  title: string;
  config: Record<string, unknown>;
  full_text: FullTextPolicy;
  authority: number;
  poll_interval_ms?: number;
  label_ids: string[];
}

/** Stable id for a source: `<kind>-<12 hex of sha256(kind:key)>`. */
export function makeSourceId(kind: SourceKind, key: string): string {
  return `${kind}-${sha256Hex(`${kind}:${key.toLowerCase()}`).slice(0, 12)}`;
}

/** A stable dedup key per kind, from which the source id is derived. */
export function sourceKeyFor(kind: SourceKind, config: Record<string, unknown>): string {
  switch (kind) {
    case "rss":
      return String(config.feed_url ?? "");
    case "github":
      return String(config.atom_url ?? "");
    case "youtube":
      return String(config.channel_id ?? "");
    case "reddit":
      return String(config.subreddit ?? config.rss_url ?? "");
    case "arxiv":
      return Array.isArray(config.categories) ? (config.categories as string[]).join("+") : "";
    case "hackernews":
      return [config.mode, config.query, config.hnrss_path].filter(Boolean).join(":");
    default:
      return JSON.stringify(config);
  }
}
