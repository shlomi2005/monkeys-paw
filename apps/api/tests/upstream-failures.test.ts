import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { GeminiModelClient } from '../src/client/gemini';
import { attemptCostCents, priceFor, DEFAULT_PRICE_TABLE } from '../src/budget/prices';
import { openTestDb } from '../src/edge/test-db';
import worker, { PawObject } from '../src/edge/worker';
import type { AssetsBinding, EdgeEnv, EdgeRequest, EdgeSettings, PawObjectNamespace } from '../src/edge/types';

/**
 * Requirement 19.7: every upstream failure on every model ends in a 503 that says the paw rests, never in a 200
 * with paw-core's fallback. Stubbed `fetch` only, never the network. Through the Node app and through the edge entry.
 * Each case builds a fresh app, so the per-IP limit never interferes.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

const EXAMPLES_FIXTURE = fileURLToPath(new URL('./fixtures/examples-cache.json', import.meta.url));
const RESTING = 'The paw is resting. Browse the examples until it wakes.';
const MODELS = ['gemini-3.6-flash', 'gemini-3.8-flash', 'gemini-3.5-flash-lite'];
const PRIMARY = MODELS[0];

const GRANT_BODY = { wish: { text: 'Only the owner can delete a project' } };
const STORY = {
  wishId: 'w1',
  narration: 'Granted.',
  curses: ['c1', 'c2', 'c3'].map((id, i) => ({
    id,
    type: (['permissions', 'time', 'money'] as const)[i],
    story: 'Story.',
    loophole: 'Loophole.',
    status: 'open' as const,
  })),
};
const BIND_BODY = { grant: STORY, curseId: 'c1', kind: 'rewrite', clause: 'Owner or deputy.' };

// ---------------------------------------------------------------------------------------------
// The stub
// ---------------------------------------------------------------------------------------------

/** One request the stub received: the model of its URL and the prompt text of its body. */
interface Call {
  model: string;
  prompt: string;
}

type Answer = (call: Call, init: RequestInit) => Response | Promise<Response>;
type Stub = ((input: unknown, init?: RequestInit) => Promise<Response>) & { calls: Call[] };

function makeStub(answer: Answer): Stub {
  const calls: Call[] = [];
  const stub = async (input: unknown, init: RequestInit = {}): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input);
    const model = decodeURIComponent(url.split('/').pop()!.split(':')[0]);
    const sent = JSON.parse(String(init.body)) as { contents: { parts: { text: string }[] }[] };
    const call = { model, prompt: sent.contents[0].parts[0].text };
    calls.push(call);
    return answer(call, init);
  };
  return Object.assign(stub, { calls });
}

// ---------------------------------------------------------------------------------------------
// The seven causes
// ---------------------------------------------------------------------------------------------

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

const quotaFailure = (quotaId: string, model: string) => ({
  '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
  violations: [{ quotaId, quotaDimensions: { location: 'global', model } }],
});

/** The ceiling of one request: the client's own plan for its prompt, at the price of the model it went to. */
const probe = new GeminiModelClient({ apiKey: 'a-fake-key', models: MODELS, fetch: makeStub(() => json(500, {})) as typeof fetch, log: () => {} });
function ceilingCents(call: Call): number {
  const plan = probe.plan(call.prompt).find((entry) => entry.model === call.model);
  if (!plan) throw new Error(`no plan for ${call.model}`);
  return attemptCostCents(priceFor(DEFAULT_PRICE_TABLE, call.model), plan.inputTokens, plan.maxOutputTokens);
}

const USAGE = { promptTokenCount: 1000, candidatesTokenCount: 500 };
const usageCents = (call: Call) => attemptCostCents(priceFor(DEFAULT_PRICE_TABLE, call.model), USAGE.promptTokenCount, USAGE.candidatesTokenCount);

interface Cause {
  name: string;
  answer: Answer;
  /** Upstream fetches of one grant or one bind, from the design table. */
  fetches: number;
  /** The spend of those fetches by the rule of 19.5. */
  cents: (calls: Call[]) => number;
}

const sum = (calls: Call[], each: (call: Call) => number) => calls.reduce((total, call) => total + each(call), 0);

const CAUSES: Cause[] = [
  {
    name: '429 per-day quota on every model',
    answer: ({ model }) =>
      json(429, {
        error: {
          code: 429,
          status: 'RESOURCE_EXHAUSTED',
          message: 'Quota exceeded.',
          details: [quotaFailure('GenerateRequestsPerDayPerProjectPerModel-FreeTier', model)],
        },
      }),
    fetches: 3,
    cents: () => 0,
  },
  {
    name: '429 per-minute quota with a retry hint on every model',
    answer: ({ model }) =>
      json(429, {
        error: {
          code: 429,
          status: 'RESOURCE_EXHAUSTED',
          message: 'Quota exceeded.',
          details: [
            quotaFailure('GenerateRequestsPerMinutePerProjectPerModel-FreeTier', model),
            { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '37s' },
          ],
        },
      }),
    fetches: 3,
    cents: () => 0,
  },
  {
    name: '500 on every model',
    answer: () => json(500, { error: { code: 500, status: 'INTERNAL', message: 'Internal error' } }),
    fetches: 2,
    cents: () => 0,
  },
  {
    name: '503 on every model',
    answer: () =>
      json(503, { error: { code: 503, status: 'UNAVAILABLE', message: 'The model is overloaded. Please try again later.' } }),
    fetches: 6,
    cents: (calls) => sum(calls, ceilingCents),
  },
  {
    name: 'a timeout on every model',
    answer: (_call, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init.signal;
        const fail = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
        if (signal?.aborted) fail();
        else signal?.addEventListener('abort', fail, { once: true });
      }),
    fetches: 2,
    cents: (calls) => sum(calls, ceilingCents),
  },
  {
    name: 'a network error on every model',
    answer: () => Promise.reject(new TypeError('fetch failed')),
    fetches: 2,
    cents: (calls) => sum(calls, ceilingCents),
  },
  {
    name: 'a 200 whose text fails validation on every model',
    answer: () =>
      json(200, {
        candidates: [{ content: { parts: [{ text: '{}' }] }, finishReason: 'STOP' }],
        usageMetadata: USAGE,
      }),
    fetches: 2,
    cents: (calls) => sum(calls, usageCents),
  },
];

