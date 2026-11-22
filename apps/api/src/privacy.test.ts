import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { inspect } from 'node:util';
import { serve } from '@hono/node-server';
import type { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { createApp } from './app';
import { FakeMeteredModel } from './budget/fake-metered';
import type { MeteredModelClient } from './budget/guarded-client';
import { GeminiModelClient } from './client/gemini';
import { runEvalCli } from './eval/script';

/**
 * Privacy (paw-api Requirement 9.7): no text that came from a caller, a model or an upstream may
 * reach stdout, stderr, a log or an error response.
 *
 * Each case carries a random canary: a run of 24 to 32 random letters with no vowels and no hex
 * letters, so no word and no id can contain a piece of it, plus an uppercase variant and a run of
 * 15 digits. A canary "appears" when any 7-character window of it appears, whatever the case. V8
 * quotes only about 10 characters of a bad JSON body, so the whole string is not the test.
 *
 * Only fake, ASCII text. On a failure nothing that was captured is printed.
 */

const EXAMPLES = fileURLToPath(new URL('../tests/fixtures/examples-cache.json', import.meta.url));
const GATE = { tier: 'free', countryHeader: 'x-test-country' } as const;
const WINDOW = 7;

interface Canary {
  lower: string;
  upper: string;
  digits: string;
}

const LETTERS = 'ghjklmnpqrstvwxz'.split('');
const canaryArb: fc.Arbitrary<Canary> = fc
  .record({
    lower: fc.array(fc.constantFrom(...LETTERS), { minLength: 24, maxLength: 32 }).map((a) => a.join('')),
    digits: fc
      .tuple(fc.integer({ min: 1, max: 9 }), fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 14, maxLength: 14 }))
      .map(([first, rest]) => `${first}${rest.join('')}`),
  })
  .map(({ lower, digits }) => ({ lower, upper: lower.toUpperCase(), digits }));

/** True when any 7-character window of any canary appears in the text, case-insensitive. */
function leaks(text: string, canary: Canary): boolean {
  const haystack = text.toLowerCase();
  for (const full of [canary.lower, canary.upper, canary.digits]) {
    const needle = full.toLowerCase();
    for (let i = 0; i + WINDOW <= needle.length; i++) {
      if (haystack.includes(needle.slice(i, i + WINDOW))) return true;
    }
  }
  return false;
}

/**
 * Capture console log/info/warn/error/debug (arguments formatted by util.inspect with showHidden,
 * so stack, cause and own properties count) and process.stdout/stderr.write, run `fn`, restore in
 * `finally`. Call it before createApp: a logger may take console.log when it is created.
 */
async function capturing<T>(fn: (seen: string[]) => Promise<T>): Promise<T> {
  const seen: string[] = [];
  const consoleMethods = ['log', 'info', 'warn', 'error', 'debug'] as const;
  const originals = consoleMethods.map((method) => console[method]);
  const originalStdout = process.stdout.write;
  const originalStderr = process.stderr.write;
  for (const method of consoleMethods) {
    console[method] = (...args: unknown[]) => {
      seen.push(args.map((arg) => inspect(arg, { showHidden: true, depth: 8 })).join(' '));
    };
  }
  const grab = (chunk: unknown): boolean => {
    seen.push(typeof chunk === 'string' ? chunk : inspect(chunk));
    return true;
  };
  process.stdout.write = grab as typeof process.stdout.write;
  process.stderr.write = grab as typeof process.stderr.write;
  try {
    return await fn(seen);
  } finally {
    consoleMethods.forEach((method, i) => {
      console[method] = originals[i] as never;
    });
    process.stdout.write = originalStdout;
    process.stderr.write = originalStderr;
  }
}

function buildApp(model: MeteredModelClient): Hono {
  return createApp({
    model,
    budget: { perIpLimit: 1_000_000, windowMs: 60_000, dailyBudgetCents: 100_000 },
    corsOrigin: '*',
    examplesCachePath: EXAMPLES,
    gate: GATE,
  });
}

