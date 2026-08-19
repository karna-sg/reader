import { describe, expect, it } from "vitest";
import { parseOpmlToSpecs } from "../src/adapters/opml.js";

const OPML = `<?xml version="1.0"?><opml version="2.0"><body>
 <outline text="Engineering">
   <outline type="rss" text="Julia Evans" xmlUrl="https://jvns.ca/atom.xml"/>
   <outline type="rss" text="Airbnb Eng" xmlUrl="https://medium.com/feed/airbnb-engineering"/>
 </outline>
 <outline text="AI / ML">
   <outline type="rss" text="Simon Willison" xmlUrl="https://simonwillison.net/atom/everything/"/>
 </outline>
 <outline text="Engineering">
   <outline type="rss" text="Simon Willison" xmlUrl="https://simonwillison.net/atom/everything/"/>
 </outline>
</body></opml>`;

describe("parseOpmlToSpecs", () => {
  const specs = parseOpmlToSpecs(OPML);

  it("produces one spec per unique feed url", () => {
    expect(specs.length).toBe(3);
    for (const s of specs) {
      expect(s.kind).toBe("rss");
      expect(s.id).toMatch(/^rss-[0-9a-f]{12}$/);
    }
  });

  it("maps ancestor group text to labels", () => {
    const jvns = specs.find((s) => s.title === "Julia Evans")!;
    expect(jvns.label_ids).toEqual(["engineering"]);
  });

  it("unions labels when a feed appears under multiple groups", () => {
    const simon = specs.find((s) => s.title === "Simon Willison")!;
    expect(simon.label_ids.sort()).toEqual(["ai-ml", "engineering"]);
  });

  it("marks excerpt-only hosts (medium/substack) as extract", () => {
    const airbnb = specs.find((s) => s.title === "Airbnb Eng")!;
    expect(airbnb.full_text).toBe("extract");
    const jvns = specs.find((s) => s.title === "Julia Evans")!;
    expect(jvns.full_text).toBe("excerpt");
  });
});
