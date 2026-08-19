// Canonical label taxonomy (mirrors the seeded DB labels + the wireframe). Used
// by OPML import and the rule-based tagger to resolve free-text label names.
export interface LabelDef {
  id: string;
  name: string;
  aliases: string[];
}

export const DEFAULT_LABELS: LabelDef[] = [
  { id: "startup", name: "Startup", aliases: ["startups", "indie", "saas", "entrepreneur", "founder"] },
  { id: "ai-ml", name: "AI / ML", aliases: ["ai", "ml", "machine learning", "llm", "ai/ml", "mlops"] },
  {
    id: "engineering",
    name: "Engineering",
    aliases: ["eng", "software", "programming", "dev", "devops", "sre", "backend", "systems"],
  },
  { id: "product", name: "Product", aliases: ["pm", "product management", "discovery"] },
  { id: "design", name: "Design", aliases: ["ux", "ui", "design systems"] },
  { id: "investing", name: "Investing", aliases: ["finance", "investing/finance", "markets"] },
  { id: "career", name: "Career", aliases: ["careers", "interviewing", "leveling"] },
  { id: "science", name: "Science", aliases: ["physics", "biology", "econ"] },
];

const LOOKUP = new Map<string, string>();
for (const l of DEFAULT_LABELS) {
  LOOKUP.set(l.id.toLowerCase(), l.id);
  LOOKUP.set(l.name.toLowerCase(), l.id);
  LOOKUP.set(l.name.toLowerCase().replace(/\s+/g, ""), l.id);
  for (const a of l.aliases) LOOKUP.set(a.toLowerCase(), l.id);
}

/** Resolve a free-text label name/alias to a canonical label id, or null. */
export function resolveLabelId(name: string): string | null {
  return LOOKUP.get(name.trim().toLowerCase()) ?? null;
}

export const DEFAULT_LABEL_IDS = DEFAULT_LABELS.map((l) => l.id);