const LIVE_HEADERS: Record<string, string> = {
  'content-type': 'application/json',
  'x-forwarded-for': '203.0.113.7',
  'x-test-country': 'US',
  'x-paw-adult-confirmed': 'yes',
};

interface Call {
  path: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

/** What a caller could see: the status, the body and the headers. `undefined` when the app threw. */
async function call(app: Hono, request: Call): Promise<{ status: number; text: string } | undefined> {
  try {
    const res = await app.request(`http://localhost${request.path}`, {
      method: request.method ?? 'POST',
      headers: { ...LIVE_HEADERS, ...request.headers },
      body: request.body,
    });
    const headerLines: string[] = [];
    res.headers.forEach((value, name) => headerLines.push(`${name}: ${value}`));
    return { status: res.status, text: `${await res.text()}\n${headerLines.join('\n')}` };
  } catch {
    return undefined; // Hono rethrows a thrown value that is not an Error; the edge answers 500
  }
}

/** The one check of every case: the new log lines, and the answer when it is an error. */
function expectNoLeak(
  canary: Canary,
  seen: string[],
  from: number,
  answer: { status: number; text: string } | undefined,
): void {
  const logged = leaks(seen.slice(from).join('\n'), canary);
  expect(logged, 'a canary window reached a log or a stream').toBe(false);
  if (answer && answer.status >= 400) {
    expect(leaks(answer.text, canary), 'a canary window reached an error answer').toBe(false);
  }
}

// ---------------------------------------------------------------------------
// Bodies
// ---------------------------------------------------------------------------

type Route = 'grant' | 'bind' | 'export';

function sampleGrant(text: string) {
  const curse = (id: string, type: string) => ({
    id,
    type,
    story: text.slice(0, 300) || 'Story.',
    loophole: text || 'Loophole.',
    status: 'open',
  });
  return {
    wishId: 'w1',
    narration: text.slice(0, 200) || 'Granted.',
    curses: [curse('c1', 'permissions'), curse('c2', 'time'), curse('c3', 'money')],
  };
}

function validBody(route: Route, text: string): unknown {
  if (route === 'grant') return { wish: { text: text.slice(0, 400), context: text.slice(0, 150) } };
  if (route === 'bind') {
    return { grant: sampleGrant(text), curseId: 'c1', kind: 'rewrite', clause: text.slice(0, 900) };
  }
  return { wish: { id: 'w1', text: text.slice(0, 400), createdAt: 1 }, grant: sampleGrant(text) };
}

function wrongTypeBody(route: Route, value: unknown, nested: boolean): unknown {
  if (route === 'grant') return nested ? { wish: { text: value, context: value } } : { wish: value };
  if (route === 'bind') {
    return nested
      ? { grant: { wishId: value, narration: value, curses: value }, curseId: 'c1', kind: 'rewrite', clause: 'x' }
      : { grant: value, curseId: value, kind: value, clause: value };
  }
  return nested ? { wish: { id: value, text: value, createdAt: value }, grant: sampleGrant('x') } : { wish: value, grant: value };
}

function overCapsBody(route: Route, c: Canary, which: number): unknown {
  const long = (filler: string, n: number) => c.lower + filler.repeat(n);
  if (route === 'grant') return which % 2 ? { wish: { text: 'a', context: long('c', 300) } } : { wish: { text: long('a', 600) } };
  if (route === 'bind') {
    return which % 2
      ? { ...(validBody('bind', 'x') as object), grant: sampleGrant(long('l', 1100)) }
      : { ...(validBody('bind', 'x') as object), clause: long('b', 1100) };
  }
  return { wish: { id: 'w1', text: long('a', 50), createdAt: 1 }, grant: { ...sampleGrant('x'), narration: long('n', 300) } };
}

const BODY_KINDS = [
  'valid',
  'malformed-start',
  'malformed-middle',
  'cut-short',
  'wrong-type-value',
  'wrong-type-key',
  'over-caps',
  'random-json',
] as const;

interface BodyCase {
  route: Route;
  kind: (typeof BODY_KINDS)[number];
  canary: Canary;
  cut: number;
  which: number;
  json: unknown;
}

function bodyOf(s: BodyCase): string {
  const { route, canary: c } = s;
  switch (s.kind) {
    case 'valid':
      return JSON.stringify(validBody(route, c.lower));
    case 'malformed-start':
      return c.lower + JSON.stringify(validBody(route, 'x'));
    case 'malformed-middle': {
      const text = JSON.stringify(validBody(route, 'x'));
      const mid = text.length >> 1;
      return `${text.slice(0, mid)} ${c.lower} ${text.slice(mid)}`;
    }
    case 'cut-short': {
      const text = JSON.stringify(validBody(route, c.lower));
      return text.slice(0, 1 + (s.cut % (text.length - 1)));
    }
    case 'wrong-type-value': {
      const values = [c.lower, [c.lower], { [c.lower]: c.upper }, Number(c.digits), null, true, c.upper];
      return JSON.stringify(wrongTypeBody(route, values[s.which % values.length], s.which % 2 === 0));
    }
    case 'wrong-type-key':
      return JSON.stringify({
        [c.lower]: c.lower,
        [c.upper]: { [c.lower]: 1 },
        wish: { [c.lower]: c.upper },
        grant: { [c.upper]: c.lower },
        curseId: 5,
      });
    case 'over-caps':
      return JSON.stringify(overCapsBody(route, c, s.which));
    case 'random-json':
      return JSON.stringify({ [c.lower]: s.json, wish: s.json, grant: s.json, text: c.lower, kind: c.upper });
  }
}

const bodyCaseArb: fc.Arbitrary<BodyCase> = fc.oneof(
  ...(['grant', 'bind', 'export'] as const).map((route) =>
    fc.record({
      route: fc.constant(route),
      kind: fc.constantFrom(...BODY_KINDS),
      canary: canaryArb,
      cut: fc.nat(5000),
      which: fc.nat(20),
      json: fc.jsonValue(),
    }),
  ),
);

// ---------------------------------------------------------------------------
// The tests
// ---------------------------------------------------------------------------

describe('privacy: nothing a caller sent reaches a log or an error answer', () => {
  it('sees the logs at all, and answers an unreadable body with the 400 of its route', async () => {
    await capturing(async (seen) => {
      const app = buildApp(new FakeMeteredModel());
      const expected: Array<[Route, string]> = [
        ['grant', 'Invalid wish format'],
        ['bind', 'Invalid bind request'],
        ['export', 'Invalid export request'],
      ];
      for (const [route, message] of expected) {
        const res = await app.request(`http://localhost/api/${route}`, {
          method: 'POST',
          headers: LIVE_HEADERS,
          body: '{ not json',
        });
        expect(res.status).toBe(400);
        expect(((await res.json()) as { message: string }).message).toBe(message);
      }
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.join('\n')).toContain('/api/grant');
    });
  });

  it('bodies of grant, bind and export: valid, malformed, cut short, wrong types, over the caps', async () => {
    await capturing(async (seen) => {
      const app = buildApp(new FakeMeteredModel());
      await fc.assert(
        fc.asyncProperty(bodyCaseArb, async (s) => {
          const from = seen.length;
          const answer = await call(app, { path: `/api/${s.route}`, body: bodyOf(s) });
          expectNoLeak(s.canary, seen, from, answer);
        }),
        { numRuns: 200 },
      );
      expect(seen.length).toBeGreaterThan(0);
    });
  }, 30_000);

  it('a 1 MB body, malformed and over the caps, on all three routes', async () => {
    await capturing(async (seen) => {
      const app = buildApp(new FakeMeteredModel());
      const canary: Canary = {
        lower: 'qxzvkwjhgmnpltrsqxzvkwjh',
        upper: 'QXZVKWJHGMNPLTRSQXZVKWJH',
        digits: '918273645546372',
      };
      const filler = 'a'.repeat(1024 * 1024);
      for (const route of ['grant', 'bind', 'export'] as const) {
        const bodies = [
          `${canary.lower}${filler}`,
          JSON.stringify({ wish: { text: `${canary.lower}${filler}` }, clause: 'b'.repeat(5000), grant: 'c'.repeat(5000) }),
        ];
        for (const body of bodies) {
          const from = seen.length;
          expectNoLeak(canary, seen, from, await call(app, { path: `/api/${route}`, body }));
        }
      }
      expect(seen.length).toBeGreaterThan(0);
    });
  }, 30_000);

  it('canary in the path, the query, the method and the headers', async () => {
    const where = fc.constantFrom(
      'path',
      'path-under-route',
      'query',
      'method',
      'header-name',
      'header-value',
      'forwarded-for',
      'country',
      'adult',
      'origin',
      'cookie',
    );
    await capturing(async (seen) => {
      const app = buildApp(new FakeMeteredModel());
      await fc.assert(
        fc.asyncProperty(
          fc.record({ canary: canaryArb, where, route: fc.constantFrom<Route>('grant', 'bind', 'export'), withBody: fc.boolean() }),
          async ({ canary: c, where: w, route, withBody }) => {
            const request: Call = { path: `/api/${route}`, body: JSON.stringify(validBody(route, 'x')) };
            if (!withBody) request.body = undefined;
            if (w === 'path') request.path = `/${c.lower}`;
            if (w === 'path-under-route') request.path = `/api/${route}/${c.lower}/${c.upper}`;
            if (w === 'query') request.path = `/api/${route}?${c.lower}=${c.upper}&${c.digits}`;
            if (w === 'method') request.method = c.lower;
            if (w === 'header-name') request.headers = { [`x-${c.lower}`]: c.upper };
            if (w === 'header-value') request.headers = { 'user-agent': c.lower, referer: `http://${c.lower}.invalid/` };
            if (w === 'forwarded-for') request.headers = { 'x-forwarded-for': `${c.lower}, ${c.upper}` };
            if (w === 'country') request.headers = { 'x-test-country': c.lower };
            if (w === 'adult') request.headers = { 'x-paw-adult-confirmed': c.lower };
            if (w === 'origin') request.headers = { origin: `http://${c.lower}.invalid` };
            if (w === 'cookie') request.headers = { cookie: `${c.lower}=${c.upper}`, authorization: c.lower };
            const from = seen.length;
            expectNoLeak(c, seen, from, await call(app, request));
          },
        ),
        { numRuns: 150 },
      );
      expect(seen.length).toBeGreaterThan(0);
    });
  }, 30_000);
});

