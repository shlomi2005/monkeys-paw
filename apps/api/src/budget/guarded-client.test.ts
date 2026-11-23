import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { DAY_MS, grantWish, judgeBinding, proposeBinding } from 'paw-core';
import type { Curse, Wish } from 'paw-core';
import { BudgetedModelClient, BudgetExhaustedError } from './guarded-client';
import { FakeMeteredModel } from './fake-metered';
import { createGlobalState } from './state';
import type { BudgetConfig } from './config';
import { DEFAULT_PRICE_TABLE } from './prices';
import {
  GeminiModelClient,
  LocationRefusedError,
  MAX_OUTPUT_TOKENS,
  QuotaExhaustedError,
} from '../client/gemini';

const config = (dailyBudgetCents: number): BudgetConfig => ({
  perIpLimit: 10,
  windowMs: 60_000,
  dailyBudgetCents,
});

/**
 * One planned attempt on gemini-3.6-flash (1.50 in, 7.50 out USD per million):
 * 10000 x 1.50 / 10000 + 2000 x 7.50 / 10000 = 1.5 + 1.5 = 3 cents, exact in floating point.
 */
const PLAN_3_CENTS = [{ model: 'gemini-3.6-flash', inputTokens: 10_000, maxOutputTokens: 2_000 }];
const CEILING = 3;

/** A fake whose one attempt is planned at 3 cents. `usage: 'ceiling'` charges all of it. */
const fake = (options: ConstructorParameters<typeof FakeMeteredModel>[0] = {}) =>
  new FakeMeteredModel({ plan: PLAN_3_CENTS, usage: 'ceiling', ...options });

const guardOf = (inner: FakeMeteredModel, state = createGlobalState(0), budget = 100, now = () => 0) =>
  new BudgetedModelClient(inner, state, config(budget), now);

