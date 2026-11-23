import type { GlobalState } from './budget/state';
import { isDayElapsed } from './budget/state';
import type { BudgetConfig } from './budget/config';

/**
 * Examples-only mode gate (Req 8, Task 47)
 *
 * The API enters examples-only mode when:
 * - GEMINI_API_KEY is absent, OR
 * - Daily budget is exhausted
 *
 * In examples-only mode:
 * - /api/grant and /api/bind return 503 (Req 8.3)
 * - /api/examples, /api/export, /api/health work normally (Req 8.2, 8.4)
 */

export type Mode = 'normal' | 'examples-only';

/**
 * The one decision "a live wish can start" (Requirement 18.1): the key is set AND the spend of the
 * current day (after the day roll) + `reservedCents` + the start ceiling fits in the daily budget.
 * A ceiling that is not a finite number does not fit. Does not mutate the state.
 */
export function liveCanStart(
  hasApiKey: boolean,
  globalState: GlobalState,
  config: BudgetConfig,
  startCeilingCents: number,
  now: number = Date.now(),
): boolean {
  if (!hasApiKey) return false;
  if (!Number.isFinite(startCeilingCents)) return false;
  const spentCents = isDayElapsed(globalState, now) ? 0 : globalState.spentCents;
  return spentCents + globalState.reservedCents + startCeilingCents <= config.dailyBudgetCents;
}

/**
 * Determine the current mode: `normal` iff a live wish can start (`liveCanStart`), else
 * `examples-only`. A day that has elapsed counts as a reset (Req 8.5).
 * (Task 47, Requirement 18)
 */
export function getCurrentMode(
  hasApiKey: boolean,
  globalState: GlobalState,
  config: BudgetConfig,
  startCeilingCents: number,
  now: number = Date.now(),
): Mode {
  return liveCanStart(hasApiKey, globalState, config, startCeilingCents, now)
    ? 'normal'
    : 'examples-only';
}

/**
 * Check if a model call is allowed in the current mode.
 * Returns true for 'normal', false for 'examples-only'.
 * (Task 47)
 */
export function isModelCallAllowed(mode: Mode): boolean {
  return mode === 'normal';
}
