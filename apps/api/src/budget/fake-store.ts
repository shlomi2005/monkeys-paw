import type { BudgetSnapshot, BudgetStore } from './store';

/**
 * An in-memory `BudgetStore` for tests. `saves` holds a copy of every snapshot saved, in order;
 * `last` is the latest. `row` is what `load` returns, and a test may put anything there to model
 * an unreadable row. `failWhen` makes `save` throw for the snapshots it accepts.
 */
export class FakeBudgetStore implements BudgetStore {
  row: unknown;
  readonly saves: BudgetSnapshot[] = [];
  failWhen: ((snapshot: BudgetSnapshot) => boolean) | undefined;

  constructor(row?: unknown) {
    this.row = row;
  }

  get last(): BudgetSnapshot | undefined {
    return this.saves[this.saves.length - 1];
  }

  load(): BudgetSnapshot | undefined {
    return this.row as BudgetSnapshot | undefined;
  }

  save(snapshot: BudgetSnapshot): void {
    if (this.failWhen?.(snapshot)) throw new Error('save failed');
    const copy = { ...snapshot };
    this.saves.push(copy);
    this.row = copy;
  }
}