describe('BudgetedModelClient with a fake client', () => {
  it('passes the call through and charges the real cost, not a fixed one', async () => {
    const inner = fake({ usage: { promptTokens: 1000, outputTokens: 2000 } });
    const state = createGlobalState(0);
    const guard = guardOf(inner, state);

    await expect(guard.generate('p')).resolves.toEqual({ ok: true });
    expect(inner.calls).toBe(1);
    expect(guard.calls).toBe(1);
    expect(guard.denied).toBe(false);
    // 1000 x 1.50 / 10000 + 2000 x 7.50 / 10000
    expect(state.spentCents).toBeCloseTo(1.65, 12);
    expect(guard.costCents).toBe(state.spentCents);
    expect(state.reservedCents).toBe(0);
  });

  it('reserves the ceiling while the call runs and releases it after', async () => {
    const state = createGlobalState(0);
    let reservedDuring = -1;
    const inner = fake({
      answer: async () => {
        reservedDuring = state.reservedCents;
        return { ok: true };
      },
    });
    await guardOf(inner, state).generate('p');
    expect(reservedDuring).toBe(CEILING);
    expect(state.reservedCents).toBe(0);
  });

  it('denies before calling the inner client when spent + reserved + ceiling is above the budget', async () => {
    const inner = fake();
    const state = createGlobalState(0);
    state.spentCents = 7.5; // 7.5 + 3 = 10.5 is above 10
    const guard = guardOf(inner, state, 10);
    await expect(guard.generate('p')).rejects.toBeInstanceOf(BudgetExhaustedError);
    expect(inner.calls).toBe(0);
    expect(guard.calls).toBe(0);
    expect(guard.denied).toBe(true);
    expect(state.spentCents).toBe(7.5);
    expect(state.reservedCents).toBe(0);
  });

  it('counts what other calls have reserved', async () => {
    const inner = fake();
    const state = createGlobalState(0);
    state.reservedCents = 8; // someone else is in flight
    const guard = guardOf(inner, state, 10);
    await expect(guard.generate('p')).rejects.toBeInstanceOf(BudgetExhaustedError);
    expect(inner.calls).toBe(0);
    expect(state.reservedCents).toBe(8);
  });

  it('allows a call that lands exactly on the budget, then denies the next', async () => {
    const inner = fake();
    const state = createGlobalState(0);
    const guard = guardOf(inner, state, 6);

    await guard.generate('a');
    await guard.generate('b');
    expect(state.spentCents).toBe(6);
    await expect(guard.generate('c')).rejects.toBeInstanceOf(BudgetExhaustedError);
    expect(inner.calls).toBe(2);
    expect(guard.denied).toBe(true);
  });

  it('charges a failed call by its usage too', async () => {
    const inner = fake({
      answer: async () => {
        throw new Error('model failed');
      },
    });
    const state = createGlobalState(0);
    const guard = guardOf(inner, state);

    await expect(guard.generate('p')).rejects.toThrow('model failed');
    expect(state.spentCents).toBe(CEILING);
    expect(state.reservedCents).toBe(0);
    expect(guard.calls).toBe(1);
    expect(guard.denied).toBe(false);
  });

  it('charges the whole ceiling when no attempt reported, and releases the reservation', async () => {
    const state = createGlobalState(0);
    const quiet = fake({ silent: true });
    await guardOf(quiet, state).generate('p');
    expect(state.spentCents).toBe(CEILING);
    expect(state.reservedCents).toBe(0);

    const dying = fake({
      silent: true,
      answer: async () => {
        throw new Error('died');
      },
    });
    await expect(guardOf(dying, state).generate('p')).rejects.toThrow('died');
    expect(state.spentCents).toBe(2 * CEILING);
    expect(state.reservedCents).toBe(0);
  });

  it('charges an attempt that reported no usage its own ceiling', async () => {
    const state = createGlobalState(0);
    await guardOf(fake({ usage: null }), state).generate('p');
    expect(state.spentCents).toBe(CEILING);
  });

  it('never calls an unavailable inner client', async () => {
    const inner = fake({ available: false });
    const state = createGlobalState(0);
    const guard = guardOf(inner, state);

    await expect(guard.generate('p')).rejects.toBeInstanceOf(BudgetExhaustedError);
    expect(inner.calls).toBe(0);
    expect(guard.denied).toBe(true);
    expect(state.spentCents).toBe(0);
    expect(state.reservedCents).toBe(0);
  });

  it('rolls the day over: an elapsed day resets the spend, not the reservations', async () => {
    let now = 0;
    const inner = fake();
    const state = createGlobalState(0);
    const guard = guardOf(inner, state, 6, () => now);

    await guard.generate('a');
    await guard.generate('b');
    await expect(guard.generate('c')).rejects.toBeInstanceOf(BudgetExhaustedError);

    now = DAY_MS;
    guard.denied = false;
    await expect(guard.generate('d')).resolves.toEqual({ ok: true });
    expect(state.dayStart).toBe(DAY_MS);
    expect(state.spentCents).toBe(CEILING);

    // A call still in flight keeps its reservation across the roll.
    let release!: () => void;
    const slow = fake({ answer: () => new Promise((resolve) => (release = () => resolve({ ok: true }))) });
    const pending = guardOf(slow, state, 100, () => now).generate('slow');
    expect(state.reservedCents).toBe(CEILING);
    now = 2 * DAY_MS;
    await guardOf(fake(), state, 100, () => now).generate('other'); // rolls the day
    expect(state.spentCents).toBe(CEILING); // the day's spend restarted at this call only
    expect(state.reservedCents).toBe(CEILING); // the slow call is still reserved
    release();
    await pending;
    expect(state.reservedCents).toBe(0);
  });

  it('shares one daily spend across guards', async () => {
    const inner = fake();
    const state = createGlobalState(0);
    const one = guardOf(inner, state, 6);
    const two = guardOf(inner, state, 6);

    await one.generate('a');
    await two.generate('b');
    await expect(one.generate('c')).rejects.toBeInstanceOf(BudgetExhaustedError);
    expect(one.denied).toBe(true);
    expect(two.denied).toBe(false);
    expect(one.calls).toBe(1);
    expect(two.calls).toBe(1);
    expect(one.costCents).toBe(CEILING);
    expect(two.costCents).toBe(CEILING);
    expect(state.spentCents).toBe(one.costCents + two.costCents);
  });

  it('reserves at once, in the same tick as the check, so parallel calls cannot overspend', async () => {
    const inner = fake();
    const state = createGlobalState(0);
    const guard = guardOf(inner, state, 9); // room for three ceilings

    const results = await Promise.allSettled(Array.from({ length: 10 }, () => guard.generate('p')));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    expect(inner.calls).toBe(3);
    expect(state.spentCents).toBe(9);
    expect(state.reservedCents).toBe(0);
  });

  it('charges the real cost even when it is above the ceiling, and refuses every later call', async () => {
    // Ceiling 0.9; the real prompt was 5000 tokens, not 1000: 5000 x 1.5 / 10000 + 1000 x 7.5 / 10000 = 1.5.
    const plan = [{ model: 'gemini-3.6-flash', inputTokens: 1000, maxOutputTokens: 1000 }];
    const inner = new FakeMeteredModel({ plan, usage: { promptTokens: 5000, outputTokens: 1000 } });
    const state = createGlobalState(0);
    const guard = guardOf(inner, state, 1.2);

    await guard.generate('p'); // 0 + 0.9 <= 1.2, admitted
    expect(state.spentCents).toBeCloseTo(1.5, 12);
    expect(state.spentCents).toBeGreaterThan(1.2);
    await expect(guard.generate('q')).rejects.toBeInstanceOf(BudgetExhaustedError);
    expect(inner.calls).toBe(1);
  });

  it('prices each row of the 1.1.2027 table at its own rates', async () => {
    // 1M prompt and 1M output tokens: (input + output USD per million) x 100 cents.
    const expected: Record<string, number> = {
      'gemini-3.6-flash': 900,
      'gemini-3.8-flash': 900,
      'gemini-3.5-flash': 900,
      'gemini-3.5-flash-lite': 280,
      'gemini-3.1-flash-lite': 175,
    };
    for (const [model, cents] of Object.entries(expected)) {
      const plan = [{ model, inputTokens: 1, maxOutputTokens: 1 }];
      const inner = new FakeMeteredModel({ plan, usage: { promptTokens: 1_000_000, outputTokens: 1_000_000 } });
      const state = createGlobalState(0);
      await guardOf(inner, state, 10_000).generate('p');
      expect(state.spentCents, model).toBeCloseTo(cents, 9);
    }
    expect(Object.keys(expected).sort()).toEqual(Object.keys(DEFAULT_PRICE_TABLE).sort());
  });

  describe('an unknown model is priced at the top row (1.50 in, 7.50 out)', () => {
    const usage = { promptTokens: 1000, outputTokens: 2000 }; // 0.15 + 1.5 at the top row

    it('a modelVersion that no row matches', async () => {
      const plan = [{ model: 'gemini-3.5-flash-lite', inputTokens: 1, maxOutputTokens: 1 }];
      const state = createGlobalState(0);
      const inner = new FakeMeteredModel({ plan, usage, modelVersion: 'gemini-9-unknown' });
      await guardOf(inner, state).generate('p');
      expect(state.spentCents).toBeCloseTo(1.65, 12);
    });

    it('a requested model that no row matches, with no usage: its ceiling at the top row', async () => {
      const plan = [{ model: 'mystery-model', inputTokens: 1000, maxOutputTokens: 2000 }];
      const state = createGlobalState(0);
      await guardOf(new FakeMeteredModel({ plan, usage: null }), state).generate('p');
      expect(state.spentCents).toBeCloseTo(1.65, 12);
    });

    it('a versioned name of a known model matches its row', async () => {
      const state = createGlobalState(0);
      const plan = [{ model: 'gemini-3.6-flash', inputTokens: 1, maxOutputTokens: 1 }];
      const inner = new FakeMeteredModel({ plan, usage, modelVersion: 'gemini-3.5-flash-lite-001' });
      await guardOf(inner, state).generate('p');
      // lite: 1000 x 0.30 / 10000 + 2000 x 2.50 / 10000
      expect(state.spentCents).toBeCloseTo(0.03 + 0.5, 12);
    });

    it('a custom price table is used', async () => {
      const state = createGlobalState(0);
      const plan = [{ model: 'mine', inputTokens: 1, maxOutputTokens: 1 }];
      const guard = new BudgetedModelClient(
        new FakeMeteredModel({ plan, usage }),
        state,
        config(100),
        () => 0,
        { mine: { inputUsdPerMTok: 10, outputUsdPerMTok: 20 } },
      );
      await guard.generate('p');
      expect(state.spentCents).toBeCloseTo(1 + 4, 12);
    });
  });

  it('property: sequential calls with any usage within the ceiling never push the spend past the budget', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.double({ min: 0, max: 60, noNaN: true }),
        fc.array(
          fc.record({
            promptTokens: fc.integer({ min: 0, max: 10_000 }),
            outputTokens: fc.integer({ min: 0, max: 2_000 }),
            noUsage: fc.boolean(),
            fails: fc.boolean(),
          }),
          { maxLength: 30 },
        ),
        async (budget, steps) => {
          const state = createGlobalState(0);
          let innerCalls = 0;
          let guardCalls = 0;
          for (const step of steps) {
            const inner = fake({
              usage: step.noUsage ? null : { promptTokens: step.promptTokens, outputTokens: step.outputTokens },
              answer: async () => {
                innerCalls += 1;
                if (step.fails) throw new Error('model failed');
                return {};
              },
            });
            const guard = guardOf(inner, state, budget);
            await guard.generate('p').catch(() => undefined);
            guardCalls += guard.calls;
            expect(state.spentCents).toBeLessThanOrEqual(budget);
            expect(state.reservedCents).toBe(0);
          }
          expect(innerCalls).toBe(guardCalls);
        },
      ),
    );
  });
});

