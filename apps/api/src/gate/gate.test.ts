import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fc from 'fast-check';
import { createApp } from '../app';
import type { AppDeps } from '../app';
import type { BudgetConfig } from '../budget/config';
import { FakeMeteredModel } from '../budget/fake-metered';
import type { GateConfig } from './config';
import { loadGateConfig } from './config';
import {
  ADULT_HEADER,
  GATE_MESSAGES,
  LIVE_ROUTES,
  adultConfirmed,
  countryAllowed,
  gateDecision,
} from './middleware';
import { EU_STATES, FREE_ALLOWED, FREE_EXCLUDED, PAID_ALLOWED, REGIONS } from './regions';

const EXAMPLES = fileURLToPath(new URL('../../tests/fixtures/examples-cache.json', import.meta.url));
const REGION_NAMES = fileURLToPath(new URL('../../tests/fixtures/gemini-available-regions.txt', import.meta.url));

const FREE: GateConfig = { tier: 'free', countryHeader: 'x-test-country' };
const PAID: GateConfig = { tier: 'paid', countryHeader: 'x-test-country' };
const BUDGET: BudgetConfig = { perIpLimit: 10, windowMs: 60_000, dailyBudgetCents: 500 };

const REGION_REFUSAL = {
  code: 'live_region_unavailable',
  message: 'The paw grants no live wishes where you stand. The examples need no permission.',
};
const ADULT_REFUSAL = {
  code: 'adult_confirmation_required',
  message: 'The paw grants live wishes only to those who confirm they are 18 or older.',
};

/** Answers each paw-core prompt with valid JSON. Never the network. */
async function answer(prompt: string): Promise<unknown> {
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
    return ['curse-0', 'curse-1', 'curse-2'].map((curseId) => ({ curseId, specific: true, reason: 'Specific.' }));
  }
  if (prompt.includes('Task: JUDGE_VERDICT')) {
    return { curseId: 'c1', closed: true, reason: 'Airtight.', judgedAt: 1 };
  }
  throw new Error('unexpected prompt');
}

function build(gate?: GateConfig, options: { model?: FakeMeteredModel; budget?: Partial<BudgetConfig> } = {}) {
  const model = options.model ?? new FakeMeteredModel({ answer });
  const deps: AppDeps = {
    model,
    budget: { ...BUDGET, ...options.budget },
    corsOrigin: '*',
    examplesCachePath: EXAMPLES,
    clock: () => 1_000_000,
    ...(gate ? { gate } : {}),
  };
  return { app: createApp(deps), model };
}
type App = ReturnType<typeof build>['app'];

const grantBody = { wish: { text: 'Only the owner can delete a project' } };
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
const BODIES: Record<string, unknown> = {
  '/api/grant': grantBody,
  '/api/bind': { grant: sampleGrant, curseId: 'c1', kind: 'rewrite', clause: 'Owner or deputy.' },
};

function post(app: App, path: string, headers: Record<string, string> = {}, body: unknown = BODIES[path], ip = '203.0.113.7') {
  return app.request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...headers },
    body: JSON.stringify(body),
  });
}

/** A request from `country` (in the configured header) with a confirmation. */
const live = (country: string, confirm: string | null = 'yes'): Record<string, string> => ({
  'x-test-country': country,
  ...(confirm === null ? {} : { [ADULT_HEADER]: confirm }),
});

async function health(app: App) {
  const res = await app.request('http://localhost/api/health');
  expect(res.status).toBe(200);
  return (await res.json()) as { budget: { dailyBudgetCents: number; spentCents: number; remainingCents: number } };
}

