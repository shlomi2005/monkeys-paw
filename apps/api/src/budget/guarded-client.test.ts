import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { DAY_MS } from 'paw-core';
import { BudgetedModelClient, BudgetExhaustedError } from './guarded-client';
import type { AvailableModelClient } from './guarded-client';
import { createGlobalState } from './state';
import type { BudgetConfig } from './config';

class FakeModel implements AvailableModelClient {
  calls = 0;
  constructor(
    public available = true,
    private readonly failEvery = 0,
  ) {}
  async generate(): Promise<unknown> {
    this.calls += 1;
    if (this.failEvery > 0 && this.calls % this.failEvery === 0) {
      throw new Error('model failed');
    }
    return { ok: true };
  }
}

const config = (dailyBudgetCents: number): BudgetConfig => ({
  perIpLimit: 10,
  windowMs: 60_000,
  dailyBudgetCents,
});

describe('BudgetedModelClient', () => {
  it('passes the call through and charges the cost', async () => {
    const inner = new FakeModel();
    const state = createGlobalState(0);
    const guard = new BudgetedModelClient(inner, state, config(10), () => 0, 1.5);

    await expect(guard.generate('p')).resolves.toEqual({ ok: true });
    expect(inner.calls).toBe(1);
    expect(guard.calls).toBe(1);
    expect(guard.denied).toBe(false);
    expect(state.spentCents).toBe(1.5);
  });

  it('denies before calling the inner client when the budget cannot cover the call', async () => {
    const inner = new FakeModel();
    const state = createGlobalState(0);
    state.spentCents = 9.5;
    const guard = new BudgetedModelClient(inner, state, config(10), () => 0, 1);

    await expect(guard.generate('p')).rejects.toBeInstanceOf(BudgetExhaustedError);
    expect(inner.calls).toBe(0);
    expect(guard.calls).toBe(0);
    expect(guard.denied).toBe(true);
    expect(state.spentCents).toBe(9.5);
  });

  it('allows a call that lands exactly on the budget, then denies the next', async () => {
    const inner = new FakeModel();
    const state = createGlobalState(0);
    const guard = new BudgetedModelClient(inner, state, config(2), () => 0, 1);

    await guard.generate('a');
    await guard.generate('b');
    expect(state.spentCents).toBe(2);
    await expect(guard.generate('c')).rejects.toBeInstanceOf(BudgetExhaustedError);
    expect(inner.calls).toBe(2);
    expect(guard.denied).toBe(true);
  });

  it('charges a failed call too', async () => {
    const inner = new FakeModel(true, 1);
    const state = createGlobalState(0);
    const guard = new BudgetedModelClient(inner, state, config(10), () => 0, 2);

    await expect(guard.generate('p')).rejects.toThrow('model failed');
    expect(state.spentCents).toBe(2);
    expect(guard.calls).toBe(1);
    expect(guard.denied).toBe(false);
  });

  it('never calls an unavailable inner client', async () => {
    const inner = new FakeModel(false);
    const state = createGlobalState(0);
    const guard = new BudgetedModelClient(inner, state, config(10), () => 0, 1);

    await expect(guard.generate('p')).rejects.toBeInstanceOf(BudgetExhaustedError);
    expect(inner.calls).toBe(0);
    expect(guard.denied).toBe(true);
    expect(state.spentCents).toBe(0);
  });

  it('rolls the day over: an elapsed day resets the spend', async () => {
    let now = 0;
    const inner = new FakeModel();
    const state = createGlobalState(0);
    const guard = new BudgetedModelClient(inner, state, config(2), () => now, 1);

    await guard.generate('a');
    await guard.generate('b');
    await expect(guard.generate('c')).rejects.toBeInstanceOf(BudgetExhaustedError);

    now = DAY_MS;
    guard.denied = false;
    await expect(guard.generate('d')).resolves.toEqual({ ok: true });
    expect(state.dayStart).toBe(DAY_MS);
    expect(state.spentCents).toBe(1);
  });

  it('shares one daily spend across guards', async () => {
    const inner = new FakeModel();
    const state = createGlobalState(0);
    const one = new BudgetedModelClient(inner, state, config(2), () => 0, 1);
    const two = new BudgetedModelClient(inner, state, config(2), () => 0, 1);

    await one.generate('a');
    await two.generate('b');
    await expect(one.generate('c')).rejects.toBeInstanceOf(BudgetExhaustedError);
    expect(one.denied).toBe(true);
    expect(two.denied).toBe(false);
    expect(one.calls).toBe(1);
    expect(two.calls).toBe(1);
  });

  it('charges at once, so parallel calls cannot overspend', async () => {
    const inner = new FakeModel();
    const state = createGlobalState(0);
    const guard = new BudgetedModelClient(inner, state, config(3), () => 0, 1);

    const results = await Promise.allSettled(Array.from({ length: 10 }, () => guard.generate('p')));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    expect(inner.calls).toBe(3);
    expect(state.spentCents).toBe(3);
  });

  it('falls back to the default cost for a cost that is not a non-negative number', async () => {
    const state = createGlobalState(0);
    const guard = new BudgetedModelClient(new FakeModel(), state, config(10), () => 0, Number.NaN);
    await guard.generate('p');
    expect(state.spentCents).toBe(0.135);
  });

  it('property: for any sequence of calls and costs, spentCents never exceeds dailyBudgetCents', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.double({ min: 0, max: 200, noNaN: true }),
        fc.array(
          fc.record({
            cost: fc.double({ min: 0, max: 40, noNaN: true }),
            fails: fc.boolean(),
          }),
          { maxLength: 60 },
        ),
        async (dailyBudgetCents, steps) => {
          const state = createGlobalState(0);
          let innerCalls = 0;
          let guardCalls = 0;

          for (const step of steps) {
            const inner: AvailableModelClient = {
              available: true,
              generate: async () => {
                innerCalls += 1;
                if (step.fails) throw new Error('model failed');
                return {};
              },
            };
            const guard = new BudgetedModelClient(
              inner,
              state,
              config(dailyBudgetCents),
              () => 0,
              step.cost,
            );
            await guard.generate('p').catch(() => undefined);
            guardCalls += guard.calls;
            expect(state.spentCents).toBeLessThanOrEqual(dailyBudgetCents);
          }

          expect(innerCalls).toBe(guardCalls);
        },
      ),
    );
  });
});
