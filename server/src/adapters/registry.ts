// Maps a source kind to its adapter. Phase 1 registers RSS; HN/Reddit/YouTube/
// arXiv/GitHub adapters register here in later phases.
import type { SourceKind } from "../model/item.js";
import type { Adapter } from "./types.js";
import { rssAdapter } from "./rss.js";
import { hackerNewsAdapter } from "./hackernews.js";
import { redditAdapter } from "./reddit.js";
import { youTubeAdapter } from "./youtube.js";
import { arxivAdapter } from "./arxiv.js";
import { gitHubAdapter } from "./github.js";

const REGISTRY = new Map<SourceKind, Adapter>();

export function registerAdapter(adapter: Adapter): void {
  REGISTRY.set(adapter.kind, adapter);
}

export function getAdapter(kind: SourceKind): Adapter {
  const adapter = REGISTRY.get(kind);
  if (!adapter) {
    throw new Error(`No adapter registered for source kind "${kind}" (added in a later phase)`);
  }
  return adapter;
}

export function hasAdapter(kind: SourceKind): boolean {
  return REGISTRY.has(kind);
}

registerAdapter(rssAdapter);
registerAdapter(hackerNewsAdapter);
registerAdapter(redditAdapter);
registerAdapter(youTubeAdapter);
registerAdapter(arxivAdapter);
registerAdapter(gitHubAdapter);