/** remaining = budget - spent - reserved, so a full remaining and no spend mean nothing is reserved. */
async function expectNothingSpentOrReserved(app: App) {
  const { budget } = await health(app);
  expect(budget.spentCents).toBe(0);
  expect(budget.remainingCents).toBe(budget.dailyBudgetCents);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the table of regions (Req 14.3)', () => {
  const names = readFileSync(REGION_NAMES, 'utf8').replace(/\n$/, '').split('\n');

  it('has the 231 names of the fixture, in order, one code each', () => {
    expect(names).toHaveLength(231);
    expect(REGIONS.map(([, name]) => name)).toEqual(names);
    for (const [code] of REGIONS) expect(code).toMatch(/^[A-Z]{2}$/);
    expect(new Set(REGIONS.map(([code]) => code)).size).toBe(231);
    expect(new Set(REGIONS.map(([, name]) => name)).size).toBe(231);
    expect(REGIONS.find(([, name]) => name === 'Kosovo')?.[0]).toBe('XK');
  });

  it('derives 231 paid codes and 172 free codes', () => {
    expect(PAID_ALLOWED.size).toBe(231);
    expect(FREE_ALLOWED.size).toBe(172);
    expect(EU_STATES).toHaveLength(27);
    for (const code of FREE_ALLOWED) {
      expect(PAID_ALLOWED.has(code)).toBe(true);
      expect(FREE_EXCLUDED.has(code)).toBe(false);
    }
    expect(REGIONS.filter(([code]) => FREE_EXCLUDED.has(code))).toHaveLength(231 - 172);
  });

  it('refuses the EEA, Switzerland, the UK and their territories on the free tier only', () => {
    for (const code of ['AT', 'FR', 'DE', 'IS', 'LI', 'NO', 'CH', 'GB', 'AX', 'FO', 'GL', 'GF', 'RE', 'NC', 'AW', 'GI', 'KY']) {
      expect(FREE_ALLOWED.has(code), code).toBe(false);
    }
    for (const code of ['US', 'IL', 'CA', 'JP', 'IN', 'BR', 'AU', 'XK']) {
      expect(FREE_ALLOWED.has(code), code).toBe(true);
    }
    for (const code of ['CN', 'RU', 'XX', 'T1', 'KP', 'CU', 'IR']) {
      expect(PAID_ALLOWED.has(code), code).toBe(false);
    }
  });
});

describe('the config loader (Req 14.2, 14.4)', () => {
  it('is paid only for exactly "paid"; anything else is free', () => {
    expect(loadGateConfig({ GEMINI_TIER: 'paid' }).tier).toBe('paid');
    for (const junk of [undefined, '', ' ', 'free', 'Paid', 'PAID', ' paid', 'paid ', 'true', '1', 'enterprise']) {
      expect(loadGateConfig({ GEMINI_TIER: junk }).tier, String(junk)).toBe('free');
    }
  });

  it('keeps COUNTRY_HEADER as written, and leaves it out when unset', () => {
    expect(loadGateConfig({ COUNTRY_HEADER: 'cf-ipcountry' })).toEqual({ tier: 'free', countryHeader: 'cf-ipcountry' });
    expect(loadGateConfig({})).toEqual({ tier: 'free' });
  });
});

