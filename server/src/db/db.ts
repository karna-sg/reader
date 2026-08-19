// Open node:sqlite, run migrations, expose the compile-only Kysely builder and
// a monotonic row-version counter used for delta sync. Single-writer process,
// so the counter is race-free.
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Kysely } from "kysely";
import { createQueryBuilder } from "./kysely-sync.js";
import type { Database } from "./schema.js";
import { INIT_SQL } from "./migrations/001-init.sql.js";

export interface Db {
  raw: DatabaseSync;
  qb: Kysely<Database>;
  /** Allocate the next monotonic row_version (atomic RETURNING). */
  nextRowVersion(): number;
  close(): void;
}

export function openDb(dbPath: string): Db {
  const isMemory = dbPath === ":memory:";
  const abs = isMemory ? ":memory:" : resolve(dbPath);
  if (!isMemory) mkdirSync(dirname(abs), { recursive: true });
  const raw = new DatabaseSync(abs);
  raw.exec(INIT_SQL);
  const qb = createQueryBuilder<Database>();

  const bumpStmt = raw.prepare(
    "UPDATE meta SET value = value + 1 WHERE key = 'row_version' RETURNING value",
  );

  return {
    raw,
    qb,
    nextRowVersion(): number {
      const r = bumpStmt.get() as { value: number } | undefined;
      if (!r) throw new Error("row_version counter missing");
      return r.value;
    },
    close(): void {
      raw.close();
    },
  };
}

/** Open an in-memory db (tests). */
export function openMemoryDb(): Db {
  return openDb(":memory:");
}