/* ---- the real GeminiModelClient under the real guard, with a stubbed fetch ---- */

const FAKE_KEY = 'test-key-not-real';

interface Stub {
  status?: number;
  text?: string;
  finishReason?: string;
  usage?: { prompt?: number; candidates?: number; thoughts?: number };
  modelVersion?: string;
}

/** A real Response whose envelope carries `usageMetadata` and `modelVersion`. */
function geminiResponse({ status = 200, text = '{"ok":true}', finishReason, usage, modelVersion }: Stub): Response {
  if (status !== 200) return new Response('{"error":{}}', { status });
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text }] }, ...(finishReason ? { finishReason } : {}) }],
      ...(usage
        ? {
            usageMetadata: {
              promptTokenCount: usage.prompt,
              candidatesTokenCount: usage.candidates,
              thoughtsTokenCount: usage.thoughts,
            },
          }
        : {}),
      ...(modelVersion ? { modelVersion } : {}),
    }),
    { status: 200 },
  );
}

function realSetup(
  responses: Array<Stub | (() => Promise<Response>)>,
  options: { models?: string[]; budget?: number; timeoutMs?: number } = {},
) {
  const queue = [...responses];
  const fetchMock = vi.fn<typeof fetch>(async () => {
    const next = queue.shift();
    if (!next) throw new Error('unexpected extra fetch');
    return typeof next === 'function' ? next() : geminiResponse(next);
  });
  const client = new GeminiModelClient({
    apiKey: FAKE_KEY,
    models: options.models ?? ['gemini-3.6-flash'],
    timeoutMs: options.timeoutMs ?? 1000,
    fetch: fetchMock,
    log: () => {},
  });
  const state = createGlobalState(0);
  const guard = new BudgetedModelClient(client, state, config(options.budget ?? 1000), () => 0);
  return { client, state, guard, fetchMock };
}

