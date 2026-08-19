// Compile-only Kysely over Node's built-in node:sqlite (DatabaseSync).
// Kysely builds and compiles the SQL (type-safe); we execute the compiled SQL
// synchronously against DatabaseSync ourselves. No ORM, no native better-sqlite3.
// This mirrors the openclaw getNodeSqliteKysely() pattern using Kysely's public
// DummyDriver instead of a custom internal dialect.
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type { CompiledQuery } from "kysely";
import {
  DummyDriver,
  Kysely,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
} from "kysely";

type Compilable<Row> = { compile(): CompiledQuery<Row> };

/** A Kysely instance whose driver never executes — use only `.compile()`. */
export function createQueryBuilder<Database>(): Kysely<Database> {
  return new Kysely<Database>({
    dialect: {
      createAdapter: () => new SqliteAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => new SqliteIntrospector(db),
      createQueryCompiler: () => new SqliteQueryCompiler(),
    },
  });
}

/** Run a compiled Kysely query and return all rows. */
export function allRows<Row>(db: DatabaseSync, query: Compilable<Row>): Row[] {
  const c = query.compile();
  const stmt = db.prepare(c.sql);
  return stmt.all(...(c.parameters as SQLInputValue[])) as Row[];
}

/** Run a compiled Kysely query and return the first row (or undefined). */
export function firstRow<Row>(db: DatabaseSync, query: Compilable<Row>): Row | undefined {
  return allRows<Row>(db, query)[0];
}

/** Execute a compiled write (insert/update/delete); returns affected-row count. */
export function execWrite(db: DatabaseSync, query: Compilable<unknown>): number {
  const c = query.compile();
  const stmt = db.prepare(c.sql);
  const { changes } = stmt.run(...(c.parameters as SQLInputValue[]));
  return Number(changes);
}
