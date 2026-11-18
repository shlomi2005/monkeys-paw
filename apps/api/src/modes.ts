import type { GlobalState } from './budget/state';
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
 * Determine the current mode based on API key availability and budget state.
 * (Task 47)
 */
export function getCurrentMode(
  hasApiKey: boolean,
  globalState: GlobalState,
  config: BudgetConfig,
): Mode {
  // Missing API key → examples-only (Req 8.1)
  if (!hasApiKey) {
    return 'examples-only';
  }

  // Budget exhausted → examples-only (Req 8.1)
  if (globalState.spentCents >= config.dailyBudgetCents) {
    return 'examples-only';
  }

  return 'normal';
}

/**
 * Check if a model call is allowed in the current mode.
 * Returns true for 'normal', false for 'examples-only'.
 * (Task 47)
 */
export function isModelCallAllowed(mode: Mode): boolean {
  return mode === 'normal';
}
