import { describe, it, expect } from 'vitest';
import { canCall } from 'paw-core';
import type { BudgetConfig, BudgetState } from 'paw-core';

describe('Budget middleware (paw-core integration)', () => {
  const config: BudgetConfig = {
    perIpLimit: 3,
    windowMs: 1000, // 1 second for testing
    dailyBudgetCents: 500,
  };

  it('returns false when per-IP limit exceeded (Req 7.1, Task 10)', () => {
    const now = Date.now();
    const state: BudgetState = {
      ipCalls: 3,
      windowStart: now,
      spentCents: 100,
      dayStart: now,
    };

    // Already at limit (3 calls in current window)
    expect(canCall(state, config, now)).toBe(false);
  });

  it('returns false when daily budget exhausted (Req 7.6, Task 11)', () => {
    const now = Date.now();
    const state: BudgetState = {
      ipCalls: 1,
      windowStart: now,
      spentCents: 500, // At daily limit
      dayStart: now,
    };

    expect(canCall(state, config, now)).toBe(false);
  });

  it('resets per-IP counter after window elapses (Req 7.5, Task 12)', () => {
    const now = Date.now();
    const windowStart = now - 2000; // 2 seconds ago (past 1-second window)

    const state: BudgetState = {
      ipCalls: 3,
      windowStart,
      spentCents: 100,
      dayStart: now,
    };

    // Window has elapsed, counter should reset, so call is allowed
    expect(canCall(state, config, now)).toBe(true);
  });
});