describe('countryAllowed and adultConfirmed', () => {
  const h = (value?: string, name = 'x-test-country') => new Headers(value === undefined ? {} : { [name]: value });

  it('lets US and IL through on both tiers', () => {
    for (const config of [FREE, PAID]) {
      expect(countryAllowed(h('US'), config)).toBe(true);
      expect(countryAllowed(h('IL'), config)).toBe(true);
    }
  });

  it('refuses GB, FR, CH on free, and CN, XX, T1 on both', () => {
    for (const code of ['GB', 'FR', 'CH']) {
      expect(countryAllowed(h(code), FREE), code).toBe(false);
      expect(countryAllowed(h(code), PAID), code).toBe(true);
    }
    for (const code of ['CN', 'XX', 'T1']) {
      expect(countryAllowed(h(code), FREE), code).toBe(false);
      expect(countryAllowed(h(code), PAID), code).toBe(false);
    }
  });

  it('allows exactly one code per listed region: all 231 on paid, 172 on free', () => {
    for (const [code] of REGIONS) {
      expect(countryAllowed(h(code), PAID), code).toBe(true);
      expect(countryAllowed(h(code), FREE), code).toBe(FREE_ALLOWED.has(code));
    }
  });

  it('refuses a value that is not exactly two uppercase ASCII letters', () => {
    for (const value of ['us', 'Us', 'USA', 'U', '', 'U1', '1S', 'US, GB', 'US,GB', 'ÜS']) {
      expect(countryAllowed(h(value), FREE), JSON.stringify(value)).toBe(false);
    }
    const repeated = new Headers();
    repeated.append('x-test-country', 'US');
    repeated.append('x-test-country', 'US');
    expect(countryAllowed(repeated, FREE)).toBe(false);
  });

  it('refuses when the header is missing', () => {
    expect(countryAllowed(h(), FREE)).toBe(false);
    expect(countryAllowed(h(undefined), PAID)).toBe(false);
  });

  it('refuses and never throws on an unset, blank or invalid header name', () => {
    const headers = new Headers({ 'x-test-country': 'US', 'cf-ipcountry': 'US' });
    const bad: Array<string | undefined> = [undefined, '', ' ', '   ', 'bad name', 'x:y', 'x\ny', 'é', 'a/b', '(x)', 'x-test-country '];
    for (const countryHeader of bad) {
      const config = countryHeader === undefined ? { tier: 'free' as const } : { tier: 'free' as const, countryHeader };
      expect(() => countryAllowed(headers, config), String(countryHeader)).not.toThrow();
      expect(countryAllowed(headers, config), String(countryHeader)).toBe(false);
    }
  });

  it('reads only the configured header', () => {
    const headers = new Headers({
      'x-vercel-ip-country': 'US',
      'cf-ipcountry': 'US',
      'x-country': 'US',
      'x-test-country': 'GB',
    });
    expect(countryAllowed(headers, FREE)).toBe(false);
    expect(countryAllowed(new Headers({ 'x-vercel-ip-country': 'US' }), FREE)).toBe(false);
    expect(countryAllowed(new Headers({ 'x-vercel-ip-country': 'US' }), { tier: 'free', countryHeader: 'X-Vercel-IP-Country' })).toBe(true);
  });

  it('wants the confirmation to be exactly "yes"', () => {
    expect(adultConfirmed(new Headers({ [ADULT_HEADER]: 'yes' }))).toBe(true);
    for (const value of ['Yes', 'YES', 'true', '1', '', 'yes please', 'y']) {
      expect(adultConfirmed(new Headers({ [ADULT_HEADER]: value })), value).toBe(false);
    }
    expect(adultConfirmed(new Headers())).toBe(false);
  });
});

