import type { GlobalState } from './state';

/** The three numbers that are saved. Nothing else about a request or a visitor is ever saved. */
export interface BudgetSnapshot {
  spentCents: number;
  reservedCents: number;
  dayStart: number;
}

/** Where the budget survives a restart. Synchronous on purpose: the guard saves in the tick of the reservation. */
export interface BudgetStore {
  load(): BudgetSnapshot | undefined;
  save(snapshot: BudgetSnapshot): void;
}

/** The three numbers of the state. `ipStates` is not part of it. */
export function snapshotOf(state: GlobalState): BudgetSnapshot {
  return {
    spentCents: state.spentCents,
    reservedCents: state.reservedCents,
    dayStart: state.dayStart,
  };
}

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

/**
 * The load rule, applied once at creation. No row: the state stays fresh. A row whose three fields
 * are not all finite numbers of 0 or more: a spent day from `now`, so the app fails closed. A readable
 * row: the reservations of the dead process count as spent (their calls may have been billed),
 * nothing is reserved, and the saved `dayStart` is kept.
 */
export function applyLoaded(
  state: GlobalState,
  loaded: BudgetSnapshot | undefined,
  dailyBudgetCents: number,
  now: number,
): void {
  if (loaded === undefined) return;
  const row = loaded as unknown as Record<string, unknown> | null;
  const spent = row?.spentCents;
  const reserved = row?.reservedCents;
  const dayStart = row?.dayStart;
  if (isCount(spent) && isCount(reserved) && isCount(dayStart)) {
    state.spentCents = spent + reserved;
    state.reservedCents = 0;
    state.dayStart = dayStart;
    return;
  }
  state.spentCents = dailyBudgetCents;
  state.reservedCents = 0;
  state.dayStart = now;
}