/** The ceiling of one attempt on a model priced `in`/`out` USD per million, at the client's plan. */
function attemptCeiling(inputTokens: number, inRate: number, outRate: number): number {
  return (inputTokens * inRate) / 10_000 + (MAX_OUTPUT_TOKENS * outRate) / 10_000;
}

describe('BudgetedModelClient with the real GeminiModelClient and a stubbed fetch', () => {
  const PROMPT = 'Task: JUDGE_VERDICT ask the judge';

  it('settle charges the real cost, not the ceiling: 1000 prompt + 1500 candidate + 500 thought tokens', async () => {
    const { guard, state, client } = realSetup([
      { usage: { prompt: 1000, candidates: 1500, thoughts: 500 }, modelVersion: 'gemini-3.6-flash' },
    ]);
    const ceiling = attemptCeiling(client.plan(PROMPT)[0].inputTokens, 1.5, 7.5);

    await expect(guard.generate(PROMPT)).resolves.toEqual({ ok: true });

    // 1000 x 1.50 / 10000 + 2000 x 7.50 / 10000
    expect(state.spentCents).toBeCloseTo(1.65, 12);
    expect(state.reservedCents).toBe(0);
    expect(guard.costCents).toBe(state.spentCents);
    expect(state.spentCents).toBeLessThan(ceiling);
  });

  it('reserves the whole chain ceiling while the call is in flight', async () => {
    let reservedDuring = -1;
    const models = ['gemini-3.6-flash', 'gemini-3.5-flash-lite'];
    const setup = realSetup(
      [async () => {
        reservedDuring = setup.state.reservedCents;
        return geminiResponse({ usage: { prompt: 10, candidates: 10 } });
      }],
      { models },
    );
    const inputTokens = setup.client.plan(PROMPT)[0].inputTokens;
    await setup.guard.generate(PROMPT);
    expect(reservedDuring).toBeCloseTo(
      attemptCeiling(inputTokens, 1.5, 7.5) + attemptCeiling(inputTokens, 0.3, 2.5),
      9,
    );
    expect(setup.state.reservedCents).toBe(0);
  });

  it('a fallback chain sums its attempts: 503 without usage costs its ceiling, then the real cost of the answer', async () => {
    const { guard, state, client } = realSetup(
      [{ status: 503 }, { usage: { prompt: 1000, candidates: 1000 }, modelVersion: 'gemini-3.8-flash' }],
      { models: ['gemini-3.6-flash', 'gemini-3.8-flash'] },
    );
    const primaryCeiling = attemptCeiling(client.plan(PROMPT)[0].inputTokens, 1.5, 7.5);

    await guard.generate(PROMPT);

    // 3.6-flash 503: its own ceiling. 3.8-flash: 1000 x 1.50 / 10000 + 1000 x 7.50 / 10000 = 0.9
    expect(state.spentCents).toBeCloseTo(primaryCeiling + 0.9, 9);
    expect(guard.costCents).toBe(state.spentCents);
    expect(state.reservedCents).toBe(0);
  });

  it('an attempt with no usage is charged its ceiling: a network error', async () => {
    const { guard, state, client } = realSetup(
      [() => Promise.reject(new TypeError('fetch failed'))],
      { models: ['gemini-3.6-flash', 'gemini-3.8-flash'] },
    );
    const firstCeiling = attemptCeiling(client.plan(PROMPT)[0].inputTokens, 1.5, 7.5);

    await expect(guard.generate(PROMPT)).rejects.toThrow('no response');

    // A network error does not move on, so only the first attempt is charged.
    expect(state.spentCents).toBeCloseTo(firstCeiling, 9);
    expect(state.reservedCents).toBe(0);
  });

  it('an attempt with no usage is charged its ceiling: a timeout', async () => {
    const waitsForAbort = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init!.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const client = new GeminiModelClient({
      apiKey: FAKE_KEY,
      models: ['gemini-3.6-flash', 'gemini-3.8-flash'],
      timeoutMs: 10,
      fetch: waitsForAbort,
      log: () => {},
    });
    const state = createGlobalState(0);
    const guard = new BudgetedModelClient(client, state, config(1000), () => 0);
    const firstCeiling = attemptCeiling(client.plan(PROMPT)[0].inputTokens, 1.5, 7.5);

    await expect(guard.generate(PROMPT)).rejects.toThrow('Model call timed out');
    expect(waitsForAbort).toHaveBeenCalledTimes(1);
    expect(state.spentCents).toBeCloseTo(firstCeiling, 9);
    expect(state.reservedCents).toBe(0);
  });

  it('an unreadable 200 body is charged its ceiling', async () => {
    const { guard, state, client } = realSetup([async () => new Response('garbage', { status: 200 })]);
    const ceiling = attemptCeiling(client.plan(PROMPT)[0].inputTokens, 1.5, 7.5);
    await expect(guard.generate(PROMPT)).rejects.toThrow('unreadable response');
    expect(state.spentCents).toBeCloseTo(ceiling, 9);
  });

  it('the real answering model sets the price: a cheaper modelVersion is charged less than the requested one', async () => {
    const { guard, state } = realSetup([
      { usage: { prompt: 1000, candidates: 2000 }, modelVersion: 'gemini-3.5-flash-lite-001' },
    ]);
    await guard.generate(PROMPT);
    expect(state.spentCents).toBeCloseTo(0.03 + 0.5, 12);
  });

  describe('MAX_TOKENS and cut-off JSON are failed attempts, charged by their usage', () => {
    const cutOff: Stub = {
      text: '{"closed": tru',
      finishReason: 'MAX_TOKENS',
      usage: { prompt: 800, candidates: 3000, thoughts: 1096 },
    };
    // 800 x 1.50 / 10000 + 4096 x 7.50 / 10000
    const COST_OF_CUT_OFF = 0.12 + 3.072;

    it('judgeBinding: retried once, then the fallback verdict; every attempt charged, the next model never tried', async () => {
      const curse: Curse = {
        id: 'c1',
        type: 'permissions',
        story: 'The owner quits.',
        loophole: 'Only the owner.',
        status: 'open',
      };
      const { guard, state, fetchMock } = realSetup([cutOff, cutOff, cutOff, cutOff], {
        models: ['gemini-3.6-flash', 'gemini-3.8-flash'],
      });

      const verdict = await judgeBinding(curse, proposeBinding(curse, 'Owner or deputy.', 'ears-clause'), guard);

      expect(verdict.closed).toBe(false); // paw-core's fallback
      expect(fetchMock).toHaveBeenCalledTimes(2); // one per generate: no move to gemini-3.8-flash
      expect(guard.calls).toBe(2);
      expect(state.spentCents).toBeCloseTo(2 * COST_OF_CUT_OFF, 9);
      expect(state.reservedCents).toBe(0);
      expect(guard.denied).toBe(false);
    });

    it('grantWish: the same, then the fallback grant', async () => {
      const wish: Wish = { id: 'w1', text: 'Only the owner can delete a project', createdAt: 1 };
      const { guard, state, fetchMock } = realSetup([cutOff, cutOff, cutOff, cutOff], {
        models: ['gemini-3.6-flash', 'gemini-3.8-flash'],
      });

      const grant = await grantWish(wish, guard);

      expect(grant.curses.length).toBeLessThan(3); // paw-core's fallback grant
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(guard.calls).toBe(2);
      // Each attempt used 800 prompt tokens in the stub, whatever the prompt: charged by usage.
      expect(state.spentCents).toBeCloseTo(2 * COST_OF_CUT_OFF, 9);
    });

    it('cut-off JSON with a normal finish reason is the same: one attempt, charged by usage', async () => {
      const { guard, state, fetchMock } = realSetup(
        [{ text: '{"narration": "cut of', finishReason: 'STOP', usage: { prompt: 100, candidates: 50 } }],
        { models: ['gemini-3.6-flash', 'gemini-3.8-flash'] },
      );
      await expect(guard.generate(PROMPT)).rejects.toThrow();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(state.spentCents).toBeCloseTo((100 * 1.5 + 50 * 7.5) / 10_000, 12);
    });
  });
});

