import { AsyncLocalStorage } from 'node:async_hooks';
import type { MiddlewareHandler } from 'hono';
import { LIVE_ROUTES } from './gate/middleware';

/**
 * The request log (paw-api Requirement 9). One JSON line per request:
 * `event`, `timestamp`, `method`, `path`, `status`, `duration`, `modelCall`.
 *
 * Nothing the caller chose reaches the line. `method` is one of the allow-listed names, else
 * "OTHER". `path` is one of the known routes (exact match), else "other". The query string, the
 * headers and the body are never read here. (Requirement 9.2, 9.7)
 */

const METHODS: ReadonlySet<string> = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

const KNOWN_PATHS: ReadonlySet<string> = new Set([
  ...LIVE_ROUTES,
  '/api/export',
  '/api/examples',
  '/api/health',
  '/api/live',
]);

/** Per request: one probe for each budget guard the request created. */
const probesOfRequest = new AsyncLocalStorage<Array<() => number>>();

/**
 * Register a guard of the current request. `calls` returns how many model calls it has made.
 * Outside a request it does nothing.
 */
export function trackModelCalls(calls: () => number): void {
  probesOfRequest.getStore()?.push(calls);
}

export function requestLogger(): MiddlewareHandler {
  return async (c, next) => {
    const startedAt = Date.now();
    const probes: Array<() => number> = [];
    let failed = false;
    try {
      await probesOfRequest.run(probes, () => next());
    } catch (err) {
      failed = true;
      throw err;
    } finally {
      try {
        const method = METHODS.has(c.req.method) ? c.req.method : 'OTHER';
        const path = KNOWN_PATHS.has(c.req.path) ? c.req.path : 'other';
        const entry = {
          event: 'request',
          timestamp: new Date().toISOString(),
          method,
          path,
          status: failed ? 500 : c.res.status,
          duration: Date.now() - startedAt,
          // True only for a POST on a live route whose guard made at least one model call.
          modelCall: method === 'POST' && LIVE_ROUTES.includes(path) && probes.some((calls) => calls() > 0),
        };
        console.log(JSON.stringify(entry));
      } catch {
        // Logging must not fail a request.
      }
    }
  };
}
