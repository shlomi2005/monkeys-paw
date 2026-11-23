import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { FakeBudgetStore } from '../budget/fake-store';
import { EDGE_MAX_MODELS, edgeAppDeps, edgeModelChain } from './config';
import { EDGE_COUNTRY_HEADER } from './headers';
import type { EdgeSettings } from './types';

const EXAMPLES = fileURLToPath(new URL('../../examples-cache.json', import.meta.url));

const deps = (env: EdgeSettings & Record<string, string | undefined> = {}) => edgeAppDeps(env, new FakeBudgetStore());

describe('edgeModelChain', () => {
  it('is the three models of Requirement 8 by default', () => {
    expect(EDGE_MAX_MODELS).toBe(3);
    expect(edgeModelChain({})).toEqual(['gemini-3.6-flash', 'gemini-3.8-flash', 'gemini-3.5-flash-lite']);
    expect(edgeModelChain({ GEMINI_MODEL: '', GEMINI_MODEL_FALLBACKS: '' })).toHaveLength(3);
  });

  it('property: at most 3, trimmed, no blanks and no repeats, for any variable values', () => {
    const text = fc.oneof(
      fc.constant(undefined),
      fc.string({ maxLength: 60 }),
      fc.array(fc.constantFrom('a', 'b', ' c ', 'd', '', 'a'), { maxLength: 12 }).map((names) => names.join(',')),
    );
    fc.assert(
      fc.property(text, text, (GEMINI_MODEL, GEMINI_MODEL_FALLBACKS) => {
        const chain = edgeModelChain({ GEMINI_MODEL, GEMINI_MODEL_FALLBACKS });
        expect(chain.length).toBeLessThanOrEqual(EDGE_MAX_MODELS);
        expect(new Set(chain).size).toBe(chain.length);
        for (const name of chain) expect(name).toBe(name.trim());
        for (const name of chain) expect(name).not.toBe('');
      }),
      { numRuns: 200 },
    );
  });

  it('keeps the order of Node: primary first, then the fallbacks, cut to 3', () => {
    expect(edgeModelChain({ GEMINI_MODEL: ' m1 ', GEMINI_MODEL_FALLBACKS: 'm2, m1 ,m3,m4,m5' })).toEqual(['m1', 'm2', 'm3']);
  });
});

describe('edgeAppDeps', () => {
  it('fixes the gate header and the hops, whatever COUNTRY_HEADER and TRUSTED_PROXY_HOPS say', () => {
    const plain = deps();
    const forged = deps({ COUNTRY_HEADER: 'cf-ipcountry', TRUSTED_PROXY_HOPS: '0' });
    for (const d of [plain, forged]) {
      expect(d.gate).toEqual({ tier: 'free', countryHeader: EDGE_COUNTRY_HEADER });
      expect(d.trustedProxyHops).toBe(1);
    }
  });

  it('takes the tier, budget, CORS and prices from the environment with Node parsing', () => {
    const d = deps({
      GEMINI_TIER: 'paid',
      DAILY_BUDGET_CENTS: '12.5',
      PER_IP_LIMIT: '4',
      RATE_WINDOW_MS: '5000',
      CORS_ORIGIN: 'https://paw.example',
    });
    expect(d.gate?.tier).toBe('paid');
    expect(d.budget).toEqual({ perIpLimit: 4, windowMs: 5000, dailyBudgetCents: 12.5 });
    expect(d.corsOrigin).toBe('https://paw.example');
    expect(deps({ GEMINI_TIER: 'PAID' }).gate?.tier).toBe('free');
    expect(deps().corsOrigin).toBe('*');
    expect(deps().budget).toEqual({ perIpLimit: 10, windowMs: 60000, dailyBudgetCents: 200 });
  });

  it('treats a missing or blank key as examples-only', () => {
    expect(deps().model.available).toBe(false);
    expect(deps({ GEMINI_API_KEY: '' }).model.available).toBe(false);
    expect(deps({ GEMINI_API_KEY: '   ' }).model.available).toBe(false);
    expect(deps({ GEMINI_API_KEY: 'a-fake-key' }).model.available).toBe(true);
  });

  it('uses the given store and serves the committed examples text', async () => {
    const store = new FakeBudgetStore();
    const d = edgeAppDeps({}, store);
    expect(d.budgetStore).toBe(store);
    expect(d.examplesCachePath).toBeUndefined();
    const text = await d.loadExamples!();
    expect(JSON.parse(text)).toEqual(JSON.parse(readFileSync(EXAMPLES, 'utf8')));
  });
});
