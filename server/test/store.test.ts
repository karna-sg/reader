import { beforeEach, describe, expect, it } from "vitest";
import { openMemoryDb, type Db } from "../src/db/db.js";
import { canonicalizeUrl, contentHash, makeItemId, type Item, type SourceKind } from "../src/model/item.js";
import { upsertSource } from "../src/store/sources.js";
import {
  assignItemLabels,
  labelFeedCandidates,
  searchItems,
  setItemState,
  upsertItem,
} from "../src/store/items.js";
import { listLabelsWithMeta } from "../src/store/labels.js";
import { rankCandidates } from "../src/pipeline/rank.js";
import { syncDelta } from "../src/store/sync.js";

function seedSource(db: Db, id: string, kind: SourceKind, labelIds: string[], authority = 0.6): void {
  upsertSource(
    db,
    {
      id,
      kind,
      title: id,
      config: { feed_url: `https://ex.com/${id}` },
      full_text: "excerpt",
      authority,
      label_ids: labelIds,
    },
    900_000,
  );
}

function mkItem(
  p: {
    source_id: string;
    external_id: string;
    url: string;
    title: string;
  } & Partial<Item>,
): Item {
  const body = p.body_text ?? null;
  return {
    id: makeItemId(p.source_id, p.external_id),
    source_id: p.source_id,
    source_kind: p.source_kind ?? "rss",
    external_id: p.external_id,
    url: p.url,
    canonical_url: p.canonical_url ?? canonicalizeUrl(p.url),
    title: p.title,
    author: p.author ?? null,
    body_html: p.body_html ?? null,
    body_text: body,
    body_tier: p.body_tier ?? "excerpt",
    content_hash: p.content_hash ?? contentHash(body, p.title),
    published_at: p.published_at ?? null,
    fetched_at: p.fetched_at ?? 1_700_000_000_000,
    hn_points: p.hn_points ?? null,
    hn_comments: p.hn_comments ?? null,
    reddit_upvotes: p.reddit_upvotes ?? null,
    reddit_comments: p.reddit_comments ?? null,
    yt_views: p.yt_views ?? null,
  };
}

describe("upsertItem dedup", () => {
  let db: Db;
  beforeEach(() => {
    db = openMemoryDb();
    seedSource(db, "src1", "hackernews", ["engineering"]);
  });

  it("inserts a new item, then reports unchanged on identical re-ingest", () => {
    const a = mkItem({ source_id: "src1", external_id: "g1", url: "https://ex.com/a", title: "A", hn_points: 10, hn_comments: 2 });
    expect(upsertItem(db, a)).toBe("new");
    expect(upsertItem(db, a)).toBe("unchanged");
  });

  it("updates engagement when it changes", () => {
    const a = mkItem({ source_id: "src1", external_id: "g1", url: "https://ex.com/a", title: "A", hn_points: 10 });
    upsertItem(db, a);
    const a2 = mkItem({ source_id: "src1", external_id: "g1", url: "https://ex.com/a", title: "A", hn_points: 50 });
    expect(upsertItem(db, a2)).toBe("updated");
  });

  it("treats a different item with the same canonical url as a duplicate", () => {
    upsertItem(db, mkItem({ source_id: "src1", external_id: "g1", url: "https://ex.com/a?utm_source=x", title: "A" }));
    const dup = mkItem({ source_id: "src1", external_id: "g2", url: "https://ex.com/a", title: "A copy" });
    expect(upsertItem(db, dup)).toBe("duplicate");
  });

  it("treats a different url with the same content hash as a duplicate", () => {
    upsertItem(db, mkItem({ source_id: "src1", external_id: "g1", url: "https://ex.com/a", title: "Same body", body_text: "identical article text" }));
    const dup = mkItem({ source_id: "src1", external_id: "g3", url: "https://ex.com/z", title: "Same body", body_text: "identical article text" });
    expect(upsertItem(db, dup)).toBe("duplicate");
  });
});

