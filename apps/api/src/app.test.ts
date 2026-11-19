import { describe, it, expect } from 'vitest';
import { DAY_MS } from 'paw-core';
import { createApp } from './app';
import type { AvailableModelClient } from './budget/guarded-client';
import type { BudgetConfig } from './budget/config';
import { fileURLToPath } from 'url';

// A small valid cache, so the tests do not depend on the generated apps/api/examples-cache.json.
const EXAMPLES_FIXTURE = fileURLToPath(new URL('../tests/fixtures/examples-cache.json', import.meta.url));

const RESTING = 'The paw is resting. Browse the examples until it wakes.';

/** A fake model that answers each paw-core prompt with valid JSON and counts its calls. */
class FakeModel implements AvailableModelClient {
  calls = 0;
  constructor(public available = true) {}

  async generate(prompt: string): Promise<unknown> {
    this.calls += 1;
    if (prompt.includes('Task: GRANT_WISH')) {
      return {
        narration: 'Your wish is granted, exactly as stated.',
        curses: [
          { id: 'x', type: 'permissions', story: 'The owner quits.', loophole: '"Only the owner"' },
          { id: 'x', type: 'time', story: 'Midnight where?', loophole: '"midnight"' },
          { id: 'x', type: 'scale', story: 'Zero projects.', loophole: '"a project"' },
        ],
      };
    }
    if (prompt.includes('Task: JUDGE_BATCH_QUALITY')) {
      return ['curse-0', 'curse-1', 'curse-2'].map((curseId) => ({
        curseId,
        specific: true,
        reason: 'Specific.',
      }));
    }
    if (prompt.includes('Task: JUDGE_VERDICT')) {
      return { curseId: 'c1', closed: true, reason: 'Airtight.', judgedAt: 1 };
    }
    throw new Error('unexpected prompt');
  }
}

/** One grant makes exactly this many model calls with FakeModel: the grant and the batch gate. */
const CALLS_PER_GRANT = 2;

const BUDGET: BudgetConfig = { perIpLimit: 10, windowMs: 60_000, dailyBudgetCents: 500 };

function makeApp(
  model: AvailableModelClient,
  overrides: { budget?: Partial<BudgetConfig>; costPerCallCents?: number; clock?: () => number } = {},
) {
  return createApp({
    model,
    budget: { ...BUDGET, ...overrides.budget },
    corsOrigin: '*',
    examplesCachePath: EXAMPLES_FIXTURE,
    clock: overrides.clock ?? (() => 1_000_000),
    costPerCallCents: overrides.costPerCallCents ?? 0.135,
  });
}

type App = ReturnType<typeof makeApp>;

