// Claude Haiku auto-tagging. A cheap classification pass over title+source+
// excerpt assigns cross-cutting labels beyond the source's own labels. Runs only
// when TAG_LLM_ENABLED and ANTHROPIC_API_KEY are set (otherwise the backend is
// rules-only). Uses structured outputs (output_config.format) so the model must
// return valid JSON; the taxonomy block is marked cache_control for reuse.
import Anthropic from "@anthropic-ai/sdk";
import type { Db } from "../db/db.js";
import type { SourceKind } from "../model/item.js";
import { DEFAULT_LABELS } from "../model/labels.js";
import { assignItemLabels } from "../store/items.js";
import { log } from "../logging/logger.js";

const VALID_LABEL_IDS = new Set(DEFAULT_LABELS.map((l) => l.id));

// Kinds whose source label is authoritative/single-topic → skip the LLM (the
// rule-based source tag is enough). Broad sources (blogs, reddit, HN) benefit
// from cross-labeling.
const LLM_ELIGIBLE_KINDS = new Set<SourceKind>(["rss", "reddit", "hackernews"]);

const TAXONOMY_BLOCK = [
  "Fixed label taxonomy (use only these ids):",
  ...DEFAULT_LABELS.map((l) => `- ${l.id} (${l.name}): ${l.aliases.join(", ")}`),
].join("\n");

const SYSTEM = [
  "You are a precise content classifier for a personal knowledge reader.",
  "Given an item's title, source, and excerpt, assign 1-3 of the most relevant labels",
  "from the fixed taxonomy below. Return each with a confidence in [0,1]. Use ONLY the",
  "label ids listed. Prefer precision over recall — do not add weakly-related labels.",
  "",
  TAXONOMY_BLOCK,
].join("\n");

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    labels: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, confidence: { type: "number" } },
        required: ["id", "confidence"],
        additionalProperties: false,
      },
    },
  },
  required: ["labels"],
  additionalProperties: false,
} as const;

export interface ClassifiedLabel {
  labelId: string;
  confidence: number;
}

/** Pure: validate the model's JSON against the known label set + clamp. */
export function parseClassification(jsonText: string, validIds: Set<string>): ClassifiedLabel[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return [];
  }
  const labels = (parsed as { labels?: unknown }).labels;
  if (!Array.isArray(labels)) return [];
  const out: ClassifiedLabel[] = [];
  const seen = new Set<string>();
  for (const l of labels) {
    const id = (l as { id?: unknown }).id;
    const conf = (l as { confidence?: unknown }).confidence;
    if (typeof id !== "string" || !validIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    const confidence = typeof conf === "number" && Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : 0.5;
    out.push({ labelId: id, confidence });
  }
  return out;
}

export function itemPrompt(item: { title: string; source_title: string; body_text: string | null }): string {
  const excerpt = (item.body_text ?? "").slice(0, 500);
  return `Title: ${item.title}\nSource: ${item.source_title}\nExcerpt: ${excerpt}`;
}

export interface Tagger {
  classify(item: { title: string; source_title: string; body_text: string | null }): Promise<ClassifiedLabel[]>;
}

/** Build a live Haiku-backed tagger from resolved credentials. */
export function makeAnthropicTagger(opts: { apiKey: string; model: string }): Tagger {
  const client = new Anthropic({ apiKey: opts.apiKey });
  return {
    async classify(item): Promise<ClassifiedLabel[]> {
      const response = await client.messages.create({
        model: opts.model,
        max_tokens: 256,
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
        messages: [{ role: "user", content: itemPrompt(item) }],
      });
      const textBlock = response.content.find((b) => b.type === "text");
      const text = textBlock && "text" in textBlock ? textBlock.text : "";
      return parseClassification(text, VALID_LABEL_IDS);
    },
  };
}

export function shouldLLMTag(kind: SourceKind): boolean {
  return LLM_ELIGIBLE_KINDS.has(kind);
}

interface PendingRow {
  id: string;
  title: string;
  body_text: string | null;
  source_title: string;
}

/** Tag items from LLM-eligible sources that have no llm-origin labels yet. */
export async function tagPending(
  db: Db,
  tagger: Tagger,
  opts: { limit?: number } = {},
): Promise<{ tagged: number; labelsAdded: number }> {
  const limit = opts.limit ?? 100;
  const kinds = [...LLM_ELIGIBLE_KINDS];
  const rows = db.raw
    .prepare(
      `SELECT i.id, i.title, i.body_text, s.title AS source_title
       FROM items i JOIN sources s ON s.id = i.source_id
       WHERE i.deleted_at IS NULL
         AND i.source_kind IN (${kinds.map(() => "?").join(",")})
         AND NOT EXISTS (SELECT 1 FROM item_labels il WHERE il.item_id = i.id AND il.origin = 'llm')
       ORDER BY i.row_version DESC
       LIMIT ?`,
    )
    .all(...kinds, limit) as unknown as PendingRow[];

  let tagged = 0;
  let labelsAdded = 0;
  for (const row of rows) {
    try {
      const labels = await tagger.classify(row);
      if (labels.length) {
        assignItemLabels(
          db,
          row.id,
          labels.map((l) => ({ labelId: l.labelId, confidence: l.confidence, origin: "llm" as const })),
          { bump: true },
        );
        labelsAdded += labels.length;
      }
      tagged++;
    } catch (err) {
      log("tag").warn("classify failed", { id: row.id, err: (err as Error).message });
    }
  }
  return { tagged, labelsAdded };
}