describe('the gate on the live routes (Req 14.1, 14.6, 14.7)', () => {
  it('lets US and IL through on /api/grant when confirmed', async () => {
    for (const country of ['US', 'IL']) {
      const { app, model } = build(FREE);
      const res = await post(app, '/api/grant', live(country));
      expect(res.status, country).toBe(200);
      expect(model.calls).toBeGreaterThan(0);
    }
  });

  it('lets a confirmed US request through on /api/bind', async () => {
    const { app, model } = build(FREE);
    const res = await post(app, '/api/bind', live('US'));
    expect(res.status).not.toBe(403);
    expect(model.calls).toBeGreaterThan(0);
  });

  it('refuses GB, FR, CH, CN, XX, T1 and a lowercase code with the exact region body', async () => {
    for (const country of ['GB', 'FR', 'CH', 'CN', 'XX', 'T1', 'us', 'US, GB']) {
      for (const route of LIVE_ROUTES) {
        const { app, model } = build(FREE);
        const res = await post(app, route, live(country));
        expect(res.status, `${route} ${country}`).toBe(403);
        expect(res.headers.get('cache-control')).toBe('no-store');
        expect(res.headers.get('content-type')).toContain('application/json');
        expect(await res.json()).toEqual(REGION_REFUSAL);
        expect(model.calls).toBe(0);
      }
    }
  });

  it('refuses when there is no country header, with the region body', async () => {
    const { app, model } = build(FREE);
    const res = await post(app, '/api/grant', { [ADULT_HEADER]: 'yes' });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(REGION_REFUSAL);
    expect(model.calls).toBe(0);
  });

  it('refuses when COUNTRY_HEADER is unset or invalid, and never throws', async () => {
    const configs: Array<GateConfig | undefined> = [
      undefined,
      { tier: 'free' },
      { tier: 'free', countryHeader: '' },
      { tier: 'free', countryHeader: 'bad header name' },
      { tier: 'paid', countryHeader: 'x:y' },
      { tier: 'paid' },
    ];
    for (const config of configs) {
      const { app, model } = build(config);
      const res = await post(app, '/api/grant', { ...live('US'), 'cf-ipcountry': 'US', 'x-vercel-ip-country': 'US' });
      expect(res.status, JSON.stringify(config)).toBe(403);
      expect(await res.json()).toEqual(REGION_REFUSAL);
      expect(model.calls).toBe(0);
    }
  });

  it('refuses an allowed country without the confirmation, with the exact adult body', async () => {
    for (const confirm of [null, '', 'Yes', 'YES', 'true', '1', 'yes please']) {
      for (const route of LIVE_ROUTES) {
        const { app, model } = build(FREE);
        const res = await post(app, route, live('US', confirm));
        expect(res.status, `${route} ${confirm}`).toBe(403);
        expect(res.headers.get('cache-control')).toBe('no-store');
        expect(await res.json()).toEqual(ADULT_REFUSAL);
        expect(model.calls).toBe(0);
      }
    }
    expect(GATE_MESSAGES.live_region_unavailable).toBe(REGION_REFUSAL.message);
    expect(GATE_MESSAGES.adult_confirmation_required).toBe(ADULT_REFUSAL.message);
  });

  it('checks the country first: a bad country with no confirmation is a region refusal', async () => {
    const { app } = build(FREE);
    const res = await post(app, '/api/grant', live('GB', null));
    expect(await res.json()).toEqual(REGION_REFUSAL);
  });

  it('refuses before reading the body: an invalid body gets the 403, not a 400', async () => {
    const { app } = build(FREE);
    const res = await app.request('http://localhost/api/grant', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-country': 'GB' },
      body: '{ not json',
    });
    expect(res.status).toBe(403);
  });

  it('gates /api/grant and /api/bind before the mode check', async () => {
    const { app } = build(FREE, { model: new FakeMeteredModel({ available: false, answer }) });
    for (const route of LIVE_ROUTES) {
      const refused = await post(app, route, live('CN'));
      expect(refused.status).toBe(403);
      const resting = await post(app, route, live('US'));
      expect(resting.status).toBe(503);
    }
  });

  it('a refusal does not count against the IP and does not move the budget', async () => {
    const { app, model } = build(FREE, { budget: { perIpLimit: 1 } });
    for (let i = 0; i < 5; i++) {
      expect((await post(app, '/api/grant', live('GB'))).status).toBe(403);
      expect((await post(app, '/api/bind', live('US', null))).status).toBe(403);
    }
    expect(model.calls).toBe(0);
    await expectNothingSpentOrReserved(app);
    expect((await post(app, '/api/grant', live('US'))).status).toBe(200); // the one call of the limit is still there
  });

  it('on the paid tier allows the listed EEA, Swiss and UK codes, and still refuses CN and a missing confirmation', async () => {
    for (const country of ['FR', 'DE', 'GB', 'CH', 'NO', 'AX', 'US', 'IL']) {
      const { app } = build(PAID);
      expect((await post(app, '/api/grant', live(country))).status, country).toBe(200);
    }
    for (const country of ['CN', 'XX', 'T1', 'fr']) {
      const { app, model } = build(PAID);
      const res = await post(app, '/api/grant', live(country));
      expect(res.status, country).toBe(403);
      expect(await res.json()).toEqual(REGION_REFUSAL);
      expect(model.calls).toBe(0);
    }
    const { app, model } = build(PAID);
    const res = await post(app, '/api/grant', live('FR', null));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(ADULT_REFUSAL);
    expect(model.calls).toBe(0);
  });

  it('treats a GEMINI_TIER that is junk as the free tier, end to end', async () => {
    for (const junk of ['junk', 'Paid', '', undefined]) {
      const { app, model } = build(loadGateConfig({ GEMINI_TIER: junk, COUNTRY_HEADER: 'x-test-country' }));
      const res = await post(app, '/api/grant', live('FR'));
      expect(res.status, String(junk)).toBe(403);
      expect(model.calls).toBe(0);
    }
    const { app } = build(loadGateConfig({ GEMINI_TIER: 'paid', COUNTRY_HEADER: 'x-test-country' }));
    expect((await post(app, '/api/grant', live('FR'))).status).toBe(200);
  });

  it('ignores every other header, the query and the body as a source of the country', async () => {
    const spoof = { 'x-vercel-ip-country': 'US', 'cf-ipcountry': 'US', 'x-country': 'US', [ADULT_HEADER]: 'yes' };
    for (const config of [FREE, PAID, { tier: 'free', countryHeader: 'cf-connecting-ip' } as GateConfig]) {
      const { app, model } = build(config);
      const res = await app.request('http://localhost/api/grant?country=US&cc=US', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...spoof },
        body: JSON.stringify({ ...grantBody, country: 'US', region: 'US' }),
      });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual(REGION_REFUSAL);
      expect(model.calls).toBe(0);
    }
    // The configured header wins over a spoofed one that says the opposite.
    const { app: a } = build(FREE);
    expect((await post(a, '/api/grant', { ...spoof, 'x-test-country': 'GB' })).status).toBe(403);
    const { app: b } = build(FREE);
    expect((await post(b, '/api/grant', { ...spoof, 'x-vercel-ip-country': 'GB', 'cf-ipcountry': 'FR', 'x-test-country': 'US' })).status).toBe(200);
  });

  it('never lets the country into a log line, a body or a header', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    ); // installed before createApp: the logger takes console.log when it is created
    const COUNTRY = /\b(CN|US|XX|GB)\b/;
    for (const country of ['CN', 'US', 'XX', 'GB']) {
      const { app } = build(FREE);
      for (const confirm of ['yes', null]) {
        const res = await post(app, '/api/grant', live(country, confirm));
        const headerLines: string[] = [];
        res.headers.forEach((value, name) => headerLines.push(`${name}: ${value}`));
        const seen = [await res.text(), ...headerLines].join('\n');
        expect(seen, `${country} ${confirm}`).not.toMatch(COUNTRY);
      }
    }
    const lines = spies.flatMap((spy) => spy.mock.calls).map((args) => args.map(String).join(' '));
    expect(lines.join('\n')).toContain('/api/grant'); // the logger did write, and the spy saw it
    expect(lines.join('\n')).not.toMatch(COUNTRY);
  });

  it('lets the CORS preflight ask for the confirmation header, with no model call', async () => {
    const { app, model } = build(FREE);
    const res = await app.request('http://localhost/api/grant', {
      method: 'OPTIONS',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,x-paw-adult-confirmed',
      },
    });
    expect(res.status).toBe(204);
    const allowed = (res.headers.get('access-control-allow-headers') ?? '').toLowerCase();
    expect(allowed).toContain('x-paw-adult-confirmed');
    expect(allowed).toContain('content-type');
    expect(model.calls).toBe(0);
  });

  it('sends the CORS headers on a refusal too, so the browser can read it', async () => {
    const { app } = build(FREE);
    const res = await post(app, '/api/grant', live('GB'));
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});

