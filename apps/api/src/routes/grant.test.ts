import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import type { ModelClient, Grant } from 'paw-core';
import { GrantSchema } from 'paw-core';
import { createGrantRoute } from './grant';
import { BudgetedModelClient } from '../budget/guarded-client';
import { createGlobalState } from '../budget/state';

/** A per-request guard factory over `model` with a budget large enough not to matter. */
function guarded(model: ModelClient, dailyBudgetCents = 500) {
  const state = createGlobalState();
  const inner = { available: true, generate: (prompt: string) => model.generate(prompt) };
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
