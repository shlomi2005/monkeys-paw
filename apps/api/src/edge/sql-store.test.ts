import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { createGlobalState } from '../budget/state';
import { applyLoaded, snapshotOf } from '../budget/store';
import { createSqlBudgetStore } from './sql-store';
import { openTestDb } from './test-db';
import type { SqlLike } from './types';

const BUDGET = 200;
const NOW = 9_000_000;

describe('createSqlBudgetStore', () => {
  it('has no row at first', () => {
    const db = openTestDb();
    expect(createSqlBudgetStore(db.sql).load()).toBeUndefined();
    expect(Object.keys(db.dump())).toEqual(['budget']);
  });

  it('creating it twice over one database keeps the row', () => {
    const db = openTestDb();
    createSqlBudgetStore(db.sql).save({ spentCents: 3, reservedCents: 1, dayStart: 5 });
    expect(createSqlBudgetStore(db.sql).load()).toEqual({ spentCents: 3, reservedCents: 1, dayStart: 5 });
  });

  it('saves and loads the three numbers, and keeps one row', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            spentCents: fc.double({ min: 0, max: 1e6, noNaN: true }),
            reservedCents: fc.double({ min: 0, max: 1e6, noNaN: true }),
            dayStart: fc.integer({ min: 0, max: 2 ** 40 }),
          }),
          { minLength: 1, maxLength: 8 },
        ),
        (snapshots) => {
          const db = openTestDb();
          const store = createSqlBudgetStore(db.sql);
          for (const snapshot of snapshots) store.save(snapshot);
          const last = snapshots[snapshots.length - 1];
          expect(store.load()).toEqual(last);
          expect(db.dump().budget).toHaveLength(1);
        },
      ),
      { numRuns: 60 },
    );
  });

  it('property 4: a reload gives spent + reserved as spent, 0 reserved and the saved dayStart', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 0, max: 2 ** 40 }),
        (spent, reserved, dayStart) => {
          const db = openTestDb();
          const store = createSqlBudgetStore(db.sql);
          const saved = createGlobalState(NOW);
          Object.assign(saved, { spentCents: spent / 100, reservedCents: reserved / 100, dayStart });
          store.save(snapshotOf(saved));
          const fresh = createGlobalState(NOW);
          applyLoaded(fresh, createSqlBudgetStore(db.sql).load(), BUDGET, NOW);
          expect(fresh.spentCents).toBeCloseTo(spent / 100 + reserved / 100, 9);
          expect(fresh.reservedCents).toBe(0);
          expect(fresh.dayStart).toBe(dayStart);
        },
      ),
      { numRuns: 60 },
    );
  });

  it('stores one table with one row of the three numbers and nothing else', () => {
    const db = openTestDb();
    createSqlBudgetStore(db.sql).save({ spentCents: 1.5, reservedCents: 0.5, dayStart: 77 });
    const dump = db.dump();
    expect(Object.keys(dump)).toEqual(['budget']);
    expect(dump.budget).toHaveLength(1);
    expect(Object.keys(dump.budget[0]).sort()).toEqual(['day_start', 'id', 'reserved_cents', 'spent_cents']);
  });

  it('returns raw values for the load rule to judge: an unreadable row is a spent day', () => {
    const raw: SqlLike = {
      exec: () => ({ toArray: () => [{ spent_cents: 'many', reserved_cents: null, day_start: 5 }] }),
    };
    const loaded = createSqlBudgetStore(raw).load();
    expect(loaded).toBeDefined();
    const state = createGlobalState(NOW);
    applyLoaded(state, loaded, BUDGET, NOW);
    expect(state).toMatchObject({ spentCents: BUDGET, reservedCents: 0, dayStart: NOW });
  });

  it('uses an upsert on the fixed id and a create-if-missing table', () => {
    const queries: string[] = [];
    const sql: SqlLike = {
      exec: (query) => {
        queries.push(query);
        return { toArray: () => [] };
      },
    };
    const store = createSqlBudgetStore(sql);
    store.load();
    store.save({ spentCents: 1, reservedCents: 2, dayStart: 3 });
    expect(queries[0]).toContain('CREATE TABLE IF NOT EXISTS budget');
    expect(queries[0]).toContain('CHECK (id = 1)');
    expect(queries.some((q) => q.includes('ON CONFLICT(id) DO UPDATE'))).toBe(true);
  });
});
