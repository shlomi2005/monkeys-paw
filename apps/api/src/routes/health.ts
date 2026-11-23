import type { Context } from 'hono';
import type { Hono } from 'hono';
import type { GlobalState } from '../budget/state';
import { rollDayIfElapsed } from '../budget/state';
import type { BudgetConfig } from '../budget/config';
import { getCurrentMode } from '../modes';

/** Cents with at most three decimals, so float sums print as 0.405 and not 0.40500000000000003. */
function roundCents(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Create the health route handler. Mode and budget are computed on every
 * request, never cached at startup.
 * (Task 42, Req 5, Req 7.7, Req 8.1)
 */
export function createHealthRoute(
  app: Hono,
  globalState: GlobalState,
  config: BudgetConfig,
  hasApiKey: () => boolean,
  startCeilingCents: number,
  clock: () => number = Date.now,
): void {
  app.get('/api/health', async (c: Context) => {
    const now = clock();
    rollDayIfElapsed(globalState, now);

    const mode = getCurrentMode(hasApiKey(), globalState, config, startCeilingCents, now);
    const remainingCents = Math.max(
      0,
      config.dailyBudgetCents - globalState.spentCents - globalState.reservedCents,
    );

    return c.json(
      {
        status: 'ok' as const,
        mode,
        budget: {
          dailyBudgetCents: config.dailyBudgetCents,
          spentCents: roundCents(globalState.spentCents),
          remainingCents: roundCents(remainingCents),
        },
      },
      200,
    );
  });
}
