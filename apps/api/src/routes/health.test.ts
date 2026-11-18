import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { createHealthRoute } from './health';
import { createGlobalState } from '../budget/state';

describe('GET /api/health', () => {
  it('returns ok status and mode (Task 40, Req 5.1)', async () => {
    const app = new Hono();
    const state = createGlobalState();
    createHealthRoute(app, state, 500, 'normal');

    const res = await app.request(
      new Request('http://localhost/api/health', { method: 'GET' }),
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('ok');
    expect(data.mode).toBe('normal');
    expect(data.budget).toBeDefined();
  });

  it('returns examples-only mode when budget exhausted (Task 41, Req 8.1)', async () => {
    const app = new Hono();
    const state = createGlobalState();
    state.spentCents = 500; // At budget limit
    createHealthRoute(app, state, 500, 'examples-only');

    const res = await app.request(
      new Request('http://localhost/api/health', { method: 'GET' }),
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('ok');
    expect(data.mode).toBe('examples-only');
  });
});
