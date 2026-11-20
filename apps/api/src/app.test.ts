import { describe, it, expect } from 'vitest';
import { DAY_MS } from 'paw-core';
import { createApp } from './app';
import { FakeMeteredModel } from './budget/fake-metered';
import type { FakeMeteredOptions } from './budget/fake-metered';
import type { MeteredModelClient } from './budget/guarded-client';
import type { BudgetConfig } from './budget/config';
import { fileURLToPath } from 'url';

// A small valid cache, so the tests do not depend on the generated apps/api/examples-cache.json.
const EXAMPLES_FIXTURE = fileURLToPath(new URL('../tests/fixtures/examples-cache.json', import.meta.url));

const RESTING = 'The paw is resting. Browse the examples until it wakes.';

/** A fake model that answers each paw-core prompt with valid JSON and counts its calls. */
class FakeModel extends FakeMeteredModel {
  constructor(options: FakeMeteredOptions = {}) {
    super(options);
  }

  protected override async answer(prompt: string): Promise<unknown> {
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

/** Reports the whole output cap as used, so a call is charged about its ceiling (a bit over 3 cents). */
const FULL: FakeMeteredOptions = { usage: 'ceiling' };

const BUDGET: BudgetConfig = { perIpLimit: 10, windowMs: 60_000, dailyBudgetCents: 500 };

function makeApp(
  model: MeteredModelClient,
  overrides: { budget?: Partial<BudgetConfig>; clock?: () => number } = {},
) {
  return createApp({
    model,
    budget: { ...BUDGET, ...overrides.budget },
    corsOrigin: '*',
    examplesCachePath: EXAMPLES_FIXTURE,
    clock: overrides.clock ?? (() => 1_000_000),
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
    const spent = (await health(one)).budget.spentCents;
    expect(spent).toBeGreaterThan(0);
    expect(spent).toBeLessThan(1); // the real cost of two small answers, far below one ceiling
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

    it('a client that fakes the leftmost x-forwarded-for entry is still limited (task 111)', async () => {
      const app = makeApp(new FakeModel());
      for (let i = 1; i <= 10; i++) {
        const res = await post(app, '/api/grant', grantBody, `fake-${i}, 203.0.113.7`);
        expect(res.status, `grant ${i}`).toBe(200);
      }
      const eleventh = await post(app, '/api/grant', grantBody, 'fake-11, 203.0.113.7');
      expect(eleventh.status).toBe(503);
    });

    it('trustedProxyHops 2 reads the second entry from the right (task 111)', async () => {
      const app = createApp({
        model: new FakeModel(),
        budget: { ...BUDGET, perIpLimit: 2 },
        corsOrigin: '*',
        examplesCachePath: EXAMPLES_FIXTURE,
        clock: () => 1_000_000,
        trustedProxyHops: 2,
      });
      for (const fake of ['a', 'b']) {
        expect((await post(app, '/api/grant', grantBody, `${fake}, 203.0.113.7, 10.0.0.1`)).status).toBe(200);
      }
      expect((await post(app, '/api/grant', grantBody, 'c, 203.0.113.7, 10.0.0.1')).status).toBe(503);
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
      const model = new FakeModel(FULL);
      // One call is reserved at about 3.3 cents and charged about the same. The budget
      // pays for one; a grant needs two.
      const app = makeApp(model, { budget: { dailyBudgetCents: 4 } });

      const res = await post(app, '/api/grant', grantBody);
      expect(res.status).toBe(503);
      expect(((await res.json()) as { message: string }).message).toBe(RESTING);
      expect(model.calls).toBe(1);

      const after = await health(app);
      expect(after.budget.spentCents).toBeGreaterThan(3);
      expect(after.budget.spentCents).toBeLessThanOrEqual(4);

      // No further call reaches the model: the next one cannot be covered either.
      expect((await post(app, '/api/grant', grantBody)).status).toBe(503);
      expect(model.calls).toBe(1);
    });

    it('a 1-cent budget admits no grant, because one grant ceiling is several cents', async () => {
      const model = new FakeModel();
      const app = makeApp(model, { budget: { dailyBudgetCents: 1 } });

      const res = await post(app, '/api/grant', grantBody);
      expect(res.status).toBe(503);
      expect(model.calls).toBe(0);
      expect((await health(app)).budget.spentCents).toBe(0);
    });

    it('stops mid-way across requests: the spend never passes the daily budget', async () => {
      const model = new FakeModel(FULL);
      const app = makeApp(model, { budget: { dailyBudgetCents: 7 } });

      expect((await post(app, '/api/grant', grantBody)).status).toBe(200); // two calls, about 6.5 cents
      expect((await post(app, '/api/grant', grantBody)).status).toBe(503); // refused before its first call
      expect(model.calls).toBe(2);
      expect((await health(app)).budget.spentCents).toBeLessThanOrEqual(7);
    });

    it('parallel grants cannot spend more than the budget', async () => {
      const model = new FakeModel(FULL);
      const app = makeApp(model, { budget: { dailyBudgetCents: 10, perIpLimit: 100 } });

      await Promise.all(Array.from({ length: 10 }, () => post(app, '/api/grant', grantBody)));
      expect(model.calls).toBeLessThanOrEqual(3); // each call reserves over 3 cents
      expect((await health(app)).budget.spentCents).toBeLessThanOrEqual(10);
    });

    it('a bind that the guard refuses returns 503, not the fallback verdict', async () => {
      const model = new FakeModel();
      const app = makeApp(model, { budget: { dailyBudgetCents: 0.5 } });
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
      const model = new FakeModel(FULL);
      const app = makeApp(model, { budget: { dailyBudgetCents: 7 }, clock: () => now });

      expect((await post(app, '/api/grant', grantBody)).status).toBe(200);
      expect((await health(app)).budget.spentCents).toBeGreaterThan(6);
      expect((await post(app, '/api/grant', grantBody)).status).toBe(503);

      now += DAY_MS;
      expect((await health(app)).budget.spentCents).toBe(0);
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
      expect(after.budget.spentCents).toBeGreaterThan(0);
      expect(after.budget.remainingCents).toBeCloseTo(500 - after.budget.spentCents, 2);
    });

    it('says examples-only once the budget is spent, not "normal" from startup', async () => {
      // The answer used more than its ceiling (10000 output tokens, 7.5 cents). The real cost is
      // charged, so the spend is past the 5-cent budget and every later call is refused.
      const model = new FakeModel({ usage: { promptTokens: 0, outputTokens: 10_000 } });
      const app = makeApp(model, { budget: { dailyBudgetCents: 5 } });
      expect((await health(app)).mode).toBe('normal');
      expect((await post(app, '/api/grant', grantBody)).status).toBe(503);
      const after = await health(app);
      expect(after.mode).toBe('examples-only');
      expect(after.budget).toMatchObject({ spentCents: 7.5, remainingCents: 0 });
      expect(model.calls).toBe(1);
    });
  });

  describe('without an API key (Req 6.2, 8)', () => {
    it('starts in examples-only mode, refuses grant and bind, still serves examples and export', async () => {
      const model = new FakeModel({ available: false });
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
