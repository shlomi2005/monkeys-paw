import { canCall, DAY_MS } from 'paw-core';
import type { BudgetState } from 'paw-core';
import type { Context, Next } from 'hono';
import type { GlobalState, IpState } from './state';
import { getOrCreateIpState } from './state';
import type { BudgetConfig } from './config';

declare global {
  namespace HonoRequest {
    interface HonoRequest {
      globalState?: GlobalState;
      ipState?: IpState;
      clientIp?: string;
    }
  }
}

/**
 * Extract client IP from x-forwarded-for header or Hono request.
 * (Req 7.4: never store wish text with IP, only use for rate-limiting)
 */
function getClientIp(c: Context): string {
  const forwarded = c.req.header('x-forwarded-for');
  if (forwarded) {
    // Take first IP in case of proxy chain
    return forwarded.split(',')[0].trim();
  }
  // Fallback: try to get from Hono's request object
  return (c.req.raw.socket?.remoteAddress || 'unknown-ip').slice(-15); // truncate for safety
}

/**
 * Check budget middleware: call canCall before model invocation.
 * Returns 503 if call would exceed budget or rate limit.
 * Attaches state to context for use by route handlers.
 * (Task 15, Req 7.1, 7.2)
 */
export function checkBudget(globalState: GlobalState, config: BudgetConfig) {
  return async (c: Context, next: Next) => {
    const clientIp = getClientIp(c);
    const ipState = getOrCreateIpState(globalState, clientIp);

    // Build the budget state view for canCall
    const now = Date.now();

    // Check if we need to reset the window
    const windowElapsed = now - ipState.windowStart >= config.windowMs;
    const dayElapsed = now - globalState.dayStart >= DAY_MS;

    let canMakeCall = false;
    try {
      const budgetState: BudgetState = {
        ipCalls: ipState.ipCalls,
        windowStart: ipState.windowStart,
        spentCents: globalState.spentCents,
        dayStart: globalState.dayStart,
      };

      canMakeCall = canCall(budgetState, config, now);

      // Reset counters if needed
      if (windowElapsed) {
        ipState.ipCalls = 0;
        ipState.windowStart = now;
      }
      if (dayElapsed) {
        globalState.spentCents = 0;
        globalState.dayStart = now;
      }
    } catch {
      // If canCall fails, deny the call
      canMakeCall = false;
    }

    if (!canMakeCall) {
      c.set('budgetExceeded', true);
    } else {
      c.set('budgetExceeded', false);
      c.set('globalState', globalState);
      c.set('ipState', ipState);
      c.set('clientIp', clientIp);
    }

    await next();
  };
}

export function isBudgetExceeded(c: Context): boolean {
  return c.get('budgetExceeded') === true;
}

export function getGlobalState(c: Context): GlobalState | undefined {
  return c.get('globalState');
}

export function getIpState(c: Context): IpState | undefined {
  return c.get('ipState');
}

export function getClientIpFromContext(c: Context): string | undefined {
  return c.get('clientIp');
}