describe('every route that can call the model is gated (Req 14.1, 14.9)', () => {
  it('has LIVE_ROUTES for grant and bind', () => {
    expect([...LIVE_ROUTES].sort()).toEqual(['/api/bind', '/api/grant']);
  });

  it('has no POST route other than LIVE_ROUTES and /api/export, and no other method', () => {
    const { app } = build(FREE);
    const methods = new Set(app.routes.map((route) => route.method));
    expect([...methods].sort()).toEqual(['ALL', 'GET', 'POST']);
    const postPaths = new Set(app.routes.filter((route) => route.method === 'POST').map((route) => route.path));
    expect(postPaths).toEqual(new Set([...LIVE_ROUTES, '/api/export']));
    for (const route of app.routes.filter((r) => r.method === 'ALL')) {
      expect(['*', '/*'].includes(route.path) || LIVE_ROUTES.includes(route.path), route.path).toBe(true);
    }
  });

  it('refuses each of them with no gate header at all, whatever the body', async () => {
    for (const route of LIVE_ROUTES) {
      for (const body of [BODIES[route], {}, 'junk', null]) {
        const { app, model } = build(FREE);
        const res = await post(app, route, {}, body);
        expect(res.status, route).toBe(403);
        expect(await res.json()).toEqual(REGION_REFUSAL);
        expect(model.calls).toBe(0);
      }
    }
  });

  it('refuses each of them when the gate config is omitted, even with every header', async () => {
    for (const route of LIVE_ROUTES) {
      const { app, model } = build();
      const res = await post(app, route, { ...live('US'), 'cf-ipcountry': 'US', 'x-vercel-ip-country': 'US' });
      expect(res.status, route).toBe(403);
      expect(model.calls).toBe(0);
    }
  });
});

