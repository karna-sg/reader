// Import a JSON array of structured source specs (the non-RSS channels: HN,
// Reddit, YouTube, arXiv, GitHub). Validates each kind-specific config, derives
// a stable id, and upserts.
import { z } from "zod";
import type { Db } from "../db/db.js";
import type { SourceKind } from "../model/item.js";
import { makeSourceId, sourceKeyFor } from "../model/source.js";
import { SourceConfigSchemas } from "../adapters/types.js";
import { upsertSource } from "./sources.js";

const KINDS = ["rss", "hackernews", "reddit", "youtube", "arxiv", "github"] as const;

const SpecInput = z.object({
  kind: z.enum(KINDS),
  title: z.string().min(1),
  config: z.record(z.string(), z.unknown()),
  full_text: z.enum(["excerpt", "extract", "render"]).default("excerpt"),
  authority: z.number().min(0).max(1).default(0.6),
  poll_interval_ms: z.number().int().positive().optional(),
  label_ids: z.array(z.string()).default([]),
});

export function importSourceSpecs(
  db: Db,
  json: string,
  defaultPollMs: number,
): { imported: number; ids: string[] } {
  const specs = z.array(SpecInput).parse(JSON.parse(json));
  const ids: string[] = [];
  for (const s of specs) {
    const kind = s.kind as SourceKind;
    SourceConfigSchemas[kind].parse(s.config); // validate kind-specific config
    const id = makeSourceId(kind, sourceKeyFor(kind, s.config));
    upsertSource(
      db,
      {
        id,
        kind,
        title: s.title,
        config: s.config,
        full_text: s.full_text,
        authority: s.authority,
        poll_interval_ms: s.poll_interval_ms,
        label_ids: s.label_ids,
      },
      defaultPollMs,
    );
    ids.push(id);
  }
  return { imported: specs.length, ids };
}
