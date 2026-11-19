import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { DAY_MS, canCall, canSpend } from '../src/budget';

const config = { dailyBudgetCents: 10 };

describe('canSpend (daily-budget-only check)', () => {
  it('allows a call that lands exactly on the budget and refuses one cent more', () => {
    const state = { spentCents: 9, dayStart: 0 };
    expect(canSpend(state, config, 1, 0)).toBe(true);
    expect(canSpend(state, config, 1.001, 0)).toBe(false);
  });

  it('refuses when the budget is already spent', () => {
    expect(canSpend({ spentCents: 10, dayStart: 0 }, config, 0.135, 0)).toBe(false);
  });

  it('treats an elapsed day as a fresh day', () => {
    const state = { spentCents: 10, dayStart: 0 };
    expect(canSpend(state, config, 0.135, DAY_MS - 1)).toBe(false);
    expect(canSpend(state, config, 0.135, DAY_MS)).toBe(true);
  });

  it('refuses a cost that is negative or not a number', () => {
    const state = { spentCents: 0, dayStart: 0 };
    expect(canSpend(state, config, -1, 0)).toBe(false);
    expect(canSpend(state, config, Number.NaN, 0)).toBe(false);
    expect(canSpend(state, config, Number.POSITIVE_INFINITY, 0)).toBe(false);
  });

  it('ignores the per-IP limit that canCall enforces', () => {
    const state = { ipCalls: 99, windowStart: 0, spentCents: 0, dayStart: 0 };
    const limits = { perIpLimit: 1, windowMs: DAY_MS + 1, dailyBudgetCents: 10 };
    expect(canCall(state, limits, 0)).toBe(false);
    expect(canSpend(state, limits, 1, 0)).toBe(true);
  });

  it('never lets a spender that obeys it pass the daily budget', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1000 }),
        fc.array(fc.double({ min: 0, max: 50, noNaN: true }), { maxLength: 200 }),
        (budget, costs) => {
          let spent = 0;
          for (const cost of costs) {
            if (canSpend({ spentCents: spent, dayStart: 0 }, { dailyBudgetCents: budget }, cost, 0)) {
              spent += cost;
            }
            expect(spent).toBeLessThanOrEqual(budget);
          }
        },
      ),
    );
  });
});
