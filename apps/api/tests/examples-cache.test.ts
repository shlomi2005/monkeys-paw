// The committed examples cache (paw-api Requirement 20): the three ready rounds of the web app, built by
// `pnpm -C apps/api examples:ready` with no model call. No network and no model here.
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { ExamplesResponseSchema } from 'paw-core';
import { createApp } from '../src/app';
import { FakeBudgetStore } from '../src/budget/fake-store';
import { FakeMeteredModel } from '../src/budget/fake-metered';
import { edgeAppDeps } from '../src/edge/config';
import { fitGrant } from '../src/fit';
import { CACHE_FILE, readyExamplesText } from '../scripts/ready-examples-cache.mjs';

const COMMITTED = fileURLToPath(new URL('../examples-cache.json', import.meta.url));
const committedText = () => readFileSync(COMMITTED, 'utf-8');
const committedRounds = () => ExamplesResponseSchema.parse(JSON.parse(committedText()));

describe('the committed examples cache', () => {
  it('is the file the script writes to', () => {
    expect(CACHE_FILE).toBe(COMMITTED);
  });

  it('has exactly the text of readyExamplesText()', () => {
    const expected = readyExamplesText();
    expect(expected.endsWith(']\n')).toBe(true);
    expect(committedText()).toBe(expected);
  });

  it('parses into 3 rounds whose every curse has a binding and a closing verdict', () => {
    const rounds = committedRounds();
    expect(rounds).toHaveLength(3);
    for (const { grant } of rounds) {
      expect(grant.curses.length).toBeGreaterThan(0);
      for (const curse of grant.curses) {
        expect(curse.binding).toBeDefined();
        expect(curse.binding?.curseId).toBe(curse.id);
        expect(curse.verdict?.closed).toBe(true);
        expect(curse.verdict?.curseId).toBe(curse.id);
      }
    }
  });

  it('holds no fallback grant', () => {
    const text = committedText();
    expect(text).not.toContain('fallback-curse');
    expect(text).not.toContain('only shape it could remember');
  });

  it('is not written by importing the script', async () => {
    const before = statSync(COMMITTED).mtimeMs;
    const text = committedText();
    vi.resetModules();
    const again = await import('../scripts/ready-examples-cache.mjs');
    expect(typeof again.readyExamplesText).toBe('function');
    expect(statSync(COMMITTED).mtimeMs).toBe(before);
    expect(committedText()).toBe(text);
  });
});

describe('GET /api/examples with the committed cache', () => {
  const BUDGET = { perIpLimit: 10, windowMs: 60_000, dailyBudgetCents: 500 };
  const GATE = { tier: 'free' as const, countryHeader: 'x-test-country' };

  async function expectThreeRounds(app: ReturnType<typeof createApp>) {
    const res = await app.request('http://localhost/api/examples');
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain('fallback-curse');
    expect(text).not.toContain('only shape it could remember');
    const body = JSON.parse(text);
    expect(body).toHaveLength(3);
    const expected = committedRounds().map((entry) => ({ ...entry, grant: fitGrant(entry.grant) }));
    expect(body).toEqual(expected);
    expect(body).toEqual(committedRounds());
  }

  it('answers 200 with the three rounds through createApp and the file path', async () => {
    const app = createApp({
      model: new FakeMeteredModel(),
      budget: BUDGET,
      corsOrigin: '*',
      gate: GATE,
      examplesCachePath: COMMITTED,
    });
    await expectThreeRounds(app);
  });

  it('answers 200 with the three rounds through the edge deps (the bundled import)', async () => {
    const app = createApp(edgeAppDeps({}, new FakeBudgetStore()));
    await expectThreeRounds(app);
  });
});
