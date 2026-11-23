import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { DAY_MS } from 'paw-core';
import { createHealthRoute } from './health';
import { createGlobalState } from '../budget/state';
import { HealthResponseSchema } from '../schemas';
import type { BudgetConfig } from '../budget/config';

const config: BudgetConfig = { perIpLimit: 10, windowMs: 60_000, dailyBudgetCents: 500 };

const CEILING = 3;

async function getHealth(app: Hono) {
  const res = await app.request(new Request('http://localhost/api/health', { method: 'GET' }));
  expect(res.status).toBe(200);
  return (await res.json()) as {
    status: string;
    mode: string;
    budget: { dailyBudgetCents: number; spentCents: number; remainingCents: number };
  };
}

describe('GET /api/health', () => {
  it('returns ok status and mode (Task 40, Req 5.1)', async () => {
    const app = new Hono();
    createHealthRoute(app, createGlobalState(), config, () => true, CEILING);

    const data = await getHealth(app);
    expect(data.status).toBe('ok');
    expect(data.mode).toBe('normal');
    expect(data.budget).toEqual({ dailyBudgetCents: 500, spentCents: 0, remainingCents: 500 });
  });

  it('returns examples-only mode when budget exhausted (Task 41, Req 8.1)', async () => {
    const app = new Hono();
    const state = createGlobalState();
    state.spentCents = 500; // At budget limit
    createHealthRoute(app, state, config, () => true, CEILING);

    const data = await getHealth(app);
    expect(data.status).toBe('ok');
    expect(data.mode).toBe('examples-only');
  });

  it('returns examples-only mode when there is no key (Req 8.1)', async () => {
    const app = new Hono();
    createHealthRoute(app, createGlobalState(), config, () => false, CEILING);
    expect((await getHealth(app)).mode).toBe('examples-only');
  });

  it('computes the mode on every request, not once at startup (Req 7.7, 8.1)', async () => {
    const app = new Hono();
    const state = createGlobalState();
    createHealthRoute(app, state, config, () => true, CEILING);

    expect((await getHealth(app)).mode).toBe('normal');
    state.spentCents = 500;
    const spent = await getHealth(app);
    expect(spent.mode).toBe('examples-only');
    expect(spent.budget.spentCents).toBe(500);
    expect(spent.budget.remainingCents).toBe(0);
  });

  it('leaves examples-only mode when the day rolls over (Req 8.5)', async () => {
    const app = new Hono();
    let now = 0;
    const state = createGlobalState(0);
    state.spentCents = 500;
    createHealthRoute(app, state, config, () => true, CEILING, () => now);

    expect((await getHealth(app)).mode).toBe('examples-only');
    now = DAY_MS;
    const data = await getHealth(app);
    expect(data.mode).toBe('normal');
    expect(data.budget.spentCents).toBe(0);
  });

  it('remaining is the budget minus what is spent and what is reserved (Req 7.7)', async () => {
    const app = new Hono();
    const state = createGlobalState();
    state.spentCents = 1.65;
    state.reservedCents = 3.1;
    createHealthRoute(app, state, config, () => true, CEILING);

    const data = await getHealth(app);
    expect(data.budget).toEqual({ dailyBudgetCents: 500, spentCents: 1.65, remainingCents: 495.25 });
  });

  it('remaining never goes below 0, and fractional cents pass the schema', async () => {
    const app = new Hono();
    const state = createGlobalState();
    state.spentCents = 499.5;
    state.reservedCents = 3;
    createHealthRoute(app, state, config, () => true, CEILING);

    const data = await getHealth(app);
    expect(data.budget.remainingCents).toBe(0);
    expect(HealthResponseSchema.safeParse(data).success).toBe(true);
  });
});
