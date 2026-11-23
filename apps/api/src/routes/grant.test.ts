import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import type { ModelClient, Grant } from 'paw-core';
import { GrantSchema } from 'paw-core';
import { createGrantRoute } from './grant';
import { BudgetedModelClient } from '../budget/guarded-client';
import { createGlobalState } from '../budget/state';
import { FakeMeteredModel } from '../budget/fake-metered';
import { MAX_WISH_CONTEXT_CHARS, MAX_WISH_TEXT_CHARS } from '../schemas';

/** A per-request guard factory over `model` with a budget large enough not to matter. */
function guarded(model: ModelClient, dailyBudgetCents = 500) {
  const state = createGlobalState();
  const inner = new FakeMeteredModel({ answer: (prompt) => model.generate(prompt) });
  return () =>
    new BudgetedModelClient(inner, state, { perIpLimit: 10, windowMs: 60_000, dailyBudgetCents });
}

// Mock ModelClient that returns a valid grant with 3+ curses
class MockModelClient implements ModelClient {
  private callCount = 0;

  async generate(): Promise<unknown> {
    this.callCount++;
    
    // For quality-gate calls, return specific: true
    if (this.callCount > 1) {
      return { specific: true, reason: 'This curse is specific.' };
    }

    // First call is the main grant
    return {
      narration: 'Your wish is granted, exactly as stated.',
      curses: [
        {
          id: 'c1',
          type: 'permissions' as const,
          story: 'Admins leave the company.',
          loophole: '"Only the owner" — the owner quits.',
        },
        {
          id: 'c2',
          type: 'time' as const,
          story: 'What happens at midnight?',
          loophole: '"permanent" has no time bound',
        },
        {
          id: 'c3',
          type: 'scale' as const,
          story: 'A single keystroke deletes everything.',
          loophole: 'no mention of batch operations',
        },
      ],
    };
  }
}

class HarmfulWishModelClient implements ModelClient {
  async generate(): Promise<never> {
    throw new Error('Harmful wish detected');
  }
}

describe('POST /api/grant', () => {
  it('returns 200 with valid grant (Task 21, Req 1.5)', async () => {
    const app = new Hono();
    const modelClient = new MockModelClient();
    createGrantRoute(app, guarded(modelClient));

    const res = await app.request(
      new Request('http://localhost/api/grant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wish: { text: 'Only the owner can delete a project' },
        }),
      }),
    );

    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.wish.text).toBe('Only the owner can delete a project');
    expect(data.wish.id).toBeDefined();
    expect(data.wish.createdAt).toBeDefined();
    expect(data.grant.narration).toBeDefined();
    expect(data.grant.curses.length).toBeGreaterThanOrEqual(1);
  });

  it('returns 400 for empty wish (Task 22, Req 1.2)', async () => {
    const app = new Hono();
    createGrantRoute(app, guarded(new MockModelClient()));

    const res = await app.request(
      new Request('http://localhost/api/grant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wish: { text: '   ' },
        }),
      }),
    );

    expect(res.status).toBe(400);
  });

  it('returns 400 for harmful wish (Task 23, Req 1.3)', async () => {
    const app = new Hono();
    createGrantRoute(app, guarded(new HarmfulWishModelClient()));

    const res = await app.request(
      new Request('http://localhost/api/grant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wish: { text: 'kill all users' },
        }),
      }),
    );

    expect(res.status).toBe(400);
    const data = (await res.json()) as any;
    expect(data.message.toLowerCase()).toContain('paw');
  });

  it('lets a wish that prevents abuse reach the model', async () => {
    const app = new Hono();
    createGrantRoute(app, guarded(new MockModelClient()));

    const res = await app.request(
      new Request('http://localhost/api/grant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wish: { text: 'Prevent abuse of the signup form' },
        }),
      }),
    );

    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.grant.curses.length).toBeGreaterThanOrEqual(1);
  });

  it('returns 503 when the guard refuses a model call (Task 24, Req 1.4)', async () => {
    const app = new Hono();
    // A budget of zero cannot pay for any call: the guard denies the first one.
    createGrantRoute(app, guarded(new MockModelClient(), 0));

    const res = await app.request(
      new Request('http://localhost/api/grant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wish: { text: 'Some wish' } }),
      }),
    );

    expect(res.status).toBe(503);
    const data = (await res.json()) as { message: string };
    expect(data.message).toBe('The paw is resting. Browse the examples until it wakes.');
  });
});

describe('POST /api/grant input caps (task 107)', () => {
  /** A route over a fake that counts every call that reaches the model. */
  function setup() {
    const inner = new FakeMeteredModel();
    const state = createGlobalState();
    let guardsCreated = 0;
    const app = new Hono();
    createGrantRoute(app, () => {
      guardsCreated += 1;
      return new BudgetedModelClient(inner, state, {
        perIpLimit: 10,
        windowMs: 60_000,
        dailyBudgetCents: 500,
      });
    });
    const post = (wish: { text: string; context?: string }) =>
      app.request(
        new Request('http://localhost/api/grant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wish }),
        }),
      );
    return { inner, post, guardsCreated: () => guardsCreated, state };
  }

  it('exports the limits as named constants', () => {
    expect(MAX_WISH_TEXT_CHARS).toBe(500);
    expect(MAX_WISH_CONTEXT_CHARS).toBe(200);
  });

  it('accepts a wish text of 500 characters and rejects 501 with 400 and no model call', async () => {
    const ok = setup();
    expect((await ok.post({ text: 'a'.repeat(500) })).status).toBe(503); // accepted: it reached the model, whose `{ ok: true }` is no grant (Req 19)
    expect(ok.inner.calls).toBeGreaterThan(0);

    const over = setup();
    const res = await over.post({ text: 'a'.repeat(501) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { message: string }).message).toBe('Invalid wish format');
    expect(over.inner.calls).toBe(0);
    expect(over.guardsCreated()).toBe(0);
    expect(over.state.spentCents).toBe(0);
    expect(over.state.reservedCents).toBe(0);
  });

  it('counts the wish text after trim', async () => {
    const padded = setup();
    expect((await padded.post({ text: `   ${'a'.repeat(500)}   ` })).status).toBe(503); // accepted, then the failed model call (Req 19)

    const over = setup();
    expect((await over.post({ text: `   ${'a'.repeat(501)}   ` })).status).toBe(400);
    expect(over.inner.calls).toBe(0);
  });

  it('accepts a context of 200 characters and rejects 201 with 400 and no model call', async () => {
    const ok = setup();
    expect((await ok.post({ text: 'Save a draft', context: 'b'.repeat(200) })).status).toBe(503); // accepted, then the failed model call (Req 19)
    expect(ok.inner.calls).toBeGreaterThan(0);

    const over = setup();
    const res = await over.post({ text: 'Save a draft', context: 'b'.repeat(201) });
    expect(res.status).toBe(400);
    expect(over.inner.calls).toBe(0);
    expect(over.guardsCreated()).toBe(0);
  });
});
