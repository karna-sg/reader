// Build the shared AdapterContext (HTTP UAs, timeout, full-text extractor) from
// config. `now` is refreshed per source run inside the ingest step.
import type { Config } from "../config/env.js";
import { makeExtractor } from "../adapters/extract.js";
import type { AdapterContext } from "../adapters/types.js";

export function buildAdapterContext(cfg: Config): AdapterContext {
  const extract = makeExtractor({ userAgent: cfg.HTTP_USER_AGENT, timeoutMs: 20_000 });
  return {
    httpUserAgent: cfg.HTTP_USER_AGENT,
    redditUserAgent: cfg.REDDIT_USER_AGENT,
    timeoutMs: 20_000,
    redditClientId: cfg.REDDIT_CLIENT_ID ?? null,
    redditClientSecret: cfg.REDDIT_CLIENT_SECRET ?? null,
    redditBearer: null,
    extract,
    now: Date.now(),
  };
}
