import { createRequire } from 'node:module';
import type { SqlLike } from './types';

/** A database for tests: `node:sqlite` in memory when this runtime loads it, else a fake of the same subset. */
export interface TestDb {
  kind: 'node:sqlite' | 'fake';
  sql: SqlLike;
  /** Every table of the database with all of its rows. */
  dump(): Record<string, Record<string, unknown>[]>;
}

type Row = Record<string, unknown>;

interface Statement {
  all(...bindings: unknown[]): Row[];
}
interface Database {
  prepare(query: string): Statement;
}

/** The fake knows exactly the three statements of `createSqlBudgetStore`, and nothing else. */
class FakeSqlDb implements SqlLike {
  tables = new Set<string>();
  row: Row | undefined;

  exec(query: string, ...bindings: unknown[]): { toArray(): Row[] } {
    const text = query.replace(/\s+/g, ' ').trim();
    if (/^CREATE TABLE IF NOT EXISTS budget \(/.test(text)) {
      this.tables.add('budget');
      return { toArray: () => [] };
    }
    if (/^SELECT spent_cents, reserved_cents, day_start FROM budget WHERE id = 1$/.test(text)) {
      return { toArray: () => (this.row ? [{ ...this.row }] : []) };
    }
    if (/^INSERT INTO budget \(id, spent_cents, reserved_cents, day_start\) VALUES \(1, \?, \?, \?\) ON CONFLICT\(id\) DO UPDATE/.test(text)) {
      const [spent, reserved, dayStart] = bindings;
      if (bindings.length !== 3) throw new Error('fake sql: expected 3 bindings');
      this.row = { id: 1, spent_cents: spent, reserved_cents: reserved, day_start: dayStart };
      return { toArray: () => [] };
    }
    throw new Error('fake sql: unknown statement');
  }
}

export function openTestDb(): TestDb {
  let DatabaseSync: (new (path: string) => Database) | undefined;
  try {
    const load = createRequire(import.meta.url);
    DatabaseSync = (load('node:sqlite') as { DatabaseSync: new (path: string) => Database }).DatabaseSync;
  } catch {
    DatabaseSync = undefined;
  }

  if (DatabaseSync) {
    const db = new DatabaseSync(':memory:');
    return {
      kind: 'node:sqlite',
      sql: {
        exec(query, ...bindings) {
          const rows = db.prepare(query).all(...bindings);
          return { toArray: () => rows.map((row) => ({ ...row })) };
        },
      },
      dump() {
        const names = db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
          .all()
          .map((row) => String(row.name));
        const out: Record<string, Row[]> = {};
        for (const name of names) {
          out[name] = db.prepare(`SELECT * FROM "${name}"`).all().map((row) => ({ ...row }));
        }
        return out;
      },
    };
  }

  const fake = new FakeSqlDb();
  return {
    kind: 'fake',
    sql: fake,
    dump() {
      const out: Record<string, Row[]> = {};
      for (const name of fake.tables) out[name] = fake.row ? [{ ...fake.row }] : [];
      return out;
    },
  };
}
