import type { Context, Hono } from 'hono';
import type { GateConfig } from '../gate/config';
import { countryAllowed } from '../gate/middleware';

/**
 * `GET /api/live`: may this visitor make live wishes? Only the country decides. It ignores age,
 * budget and mode, calls no model and counts nothing.
 * (paw-api Requirement 14.8)
 */
export function createLiveRoute(app: Hono, gate: GateConfig): void {
  app.get('/api/live', (c: Context) =>
    c.json({ live: countryAllowed(c.req.raw.headers, gate) }, 200, { 'cache-control': 'no-store' }),
  );
}