describe('quota attempts: charged 0 cents, and the guard stops after one (paw-api task 114, Req 13.5, 13.6)', () => {
  const PROMPT = 'Task: JUDGE_VERDICT ask the judge';
  const MODELS = ['gemini-3.6-flash', 'gemini-3.8-flash', 'gemini-3.5-flash-lite'];

  const perModel = () =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          error: {
            status: 'RESOURCE_EXHAUSTED',
            details: [
              {
                '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
                violations: [
                  { quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', quotaDimensions: { model: 'm' } },
                ],
              },
            ],
          },
        }),
        { status: 429 },
      ),
    );
  const shared = () =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          error: {
            status: 'RESOURCE_EXHAUSTED',
            details: [
              {
                '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
                violations: [{ quotaId: 'GenerateRequestsPerDayPerProject-FreeTier', quotaDimensions: { location: 'global' } }],
              },
            ],
          },
        }),
        { status: 429 },
      ),
    );

  it('a quota attempt costs 0: spentCents does not move, reservedCents returns to 0', async () => {
    const { guard, state, fetchMock } = realSetup([shared], { models: MODELS });
    await expect(guard.generate(PROMPT)).rejects.toBeInstanceOf(QuotaExhaustedError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(state.spentCents).toBe(0);
    expect(guard.costCents).toBe(0);
    expect(state.reservedCents).toBe(0);
    expect(guard.calls).toBe(1);
  });

  it('429 on every model of the chain costs 0 in total', async () => {
    const { guard, state, fetchMock } = realSetup([perModel, perModel, perModel], { models: MODELS });
    await expect(guard.generate(PROMPT)).rejects.toBeInstanceOf(QuotaExhaustedError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(state.spentCents).toBe(0);
    expect(state.reservedCents).toBe(0);
  });

  it('a quota attempt then a success is charged only the success', async () => {
    const { guard, state } = realSetup(
      [perModel, { usage: { prompt: 1000, candidates: 1000 }, modelVersion: 'gemini-3.8-flash' }],
      { models: MODELS },
    );
    await expect(guard.generate(PROMPT)).resolves.toEqual({ ok: true });
    // 1000 x 1.50 / 10000 + 1000 x 7.50 / 10000
    expect(state.spentCents).toBeCloseTo(0.9, 12);
    expect(guard.costCents).toBe(state.spentCents);
    expect(state.reservedCents).toBe(0);
    expect(guard.quotaSpent).toBe(false);
    expect(guard.denied).toBe(false);
  });

  it('a 404 and any other failure keep the rule: charged their ceiling, only the quota attempt is free', async () => {
    const notFound = () => Promise.resolve(new Response('{}', { status: 404 }));
    const { guard, state, client } = realSetup([notFound, perModel, perModel], { models: MODELS });
    const firstCeiling = attemptCeiling(client.plan(PROMPT)[0].inputTokens, 1.5, 7.5);
    await expect(guard.generate(PROMPT)).rejects.toBeInstanceOf(QuotaExhaustedError);
    expect(state.spentCents).toBeCloseTo(firstCeiling, 9);

    const server = () => Promise.resolve(new Response('{}', { status: 502 }));
    const failing = realSetup([server], { models: MODELS });
    await expect(failing.guard.generate(PROMPT)).rejects.toThrow('HTTP 502');
    expect(failing.state.spentCents).toBeCloseTo(attemptCeiling(failing.client.plan(PROMPT)[0].inputTokens, 1.5, 7.5), 9);
    expect(failing.guard.quotaSpent).toBe(false);
  });

  it('the reservation of the whole chain is unchanged by quota answers', async () => {
    let reservedDuring = -1;
    const setup = realSetup(
      [
        () => {
          reservedDuring = setup.state.reservedCents;
          return perModel();
        },
        perModel,
        perModel,
      ],
      { models: MODELS },
    );
    const inputTokens = setup.client.plan(PROMPT)[0].inputTokens;
    await expect(setup.guard.generate(PROMPT)).rejects.toBeInstanceOf(QuotaExhaustedError);
    expect(reservedDuring).toBeCloseTo(
      attemptCeiling(inputTokens, 1.5, 7.5) + attemptCeiling(inputTokens, 1.5, 7.5) + attemptCeiling(inputTokens, 0.3, 2.5),
      9,
    );
    expect(setup.state.reservedCents).toBe(0);
  });

  it('the guard sets quotaSpent and denied on QuotaExhaustedError, and rethrows it', async () => {
    const inner = fake({
      quota: true,
      answer: async () => {
        throw new QuotaExhaustedError();
      },
    });
    const state = createGlobalState(0);
    const guard = guardOf(inner, state);
    expect(guard.quotaSpent).toBe(false);
    await expect(guard.generate('p')).rejects.toBeInstanceOf(QuotaExhaustedError);
    expect(guard.quotaSpent).toBe(true);
    expect(guard.denied).toBe(true);
    expect(state.spentCents).toBe(0);
    expect(state.reservedCents).toBe(0);
  });

  it('after a quota answer a second generate makes no inner call, reserves nothing and does not even roll the day', async () => {
    const { client, state, fetchMock } = realSetup([shared], { models: MODELS });
    let clock = 0;
    const guard = new BudgetedModelClient(client, state, config(1000), () => clock);
    await expect(guard.generate(PROMPT)).rejects.toBeInstanceOf(QuotaExhaustedError);

    clock = 2 * DAY_MS; // a day roll would reset the spend to 0
    state.spentCents = 5;
    const error = await guard.generate(PROMPT).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BudgetExhaustedError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(guard.calls).toBe(1);
    expect(state.reservedCents).toBe(0);
    expect(state.spentCents).toBe(5);
    expect(guard.denied).toBe(true);
  });

  it('a quota answer does not outlive the guard: a new guard on the same state calls the model again', async () => {
    const first = realSetup([shared], { models: MODELS });
    await expect(first.guard.generate(PROMPT)).rejects.toBeInstanceOf(QuotaExhaustedError);

    const second = new BudgetedModelClient(first.client, first.state, config(1000), () => 0);
    const calls = first.fetchMock.mock.calls.length;
    await expect(second.generate(PROMPT)).rejects.toThrow(); // the stub has no more answers
    expect(first.fetchMock.mock.calls.length).toBe(calls + 1);
    expect(second.quotaSpent).toBe(false);
  });

  it('grantWish: after the quota answer paw-core retries and falls back with no second HTTP call', async () => {
    const wish: Wish = { id: 'w1', text: 'Only the owner can delete a project', createdAt: 1 };
    const { guard, state, fetchMock } = realSetup([shared], { models: MODELS });
    const grant = await grantWish(wish, guard);
    expect(grant.curses.length).toBeLessThan(3); // paw-core's fallback grant
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(guard.quotaSpent).toBe(true);
    expect(guard.denied).toBe(true);
    expect(state.spentCents).toBe(0);
    expect(state.reservedCents).toBe(0);
  });

  it('judgeBinding: the same, with the fallback verdict', async () => {
    const curse: Curse = {
      id: 'c1',
      type: 'permissions',
      story: 'The owner quits.',
      loophole: 'Only the owner.',
      status: 'open',
    };
    const { guard, state, fetchMock } = realSetup([shared], { models: MODELS });
    const verdict = await judgeBinding(curse, proposeBinding(curse, 'Owner or deputy.', 'ears-clause'), guard);
    expect(verdict.closed).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(guard.quotaSpent).toBe(true);
    expect(guard.denied).toBe(true);
    expect(state.spentCents).toBe(0);
  });

  it('a budget refusal does not set quotaSpent, and a later, cheaper call on the same guard still fits', async () => {
    const inner = new FakeMeteredModel({ usage: null });
    const state = createGlobalState(0);
    const guard = new BudgetedModelClient(inner, state, config(4), () => 0);

    // Default fake plan: ceil(chars / 3) input tokens at 1.50 plus 4096 output tokens at 7.50 USD per million.
    // 30000 chars cost 1.5 + 3.072 cents: above 4. One char costs 3.0722: below 4.
    await expect(guard.generate('x'.repeat(30_000))).rejects.toBeInstanceOf(BudgetExhaustedError);
    expect(guard.denied).toBe(true);
    expect(guard.quotaSpent).toBe(false);
    expect(inner.calls).toBe(0);

    await expect(guard.generate('x')).resolves.toEqual({ ok: true });
    expect(inner.calls).toBe(1);
    expect(guard.quotaSpent).toBe(false);
  });
});