// ---------------------------------------------------------------------------
// A model that fails
// ---------------------------------------------------------------------------

const FAILURES = [
  'error-with-prompt',
  'error-with-canary',
  'forged-name',
  'forged-class',
  'error-with-cause',
  'string',
  'object',
  'invalid-json',
  'wrong-shape',
] as const;

function failingModel(kind: (typeof FAILURES)[number], c: Canary): FakeMeteredModel {
  return new FakeMeteredModel({
    answer: async (prompt: string) => {
      switch (kind) {
        case 'error-with-prompt':
          throw new Error(`${prompt} ${c.lower}`);
        case 'error-with-canary':
          throw new Error(c.lower);
        case 'forged-name': {
          const err = new Error(c.lower);
          err.name = c.upper;
          throw err;
        }
        case 'forged-class': {
          class Forged extends Error {}
          Object.defineProperty(Forged, 'name', { value: c.upper });
          throw new Forged(c.lower);
        }
        case 'error-with-cause':
          throw new Error('failed', { cause: c.lower });
        case 'string':
          throw c.lower;
        case 'object':
          throw { message: c.lower, stack: c.upper, name: c.lower };
        case 'invalid-json':
          return `${c.lower} {`;
        case 'wrong-shape':
          return { narration: c.lower, curses: c.lower, [c.upper]: c.digits, closed: c.lower, reason: c.lower };
      }
    },
  });
}

