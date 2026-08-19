import { describe, expect, it } from "vitest";
import { canonicalizeUrl, contentHash, makeItemId, normalizeText } from "../src/model/item.js";

describe("canonicalizeUrl", () => {
  it("strips tracking params, fragment, trailing slash, and www", () => {
    expect(canonicalizeUrl("https://www.Example.com/post/?utm_source=x&id=5#frag")).toBe(
      "https://example.com/post?id=5",
    );
  });

  it("drops default ports and lowercases host", () => {
    expect(canonicalizeUrl("https://Example.com:443/a")).toBe("https://example.com/a");
    expect(canonicalizeUrl("http://Example.com:80/a")).toBe("http://example.com/a");
  });

  it("sorts remaining query params for stable dedup", () => {
    expect(canonicalizeUrl("https://ex.com/x?b=2&a=1")).toBe("https://ex.com/x?a=1&b=2");
  });

  it("keeps the root slash", () => {
    expect(canonicalizeUrl("https://ex.com/")).toBe("https://ex.com/");
  });

  it("returns input unchanged when not a URL", () => {
    expect(canonicalizeUrl("not a url")).toBe("not a url");
  });
});

describe("makeItemId", () => {
  it("is a stable 64-char hex derived from source + external id", () => {
    const a = makeItemId("src1", "guid-1");
    const b = makeItemId("src1", "guid-1");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(makeItemId("src1", "guid-2")).not.toBe(a);
  });
});

describe("contentHash", () => {
  it("normalizes whitespace and is case-insensitive", () => {
    expect(contentHash("  Hello   World ", "t")).toBe(contentHash("hello world", "t"));
  });

  it("falls back to the title when body is empty", () => {
    expect(contentHash(null, "My Title")).toBe(contentHash("", "My Title"));
    expect(contentHash("", "My Title")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("normalizeText", () => {
  it("collapses whitespace and trims", () => {
    expect(normalizeText("  a\n\t b  ")).toBe("a b");
    expect(normalizeText(null)).toBe("");
  });
});