describe('unbilled attempts are charged 0 (paw-api task 123, Req 16)', () => {
  const PROMPT = 'Task: JUDGE_VERDICT ask the judge';
  const MODELS = ['gemini-3.6-flash', 'gemini-3.8-flash', 'gemini-3.5-flash-lite'];
  const refusal = (status: number, extra: object = {}) => () =>
    Promise.resolve(new Response(JSON.stringify({ error: { message: 'refused' }, ...extra }), { status }));

  it.each([400, 500])('a %i costs 0, with the chain reservation unchanged during the call', async (code) => {
    let reservedDuring = -1;
    const setup = realSetup(
      [
        () => {
          reservedDuring = setup.state.reservedCents;
          return refusal(code)();
        },
      ],
      { models: MODELS },
    );
    const n = setup.client.plan(PROMPT)[0].inputTokens;
    await expect(setup.guard.generate(PROMPT)).rejects.toThrow(`HTTP ${code}`);
    expect(reservedDuring).toBeCloseTo(
      attemptCeiling(n, 1.5, 7.5) + attemptCeiling(n, 1.5, 7.5) + attemptCeiling(n, 0.3, 2.5),
      9,
    );
    expect(setup.state.spentCents).toBe(0);
    expect(setup.guard.costCents).toBe(0);
    expect(setup.state.reservedCents).toBe(0);
  });

  it.each([400, 500])('a %i with usage costs that usage', async (code) => {
    const usageMetadata = { promptTokenCount: 1000, candidatesTokenCount: 1000 };
    const { guard, state } = realSetup([refusal(code, { usageMetadata })]);
    await expect(guard.generate(PROMPT)).rejects.toThrow(`HTTP ${code}`);
    // 1000 x 1.50 / 10000 + 1000 x 7.50 / 10000
    expect(state.spentCents).toBeCloseTo(0.9, 12);
  });

  it('unreadable usage costs the ceiling', async () => {
    const { guard, state, client } = realSetup([refusal(400, { usageMetadata: 'many' })]);
    const ceiling = attemptCeiling(client.plan(PROMPT)[0].inputTokens, 1.5, 7.5);
    await expect(guard.generate(PROMPT)).rejects.toThrow('HTTP 400');
    expect(state.spentCents).toBeCloseTo(ceiling, 9);
  });

  it('a timeout while the error body is read costs the ceiling', async () => {
    const hanging = () => Promise.resolve(new Response(new ReadableStream<Uint8Array>({ start() {} }), { status: 400 }));
    const { guard, state, client } = realSetup([hanging], { timeoutMs: 10 });
    const ceiling = attemptCeiling(client.plan(PROMPT)[0].inputTokens, 1.5, 7.5);
    await expect(guard.generate(PROMPT)).rejects.toThrow('timed out');
    expect(state.spentCents).toBeCloseTo(ceiling, 9);
  });

  it('a network error costs the ceiling', async () => {
    const down = () => Promise.reject(new TypeError('network down'));
    const { guard, state, client } = realSetup([down]);
    const ceiling = attemptCeiling(client.plan(PROMPT)[0].inputTokens, 1.5, 7.5);
    await expect(guard.generate(PROMPT)).rejects.toThrow();
    expect(state.spentCents).toBeCloseTo(ceiling, 9);
  });

  it('a 503 then a 400 costs only the first ceiling', async () => {
    const { guard, state, client } = realSetup([refusal(503), refusal(400)], { models: MODELS });
    const first = attemptCeiling(client.plan(PROMPT)[0].inputTokens, 1.5, 7.5);
    await expect(guard.generate(PROMPT)).rejects.toThrow('HTTP 400');
    expect(state.spentCents).toBeCloseTo(first, 9);
    expect(state.reservedCents).toBe(0);
  });
});

