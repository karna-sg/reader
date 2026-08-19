// YouTube channel adapter: the keyless Atom feed feeds/videos.xml?channel_id=UC…
// Parsed as a generic feed (title/link/published/author); view counts require
// the media namespace and are left null for now.
import type { Adapter, AdapterContext, AdapterResult, Source } from "./types.js";
import { parseConfig } from "./types.js";
import { runFeedSource } from "./feed-runner.js";

export const youTubeAdapter: Adapter = {
  kind: "youtube",
  async run(source: Source, ctx: AdapterContext): Promise<AdapterResult> {
    const cfg = parseConfig("youtube", source.config);
    const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(cfg.channel_id)}`;
    return runFeedSource(source, url, "youtube", ctx, ctx.httpUserAgent);
  },
};
