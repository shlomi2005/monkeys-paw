import { canCall } from 'paw-core';
import type { BudgetState } from 'paw-core';
import type { Context, Next } from 'hono';
import type { GlobalState } from './state';
import { getOrCreateIpState, rollDayIfElapsed } from './state';
import { DEFAULT_TRUSTED_PROXY_HOPS } from './config';
import type { BudgetConfig } from './config';
import { RESTING_MESSAGE } from './messages';

/**
 * The key that the per-IP limit counts under (task 111, Req 7.4).
 *
 * `x-forwarded-for` is a list: each proxy appends the address it saw, on the right.
 * A client can put anything at the left, so the leftmost entry cannot be trusted.
 * With `trustedProxyHops` proxies of ours in front, the entry the outermost one
 * appended is `entries[entries.length - hops]`, counted from the right.
 *
 * The socket address is the key when hops is 0, when there is no header (or only
 * blank entries), and when the header has fewer entries than hops: a request that
 * did not pass through all our proxies has a header we cannot vouch for.
 *
 * (Req 7.4: never store wish text with IP, only use for rate-limiting)
 */
export function clientKeyOf(
  forwardedFor: string | undefined,
  socketAddress: string | undefined,
  trustedProxyHops: number,
): string {
  const socketKey = (socketAddress || 'unknown-ip').slice(-15); // truncate for safety
  if (!forwardedFor || trustedProxyHops < 1) return socketKey;

  const entries = forwardedFor
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  if (entries.length < trustedProxyHops) return socketKey;

  return entries[entries.length - trustedProxyHops];
}

/** A value that is not an integer of 0 or more means the default of 1. */
function validHops(hops: number): number {
  return Number.isInteger(hops) && hops >= 0 ? hops : DEFAULT_TRUSTED_PROXY_HOPS;
}

function getClientIp(c: Context, trustedProxyHops: number): string {
  // @hono/node-server exposes the Node request as c.env.incoming
  const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)
    ?.incoming;
  return clientKeyOf(c.req.header('x-forwarded-for'), incoming?.socket?.remoteAddress, trustedProxyHops);
}

/**
 * Per-request admission check for the routes that call the model.
 *
 * Asks paw-core's `canCall` (per-IP limit and daily budget). When it says no,
 * answers 503 itself and skips the handler. When it says yes, it counts the
 * request against the IP before the handler runs, so parallel requests cannot
 * slip past the limit. The cost of each model call is charged separately, per
 * call, by `BudgetedModelClient`.
 * The per-IP key comes from `x-forwarded-for` and `trustedProxyHops` (see `clientKeyOf`).
 * (Task 15, Req 7.1, 7.2; task 111, Req 7.4)
 */
export function checkBudget(
  globalState: GlobalState,
  config: BudgetConfig,
  clock: () => number = Date.now,
  trustedProxyHops: number = DEFAULT_TRUSTED_PROXY_HOPS,
) {
  const hops = validHops(trustedProxyHops);
  return async (c: Context, next: Next) => {
    const now = clock();
    rollDayIfElapsed(globalState, now);

    const ipState = getOrCreateIpState(globalState, getClientIp(c, hops), now);
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
