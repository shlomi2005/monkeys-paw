import type { Context, Hono } from 'hono';
import type { GateConfig } from '../gate/config';
import { countryAllowed } from '../gate/middleware';

/**
 * `GET /api/live`: may this visitor make live wishes? The country decides. When it allows them, the
 * body also says `resting: true` while the model is not callable (mode or budget). It ignores age,
 * calls no model and counts nothing.
 * (paw-api Requirement 14.8)
 */
export function createLiveRoute(app: Hono, gate: GateConfig, isResting: () => boolean): void {
  app.get('/api/live', (c: Context) =>
    {
      const live = countryAllowed(c.req.raw.headers, gate);
      return c.json(live && isResting() ? { live, resting: true } : { live }, 200, { 'cache-control': 'no-store' });
    },
  );
}
