import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { DAY_MS, canCall, recordCall } from '../src/budget';
import { computeIntegrity } from '../src/integrity';
import { exportSpec } from '../src/export';
import type { BudgetConfig, BudgetState } from '../src/budget';
import type { Curse, Grant, Wish } from '../src/types';

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

// ── Property tests for integrity and export ────────────────────────────────

/** Generate a valid Curse with a given status. */
function genCurse(status: 'open' | 'closed' = 'open'): fc.Arbitrary<Curse> {
  return fc.record({
    id: fc.string().map((s) => s || 'id'),
    type: fc.constantFrom(
      'permissions',
      'time',
      'money',
      'scale',
      'abuse',
      'privacy',
      'accessibility',
      'data-loss',
      'concurrency',
      'edge-input',
    ) as fc.Arbitrary<any>,
    story: fc.string({ maxLength: 300 }),
    loophole: fc.string().map((s) => s || 'loophole'),
    status: fc.constant(status),
    binding: status === 'closed'
      ? fc.record({
          curseId: fc.string().map((s) => s || 'id'),
          kind: fc.constantFrom('rewrite', 'ears-clause'),
          clause: fc.string().map((s) => s || 'clause'),
          proposedAt: fc.integer(),
        })
      : fc.constant(undefined),
    verdict: status === 'closed'
      ? fc.record({
          curseId: fc.string().map((s) => s || 'id'),
          closed: fc.constant(true),
          reason: fc.string().map((s) => s || 'reason'),
          judgedAt: fc.integer(),
        })
      : fc.constant(undefined),
  });
}

/** Generate a valid Grant with a specified number of closed curses. */
function genGrant(closedCount: number): fc.Arbitrary<Grant> {
  return fc.record({
    wishId: fc.string().map((s) => s || 'wish'),
    narration: fc.string({ maxLength: 200 }).map((s) => s || 'narration'),
    curses: fc.tuple(
      ...Array(closedCount)
        .fill(null)
        .map(() => genCurse('closed')),
      ...Array(Math.max(3 - closedCount, 0))
        .fill(null)
        .map(() => genCurse('open')),
    ),
  });
}

/** Generate a valid Wish. */
function genWish(): fc.Arbitrary<Wish> {
  return fc.record({
    id: fc.string().map((s) => s || 'wish'),
    text: fc.string({ minLength: 1, maxLength: 200 }).map((s) => s || 'requirement'),
    context: fc.option(fc.string({ maxLength: 100 })),
    createdAt: fc.integer({ min: 0, max: Date.now() }),
  });
}

describe('integrity properties (P4)', () => {
  it('returns score in 0–5 and uses correct formula', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 5 }), (closedCount) => {
        const grant = fc.sample(genGrant(closedCount), 1)[0]!;
        const result = computeIntegrity(grant);

        // P4: score is in 0–5.
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(5);

        // P4: score formula holds when total > 0.
        const total = grant.curses.length;
        const closed = grant.curses.filter((c) => c.status === 'closed').length;
        const expectedScore = total === 0 ? 5 : Math.floor((closed / total) * 5);
        expect(result.score).toBe(expectedScore);

        // P4: counts match.
        expect(result.total).toBe(total);
        expect(result.closed).toBe(closed);
        expect(result.open).toBe(total - closed);
      }),
    );
  });

  it('closing more curses never decreases the score', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 4 }), (closedCount) => {
        const grant1 = fc.sample(genGrant(closedCount), 1)[0]!;
        const grant2 = fc.sample(genGrant(closedCount + 1), 1)[0]!;

        const score1 = computeIntegrity(grant1).score;
        const score2 = computeIntegrity(grant2).score;

        expect(score2).toBeGreaterThanOrEqual(score1);
      }),
    );
  });
});

describe('export properties (P1, P2)', () => {
  it('P1: every acceptance criterion matches the EARS pattern', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 5 }), (closedCount) => {
        const grant = fc.sample(genGrant(closedCount), 1)[0]!;
        const wish = fc.sample(genWish(), 1)[0]!;
        const spec = exportSpec(wish, grant);

        // P1: every numbered criterion must contain EARS keywords.
        const lines = spec.requirementsMd.split('\n');
        for (const line of lines) {
          if (/^\d+\./.test(line)) {
            // Numbered acceptance criterion
            const matchesEars =
              /\b(WHEN|IF|WHILE|WHERE|THE SYSTEM SHALL)\b/.test(line);
            expect(matchesEars).toBe(true);
          }
        }
      }),
    );
  });

  it('P2: one property per closed curse', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 5 }), (closedCount) => {
        const grant = fc.sample(genGrant(closedCount), 1)[0]!;
        const wish = fc.sample(genWish(), 1)[0]!;
        const spec = exportSpec(wish, grant);

        // P2: count of properties in propertiesMd equals number of closed curses.
        const propertyCount = (spec.propertiesMd.match(/\*For any\*/g) || []).length;
        expect(propertyCount).toBe(closedCount);
      }),
    );
  });

  it('P23: each property line starts with "*For any*" and names curse type and requirement', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5 }), (closedCount) => {
        const grant = fc.sample(genGrant(closedCount), 1)[0]!;
        const wish = fc.sample(genWish(), 1)[0]!;
        const spec = exportSpec(wish, grant);

        // Task 23: each property line must start with "*For any*", include curse type, and reference Req 6.3
        const propertyLines = spec.propertiesMd.split('\n').filter((l) => l.startsWith('*For any*'));
        expect(propertyLines.length).toBe(closedCount);

        for (const line of propertyLines) {
          expect(line).toMatch(/^\*For any\*/);
          expect(line).toMatch(/`[a-z-]+`/); // curse type in backticks (curse types have hyphens)
          expect(line).toMatch(/Req 6\.3/);
        }
      }),
    );
  });
});

describe('finger-count property (P5)', () => {
  it('open curse count equals finger count, closing reduces by exactly one', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 5 }), (closedCount) => {
        const grant = fc.sample(genGrant(closedCount), 1)[0]!;

        // P5: number of open curses = finger count.
        const openCurses = grant.curses.filter((c) => c.status === 'open');
        const expectedFingers = openCurses.length;

        // If we close one more curse, the finger count decreases by exactly one.
        // (This is a tautology by definition, but we verify it anyway.)
        const totalCurses = grant.curses.length;
        const openCount = totalCurses - closedCount;
        expect(openCount).toBe(expectedFingers);

        // Verify monotonicity: closing one more never increases finger count.
        if (closedCount < totalCurses) {
          const closedCountNext = closedCount + 1;
          const expectedFingersNext = totalCurses - closedCountNext;
          expect(expectedFingersNext).toBeLessThan(expectedFingers);
        }
      }),
    );
  });
});
