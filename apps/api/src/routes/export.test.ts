import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { createExportRoute } from './export';

describe('POST /api/export', () => {
  it('route is registered without error (Task 34)', () => {
    const app = new Hono();
    // Should not throw when creating the route
    expect(() => createExportRoute(app)).not.toThrow();
  });

  it('returns 400 for malformed grant (Task 33, Req 3.3)', async () => {
    const app = new Hono();
    createExportRoute(app);

    const res = await app.request(
      new Request('http://localhost/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wish: {
            id: 'w1',
            text: 'Only admins can delete projects',
            createdAt: Date.now(),
          },
          grant: {
            // Missing narration
            wishId: 'w1',
            curses: [],
          },
        }),
      }),
    );

    expect(res.status).toBe(400);
  });
});