function post(app: App, path: string, body: unknown, ip = '203.0.113.7') {
  return app.request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

const grantBody = { wish: { text: 'Only the owner can delete a project' } };

async function health(app: App) {
  const res = await app.request('http://localhost/api/health');
  expect(res.status).toBe(200);
  return (await res.json()) as {
    status: string;
    mode: string;
    budget: { dailyBudgetCents: number; spentCents: number; remainingCents: number };
  };
}

const openCurse = (id: string, type: 'permissions' | 'time' | 'money') => ({
  id,
  type,
  story: 'Story.',
  loophole: 'Loophole.',
  status: 'open' as const,
});
const sampleGrant = {
  wishId: 'w1',
  narration: 'Granted.',
  curses: [openCurse('c1', 'permissions'), openCurse('c2', 'time'), openCurse('c3', 'money')],
};

describe('createApp', () => {
  it('builds with no side effects: two apps do not share budget state', async () => {
    const model = new FakeModel();
    const one = makeApp(model);
    const two = makeApp(model);

    expect((await post(one, '/api/grant', grantBody)).status).toBe(200);
    expect((await health(one)).budget.spentCents).toBeCloseTo(CALLS_PER_GRANT * 0.135, 5);
    expect((await health(two)).budget.spentCents).toBe(0);
  });

  describe('per-IP limit (paw-api task 55)', () => {
    it('grants 1-10 from one IP return 200 and the 11th returns 503', async () => {
      const app = makeApp(new FakeModel());
      for (let i = 1; i <= 10; i++) {
        const res = await post(app, '/api/grant', grantBody);
        expect(res.status, `grant ${i}`).toBe(200);
      }
      const eleventh = await post(app, '/api/grant', grantBody);
      expect(eleventh.status).toBe(503);
      expect(((await eleventh.json()) as { message: string }).message).toBe(RESTING);

      // another IP is unaffected
      expect((await post(app, '/api/grant', grantBody, '198.51.100.9')).status).toBe(200);
    });

    it('counts a request when it is admitted, so parallel requests cannot slip through', async () => {
      const app = makeApp(new FakeModel());
      const responses = await Promise.all(
        Array.from({ length: 15 }, () => post(app, '/api/grant', grantBody)),
      );
      const statuses = responses.map((r) => r.status);
      expect(statuses.filter((s) => s === 200)).toHaveLength(10);
      expect(statuses.filter((s) => s === 503)).toHaveLength(5);
    });

    it('counts bind requests against the same IP limit', async () => {
      const app = makeApp(new FakeModel(), { budget: { perIpLimit: 2 } });
      const bind = { grant: sampleGrant, curseId: 'c1', kind: 'rewrite', clause: 'Owner or deputy.' };
      expect((await post(app, '/api/bind', bind)).status).toBe(200);
      expect((await post(app, '/api/grant', grantBody)).status).toBe(200);
      expect((await post(app, '/api/bind', bind)).status).toBe(503);
    });

    it('admits the IP again after the window has elapsed', async () => {
      let now = 1_000_000;
      const app = makeApp(new FakeModel(), { clock: () => now });
      for (let i = 0; i < 10; i++) await post(app, '/api/grant', grantBody);
      expect((await post(app, '/api/grant', grantBody)).status).toBe(503);

      now += BUDGET.windowMs;
      expect((await post(app, '/api/grant', grantBody)).status).toBe(200);
    });
  });

  describe('budget guard on every model call (iron-rules §5)', () => {
    it('a grant that needs more model calls than the budget allows returns 503, and the model is called no more than the budget allows', async () => {
      const model = new FakeModel();
      // The budget pays for exactly one call; a grant needs two.
      const app = makeApp(model, { budget: { dailyBudgetCents: 1 }, costPerCallCents: 1 });

      const res = await post(app, '/api/grant', grantBody);
      expect(res.status).toBe(503);
      expect(((await res.json()) as { message: string }).message).toBe(RESTING);
      expect(model.calls).toBe(1);

      const after = await health(app);
      expect(after.budget.spentCents).toBe(1);
      expect(after.mode).toBe('examples-only');

      // Examples-only now: no further call reaches the model.
      expect((await post(app, '/api/grant', grantBody)).status).toBe(503);
      expect(model.calls).toBe(1);
    });

    it('stops mid-way across requests: the spend never passes the daily budget', async () => {
      const model = new FakeModel();
      const app = makeApp(model, { budget: { dailyBudgetCents: 3 }, costPerCallCents: 1 });

      expect((await post(app, '/api/grant', grantBody)).status).toBe(200); // calls 1 and 2
      expect((await post(app, '/api/grant', grantBody)).status).toBe(503); // call 3, then denied
      expect(model.calls).toBe(3);
      expect((await health(app)).budget.spentCents).toBe(3);
    });

    it('parallel grants cannot spend more than the budget', async () => {
      const model = new FakeModel();
      const app = makeApp(model, {
        budget: { dailyBudgetCents: 5, perIpLimit: 100 },
        costPerCallCents: 1,
      });

      await Promise.all(Array.from({ length: 10 }, () => post(app, '/api/grant', grantBody)));
      expect(model.calls).toBeLessThanOrEqual(5);
      expect((await health(app)).budget.spentCents).toBeLessThanOrEqual(5);
    });

    it('a bind that the guard refuses returns 503, not the fallback verdict', async () => {
      const model = new FakeModel();
      const app = makeApp(model, { budget: { dailyBudgetCents: 0.5 }, costPerCallCents: 1 });
      const res = await post(app, '/api/bind', {
        grant: sampleGrant,
        curseId: 'c1',
        kind: 'rewrite',
        clause: 'Owner or deputy.',
      });
      expect(res.status).toBe(503);
      expect(model.calls).toBe(0);
    });

    it('the spend resets when the day rolls over (Req 8.5)', async () => {
      let now = 1_000_000;
      const model = new FakeModel();
      const app = makeApp(model, {
        budget: { dailyBudgetCents: 2 },
        costPerCallCents: 1,
        clock: () => now,
      });

      expect((await post(app, '/api/grant', grantBody)).status).toBe(200);
      expect((await health(app)).mode).toBe('examples-only');
      expect((await post(app, '/api/grant', grantBody)).status).toBe(503);

      now += DAY_MS;
      expect((await health(app)).mode).toBe('normal');
      expect((await post(app, '/api/grant', grantBody)).status).toBe(200);
    });
  });

  describe('health', () => {
    it('shows the spend after a grant', async () => {
      const app = makeApp(new FakeModel());
      const before = await health(app);
      expect(before).toMatchObject({ status: 'ok', mode: 'normal' });
      expect(before.budget.spentCents).toBe(0);

      expect((await post(app, '/api/grant', grantBody)).status).toBe(200);

      const after = await health(app);
      expect(after.mode).toBe('normal');
      expect(after.budget.spentCents).toBeCloseTo(CALLS_PER_GRANT * 0.135, 5);
      expect(after.budget.remainingCents).toBeCloseTo(500 - CALLS_PER_GRANT * 0.135, 5);
    });

    it('says examples-only once the budget is spent, not "normal" from startup', async () => {
      const app = makeApp(new FakeModel(), { budget: { dailyBudgetCents: 2 }, costPerCallCents: 1 });
      expect((await health(app)).mode).toBe('normal');
      await post(app, '/api/grant', grantBody);
      expect((await health(app)).mode).toBe('examples-only');
    });
  });

  describe('without an API key (Req 6.2, 8)', () => {
    it('starts in examples-only mode, refuses grant and bind, still serves examples and export', async () => {
      const model = new FakeModel(false);
      const app = makeApp(model);

      expect(await health(app)).toMatchObject({ status: 'ok', mode: 'examples-only' });

      const grant = await post(app, '/api/grant', grantBody);
      expect(grant.status).toBe(503);
      expect(((await grant.json()) as { message: string }).message).toBe(RESTING);

      const bind = await post(app, '/api/bind', {
        grant: sampleGrant,
        curseId: 'c1',
        kind: 'rewrite',
        clause: 'Owner or deputy.',
      });
      expect(bind.status).toBe(503);

      const examples = await app.request('http://localhost/api/examples');
      expect(examples.status).toBe(200);
      expect(await examples.json()).toHaveLength(1);

      const exported = await post(app, '/api/export', {
        wish: { id: 'w1', text: 'Only the owner can delete a project', createdAt: 1 },
        grant: sampleGrant,
      });
      expect(exported.status).toBe(200);

      expect(model.calls).toBe(0);
      expect((await health(app)).budget.spentCents).toBe(0);
    });
  });
});