describe('a location refusal (paw-api task 125, Req 17)', () => {
  const PROMPT = 'Task: JUDGE_VERDICT ask the judge';
  const REFUSAL = {
    error: { code: 400, message: 'User location is not supported for the API use.', status: 'FAILED_PRECONDITION' },
  };

  function refusedSetup() {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(REFUSAL), { status: 400 }));
    const client = new GeminiModelClient({
      apiKey: 'test-key-not-real',
      models: ['gemini-3.6-flash', 'gemini-3.8-flash'],
      timeoutMs: 1000,
      fetch: fetchMock,
      log: () => {},
    });
    const state = createGlobalState(0);
    const guard = new BudgetedModelClient(client, state, config(1000), () => 0);
    return { guard, client, state, fetchMock };
  }

  it('costs 0 cents, sets locationRefused and denied, and rethrows', async () => {
    const { guard, state, fetchMock } = refusedSetup();
    expect(guard.locationRefused).toBe(false);
    await expect(guard.generate(PROMPT)).rejects.toBeInstanceOf(LocationRefusedError);
    expect(guard.locationRefused).toBe(true);
    expect(guard.denied).toBe(true);
    expect(guard.quotaSpent).toBe(false);
    expect(state.spentCents).toBe(0);
    expect(guard.costCents).toBe(0);
    expect(state.reservedCents).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a second generate throws BudgetExhaustedError and makes no fetch', async () => {
    const { guard, fetchMock } = refusedSetup();
    await expect(guard.generate(PROMPT)).rejects.toBeInstanceOf(LocationRefusedError);
    await expect(guard.generate(PROMPT)).rejects.toBeInstanceOf(BudgetExhaustedError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(guard.calls).toBe(1);
  });

  it('another guard on the same state tries the model again', async () => {
    const { guard, client, state, fetchMock } = refusedSetup();
    await expect(guard.generate(PROMPT)).rejects.toBeInstanceOf(LocationRefusedError);
    const other = new BudgetedModelClient(client, state, config(1000), () => 0);
    expect(other.locationRefused).toBe(false);
    await expect(other.generate(PROMPT)).rejects.toBeInstanceOf(LocationRefusedError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
