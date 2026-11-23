import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fc from 'fast-check';
import { build } from 'esbuild';
import { createApp } from '../src/app';
import { FakeBudgetStore } from '../src/budget/fake-store';
import { GRANT_CALLS, BIND_CALLS } from '../src/budget/worst-case';
import { EDGE_MAX_MODELS, edgeAppDeps, edgeModelChain } from '../src/edge/config';
import { createSqlBudgetStore } from '../src/edge/sql-store';
import { openTestDb } from '../src/edge/test-db';
import type { TestDb } from '../src/edge/test-db';
import * as entry from '../src/edge/worker';
import worker, { PawObject } from '../src/edge/worker';
import type { AssetsBinding, EdgeEnv, EdgeRequest, EdgeSettings, PawObjectNamespace } from '../src/edge/types';

const API_ROOT = fileURLToPath(new URL('..', import.meta.url));
const REPO_ROOT = path.join(API_ROOT, '..', '..');

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------------------------
// Harness: the real entry and a real PawObject, with a fake namespace, fake ASSETS and fake fetch.
// ---------------------------------------------------------------------------------------------

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

/** A 200 answer with one text part and a small usage count. */
function okResponse(text: string): Response {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 500 },
    }),
    { status: 200 },
  );
}

/** Every attempt answers a valid envelope holding `{}`: a failed validation that is still billed. */
const billedNothingFetch = () => vi.fn(async (_url: unknown, _init?: unknown) => okResponse('{}'));

interface Harness {
  env: EdgeEnv;
  objects: PawObject[];
  jurisdictions: string[];
  assetPaths: string[];
  dbs: TestDb[];
  fetchMock: ReturnType<typeof vi.fn>;
  /** A new PawObject over the database of the first one, as after an eviction. */
  restart(): void;
}

function harness(settings: Record<string, string | undefined> = {}, fetchMock = vi.fn(async () => new Response('{}', { status: 503 }))): Harness {
  vi.stubGlobal('fetch', fetchMock); // before any object is built: the object binds the global
  const objects: PawObject[] = [];
  const dbs: TestDb[] = [];
  const jurisdictions: string[] = [];
  const assetPaths: string[] = [];
  const dbById = new Map<string, TestDb>();
  const current = new Map<string, PawObject>();

  const env = {
    GEMINI_API_KEY: 'a-fake-key',
    DAILY_BUDGET_CENTS: '100000',
    ...settings,
  } as EdgeSettings as EdgeEnv;

  const buildObject = (id: string): PawObject => {
    let db = dbById.get(id);
    if (!db) {
      db = openTestDb();
      dbById.set(id, db);
      dbs.push(db);
    }
    const object = new PawObject({ storage: { sql: db.sql } }, env);
    objects.push(object);
    current.set(id, object);
    return object;
  };

  const inner: PawObjectNamespace = {
    idFromName: (name) => `id:${name}`,
    get: (id) => ({
      fetch: (request) => (current.get(String(id)) ?? buildObject(String(id))).fetch(request),
    }),
  };
  const assets: AssetsBinding = {
    fetch: async (request) => {
      assetPaths.push(new URL(request.url).pathname);
      return new Response('asset', { status: 200 });
    },
  };
  env.PAW = {
    jurisdiction: (name) => {
      jurisdictions.push(name);
      return inner;
    },
    idFromName: inner.idFromName,
    get: inner.get,
  };
  env.ASSETS = assets;

  return {
    env,
    objects,
    jurisdictions,
    assetPaths,
    dbs,
    fetchMock,
    restart: () => {
      buildObject('id:paw');
    },
  };
}

interface Call {
  method?: string;
  path: string;
  headers?: Record<string, string>;
  /** `request.cf`. Omitted means no `cf` at all. */
  cf?: unknown;
  body?: unknown;
}