describe('privacy: a model that fails', () => {
  it('echoes the prompt or the canary, forges its name and class, throws a non-Error, answers badly', async () => {
    await capturing(async (seen) => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({ canary: canaryArb, kind: fc.constantFrom(...FAILURES), route: fc.constantFrom<Route>('grant', 'bind') }),
          async ({ canary: c, kind, route }) => {
            const app = buildApp(failingModel(kind, c));
            const from = seen.length;
            const answer = await call(app, { path: `/api/${route}`, body: JSON.stringify(validBody(route, c.lower)) });
            expectNoLeak(c, seen, from, answer);
          },
        ),
        { numRuns: 60 },
      );
      expect(seen.length).toBeGreaterThan(0);
    });
  });

  it('a model whose `available` getter throws', async () => {
    await capturing(async (seen) => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({ canary: canaryArb, plain: fc.boolean(), route: fc.constantFrom<Route>('grant', 'bind') }),
          async ({ canary: c, plain, route }) => {
            const model = new FakeMeteredModel();
            Object.defineProperty(model, 'available', {
              get() {
                throw plain ? c.lower : new Error(c.lower);
              },
            });
            const app = buildApp(model);
            const from = seen.length;
            const answer = await call(app, { path: `/api/${route}`, body: JSON.stringify(validBody(route, 'x')) });
            expectNoLeak(c, seen, from, answer);
          },
        ),
        { numRuns: 30 },
      );
      expect(seen.length).toBeGreaterThan(0);
    });
  });
});

