import type { Context } from 'hono';
import type { Hono } from 'hono';
import type { GlobalState } from '../budget/state';

/**
 * Create the health route handler.
 * (Task 42, Req 5)
 */
export function createHealthRoute(
  app: Hono,
  globalState: GlobalState,
  dailyBudgetCents: number,
  mode: 'normal' | 'examples-only',
): void {
  app.get('/api/health', async (c: Context) => {
    const remainingCents = Math.max(0, dailyBudgetCents - globalState.spentCents);

    return c.json(
      {
        status: 'ok' as const,
        mode,
        budget: {
          dailyBudgetCents,
          spentCents: globalState.spentCents,
          remainingCents,
        },
      },
      200,
    );
  });
}
