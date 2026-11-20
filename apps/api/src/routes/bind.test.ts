import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import type { ModelClient } from 'paw-core';
import { createBindRoute } from './bind';
import { BudgetedModelClient } from '../budget/guarded-client';
import { createGlobalState } from '../budget/state';
import { FakeMeteredModel } from '../budget/fake-metered';

/** A per-request guard factory over `model` with a budget large enough not to matter. */
function guarded(model: ModelClient, dailyBudgetCents = 500) {
  const state = createGlobalState();
  const inner = new FakeMeteredModel({ answer: (prompt) => model.generate(prompt) });
  return () =>
    new BudgetedModelClient(inner, state, { perIpLimit: 10, windowMs: 60_000, dailyBudgetCents });
}

class MockModelClient implements ModelClient {
  async generate(): Promise<unknown> {
    return {
      curseId: 'c1',
      closed: true,
      reason: 'The binding is airtight.',
      judgedAt: Date.now(),
    };
  }
}

class MockModelClientFails implements ModelClient {
  async generate(): Promise<never> {
    throw new Error('Model failed');
  }
}

describe('POST /api/bind', () => {
  it('returns 200 with updated grant (Task 27, Req 2.4)', async () => {
    const app = new Hono();
    createBindRoute(app, guarded(new MockModelClient()));

    const req = {
      grant: {
        wishId: 'w1',
        narration: 'Granted.',
        curses: [
          {
            id: 'c1',
            type: 'permissions' as const,
            story: 'Admins leave.',
            loophole: 'Owner leaves.',
            status: 'open' as const,
          },
          {
            id: 'c2',
            type: 'time' as const,
            story: 'Time passes.',
            loophole: 'No deadline.',
            status: 'open' as const,
          },
          {
            id: 'c3',
            type: 'money' as const,
            story: 'Money disappears.',
            loophole: 'No price set.',
            status: 'open' as const,
          },
        ],
      },
      curseId: 'c1',
      kind: 'rewrite' as const,
      clause: 'Only the owner can delete, or a board-approved admin.',
    };

    const res = await app.request(
      new Request('http://localhost/api/bind', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      }),
    );

    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.grant).toBeDefined();
    expect(data.verdict).toBeDefined();
  });

  it('returns 400 for empty clause (Task 28, Req 2.2)', async () => {
    const app = new Hono();
    createBindRoute(app, guarded(new MockModelClient()));

    const res = await app.request(
      new Request('http://localhost/api/bind', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant: {
            wishId: 'w1',
            narration: 'Granted.',
            curses: [
              {
                id: 'c1',
                type: 'permissions' as const,
                story: 'Story',
                loophole: 'loophole',
                status: 'open' as const,
              },
              {
                id: 'c2',
                type: 'time' as const,
                story: 'Story2',
                loophole: 'loophole2',
                status: 'open' as const,
              },
              {
                id: 'c3',
                type: 'money' as const,
                story: 'Story3',
                loophole: 'loophole3',
                status: 'open' as const,
              },
            ],
          },
          curseId: 'c1',
          kind: 'rewrite' as const,
          clause: '   ',
        }),
      }),
    );

    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown curseId (Task 29, Req 2.3)', async () => {
    const app = new Hono();
    createBindRoute(app, guarded(new MockModelClient()));

    const res = await app.request(
      new Request('http://localhost/api/bind', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant: {
            wishId: 'w1',
            narration: 'Granted.',
            curses: [
              {
                id: 'c1',
                type: 'permissions' as const,
                story: 'Story',
                loophole: 'loophole',
                status: 'open' as const,
              },
              {
                id: 'c2',
                type: 'time' as const,
                story: 'Story2',
                loophole: 'loophole2',
                status: 'open' as const,
              },
              {
                id: 'c3',
                type: 'money' as const,
                story: 'Story3',
                loophole: 'loophole3',
                status: 'open' as const,
              },
            ],
          },
          curseId: 'unknown-curse',
          kind: 'rewrite' as const,
          clause: 'Some binding',
        }),
      }),
    );

    expect(res.status).toBe(404);
  });

  it('returns 503 when the guard refuses a model call (Req 7.1, 8.3)', async () => {
    const app = new Hono();
    createBindRoute(app, guarded(new MockModelClient(), 0));

    const curse = (id: string, type: 'permissions' | 'time' | 'money') => ({
      id,
      type,
      story: 'Story',
      loophole: 'Loophole',
      status: 'open' as const,
    });
    const res = await app.request(
      new Request('http://localhost/api/bind', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant: {
            wishId: 'w1',
            narration: 'Granted.',
            curses: [curse('c1', 'permissions'), curse('c2', 'time'), curse('c3', 'money')],
          },
          curseId: 'c1',
          kind: 'rewrite',
          clause: 'Only the owner, or a named deputy, can delete.',
        }),
      }),
    );

    expect(res.status).toBe(503);
    const data = (await res.json()) as { message: string };
    expect(data.message).toBe('The paw is resting. Browse the examples until it wakes.');
  });
});