describe('property 11: an excluded country never reaches the model (Req 14.12)', () => {
  const confirmations = fc.constantFrom<string | undefined>(undefined, 'yes', 'Yes', 'YES', 'true', '1', '', 'no');
  const extraHeaders = fc.record(
    {
      'x-vercel-ip-country': fc.stringMatching(/^[A-Z]{2}$/),
      'cf-ipcountry': fc.stringMatching(/^[A-Z]{2}$/),
      'x-country': fc.stringMatching(/^[A-Z]{2}$/),
      origin: fc.constant('http://localhost:5173'),
    },
    { requiredKeys: [] },
  );

  it('answers 403 with 0 calls, nothing spent or reserved, no IP count and the body unread', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...FREE_EXCLUDED),
        fc.constantFrom(...LIVE_ROUTES),
        confirmations,
        extraHeaders,
        async (code, route, confirm, extra) => {
          const { app, model } = build(FREE, { budget: { perIpLimit: 1 } });
          const headers = new Headers({ 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.9' });
          for (const [name, value] of Object.entries(extra)) headers.set(name, value);
          headers.set('x-test-country', code);
          if (confirm !== undefined) headers.set(ADULT_HEADER, confirm);
          const request = new Request(`http://localhost${route}`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ ...(BODIES[route] as object), country: code }),
          });

          const res = await app.fetch(request);

          expect(res.status).toBe(403);
          expect(res.headers.get('cache-control')).toBe('no-store');
          expect(await res.json()).toEqual(REGION_REFUSAL);
          expect(request.bodyUsed).toBe(false);
          expect(model.calls).toBe(0);
          await expectNothingSpentOrReserved(app);
          // The one call of the limit is untouched: the same IP, now from an allowed country, gets in.
          const ok = await post(app, '/api/grant', live('US'), grantBody, '198.51.100.9');
          expect(ok.status).toBe(200);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('refuses every excluded code on both routes, with a confirmation, on one shared app', async () => {
    const { app, model } = build(FREE);
    for (const code of FREE_EXCLUDED) {
      for (const route of LIVE_ROUTES) {
        const res = await post(app, route, live(code));
        expect(res.status, `${route} ${code}`).toBe(403);
      }
    }
    expect(model.calls).toBe(0);
    await expectNothingSpentOrReserved(app);
  });

  it('control: an allowed request does read the body, so the unread-body check can fail', async () => {
    const { app } = build(FREE);
    const request = new Request('http://localhost/api/grant', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...live('US') },
      body: JSON.stringify(grantBody),
    });
    expect((await app.fetch(request)).status).toBe(200);
    expect(request.bodyUsed).toBe(true);
  });
});

