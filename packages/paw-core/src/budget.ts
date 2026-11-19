// Pure rate-limit + daily-budget guards. No side effects, no Node/DOM.
//
// The API layer (apps/api) holds the mutable, short-lived counters (iron-rules
// §2) and calls canCall before every model invocation (iron-rules §5). Over
// budget, the API serves cached example wishes only and never calls the model.
//
// The per-IP window reset is performed by the API layer, which owns the
// mutable counters and the BudgetConfig. recordCall handles the fixed daily
// boundary (DAY_MS is a constant) so multi-day sequences behave correctly in
// the pure model; it does not assume knowledge of the configurable window length.

/** One day in milliseconds. */
export const DAY_MS = 24 * 60 * 60 * 1000;

export interface BudgetConfig {
  /** Max model calls per IP per window. */
  readonly perIpLimit: number;
  /** Window in ms for the per-IP counter. */
  readonly windowMs: number;
  /** Hard daily spend cap in cents. */
  readonly dailyBudgetCents: number;
}

export interface BudgetState {
  /** Calls in the current window for this IP. */
  readonly ipCalls: number;
  /** Start of the current per-IP window (epoch ms). */
  readonly windowStart: number;
  /** Spend in the current day (cents). */
  readonly spentCents: number;
  /** Start of the current day (epoch ms). */
  readonly dayStart: number;
}

function windowElapsed(state: BudgetState, config: BudgetConfig, now: number): boolean {
  return now - state.windowStart >= config.windowMs;
}

function dayElapsed(state: BudgetState, now: number): boolean {
  return now - state.dayStart >= DAY_MS;
}

/**
 * Returns false if a call now would exceed the per-IP rate limit or the daily
 * budget. A window or day that has elapsed resets its counter for the check.
 */
export function canCall(state: BudgetState, config: BudgetConfig, now: number): boolean {
  const rateOk = windowElapsed(state, config, now)
    ? config.perIpLimit > 0
    : state.ipCalls < config.perIpLimit;
  const budgetOk = dayElapsed(state, now)
    ? config.dailyBudgetCents > 0
    : state.spentCents < config.dailyBudgetCents;
  return rateOk && budgetOk;
}

/**
 * Records a successful call's cost. Rolls the fixed daily boundary forward when
 * the day has elapsed. Returns a new state; does not mutate the input.
 */
export function recordCall(state: BudgetState, costCents: number, now: number): BudgetState {
  const newDay = dayElapsed(state, now);
  return {
    ipCalls: state.ipCalls + 1,
    windowStart: state.windowStart,
    spentCents: newDay ? costCents : state.spentCents + costCents,
    dayStart: newDay ? now : state.dayStart,
  };
}

/**
 * Daily-budget-only check for one model call that will cost `costCents`.
 * True only when the spend after the call still fits inside the daily budget.
 * A day that has elapsed counts as a fresh day with nothing spent. Ignores the
 * per-IP limit, which the API applies once per HTTP request, not per model call.
 */
export function canSpend(
  state: Pick<BudgetState, 'spentCents' | 'dayStart'>,
  config: Pick<BudgetConfig, 'dailyBudgetCents'>,
  costCents: number,
  now: number,
): boolean {
  if (!Number.isFinite(costCents) || costCents < 0) return false;
  const spent = now - state.dayStart >= DAY_MS ? 0 : state.spentCents;
  return spent + costCents <= config.dailyBudgetCents;
}