describe("feed candidates + ranking + kind filter", () => {
  let db: Db;
  beforeEach(() => {
    db = openMemoryDb();
    seedSource(db, "blog", "rss", ["ai-ml"], 0.9);
    seedSource(db, "hn", "hackernews", ["ai-ml"], 0.5);
    const now = 1_700_000_000_000;
    const items: Item[] = [
      mkItem({ source_id: "blog", external_id: "b1", url: "https://ex.com/b1", title: "old blog post", published_at: now - 96 * 3600_000 }),
      mkItem({ source_id: "blog", external_id: "b2", url: "https://ex.com/b2", title: "fresh blog post", published_at: now - 1 * 3600_000 }),
      mkItem({ source_id: "hn", external_id: "h1", url: "https://ex.com/h1", title: "hn story", source_kind: "hackernews", hn_points: 900, hn_comments: 300, published_at: now - 3 * 3600_000 }),
    ];
    for (const it of items) {
      upsertItem(db, it);
      const labelIds = it.source_id === "hn" ? ["ai-ml"] : ["ai-ml"];
      assignItemLabels(db, it.id, labelIds.map((l) => ({ labelId: l, confidence: 0.9, origin: "rule" as const })));
    }
  });

  it("returns all candidates for a label", () => {
    expect(labelFeedCandidates(db, "ai-ml", {}).length).toBe(3);
  });

  it("filters by source kind (hn vs blogs)", () => {
    expect(labelFeedCandidates(db, "ai-ml", { kind: "hn" }).length).toBe(1);
    expect(labelFeedCandidates(db, "ai-ml", { kind: "blogs" }).length).toBe(2);
  });

  it("ranks the fresh high-engagement item above the old one", () => {
    const ranked = rankCandidates(labelFeedCandidates(db, "ai-ml", {}), 1_700_000_000_000, "score");
    expect(ranked[0]!.score).toBeGreaterThan(ranked[ranked.length - 1]!.score);
    // the 96h-old blog post should rank last
    expect(ranked[ranked.length - 1]!.candidate.title).toBe("old blog post");
  });
});

describe("FTS search + label meta + sync", () => {
  let db: Db;
  beforeEach(() => {
    db = openMemoryDb();
    seedSource(db, "s", "rss", ["engineering"], 0.7);
    for (const [i, title, body] of [
      [1, "Scaling Kubernetes to 7500 nodes", "kubernetes clusters at scale"],
      [2, "A note on Rust ownership", "borrow checker basics"],
    ] as const) {
      const it = mkItem({ source_id: "s", external_id: `e${i}`, url: `https://ex.com/${i}`, title, body_text: body });
      upsertItem(db, it);
      assignItemLabels(db, it.id, [{ labelId: "engineering", confidence: 0.9, origin: "rule" }]);
    }
  });

  it("finds items by full-text (prefix) match", () => {
    expect(searchItems(db, "kubernetes").length).toBe(1);
    expect(searchItems(db, "rust").length).toBe(1);
    expect(searchItems(db, "kuber").length).toBe(1); // prefix
    expect(searchItems(db, "nonexistentterm").length).toBe(0);
  });

  it("reports label meta with unread counts and source summary", () => {
    const eng = listLabelsWithMeta(db).find((l) => l.id === "engineering")!;
    expect(eng.unread).toBe(2);
    expect(eng.source_count).toBe(1);
    expect(eng.source_summary).toContain("s");
  });

  it("marking read reduces the unread count and bumps sync cursor", () => {
    const before = syncDelta(db, 0);
    const first = before.items[0]!;
    setItemState(db, first.id, { read: true });
    const eng = listLabelsWithMeta(db).find((l) => l.id === "engineering")!;
    expect(eng.unread).toBe(1);
    const after = syncDelta(db, before.cursor - 1);
    expect(after.items.some((i) => i.id === first.id && i.read_at !== null)).toBe(true);
  });
});
