import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { DAY_MS, canCall, recordCall } from '../src/budget';
import type { BudgetConfig, BudgetState } from '../src/budget';

describe('budget properties (P8)', () => {
  it('once spentCents >= dailyBudgetCents (within the day), canCall is false regardless of ipCalls or window', () => {
    fc.assert(
      fc.property(
        fc.record({
          dailyBudgetCents: fc.integer({ min: 1, max: 1000 }),
          spentCents: fc.integer({ min: 0, max: 5000 }),
          ipCalls: fc.integer({ min: 0, max: 1000 }),
          windowMs: fc.integer({ min: 1, max: 10_000_000 }),
          perIpLimit: fc.integer({ min: 1, max: 1000 }),
          offset: fc.integer({ min: 0, max: DAY_MS - 1 }),
        }),
        ({ dailyBudgetCents, spentCents, ipCalls, windowMs, perIpLimit, offset }) => {
          const config: BudgetConfig = { dailyBudgetCents, perIpLimit, windowMs };
          const dayStart = 0;
          const now = offset; // within the day (offset < DAY_MS)

          const overSpent = Math.max(spentCents, dailyBudgetCents);
          const overState: BudgetState = {
            ipCalls,
            windowStart: 0,
            spentCents: overSpent,
            dayStart,
          };
          // At or over budget, every IP/window position is blocked.
          expect(canCall(overState, config, now)).toBe(false);

          // A fresh-IP, fresh-window state that still shares the day's spend is blocked too.
          const freshIpOver: BudgetState = {
            ipCalls: 0,
            windowStart: now,
            spentCents: dailyBudgetCents,
            dayStart,
          };
          expect(canCall(freshIpOver, config, now)).toBe(false);
        },
      ),
    );
  });

  it('a budget-aware caller never lets spentCents exceed dailyBudgetCents, and once over it stays blocked', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 500 }),
        fc.array(
          fc.record({
            cost: fc.integer({ min: 1, max: 100 }),
            dt: fc.integer({ min: 0, max: 1000 }),
          }),
          { maxLength: 200 },
        ),
        (dailyBudgetCents, steps) => {
          // Window never elapses within the day; rate limit never blocks, so the
          // daily budget is the only gate under test.
          const config: BudgetConfig = {
            dailyBudgetCents,
            perIpLimit: 100_000,
            windowMs: DAY_MS + 1,
          };
          let state: BudgetState = {
            ipCalls: 0,
            windowStart: 0,
            spentCents: 0,
            dayStart: 0,
          };
          let now = 0;
          let everOver = false;

          for (const step of steps) {
            now += step.dt;
            if (now >= DAY_MS) break; // stay within the day

            const remaining = config.dailyBudgetCents - state.spentCents;
            if (canCall(state, config, now) && step.cost <= remaining) {
              state = recordCall(state, step.cost, now);
              if (state.spentCents >= config.dailyBudgetCents) everOver = true;
            }

            // Hard invariant: the daily budget is never exceeded.
            expect(state.spentCents).toBeLessThanOrEqual(config.dailyBudgetCents);
          }

          if (everOver) {
            const later = now < DAY_MS - 1 ? now + 1 : now; // still the same day
            const freshIp: BudgetState = {
              ipCalls: 0,
              windowStart: later,
              spentCents: state.spentCents,
              dayStart: 0,
            };
            expect(canCall(state, config, later)).toBe(false);
            expect(canCall(freshIp, config, later)).toBe(false);
          }
        },
      ),
    );
  });
});
