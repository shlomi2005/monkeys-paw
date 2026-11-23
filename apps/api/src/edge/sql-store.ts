import type { BudgetSnapshot, BudgetStore } from '../budget/store';
import type { SqlLike } from './types';

const CREATE_TABLE = `CREATE TABLE IF NOT EXISTS budget (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  spent_cents REAL NOT NULL,
  reserved_cents REAL NOT NULL,
  day_start INTEGER NOT NULL
)`;

const UPSERT = `INSERT INTO budget (id, spent_cents, reserved_cents, day_start) VALUES (1, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET spent_cents = excluded.spent_cents,
    reserved_cents = excluded.reserved_cents, day_start = excluded.day_start`;

/**
 * The budget in one row of one table. Only the three numbers are stored: no address, wish,
 * clause, country or key. `load` returns the raw values; `applyLoaded` judges them.
 */
export function createSqlBudgetStore(sql: SqlLike): BudgetStore {
  sql.exec(CREATE_TABLE);
  return {
    load(): BudgetSnapshot | undefined {
      const rows = sql
        .exec('SELECT spent_cents, reserved_cents, day_start FROM budget WHERE id = 1')
        .toArray();
      const row = rows[0];
      if (row === undefined) return undefined;
      return {
        spentCents: row.spent_cents,
        reservedCents: row.reserved_cents,
        dayStart: row.day_start,
      } as unknown as BudgetSnapshot;
    },
    save(snapshot: BudgetSnapshot): void {
      sql.exec(UPSERT, snapshot.spentCents, snapshot.reservedCents, snapshot.dayStart);
    },
  };
}
