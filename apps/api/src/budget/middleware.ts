import { canCall } from 'paw-core';
import type { BudgetState } from 'paw-core';
import type { Context, Next } from 'hono';
import type { GlobalState } from './state';
import { getOrCreateIpState, rollDayIfElapsed } from './state';
import type { BudgetConfig } from './config';
import { RESTING_MESSAGE } from './messages';

/**
 * Extract client IP from x-forwarded-for header or the Node connection.
 * (Req 7.4: never store wish text with IP, only use for rate-limiting)
 */
function getClientIp(c: Context): string {
  const forwarded = c.req.header('x-forwarded-for');
  if (forwarded) {
    // Take first IP in case of proxy chain
    return forwarded.split(',')[0].trim();
  }
  // @hono/node-server exposes the Node request as c.env.incoming
  const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)
    ?.incoming;
  return (incoming?.socket?.remoteAddress || 'unknown-ip').slice(-15); // truncate for safety
}

/**
 * Per-request admission check for the routes that call the model.
 *
 * Asks paw-core's `canCall` (per-IP limit and daily budget). When it says no,
 * answers 503 itself and skips the handler. When it says yes, it counts the
 * request against the IP before the handler runs, so parallel requests cannot
 * slip past the limit. The cost of each model call is charged separately, per
 * call, by `BudgetedModelClient`.
 * (Task 15, Req 7.1, 7.2)
 */
export function checkBudget(
  globalState: GlobalState,
  config: BudgetConfig,
  clock: () => number = Date.now,
) {
  return async (c: Context, next: Next) => {
    const now = clock();
    rollDayIfElapsed(globalState, now);

    const ipState = getOrCreateIpState(globalState, getClientIp(c), now);
    if (now - ipState.windowStart >= config.windowMs) {
      ipState.ipCalls = 0;
      ipState.windowStart = now;
    }

    const budgetState: BudgetState = {
      ipCalls: ipState.ipCalls,
      windowStart: ipState.windowStart,
      spentCents: globalState.spentCents,
      dayStart: globalState.dayStart,
    };

    if (!canCall(budgetState, config, now)) {
      return c.json({ message: RESTING_MESSAGE }, 503);
    }

    ipState.ipCalls += 1;
    return next();
  };
}