const ROUTES = [
  { name: 'grant', path: '/api/grant', body: GRANT_BODY },
  { name: 'bind', path: '/api/bind', body: BIND_BODY },
] as const;

// ---------------------------------------------------------------------------------------------
// The two apps
// ---------------------------------------------------------------------------------------------

interface Target {
  post(path: string, body: unknown): Promise<Response>;
  /** `budget.spentCents` of `GET /api/health`. */
  spent(): Promise<number>;
}

/** `createApp` with the real Gemini client over the stub. */
function nodeTarget(stub: Stub): Target {
  const app = createApp({
    model: new GeminiModelClient({
      apiKey: 'a-fake-key',
      models: MODELS,
      timeoutMs: 30,
      fetch: stub as typeof fetch,
      log: () => {},
    }),
    budget: { perIpLimit: 10, windowMs: 60_000, dailyBudgetCents: 100_000 },
    corsOrigin: '*',
    examplesCachePath: EXAMPLES_FIXTURE,
    gate: { tier: 'free', countryHeader: 'x-test-country' },
  });
  return {
    post: (path, body) =>
      app.request(`http://localhost${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': '203.0.113.7',
          'x-test-country': 'US',
          'x-paw-adult-confirmed': 'yes',
        },
        body: JSON.stringify(body),
      }),
    spent: async () => {
      const res = await app.request('http://localhost/api/health');
      return ((await res.json()) as { budget: { spentCents: number } }).budget.spentCents;
    },
  };
}

/** The real Worker and a real PawObject over a test database, with a fake namespace and fake ASSETS. */
function edgeTarget(stub: Stub): Target {
  vi.stubGlobal('fetch', stub); // before the object is built: edgeAppDeps binds the global
  const env = {
    GEMINI_API_KEY: 'a-fake-key',
    GEMINI_TIER: 'free',
    GEMINI_TIMEOUT_MS: '30',
    DAILY_BUDGET_CENTS: '100000',
  } as EdgeSettings as EdgeEnv;

  const db = openTestDb();
  let object: PawObject | undefined;
  const inner: PawObjectNamespace = {
    idFromName: (name) => `id:${name}`,
    get: () => ({
      fetch: (request) => {
        object ??= new PawObject({ storage: { sql: db.sql } }, env);
        return object.fetch(request);
      },
    }),
  };
  const assets: AssetsBinding = { fetch: async () => new Response('asset', { status: 200 }) };
  env.PAW = { jurisdiction: () => inner, idFromName: inner.idFromName, get: inner.get };
  env.ASSETS = assets;

  const send = (path: string, method: string, headers: Record<string, string>, body?: unknown) => {
    const request = new Request(`https://paw.example${path}`, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    Object.defineProperty(request, 'cf', { value: { country: 'US' } });
    return worker.fetch(request as EdgeRequest, env);
  };

  return {
    post: (path, body) => send(path, 'POST', { 'x-paw-adult-confirmed': 'yes', 'cf-connecting-ip': '198.51.100.7' }, body),
    spent: async () => {
      const res = await send('/api/health', 'GET', {});
      return ((await res.json()) as { budget: { spentCents: number } }).budget.spentCents;
    },
  };
}

const APPS: [string, (stub: Stub) => Target][] = [
  ['node', nodeTarget],
  ['edge', edgeTarget],
];

const ROWS = ROUTES.flatMap((route) => CAUSES.map((cause) => [`${route.name}: ${cause.name}`, route, cause] as const));

describe.each(APPS)('%s', (_app, makeTarget) => {
  it.each(ROWS)('%s', async (_title, route, cause) => {
    const stub = makeStub(cause.answer);
    const target = makeTarget(stub);
    const before = await target.spent();

    const res = await target.post(route.path, route.body);
    const text = await res.text();

    expect(res.status).toBe(503);
    expect(JSON.parse(text)).toMatchObject({ message: RESTING });
    expect(text).not.toContain('fallback-curse');
    expect(text).not.toContain('only shape it could remember');
    expect(text).not.toContain('could not be roused');
    expect(stub.calls).toHaveLength(cause.fetches);

    const after = await target.spent();
    // `/api/health` rounds the running total to three decimals, so allow one display unit.
    expect(Math.abs(after - before - cause.cents(stub.calls))).toBeLessThanOrEqual(0.0011);
  });
});