// ---------------------------------------------------------------------------
// The real Gemini client with a fake fetch and its default log
// ---------------------------------------------------------------------------

const UPSTREAM = [
  'error-body',
  'error-body-raw',
  'quota-body',
  'status-text',
  'finish-reason',
  'usage-digits',
  'model-version',
  'network-error',
  'network-error-forged',
  'not-json',
  'text-not-json',
] as const;

function envelope(extra: Record<string, unknown>, text = '{}'): Response {
  return new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, ...(extra.candidate as object) }], ...extra, candidate: undefined }),
    { status: 200 },
  );
}

function fakeFetch(kind: (typeof UPSTREAM)[number], c: Canary): typeof fetch {
  return (async () => {
    switch (kind) {
      case 'error-body':
        return new Response(JSON.stringify({ error: { message: c.lower, status: c.upper, details: [c.lower] } }), { status: 500 });
      case 'error-body-raw':
        return new Response(c.lower, { status: 400 });
      case 'quota-body':
        return new Response(JSON.stringify({ error: { message: c.lower, status: 'RESOURCE_EXHAUSTED' } }), { status: 429 });
      case 'status-text':
        return new Response('{}', { status: 500, statusText: c.lower });
      case 'finish-reason':
        return envelope({ candidate: { finishReason: c.upper } });
      case 'usage-digits': {
        const n = Number(c.digits);
        return envelope({ candidate: {}, usageMetadata: { promptTokenCount: n, candidatesTokenCount: n, thoughtsTokenCount: n } });
      }
      case 'model-version':
        return envelope({ candidate: {}, modelVersion: c.lower });
      case 'network-error':
        throw new Error(c.lower);
      case 'network-error-forged': {
        const err = new Error(c.lower);
        err.name = c.upper;
        throw err;
      }
      case 'not-json':
        return new Response(c.lower, { status: 200 });
      case 'text-not-json':
        return envelope({ candidate: {} }, c.lower);
    }
  }) as typeof fetch;
}

describe('privacy: the real Gemini client with a fake fetch and its default log', () => {
  it('error body, statusText, finishReason, usage digits, modelVersion, network error', async () => {
    await capturing(async (seen) => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({ canary: canaryArb, kind: fc.constantFrom(...UPSTREAM), route: fc.constantFrom<Route>('grant', 'bind') }),
          async ({ canary: c, kind, route }) => {
            const model = new GeminiModelClient({
              apiKey: 'fake-key-for-tests',
              models: ['gemini-3.6-flash'],
              timeoutMs: 2000,
              fetch: fakeFetch(kind, c),
            });
            const app = buildApp(model);
            const from = seen.length;
            const answer = await call(app, { path: `/api/${route}`, body: JSON.stringify(validBody(route, 'x')) });
            expectNoLeak(c, seen, from, answer);
          },
        ),
        { numRuns: 80 },
      );
      // The default log wrote model_call lines, and the capture saw them.
      expect(seen.join('\n')).toContain('model_call');
    });
  }, 30_000);
});