describe('property 12: only the named header counts (Req 14.4)', () => {
  const otherHeaders = fc.dictionary(
    fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/).filter((name) => name !== 'x-test-country' && name !== ADULT_HEADER),
    fc.stringMatching(/^[!-~]{0,20}$/),
  );
  const countryValue = fc.oneof(fc.constantFrom(...PAID_ALLOWED), fc.constantFrom('XX', 'T1', 'CN', 'us', 'US, GB', ''));
  const confirmValue = fc.constantFrom<string | undefined>(undefined, 'yes', 'Yes', 'true', '');

  it('decides the same with or without any other header, on both tiers', () => {
    fc.assert(
      fc.property(countryValue, confirmValue, otherHeaders, fc.constantFrom(FREE, PAID), (country, confirm, extra, config) => {
        const base: Record<string, string> = { 'x-test-country': country };
        if (confirm !== undefined) base[ADULT_HEADER] = confirm;
        const plain = new Headers(base);
        const noisy = new Headers({ ...extra, ...base });
        expect(gateDecision(noisy, config)).toBe(gateDecision(plain, config));
      }),
      { numRuns: 200 },
    );
  });
});

describe('GET /api/live (Req 14.8)', () => {
  const get = (app: App, headers: Record<string, string> = {}) =>
    app.request('http://localhost/api/live', { headers });

  it('answers {live: true} for an allowed country, with no confirmation, and no-store', async () => {
    const { app } = build(FREE);
    const res = await get(app, { 'x-test-country': 'US' });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ live: true });
  });

  it('answers {live: false} for GB, a missing header, junk, and an unset or omitted config', async () => {
    const { app } = build(FREE);
    const cases: Array<Record<string, string>> = [{ 'x-test-country': 'GB' }, {}, { 'x-test-country': 'us' }, { 'cf-ipcountry': 'US' }];
    for (const headers of cases) {
      const res = await get(app, headers);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ live: false });
    }
    for (const config of [undefined, { tier: 'free' } as GateConfig, { tier: 'paid', countryHeader: 'no good' } as GateConfig]) {
      const res = await get(build(config).app, { 'x-test-country': 'US' });
      expect(await res.json()).toEqual({ live: false });
    }
  });

  it('follows the tier', async () => {
    expect(await (await get(build(PAID).app, { 'x-test-country': 'FR' })).json()).toEqual({ live: true });
    expect(await (await get(build(FREE).app, { 'x-test-country': 'FR' })).json()).toEqual({ live: false });
  });

  it('tells resting from mode and budget, calls no model and counts nothing', async () => {
    const model = new FakeMeteredModel({ available: false, answer });
    const { app } = build(FREE, { model, budget: { dailyBudgetCents: 0, perIpLimit: 1 } });
    for (let i = 0; i < 5; i++) {
      expect(await (await get(app, { 'x-test-country': 'US' })).json()).toEqual({ live: true, resting: true });
    }
    expect(model.calls).toBe(0);
    await expectNothingSpentOrReserved(app);
  });

  it('does not use up the IP limit', async () => {
    const { app } = build(FREE, { budget: { perIpLimit: 1 } });
    for (let i = 0; i < 3; i++) await get(app, { 'x-test-country': 'US' });
    expect((await post(app, '/api/grant', live('US'))).status).toBe(200);
  });
});

describe('the routes the gate leaves alone (Req 14.9)', () => {
  it('answers /api/examples, /api/export and /api/health with no gate header, on a gate that refuses everyone', async () => {
    const { app, model } = build();
    expect((await app.request('http://localhost/api/health')).status).toBe(200);

    const examples = await app.request('http://localhost/api/examples');
    expect(examples.status).toBe(200);
    expect(await examples.json()).toHaveLength(1);

    const exported = await post(app, '/api/export', {}, {
      wish: { id: 'w1', text: 'Only the owner can delete a project', createdAt: 1 },
      grant: sampleGrant,
    });
    expect(exported.status).toBe(200);
    expect(model.calls).toBe(0);
  });
});
