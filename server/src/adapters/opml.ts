// Import an OPML subscription list into RSS SourceSpecs. Nested outlines map to
// labels: an ancestor group's `text` (or a leaf `category`) resolves to a label
// id. Host heuristics pick a full-text policy for excerpt-only feeds.
import { parseOpml } from "feedsmith";
import type { FullTextPolicy } from "../db/schema.js";
import { resolveLabelId } from "../model/labels.js";
import type { SourceSpec } from "../model/source.js";
import { makeSourceId } from "../model/source.js";

interface Outline {
  text?: string;
  title?: string;
  type?: string;
  xmlUrl?: string;
  htmlUrl?: string;
  category?: string;
  categories?: string[];
  outlines?: Outline[];
}

const EXCERPT_ONLY_HOST = /(^|\.)(medium\.com|substack\.com)$/i;

function policyForHost(feedUrl: string): FullTextPolicy {
  try {
    const host = new URL(feedUrl).hostname;
    if (EXCERPT_ONLY_HOST.test(host)) return "extract";
  } catch {
    /* ignore */
  }
  return "excerpt";
}

function labelsFor(outline: Outline, groupLabels: string[]): string[] {
  const found = new Set<string>(groupLabels);
  const cats = [
    ...(outline.categories ?? []),
    ...(outline.category ? outline.category.split(",") : []),
  ];
  for (const c of cats) {
    const id = resolveLabelId(c.replace(/^\//, "").split("/").pop() ?? c);
    if (id) found.add(id);
  }
  return [...found];
}

function walk(outlines: Outline[], groupLabels: string[], out: SourceSpec[]): void {
  for (const o of outlines) {
    const feedUrl = o.xmlUrl;
    if (feedUrl) {
      const title = o.title ?? o.text ?? feedUrl;
      out.push({
        id: makeSourceId("rss", feedUrl),
        kind: "rss",
        title,
        config: { feed_url: feedUrl, ua_profile: "default" },
        full_text: policyForHost(feedUrl),
        authority: 0.6,
        label_ids: labelsFor(o, groupLabels),
      });
    }
    if (o.outlines?.length) {
      // A group outline's text names a label for everything beneath it.
      const groupLabelId = o.text ? resolveLabelId(o.text) : null;
      const nextLabels = groupLabelId ? [...groupLabels, groupLabelId] : groupLabels;
      walk(o.outlines, nextLabels, out);
    }
  }
}

export function parseOpmlToSpecs(xml: string): SourceSpec[] {
  const doc = parseOpml(xml) as { body?: { outlines?: Outline[] } };
  const outlines = doc.body?.outlines ?? [];
  const specs: SourceSpec[] = [];
  walk(outlines, [], specs);
  // De-dup by id (same feed listed under multiple groups → union labels).
  const byId = new Map<string, SourceSpec>();
  for (const s of specs) {
    const existing = byId.get(s.id);
    if (existing) {
      existing.label_ids = [...new Set([...existing.label_ids, ...s.label_ids])];
    } else {
      byId.set(s.id, s);
    }
  }
  return [...byId.values()];
}
