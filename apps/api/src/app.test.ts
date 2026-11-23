import { describe, it, expect, vi } from 'vitest';
import { DAY_MS } from 'paw-core';
import { createApp } from './app';
import { DEFAULT_MODEL_CHAIN, GeminiModelClient } from './client/gemini';
import { GATE_MESSAGES } from './gate/middleware';
import { FakeMeteredModel } from './budget/fake-metered';
import type { FakeMeteredOptions } from './budget/fake-metered';
import type { MeteredModelClient } from './budget/guarded-client';
import type { BudgetConfig } from './budget/config';
import type { GateConfig } from './gate/config';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { FakeBudgetStore } from './budget/fake-store';
import { attemptCostCents, priceFor, DEFAULT_PRICE_TABLE } from './budget/prices';

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

// The gate of these tests lets everyone in (a free-tier country, confirmed), so the tests below mean
// what they meant before the gate. The gate itself is tested in gate/gate.test.ts.
const TEST_GATE: GateConfig = { tier: 'free', countryHeader: 'x-test-country' };
const GATE_HEADERS = { 'x-test-country': 'US', 'x-paw-adult-confirmed': 'yes' };

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
    gate: TEST_GATE,
  });
}

type App = ReturnType<typeof makeApp>;

function post(app: App, path: string, body: unknown, ip = '203.0.113.7') {
  return app.request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...GATE_HEADERS },
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
        gate: TEST_GATE,
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

  describe('the free quota is spent (paw-api task 115, Req 1.9, 2.9, 8.6)', () => {
    const MODELS = ['model-a', 'model-b', 'model-c'];
    const quotaAnswer = (code: number, body: unknown = {}) => () =>
      new Response(JSON.stringify(body), { status: code });

    /** The real Gemini client over a stubbed fetch: every call answers with `answer`. Never the network. */
    function quotaApp(answer: () => Response) {
      const fetchMock = vi.fn<typeof fetch>(async () => answer());
      const client = new GeminiModelClient({
        apiKey: 'test-key',
        models: MODELS,
        timeoutMs: 1000,
        fetch: fetchMock,
        log: () => {},
      });
      return { app: makeApp(client), fetchMock };
    }

    const bindBody = { grant: sampleGrant, curseId: 'c1', kind: 'rewrite', clause: 'Owner or deputy.' };

    it('429 on every model gives 503 with RESTING_MESSAGE on /api/grant, with no fallback grant and no retry round', async () => {
      const { app, fetchMock } = quotaApp(quotaAnswer(429));
      const res = await post(app, '/api/grant', grantBody);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ message: RESTING });
      expect(fetchMock).toHaveBeenCalledTimes(MODELS.length); // paw-core's retry makes no second round
    });

    it('429 on every model gives 503 with RESTING_MESSAGE on /api/bind, not the fallback verdict', async () => {
      const { app, fetchMock } = quotaApp(quotaAnswer(429));
      const res = await post(app, '/api/bind', bindBody);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ message: RESTING });
      expect(fetchMock).toHaveBeenCalledTimes(MODELS.length);
    });

    it('RESOURCE_EXHAUSTED in the body of another status gives the same 503', async () => {
      const body = { error: { code: 403, status: 'RESOURCE_EXHAUSTED', message: 'quota' } };
      for (const code of [403, 503, 400]) {
        const { app } = quotaApp(quotaAnswer(code, body));
        const grant = await post(app, '/api/grant', grantBody);
        expect(grant.status, `grant ${code}`).toBe(503);
        expect(await grant.json()).toEqual({ message: RESTING });
        const bind = await post(app, '/api/bind', bindBody);
        expect(bind.status, `bind ${code}`).toBe(503);
        expect(await bind.json()).toEqual({ message: RESTING });
      }
    });

    it('a quota shared by all models stops after one HTTP call', async () => {
      const shared = {
        error: {
          status: 'RESOURCE_EXHAUSTED',
          details: [
            {
              '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
              violations: [{ quotaId: 'GenerateRequestsPerDayPerProject-FreeTier', quotaDimensions: { location: 'global' } }],
            },
          ],
        },
      };
      const { app, fetchMock } = quotaApp(quotaAnswer(429, shared));
      expect((await post(app, '/api/grant', grantBody)).status).toBe(503);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('health still says normal, and nothing was charged', async () => {
      const { app } = quotaApp(quotaAnswer(429));
      expect((await post(app, '/api/grant', grantBody)).status).toBe(503);
      expect(await health(app)).toMatchObject({
        status: 'ok',
        mode: 'normal',
        budget: { spentCents: 0, remainingCents: 500 },
      });
    });

    it('keeps nothing for the next request: the model is tried again', async () => {
      const { app, fetchMock } = quotaApp(quotaAnswer(429));
      await post(app, '/api/grant', grantBody, '203.0.113.1');
      expect(fetchMock).toHaveBeenCalledTimes(MODELS.length);
      await post(app, '/api/grant', grantBody, '203.0.113.2');
      expect(fetchMock).toHaveBeenCalledTimes(2 * MODELS.length);
    });
  });

  describe('refused calls are not billed (paw-api task 123, Req 16)', () => {
    const REFUSED_400 =
      '{"error":{"code":400,"status":"FAILED_PRECONDITION","message":"User location is not supported for the API use."}}';

    it.each([
      [400, REFUSED_400],
      [500, '{"error":{"code":500,"status":"INTERNAL","message":"Internal error."}}'],
    ])('40 grants from 40 addresses, each answered %i, never rest the paw', async (code, body) => {
      const fetchMock = vi.fn<typeof fetch>(async () => new Response(body, { status: code }));
      const client = new GeminiModelClient({
        apiKey: 'test-key',
        models: ['model-a'],
        timeoutMs: 1000,
        fetch: fetchMock,
        log: () => {},
      });
      const app = makeApp(client, { budget: { dailyBudgetCents: 200 } });
      for (let i = 0; i < 40; i += 1) {
        const res = await post(app, '/api/grant', grantBody, `203.0.113.${i + 1}`);
        expect(res.status, `grant ${i}`).not.toBe(503);
      }
      expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(40);
      expect(await health(app)).toMatchObject({
        mode: 'normal',
        budget: { spentCents: 0, remainingCents: 200 },
      });
      const live = await app.request('http://localhost/api/live', { headers: GATE_HEADERS });
      expect(await live.json()).not.toHaveProperty('resting');
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

  describe('budget store and examples loader (paw-edge task 2, Req 5, 7)', () => {
    const RESTART_BUDGET: BudgetConfig = { perIpLimit: 100, windowMs: 60_000, dailyBudgetCents: 500 };
    const GEMINI_GRANT = JSON.stringify({
      narration: 'Granted.',
      curses: [
        { id: 'x', type: 'permissions', story: 'The owner quits.', loophole: '"owner"' },
        { id: 'x', type: 'time', story: 'Midnight where?', loophole: '"midnight"' },
        { id: 'x', type: 'scale', story: 'Zero projects.', loophole: '"project"' },
      ],
    });
    const okResponse = () =>
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: GEMINI_GRANT }] } }],
          usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 100 },
        }),
        { status: 200 },
      );

    function storeApp(
      model: MeteredModelClient,
      store: FakeBudgetStore | undefined,
      clock: () => number = () => 1_000_000,
    ) {
      return createApp({
        model,
        budget: RESTART_BUDGET,
        corsOrigin: '*',
        examplesCachePath: EXAMPLES_FIXTURE,
        clock,
        gate: TEST_GATE,
        budgetStore: store,
      });
    }

    function geminiOver(fetchMock: typeof fetch) {
      return new GeminiModelClient({
        apiKey: 'test-key',
        models: ['model-a'],
        timeoutMs: 60_000,
        fetch: fetchMock,
        log: () => {},
      });
    }

    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

    it('no store: nothing is saved and the numbers are as before', async () => {
      const store = new FakeBudgetStore();
      const withoutStore = storeApp(new FakeModel(), undefined);
      expect((await post(withoutStore, '/api/grant', grantBody)).status).toBe(200);
      const spent = (await health(withoutStore)).budget.spentCents;
      expect(spent).toBeGreaterThan(0);
      expect(spent).toBeLessThan(1);
      expect(store.saves).toHaveLength(0);
      expect(store.load()).toBeUndefined();
    });

    it('with a store, the state is saved once at creation', () => {
      const store = new FakeBudgetStore();
      storeApp(new FakeModel(), store);
      expect(store.saves).toEqual([{ spentCents: 0, reservedCents: 0, dayStart: 1_000_000 }]);
    });

    it('restart: a second app over the same store reports the same spentCents', async () => {
      const store = new FakeBudgetStore();
      const one = storeApp(new FakeModel(), store);
      expect((await post(one, '/api/grant', grantBody)).status).toBe(200);
      const before = await health(one);
      expect(before.budget.spentCents).toBeGreaterThan(0);

      const two = storeApp(new FakeModel(), store);
      const after = await health(two);
      expect(after.budget.spentCents).toBe(before.budget.spentCents);
      expect(after.budget.remainingCents).toBe(before.budget.remainingCents);
    });

    it('a leftover reservation counts as spent after a restart', async () => {
      const store = new FakeBudgetStore({ spentCents: 20, reservedCents: 0, dayStart: 1_000_000 });
      const never = vi.fn<typeof fetch>(() => new Promise<Response>(() => {}));
      const one = storeApp(geminiOver(never), store);
      void post(one, '/api/grant', grantBody); // never settles
      while (never.mock.calls.length === 0) await tick();

      const saved = store.last!;
      expect(saved.spentCents).toBe(20);
      expect(saved.reservedCents).toBeGreaterThan(0);

      const two = storeApp(new FakeModel(), store);
      const h = await health(two);
      expect(h.budget.spentCents).toBeCloseTo(20 + saved.reservedCents, 3);
      expect(h.budget.remainingCents).toBeCloseTo(500 - 20 - saved.reservedCents, 3);
      expect(store.last!.reservedCents).toBe(0);
      expect(store.last!.spentCents).toBeCloseTo(20 + saved.reservedCents, 9);
    });

    const unreadable: Array<[string, unknown]> = [
      ['a missing field', { spentCents: 1, dayStart: 1_000_000 }],
      ['NaN', { spentCents: NaN, reservedCents: 0, dayStart: 1_000_000 }],
      ['Infinity', { spentCents: 1, reservedCents: Infinity, dayStart: 1_000_000 }],
      ['a negative number', { spentCents: -5, reservedCents: 0, dayStart: 1_000_000 }],
      ['a wrong type', { spentCents: '1', reservedCents: 0, dayStart: 1_000_000 }],
    ];
    for (const [name, row] of unreadable) {
      it(`an unreadable row (${name}) is a spent day: examples-only, nothing remaining`, async () => {
        const model = new FakeModel();
        const app = storeApp(model, new FakeBudgetStore(row));
        const h = await health(app);
        expect(h.mode).toBe('examples-only');
        expect(h.budget).toMatchObject({ spentCents: 500, remainingCents: 0 });
        expect((await post(app, '/api/grant', grantBody)).status).toBe(503);
        expect(model.calls).toBe(0);
      });
    }

    it('the reservation is saved before the first upstream fetch, at least at the ceiling', async () => {
      const store = new FakeBudgetStore();
      const seen: Array<{ reservedCents: number }> = [];
      const fetchMock = vi.fn<typeof fetch>(async () => {
        seen.push({ reservedCents: store.last!.reservedCents });
        return okResponse();
      });
      const client = geminiOver(fetchMock);
      const planSpy = vi.spyOn(client, 'plan');
      const app = storeApp(client, store);
      planSpy.mockClear(); // createApp calls plan() once itself; keep only the request's calls
      await post(app, '/api/grant', grantBody);

      expect(fetchMock).toHaveBeenCalled();
      const ceiling = (planSpy.mock.results[0].value as ReturnType<GeminiModelClient['plan']>).reduce(
        (sum, a) =>
          sum + attemptCostCents(priceFor(DEFAULT_PRICE_TABLE, a.model), a.inputTokens, a.maxOutputTokens),
        0,
      );
      expect(ceiling).toBeGreaterThan(0);
      expect(seen[0].reservedCents).toBeGreaterThanOrEqual(ceiling);
    });

    it('a day roll is saved', async () => {
      let now = 1_000_000;
      const store = new FakeBudgetStore();
      const app = storeApp(new FakeModel(), store, () => now);
      await post(app, '/api/grant', grantBody);
      expect(store.last!.spentCents).toBeGreaterThan(0);

      now += DAY_MS;
      await health(app);
      expect(store.last).toEqual({ spentCents: 0, reservedCents: 0, dayStart: now });
    });

    it('a store whose save throws at the reservation: fixed 500 and the model is never called', async () => {
      const store = new FakeBudgetStore();
      store.failWhen = (s) => s.reservedCents > 0;
      const fetchMock = vi.fn<typeof fetch>(async () => okResponse());
      const app = storeApp(geminiOver(fetchMock), store);
      const res = await post(app, '/api/grant', grantBody);
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ message: 'An error occurred while granting your wish' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('only spentCents, reservedCents and dayStart are saved, whatever the addresses', async () => {
      const store = new FakeBudgetStore();
      const app = storeApp(new FakeModel(), store);
      const ips = Array.from({ length: 20 }, (_, i) => `198.51.100.${i + 1}`);
      for (const ip of ips) expect((await post(app, '/api/grant', grantBody, ip)).status).toBe(200);
      expect(store.saves.length).toBeGreaterThan(ips.length);
      for (const saved of store.saves) {
        expect(Object.keys(saved).sort()).toEqual(['dayStart', 'reservedCents', 'spentCents']);
        for (const value of Object.values(saved)) expect(typeof value).toBe('number');
      }
      const text = JSON.stringify(store.saves);
      for (const ip of ips) expect(text).not.toContain(ip);
    });

    describe('examples loader', () => {
      const examplesText = readFileSync(EXAMPLES_FIXTURE, 'utf-8');
      const getExamples = (app: App) => app.request('http://localhost/api/examples');
      const base = { model: new FakeModel(), budget: BUDGET, corsOrigin: '*', gate: TEST_GATE };

      it('a loader with the valid fixture gives 200', async () => {
        const app = createApp({ ...base, loadExamples: async () => examplesText });
        const res = await getExamples(app);
        expect(res.status).toBe(200);
        expect(Array.isArray(await res.json())).toBe(true);
      });

      it('the loader wins over the path', async () => {
        const app = createApp({
          ...base,
          examplesCachePath: '/nonexistent/cache.json',
          loadExamples: async () => examplesText,
        });
        expect((await getExamples(app)).status).toBe(200);
      });

      it('text that is not JSON gives the "not yet generated" 503', async () => {
        const app = createApp({ ...base, loadExamples: async () => 'not json' });
        const res = await getExamples(app);
        expect(res.status).toBe(503);
        expect(await res.json()).toEqual({ message: 'Examples cache not yet generated' });
      });

      it('a throwing loader gives the "not yet generated" 503', async () => {
        const app = createApp({
          ...base,
          loadExamples: async () => {
            throw new Error('boom');
          },
        });
        const res = await getExamples(app);
        expect(res.status).toBe(503);
        expect(await res.json()).toEqual({ message: 'Examples cache not yet generated' });
      });

      it('valid JSON of the wrong shape still gives the corrupted 503', async () => {
        const app = createApp({ ...base, loadExamples: async () => '{"a":1}' });
        const res = await getExamples(app);
        expect(res.status).toBe(503);
        expect(await res.json()).toEqual({ message: 'Examples cache is corrupted' });
      });

      it('the path form is unchanged, and neither source gives the 503', async () => {
        const withPath = createApp({ ...base, examplesCachePath: EXAMPLES_FIXTURE });
        expect((await getExamples(withPath)).status).toBe(200);
        const neither = createApp({ ...base });
        const res = await getExamples(neither);
        expect(res.status).toBe(503);
        expect(await res.json()).toEqual({ message: 'Examples cache not yet generated' });
      });
    });
  });
});

