import { recordCall } from 'paw-core';
import type { BudgetState } from 'paw-core';
import type { GlobalState, IpState } from './state';

/**
 * Record a successful model call cost in the global state.
 * Updates both the per-IP counter and the daily spend.
 * (Task 16, Req 7.2)
 */
export function recordCallInGlobalState(
  globalState: GlobalState,
  ipState: IpState,
  costCents: number,
): void {
  const budgetState: BudgetState = {
    ipCalls: ipState.ipCalls,
    windowStart: ipState.windowStart,
    spentCents: globalState.spentCents,
    dayStart: globalState.dayStart,
  };

  const updated = recordCall(budgetState, costCents, Date.now());

  // Update in-place
  ipState.ipCalls = updated.ipCalls;
  ipState.windowStart = updated.windowStart;
  globalState.spentCents = updated.spentCents;
  globalState.dayStart = updated.dayStart;
}
