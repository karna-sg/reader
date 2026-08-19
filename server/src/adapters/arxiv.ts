// arXiv adapter: rss.arxiv.org/rss/<cat> (categories combined with '+', e.g.
// cs.LG+cs.CL). RSS with the abstract as the item body. Updated daily ~00:00 ET.
import type { Adapter, AdapterContext, AdapterResult, Source } from "./types.js";
import { parseConfig } from "./types.js";
import { runFeedSource } from "./feed-runner.js";

export const arxivAdapter: Adapter = {
  kind: "arxiv",
  async run(source: Source, ctx: AdapterContext): Promise<AdapterResult> {
    const cfg = parseConfig("arxiv", source.config);
    const cats = cfg.categories.map((c) => c.trim()).filter(Boolean).join("+");
    const url = `https://rss.arxiv.org/rss/${cats}`;
    return runFeedSource(source, url, "arxiv", ctx, ctx.httpUserAgent);
  },
};
