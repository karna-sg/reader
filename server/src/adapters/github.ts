// GitHub adapter: the keyless .atom feeds on releases/commits/tags/<user>.
// The full .atom URL is stored in config; parsed as a generic Atom feed.
import type { Adapter, AdapterContext, AdapterResult, Source } from "./types.js";
import { parseConfig } from "./types.js";
import { runFeedSource } from "./feed-runner.js";

export const gitHubAdapter: Adapter = {
  kind: "github",
  async run(source: Source, ctx: AdapterContext): Promise<AdapterResult> {
    const cfg = parseConfig("github", source.config);
    return runFeedSource(source, cfg.atom_url, "github", ctx, ctx.httpUserAgent);
  },
};
