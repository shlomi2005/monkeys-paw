import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { createExamplesRoute } from './examples';

describe('GET /api/examples', () => {
  it('route is registered without error (Task 38)', () => {
    const app = new Hono();
    // Should not throw when creating the route
    expect(() => createExamplesRoute(app, '/nonexistent/cache.json')).not.toThrow();
  });

  it('returns 503 when cache file is missing (Task 37, Req 4.3)', async () => {
    const app = new Hono();
    createExamplesRoute(app, '/nonexistent/cache.json');

    const res = await app.request(
      new Request('http://localhost/api/examples', { method: 'GET' }),
    );

    expect(res.status).toBe(503);
  });
});
