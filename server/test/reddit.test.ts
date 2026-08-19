import { describe, expect, it } from "vitest";
import { listingToItems, rssToItems } from "../src/adapters/reddit.js";
import { redditAdapter } from "../src/adapters/reddit.js";
import type { AdapterContext, Source } from "../src/adapters/types.js";

const source: Source = {
  id: "reddit-saas",
  kind: "reddit",
  title: "r/SaaS",
  config: { subreddit: "SaaS", listing: "top", timeframe: "day", limit: 40 },
  full_text: "excerpt",
  authority: 0.6,
  poll_interval_ms: 900000,
  etag: null,
  last_modified: null,
};

describe("reddit listingToItems (OAuth/JSON path mapping)", () => {
  const listing = {
    data: {
      children: [
        {
          data: {
            id: "abc",
            name: "t3_abc",
            title: "I sold my SaaS for $400k",
            url: "https://www.reddit.com/r/SaaS/comments/abc/i_sold/",
            permalink: "/r/SaaS/comments/abc/i_sold/",
            author: "founder_jane",
            ups: 1200,
            num_comments: 88,
            created_utc: 1_700_000_000,
            selftext: "Three years ago I quit my job...",
          },
        },
        { data: { id: "sticky", title: "Pinned", stickied: true, ups: 5 } },
      ],
    },
  };
  const items = listingToItems(listing, source, 1_700_000_500_000);

  it("skips stickied posts and maps engagement", () => {
    expect(items.length).toBe(1);
    const it = items[0]!;
    expect(it.source_kind).toBe("reddit");
    expect(it.reddit_upvotes).toBe(1200);
    expect(it.reddit_comments).toBe(88);
    expect(it.hn_points).toBeNull();
    expect(it.author).toBe("u/founder_jane");
    expect(it.external_id).toBe("t3_abc");
    expect(it.published_at).toBe(1_700_000_000 * 1000);
    expect(it.body_text).toContain("quit my job");
  });
});

describe("reddit rssToItems (user=/feed= token URL path)", () => {
  const rss = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
    <entry><title>Pricing lessons from 200 indie founders</title>
      <link href="https://www.reddit.com/r/indiehackers/comments/x/"/>
      <id>t3_x</id><updated>2026-08-18T10:00:00Z</updated>
      <author><name>/u/indie</name></author></entry></feed>`;
  const items = rssToItems(rss, source, 1);
  it("maps entries with null engagement", () => {
    expect(items.length).toBe(1);
    expect(items[0]!.reddit_upvotes).toBeNull();
    expect(items[0]!.source_kind).toBe("reddit");
    expect(items[0]!.title).toContain("Pricing lessons");
  });
});

describe("reddit adapter requires credentials", () => {
  it("errors clearly when neither OAuth nor rss_url is configured", async () => {
    const ctx: AdapterContext = {
      httpUserAgent: "ua",
      redditUserAgent: "ua",
      timeoutMs: 5000,
      redditClientId: null,
      redditClientSecret: null,
      redditBearer: null,
      now: Date.now(),
    };
    const res = await redditAdapter.run(source, ctx);
    expect(res.status).toBe("error");
    expect(res.error).toMatch(/OAuth|rss_url/);
    expect(res.items.length).toBe(0);
  });
});
