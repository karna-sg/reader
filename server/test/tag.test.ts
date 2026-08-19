import { describe, expect, it } from "vitest";
import { itemPrompt, parseClassification, shouldLLMTag } from "../src/pipeline/tag.js";

const VALID = new Set(["startup", "ai-ml", "engineering", "product", "design", "investing", "career", "science"]);

describe("parseClassification", () => {
  it("keeps valid label ids, clamps confidence, dedups", () => {
    const json = JSON.stringify({
      labels: [
        { id: "ai-ml", confidence: 0.92 },
        { id: "engineering", confidence: 1.4 }, // clamps to 1
        { id: "ai-ml", confidence: 0.5 }, // duplicate ignored
        { id: "bogus", confidence: 0.9 }, // unknown id dropped
      ],
    });
    const out = parseClassification(json, VALID);
    expect(out).toEqual([
      { labelId: "ai-ml", confidence: 0.92 },
      { labelId: "engineering", confidence: 1 },
    ]);
  });

  it("defaults a missing/invalid confidence to 0.5", () => {
    const out = parseClassification(JSON.stringify({ labels: [{ id: "startup" }] }), VALID);
    expect(out).toEqual([{ labelId: "startup", confidence: 0.5 }]);
  });

  it("returns [] on malformed JSON or wrong shape", () => {
    expect(parseClassification("not json", VALID)).toEqual([]);
    expect(parseClassification(JSON.stringify({ nope: 1 }), VALID)).toEqual([]);
  });
});

describe("shouldLLMTag", () => {
  it("tags broad sources but skips single-topic ones", () => {
    expect(shouldLLMTag("rss")).toBe(true);
    expect(shouldLLMTag("reddit")).toBe(true);
    expect(shouldLLMTag("hackernews")).toBe(true);
    expect(shouldLLMTag("arxiv")).toBe(false);
    expect(shouldLLMTag("github")).toBe(false);
    expect(shouldLLMTag("youtube")).toBe(false);
  });
});

describe("itemPrompt", () => {
  it("includes title/source and a bounded excerpt", () => {
    const p = itemPrompt({ title: "T", source_title: "HN", body_text: "x".repeat(1000) });
    expect(p).toContain("Title: T");
    expect(p).toContain("Source: HN");
    expect(p.length).toBeLessThan(600);
  });
});