function makeRequest(call: Call): EdgeRequest {
  const request = new Request(`https://paw.example${call.path}`, {
    method: call.method ?? 'GET',
    headers: {
      ...(call.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...call.headers,
    },
    body: call.body !== undefined ? JSON.stringify(call.body) : undefined,
  });
  if ('cf' in call) Object.defineProperty(request, 'cf', { value: call.cf });
  return request as EdgeRequest;
}

const send = (h: Harness, call: Call) => worker.fetch(makeRequest(call), h.env);

const FORGED_REFUSED = {
  'x-paw-country': 'DE',
  'X-Paw-Dev-Country': 'DE',
  'cf-ipcountry': 'DE',
  'true-client-ip': '203.0.113.5',
};
const FORGED_US = {
  'x-paw-country': 'US',
  'x-paw-dev-country': 'US',
  'cf-ipcountry': 'US',
};
const ADULT = { 'x-paw-adult-confirmed': 'yes' };

const live = async (h: Harness, call: Omit<Call, 'path'>) => (await send(h, { ...call, path: '/api/live' })).json();
const grant = (h: Harness, call: Omit<Call, 'path' | 'method' | 'body'>, body: unknown = GRANT_BODY) =>
  send(h, { ...call, path: '/api/grant', method: 'POST', body });

// ---------------------------------------------------------------------------------------------
// The entry
// ---------------------------------------------------------------------------------------------

describe('the entry routes', () => {
  it('asks for the "us" jurisdiction and one fixed object name', async () => {
    const h = harness();
    await send(h, { path: '/api/health', cf: { country: 'IL' } });
    await send(h, { path: '/api/live', cf: { country: 'IL' } });
    expect(h.jurisdictions).toEqual(['us', 'us']);
    expect(h.objects).toHaveLength(1);
  });

  it('falls back to the plain namespace when the runtime has no jurisdictions', async () => {
    const h = harness();
    h.env.PAW.jurisdiction = () => {
      throw new Error('Jurisdiction restrictions are not implemented in workerd.');
    };
    const response = await send(h, { path: '/api/health', cf: { country: 'IL' } });
    expect(response.status).toBe(200);
    expect(h.objects).toHaveLength(1);
  });

  it('answers the fixed 500 on any other jurisdiction error and builds no object', async () => {
    const h = harness();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.env.PAW.jurisdiction = () => {
      throw new Error('secret-detail');
    };
    const response = await send(h, { path: '/api/health' });
    const text = await response.text();
    expect(response.status).toBe(500);
    expect(JSON.parse(text)).toEqual({ message: 'An error occurred while handling the request' });
    expect(text).not.toContain('secret-detail');
    expect(h.objects).toHaveLength(0);
    spy.mockRestore();
  });

  it('answers the fixed 500 when the stub fetch rejects', async () => {
    const h = harness();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.env.PAW.jurisdiction = () => ({
      idFromName: (n: string) => n,
      get: () => ({ fetch: () => Promise.reject(new Error('stub-detail')) }),
    });
    const response = await send(h, { path: '/api/health' });
    const text = await response.text();
    expect(response.status).toBe(500);
    expect(JSON.parse(text)).toEqual({ message: 'An error occurred while handling the request' });
    expect(text).not.toContain('stub-detail');
    spy.mockRestore();
  });

  it('sends a path outside /api/ to ASSETS and never builds the object', async () => {
    const h = harness();
    for (const p of ['/', '/index.html', '/assets/app.js', '/api', '/apiary', '/favicon.ico']) {
      const response = await send(h, { path: p, cf: { country: 'IL' } });
      expect(await response.text()).toBe('asset');
    }
    expect(h.assetPaths).toEqual(['/', '/index.html', '/assets/app.js', '/api', '/apiary', '/favicon.ico']);
    expect(h.objects).toHaveLength(0);
    expect(h.jurisdictions).toEqual([]);
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it('builds the app once per object, not per request', async () => {
    const h = harness();
    for (let i = 0; i < 4; i++) await send(h, { path: '/api/health' });
    expect(h.objects).toHaveLength(1);
  });

  it('answers an error that escapes the app with the fixed 500 body', async () => {
    const h = harness();
    const object = new PawObject({ storage: { sql: openTestDb().sql } }, h.env);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // A request whose URL getter throws a non-Error escapes the app before any handler runs.
    const hostile = new Proxy(makeRequest({ path: '/api/health' }), {
      get(target, prop) {
        if (prop === 'url') throw 'boom';
        const value = Reflect.get(target, prop, target) as unknown;
        return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    });
    const response = await object.fetch(hostile);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ message: 'An error occurred while handling the request' });
    expect(spy.mock.calls.some((c) => String(c[0]).includes('"code":"edge_failed"'))).toBe(true);
    spy.mockRestore();
  });
});

describe('the rate-window timer', () => {
  it('keeps one timer after a POST to grant or bind, replaces it, and ignores other requests', async () => {
    vi.useFakeTimers();
    try {
      const h = harness({ RATE_WINDOW_MS: '5000' });
      await send(h, { path: '/api/health' });
      expect(vi.getTimerCount()).toBe(0);
      await grant(h, { cf: { country: 'IL' }, headers: { ...ADULT } }, 'not a wish');
      expect(vi.getTimerCount()).toBe(1);
      await send(h, { path: '/api/bind', method: 'POST', cf: { country: 'IL' }, headers: { ...ADULT }, body: 'x' });
      expect(vi.getTimerCount()).toBe(1);
      vi.advanceTimersByTime(5000);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Forged headers, in both directions, through the real entry and a real PawObject
// ---------------------------------------------------------------------------------------------

describe('forged headers through the entry', () => {
  it('an allowed cf.country stays allowed against forged refused codes', async () => {
    const h = harness();
    expect(await live(h, { cf: { country: 'IL' }, headers: FORGED_REFUSED })).toEqual({ live: true });
    const response = await grant(h, { cf: { country: 'IL' }, headers: { ...FORGED_REFUSED, ...ADULT } });
    expect(response.status).not.toBe(403);
    expect(h.fetchMock).toHaveBeenCalled();
  });

  for (const [label, cf] of [
    ['DE', { country: 'DE' }],
    ['XX', { country: 'XX' }],
    ['T1', { country: 'T1' }],
    ['missing cf', undefined],
    ['an empty cf', {}],
    ['a lower-case code', { country: 'il' }],
  ] as const) {
    it(`${label} with forged US stays refused: 403 and no model fetch`, async () => {
      const h = harness();
      const call = label === 'missing cf' ? { headers: FORGED_US } : { cf, headers: FORGED_US };
      expect(await live(h, call)).toEqual({ live: false });
      const response = await grant(h, { ...call, headers: { ...FORGED_US, ...ADULT } });
      expect(response.status).toBe(403);
      expect(((await response.json()) as { code: string }).code).toBe('live_region_unavailable');
      const bind = await send(h, { path: '/api/bind', method: 'POST', body: BIND_BODY, ...call, headers: { ...FORGED_US, ...ADULT } });
      expect(bind.status).toBe(403);
      expect(h.fetchMock).not.toHaveBeenCalled();
    });
  }

  it('CF-Worker with cf.country US is refused', async () => {
    const h = harness();
    const headers = { 'CF-Worker': 'someone.example', ...FORGED_US };
    expect(await live(h, { cf: { country: 'US' }, headers })).toEqual({ live: false });
    const response = await grant(h, { cf: { country: 'US' }, headers: { ...headers, ...ADULT } });
    expect(response.status).toBe(403);
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it('the adult header still reaches the gate: allowed country without it is the age refusal', async () => {
    const h = harness();
    const response = await grant(h, { cf: { country: 'IL' } });
    expect(response.status).toBe(403);
    expect(((await response.json()) as { code: string }).code).toBe('adult_confirmation_required');
  });

  it('property: any forged headers leave the verdict to cf.country alone', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('IL', 'US', 'DE', 'XX', 'T1', 'FR', 'il', undefined),
        fc.constantFrom('US', 'DE', 'IL', 'XX', 'garbage'),
        fc.boolean(),
        async (country, forged, workerHeader) => {
          const h = harness();
          const headers: Record<string, string> = {
            'x-paw-country': forged,
            'cf-ipcountry': forged,
            'x-paw-dev-country': forged,
            ...(workerHeader ? { 'cf-worker': 'x.example' } : {}),
          };
          const body = (await live(h, country === undefined ? { headers } : { cf: { country }, headers })) as { live: boolean };
          // IL and US are on the free list; FR (EEA), DE, XX, T1, lower case and no cf are not.
          const expected = (country === 'IL' || country === 'US') && !workerHeader;
          expect(body.live).toBe(expected);
        },
      ),
      { numRuns: 40 },
    );
  });
});

describe('the per-IP limit under forged XFF', () => {
  it('the 11th live call from one CF-Connecting-IP is refused, and a second address is not', async () => {
    const h = harness();
    const call = (ip: string, n: number): Call => ({
      path: '/api/grant',
      method: 'POST',
      cf: { country: 'IL' },
      body: 'not a wish',
      headers: { ...ADULT, 'cf-connecting-ip': ip, 'x-forwarded-for': `10.0.0.${n}, 10.1.1.${n}`, 'x-real-ip': `10.2.2.${n}` },
    });
    for (let n = 1; n <= 10; n++) {
      expect((await send(h, call('198.51.100.1', n))).status).toBe(400);
    }
    const eleventh = await send(h, call('198.51.100.1', 11));
    expect(eleventh.status).toBe(503);
    expect((await send(h, call('198.51.100.2', 12))).status).toBe(400);
    expect(h.fetchMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------------------------

const spentOf = async (h: Harness): Promise<number> => {
  const response = await send(h, { path: '/api/health' });
  return ((await response.json()) as { budget: { spentCents: number } }).budget.spentCents;
};

describe('budget storage behind the object', () => {
  it('survives an object restart: a new PawObject over the same database reports the same spend', async () => {
    const h = harness({}, billedNothingFetch());
    expect(await spentOf(h)).toBe(0);
    const response = await grant(h, { cf: { country: 'IL' }, headers: { ...ADULT, 'cf-connecting-ip': '198.51.100.3' } });
    expect(response.status).not.toBe(403);
    const before = await spentOf(h);
    expect(before).toBeGreaterThan(0);
    h.restart();
    expect(h.objects).toHaveLength(2);
    expect(h.dbs).toHaveLength(1);
    expect(await spentOf(h)).toBe(before);
  });

  it('counts a leftover reservation as spent', async () => {
    const h = harness();
    // Make the database first by touching the app, then plant a row the way a dead process leaves it.
    await spentOf(h);
    createSqlBudgetStore(h.dbs[0].sql).save({ spentCents: 10, reservedCents: 5, dayStart: Date.now() });
    h.restart();
    expect(await spentOf(h)).toBe(15);
  });

  it('property 5: after live calls from many addresses the database holds one budget row of three numbers and no address', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(
          fc.tuple(fc.integer({ min: 1, max: 254 }), fc.integer({ min: 1, max: 254 }), fc.integer({ min: 1, max: 254 })),
          { minLength: 1, maxLength: 8, selector: (t) => t.join('.') },
        ),
        async (triples) => {
          const h = harness({}, billedNothingFetch());
          const addresses = triples.map(([a, b, c]) => `203.${a}.${b}.${c}`);
          for (const ip of addresses) {
            const headers = { ...ADULT, 'cf-connecting-ip': ip, 'x-forwarded-for': `192.0.2.${triples.length}`, 'cf-ipcountry': 'IL' };
            await grant(h, { cf: { country: 'IL' }, headers }, 'not a wish');
          }
          await grant(h, { cf: { country: 'IL' }, headers: { ...ADULT, 'cf-connecting-ip': addresses[0] } });
          const dump = h.dbs[0].dump();
          expect(Object.keys(dump)).toEqual(['budget']);
          expect(dump.budget).toHaveLength(1);
          const row = dump.budget[0];
          expect(Object.keys(row).sort()).toEqual(['day_start', 'id', 'reserved_cents', 'spent_cents']);
          for (const value of Object.values(row)) expect(typeof value).toBe('number');
          const text = JSON.stringify(dump);
          for (const ip of addresses) expect(text).not.toContain(ip);
          expect(text).not.toContain('192.0.2');
          expect(text).not.toContain('IL');
        },
      ),
      { numRuns: 10 },
    );
  });
});

// ---------------------------------------------------------------------------------------------
// wrangler.json
// ---------------------------------------------------------------------------------------------

describe('wrangler.json', () => {
  const text = readFileSync(path.join(API_ROOT, 'wrangler.json'), 'utf8');
  const config = JSON.parse(text) as Record<string, any>;

  it('has exactly the values of Requirements 1 and 4', () => {
    expect(config).toEqual({
      name: 'monkeys-paw',
      main: 'src/edge/worker.ts',
      compatibility_date: '2026-11-01',
      compatibility_flags: ['nodejs_compat'],
      workers_dev: true,
      preview_urls: false,
      send_metrics: false,
      assets: { directory: '../web/dist', binding: 'ASSETS', run_worker_first: ['/api/*'] },
      durable_objects: { bindings: [{ name: 'PAW', class_name: 'PawObject' }] },
      migrations: [{ tag: 'v1', new_sqlite_classes: ['PawObject'] }],
      vars: { GEMINI_TIER: 'free' },
    });
    expect(config.assets.run_worker_first).toEqual(['/api/*']);
  });

  it('points at an entry that exists and exports the class that the migration lists', () => {
    expect(existsSync(path.join(API_ROOT, config.main))).toBe(true);
    const listed: string[] = config.migrations.flatMap((m: { new_sqlite_classes?: string[] }) => m.new_sqlite_classes ?? []);
    expect(listed).toContain(config.durable_objects.bindings[0].class_name);
    for (const name of listed) expect(typeof (entry as Record<string, unknown>)[name]).toBe('function');
    expect(typeof entry.default.fetch).toBe('function');
  });

  it('has no account, route, zone or secret-like key or value', () => {
    const keys: string[] = [];
    const walk = (value: unknown) => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === 'object') {
        for (const [key, inner] of Object.entries(value)) {
          keys.push(key);
          walk(inner);
        }
      }
    };
    walk(config);
    for (const key of keys) expect(key).not.toMatch(/account|^routes?$|zone|secret|token|api_?key|password|pattern/i);
    expect(text).not.toMatch(/AIza|[0-9a-f]{32}/);
  });

  it('adds the edge:dev script and no deploy script', () => {
    const pkg = JSON.parse(readFileSync(path.join(API_ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['edge:dev']).toBe('wrangler dev');
    expect(Object.keys(pkg.scripts).filter((name) => /deploy|publish/.test(name))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// The edge bundle
// ---------------------------------------------------------------------------------------------

describe('the edge bundle', () => {
  it('holds no Node server files and imports only the node builtins the code needs', async () => {
    const result = await build({
      absWorkingDir: API_ROOT,
      entryPoints: ['src/edge/worker.ts'],
      bundle: true,
      platform: 'neutral',
      format: 'esm',
      target: 'es2022',
      mainFields: ['module', 'main'],
      conditions: ['workerd', 'worker', 'browser'],
      external: ['node:*', 'crypto'],
      alias: { 'paw-core': path.join(REPO_ROOT, 'packages', 'paw-core', 'src', 'index.ts') },
      write: false,
      metafile: true,
      logLevel: 'silent',
      outfile: 'edge-bundle-in-memory.mjs',
    });
    expect(result.outputFiles).toHaveLength(1);

    const inputs = Object.keys(result.metafile.inputs);
    expect(inputs.some((p) => p.endsWith('src/edge/worker.ts'))).toBe(true);
    for (const forbidden of ['src/server.ts', 'src/paths.ts', 'src/error-log-sync.ts', '@hono/node-server']) {
      expect(inputs.filter((p) => p.includes(forbidden))).toEqual([]);
    }

    // Static and dynamic imports of node builtins that remain in the output. `node:fs/promises` is the
    // dynamic import of `fileExamplesLoader`; the edge passes its own loader, so it never runs there.
    const imports = Object.values(result.metafile.outputs).flatMap((output) => output.imports.filter((i) => i.external));
    const staticImports = new Set(imports.filter((i) => i.kind !== 'dynamic-import').map((i) => i.path));
    const dynamicImports = new Set(imports.filter((i) => i.kind === 'dynamic-import').map((i) => i.path));
    expect([...staticImports].sort()).toEqual(['crypto', 'node:async_hooks']);
    expect([...dynamicImports].sort()).toEqual(['node:fs/promises']);
    expect(imports.every((i) => i.path.startsWith('node:') || i.path === 'crypto')).toBe(true);

    // The examples cache is inside the bundle.
    expect(inputs.some((p) => p === 'examples-cache.json' || p.endsWith('/examples-cache.json'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// Fetch count (task 4)
// ---------------------------------------------------------------------------------------------

describe('fetch count on the edge', () => {
  const curse = (i: number) => ({ type: 'time', story: `Story ${i}.`, loophole: `"midnight ${i}"` });
  const GRANT_ANSWER = {
    narration: 'Granted, exactly.',
    userStory: 'As an owner, I want a rule.',
    wishCriterion: 'WHEN a project is deleted THE SYSTEM SHALL ask the owner.',
    curses: [0, 1, 2, 3, 4].map(curse),
  };
  const ALL_GENERIC = [0, 1, 2, 3, 4].map((i) => ({ curseId: `curse-${i}`, specific: false, reason: 'Generic.' }));
  const INVALID = { bad: true };

  /**
   * The worst path: on every call the first two models answer 503 and the third answers a scripted body.
   * Genie: invalid, then valid. Batch judge: invalid, then all generic. Each replacement: invalid, then
   * valid. Verdict: invalid every time.
   */
  function scriptedFetch() {
    const chain = edgeModelChain({});
    const seen = { models: [] as string[], genie: 0, batch: 0, replace: 0, verdict: 0 };
    const fetchMock = vi.fn(async (url: unknown, init?: unknown) => {
      const model = /models\/([^:]+):generateContent/.exec(String(url))?.[1] ?? '';
      seen.models.push(model);
      if (chain.indexOf(model) < EDGE_MAX_MODELS - 1) return new Response('{}', { status: 503 });
      const sent = JSON.parse(String((init as { body: string }).body)) as { contents: Array<{ parts: Array<{ text: string }> }> };
      const prompt = sent.contents[0].parts[0].text;
      let answer: unknown = INVALID;
      if (prompt.includes('Task: REPLACE_CURSE')) answer = seen.replace++ % 2 === 0 ? INVALID : curse(9);
      else if (prompt.includes('Task: JUDGE_BATCH_QUALITY')) answer = seen.batch++ === 0 ? INVALID : ALL_GENERIC;
      else if (prompt.includes('Task: JUDGE_VERDICT')) seen.verdict++;
      else if (prompt.includes('Task: GRANT_WISH')) answer = seen.genie++ === 0 ? INVALID : GRANT_ANSWER;
      else throw new Error('unexpected prompt');
      return okResponse(JSON.stringify(answer));
    });
    return { fetchMock, seen, chain };
  }

  function appFor(fetchMock: ReturnType<typeof vi.fn>) {
    vi.stubGlobal('fetch', fetchMock);
    const env: EdgeSettings = { GEMINI_API_KEY: 'a-fake-key', DAILY_BUDGET_CENTS: '100000' };
    return createApp(edgeAppDeps(env, new FakeBudgetStore()));
  }

  const post = (app: ReturnType<typeof createApp>, p: string, body: unknown) =>
    app.request(`http://edge.test${p}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-paw-country': 'IL', 'x-paw-adult-confirmed': 'yes', 'x-forwarded-for': '198.51.100.9' },
      body: JSON.stringify(body),
    });

  it('keeps the arithmetic under the 50 subrequests of the Free plan', () => {
    expect(GRANT_CALLS * EDGE_MAX_MODELS).toBeLessThan(50);
    expect(GRANT_CALLS * EDGE_MAX_MODELS).toBe(42);
    expect(BIND_CALLS * EDGE_MAX_MODELS).toBe(6);
  });

  it('a grant on the worst path makes 14 generate calls and 42 upstream fetches', async () => {
    const { fetchMock, seen, chain } = scriptedFetch();
    const response = await post(appFor(fetchMock), '/api/grant', GRANT_BODY);
    expect(response.status).toBe(200);
    expect(seen.genie).toBe(2);
    expect(seen.batch).toBe(2);
    expect(seen.replace).toBe(10);
    // Every generate call starts at the first model of the chain.
    expect(seen.models.filter((m) => m === chain[0])).toHaveLength(GRANT_CALLS);
    expect(fetchMock).toHaveBeenCalledTimes(42);
    expect(fetchMock.mock.calls.length).toBeLessThan(50);
    expect(new Set(seen.models).size).toBe(EDGE_MAX_MODELS);
  });

  it('a bind whose judge answers are invalid twice makes 6 fetches', async () => {
    const { fetchMock, seen } = scriptedFetch();
    const response = await post(appFor(fetchMock), '/api/bind', BIND_BODY);
    expect(response.status).toBe(200);
    expect(seen.verdict).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(fetchMock.mock.calls.length).toBeLessThan(50);
  });

  it('cuts a long configured chain to 3 models in the URLs it calls', async () => {
    const urls: string[] = [];
    const fetchMock = vi.fn(async (url: unknown) => {
      urls.push(String(url));
      return new Response('{}', { status: 503 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const env: EdgeSettings = {
      GEMINI_API_KEY: 'a-fake-key',
      DAILY_BUDGET_CENTS: '100000',
      GEMINI_MODEL: 'm1',
      GEMINI_MODEL_FALLBACKS: 'm2,m3,m4,m5',
    };
    const app = createApp(edgeAppDeps(env, new FakeBudgetStore()));
    await post(app, '/api/bind', BIND_BODY);
    expect(new Set(urls.map((u) => /models\/([^:]+):/.exec(u)?.[1]))).toEqual(new Set(['m1', 'm2', 'm3']));
    expect(urls).toHaveLength(6);
  });
});