describe('a location refusal gives the ready rounds (paw-api task 125, Req 17)', () => {
  const REFUSAL =
    '{"error":{"code":400,"message":"User location is not supported for the API use.","status":"FAILED_PRECONDITION"}}';
  const bindBody = { grant: sampleGrant, curseId: 'c1', kind: 'rewrite', clause: 'Owner or deputy.' };
  const GATE_BODY = { code: 'live_region_unavailable', message: GATE_MESSAGES.live_region_unavailable };

  /** The real client over a stubbed fetch, with its default log line on stdout. Never the network. */
  function refusedApp() {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(REFUSAL, { status: 400 }));
    const client = new GeminiModelClient({
      apiKey: 'test-key',
      models: ['model-a', 'model-b', 'model-c', 'model-d'],
      timeoutMs: 1000,
      fetch: fetchMock,
    });
    return { app: makeApp(client), fetchMock };
  }

  /** Runs `fn` with every way of printing captured; returns what was printed. */
  async function printedDuring(fn: () => Promise<void>): Promise<string> {
    const lines: string[] = [];
    const take = (chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    };
    const spies = [
      vi.spyOn(process.stdout, 'write').mockImplementation(take as never),
      vi.spyOn(process.stderr, 'write').mockImplementation(take as never),
      vi.spyOn(console, 'log').mockImplementation(take),
      vi.spyOn(console, 'error').mockImplementation(take),
      vi.spyOn(console, 'warn').mockImplementation(take),
    ];
    try {
      await fn();
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
    return lines.join('\n');
  }

  it.each([
    ['/api/grant', grantBody],
    ['/api/bind', bindBody],
  ])('POST %s gives the gate\'s 403 body, no-store, 1 upstream fetch and 0 cents', async (path, body) => {
    const { app, fetchMock } = refusedApp();
    const printed = await printedDuring(async () => {
      const res = await post(app, path, body);
      expect(res.status).toBe(403);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.json()).toEqual(GATE_BODY);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await health(app)).budget.spentCents).toBe(0);
    expect(printed).not.toMatch(/location is not supported/i);
    expect(printed).not.toContain('FAILED_PRECONDITION');
  });

  it.each([
    ['/api/grant', grantBody],
    ['/api/bind', bindBody],
  ])('POST %s keeps nothing: the next request tries the model again, and health says normal', async (path, body) => {
    const { app, fetchMock } = refusedApp();
    await post(app, path, body, '203.0.113.1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const second = await post(app, path, body, '203.0.113.2');
    expect(second.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await health(app)).toMatchObject({ mode: 'normal', budget: { spentCents: 0 } });
  });

  it('a 400 with another message is not the gate\'s 403', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response('{"error":{"message":"details"}}', { status: 400 }),
    );
    const client = new GeminiModelClient({
      apiKey: 'test-key',
      models: ['model-a'],
      timeoutMs: 1000,
      fetch: fetchMock,
      log: () => {},
    });
    const res = await post(makeApp(client), '/api/grant', grantBody);
    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe('health, live and grant agree on whether a live wish can start (paw-api task 126, Req 18)', () => {
  /** The real client, default chain, over a stubbed fetch that answers 500. Never the network. */
  function startApp(spentCents: number) {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response('{"error":{"message":"details"}}', { status: 500 }),
    );
    const client = new GeminiModelClient({
      apiKey: 'test-key',
      models: [...DEFAULT_MODEL_CHAIN],
      timeoutMs: 1000,
      fetch: fetchMock,
      log: () => {},
    });
    const store = new FakeBudgetStore({ spentCents, reservedCents: 0, dayStart: 1_000_000 });
    const app = createApp({
      model: client,
      budget: { ...BUDGET, perIpLimit: 100, dailyBudgetCents: 200 },
      corsOrigin: '*',
      examplesCachePath: EXAMPLES_FIXTURE,
      clock: () => 1_000_000,
      gate: TEST_GATE,
      budgetStore: store,
    });
    return { app, fetchMock };
  }

  const live = async (app: App) =>
    (await app.request('http://localhost/api/live', { headers: GATE_HEADERS })).json();

  it('budget 200 at 191.98 spent: examples-only, resting, and the grant gets 503 with 0 fetches', async () => {
    // The start ceiling of the default chain is about 8.38 cents, so 191.98 + 8.38 passes 200.
    const { app, fetchMock } = startApp(191.98);
    expect((await health(app)).mode).toBe('examples-only');
    expect(await live(app)).toEqual({ live: true, resting: true });
    const res = await post(app, '/api/grant', grantBody);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ message: RESTING });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('just under the threshold: normal, live without resting, the first call of a grant is reserved', async () => {
    const { app, fetchMock } = startApp(191.6); // 191.6 + 8.38 is 199.98
    expect((await health(app)).mode).toBe('normal');
    expect(await live(app)).toEqual({ live: true });
    await post(app, '/api/grant', grantBody);
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(1);
  });
});