// ---------------------------------------------------------------------------
// The eval command
// ---------------------------------------------------------------------------

describe('privacy: the eval command', () => {
  it('prints no message of a thrown value', async () => {
    await capturing(async (seen) => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({ canary: canaryArb, kind: fc.constantFrom('error', 'forged', 'string', 'object') }),
          async ({ canary: c, kind }) => {
            const from = seen.length;
            const code = await runEvalCli([], {
              runEval: async () => {
                if (kind === 'string') throw c.lower;
                if (kind === 'object') throw { message: c.lower, name: c.upper };
                const err = new Error(c.lower);
                if (kind === 'forged') err.name = c.upper;
                throw err;
              },
              writeEvalReport: async () => {},
              writeExamplesCache: async () => {},
            });
            expect(code).toBe(1);
            expect(seen.length).toBeGreaterThan(from);
            expect(leaks(seen.slice(from).join('\n'), c), 'a canary window reached the eval output').toBe(false);
          },
        ),
        { numRuns: 40 },
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Real HTTP on 127.0.0.1
// ---------------------------------------------------------------------------

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** One POST over a real socket. `undefined` when no answer came (the caller went away or the server did). */
function post(
  port: number,
  request: { path: string; body: string; declaredLength: number; abort: boolean },
): Promise<{ status: number; text: string } | undefined> {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: request.path,
        agent: false,
        headers: { ...LIVE_HEADERS, 'content-length': String(request.declaredLength) },
      },
      (res) => {
        const parts: Buffer[] = [];
        res.on('data', (part: Buffer) => parts.push(part));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            text: `${Buffer.concat(parts).toString('utf8')}\n${JSON.stringify(res.headers)}`,
          }),
        );
        res.on('error', () => resolve(undefined));
      },
    );
    req.on('error', () => resolve(undefined));
    req.on('close', () => setTimeout(() => resolve(undefined), 50));
    req.write(request.body);
    if (request.abort) setTimeout(() => req.destroy(), 20);
    else req.end();
  });
}

describe('privacy: over real HTTP', () => {
  it('malformed, cut-short and aborted bodies, with the canary in the path and the query too', async () => {
    await capturing(async (seen) => {
      const app = buildApp(new FakeMeteredModel());
      let port = 0;
      const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
        const created = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, (info) => {
          port = info.port;
          resolve(created);
        });
      });
      try {
        await fc.assert(
          fc.asyncProperty(
            fc.record({
              canary: canaryArb,
              mode: fc.constantFrom('malformed', 'cut-short', 'aborted'),
              route: fc.constantFrom<Route>('grant', 'bind', 'export'),
            }),
            async ({ canary: c, mode, route }) => {
              const full = JSON.stringify(validBody(route, c.lower));
              const body =
                mode === 'malformed' ? `${c.lower}${full}` : full.slice(0, Math.max(2, full.length >> 1));
              const from = seen.length;
              const answer = await post(port, {
                path: `/api/${route}?${c.lower}=${c.upper}`,
                body,
                declaredLength: mode === 'aborted' ? Buffer.byteLength(body) + 500 : Buffer.byteLength(body),
                abort: mode === 'aborted',
              });
              await pause(30);
              expectNoLeak(c, seen, from, answer);
              if (mode !== 'aborted') expect(answer?.status).toBe(400);
            },
          ),
          { numRuns: 18 },
        );
        // The server is still up after all of it.
        const health = await fetch(`http://127.0.0.1:${port}/api/health`);
        expect(health.status).toBe(200);
        expect(seen.length).toBeGreaterThan(0);
      } finally {
        (server as http.Server).closeAllConnections?.();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  }, 60_000);
});
