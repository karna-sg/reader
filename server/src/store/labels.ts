// Label persistence + the rich per-label metadata the LabelsListView needs:
// unread count and a source summary ("12 sources · HN, r/SaaS, Lenny").
import type { Db } from "../db/db.js";
import type { LabelsTable } from "../db/schema.js";

export function listLabels(db: Db): LabelsTable[] {
  return db.raw
    .prepare("SELECT * FROM labels ORDER BY position ASC, name ASC")
    .all() as unknown as LabelsTable[];
}

export function getLabel(db: Db, id: string): LabelsTable | undefined {
  return db.raw.prepare("SELECT * FROM labels WHERE id = ?").get(id) as LabelsTable | undefined;
}

export interface LabelMeta {
  id: string;
  name: string;
  position: number;
  unread: number;
  total: number;
  source_count: number;
  source_summary: string[]; // up to 3 source titles, highest authority first
}

export function listLabelsWithMeta(db: Db): LabelMeta[] {
  const labels = listLabels(db);
  const out: LabelMeta[] = [];
  for (const l of labels) {
    const counts = db.raw
      .prepare(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN i.read_at IS NULL THEN 1 ELSE 0 END) AS unread
         FROM items i
         JOIN item_labels il ON il.item_id = i.id AND il.label_id = ?
         WHERE i.deleted_at IS NULL`,
      )
      .get(l.id) as { total: number; unread: number | null };
    const sources = db.raw
      .prepare(
        `SELECT s.title AS title, s.authority AS authority
         FROM sources s
         JOIN source_labels sl ON sl.source_id = s.id AND sl.label_id = ?
         WHERE s.enabled = 1
         ORDER BY s.authority DESC, s.title ASC`,
      )
      .all(l.id) as { title: string; authority: number }[];
    out.push({
      id: l.id,
      name: l.name,
      position: l.position,
      unread: counts.unread ?? 0,
      total: counts.total,
      source_count: sources.length,
      source_summary: sources.slice(0, 3).map((s) => s.title),
    });
  }
  return out;
}

export function addLabel(db: Db, input: { id: string; name: string; position?: number }): void {
  const now = Date.now();
  const position =
    input.position ??
    ((db.raw.prepare("SELECT COALESCE(MAX(position), 0) + 1 AS p FROM labels").get() as { p: number })
      .p);
  db.raw
    .prepare(
      `INSERT INTO labels(id, name, position, min_score, created_at, updated_at)
       VALUES (?, ?, ?, 0, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`,
    )
    .run(input.id, input.name, position, now, now);
}

export function updateLabel(
  db: Db,
  id: string,
  patch: { name?: string; position?: number; min_score?: number },
): boolean {
  const sets: string[] = [];
  const params: (string | number)[] = [];
  if (patch.name !== undefined) {
    sets.push("name = ?");
    params.push(patch.name);
  }
  if (patch.position !== undefined) {
    sets.push("position = ?");
    params.push(patch.position);
  }
  if (patch.min_score !== undefined) {
    sets.push("min_score = ?");
    params.push(patch.min_score);
  }
  if (!sets.length) return false;
  sets.push("updated_at = ?");
  params.push(Date.now());
  const info = db.raw.prepare(`UPDATE labels SET ${sets.join(", ")} WHERE id = ?`).run(...params, id);
  return Number(info.changes) > 0;
}
