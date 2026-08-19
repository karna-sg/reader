// Build the shared AdapterContext from the effective (DB-overridable) config.
// `now` is refreshed per source run inside the ingest step.
import { makeExtractor } from "../adapters/extract.js";
import type { AdapterContext } from "../adapters/types.js";
import type { EffectiveConfig } from "../config/settings.js";

export function buildAdapterContext(eff: EffectiveConfig): AdapterContext {
  const extract = makeExtractor({ userAgent: eff.httpUserAgent, timeoutMs: 20_000 });
  return {
    httpUserAgent: eff.httpUserAgent,
    redditUserAgent: eff.redditUserAgent,
    timeoutMs: 20_000,
    redditClientId: eff.redditClientId,
    redditClientSecret: eff.redditClientSecret,
    redditBearer: null,
    extract,
    now: Date.now(),
  };
}
