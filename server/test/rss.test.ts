import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeFeed } from "../src/adapters/rss.js";
import type { Source } from "../src/adapters/types.js";

const here = dirname(fileURLToPath(import.meta.url));

const source: Source = {
  id: "rss-test",
  kind: "rss",
  title: "Test",
  config: { feed_url: "https://jvns.ca/atom.xml", ua_profile: "default" },
  full_text: "excerpt",
  authority: 0.9,
  poll_interval_ms: 900000,
  etag: null,
  last_modified: null,
};

describe("normalizeFeed — captured atom fixture", () => {
  const xml = readFileSync(join(here, "fixtures/jvns-atom.xml"), "utf8");
  const items = normalizeFeed(xml, source, 1_700_000_000_000);

  it("maps all entries to items with required fields", () => {
    expect(items.length).toBe(20);
    for (const it of items) {
      expect(it.id).toMatch(/^[0-9a-f]{64}$/);
      expect(it.url).toMatch(/^https?:\/\//);
      expect(it.title.length).toBeGreaterThan(0);
      expect(it.source_kind).toBe("rss");
      expect(it.body_tier).toBe("excerpt");
      expect(it.hn_points).toBeNull(); // engagement N/A for rss
    }
  });

  it("extracts body_text and applies the feed-level author fallback", () => {
    const first = items[0]!;
    expect(first.body_text && first.body_text.length).toBeGreaterThan(100);
    expect(first.author).toBe("Julia Evans");
    expect(first.published_at).toBeTypeOf("number");
  });

  it("canonicalizes urls (strips trailing slash)", () => {
    expect(items[0]!.canonical_url.endsWith("/")).toBe(false);
  });
});

describe("normalizeFeed — inline RSS with content:encoded", () => {
  const rss = `<?xml version="1.0"?>
  <rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel><title>Blog</title>
  <item>
    <title>Post One</title><link>https://ex.com/1</link><guid>g1</guid>
    <pubDate>Tue, 18 Aug 2026 10:00:00 GMT</pubDate>
    <dc:creator>Jane Dev</dc:creator>
    <description>excerpt</description>
    <content:encoded><![CDATA[<p>Full body <b>here</b> with <script>alert(1)</script> danger</p>]]></content:encoded>
  </item></channel></rss>`;
  const items = normalizeFeed(rss, source, 1);

  it("prefers content:encoded and sanitizes script tags", () => {
    const it = items[0]!;
    expect(it.author).toBe("Jane Dev");
    expect(it.body_text).toContain("Full body here");
    expect(it.body_html ?? "").not.toContain("<script");
    expect(it.body_text ?? "").not.toContain("alert(1)");
  });

  it("uses the rss guid as external id", () => {
    expect(items[0]!.external_id).toBe("g1");
  });
});
