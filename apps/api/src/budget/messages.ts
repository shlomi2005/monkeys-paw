import type { Context } from 'hono';

/** The line served whenever the paw will not make a model call (Req 8.3). */
export const RESTING_MESSAGE = 'The paw is resting. Browse the examples until it wakes.';

/**
 * The one 503 of grant and bind when the paw cannot give a real answer: a refused call, a spent quota,
 * or a failed upstream call (Requirement 19). With a hint (whole seconds, 1 to 86400) the body gets
 * `retryAfter` and the response the `Retry-After` header with the same number; with none, neither.
 */
export function restingResponse(c: Context, retryAfterSeconds?: number): Response {
  if (retryAfterSeconds === undefined) return c.json({ message: RESTING_MESSAGE }, 503);
  return c.json({ message: RESTING_MESSAGE, retryAfter: retryAfterSeconds }, 503, {
    'retry-after': String(retryAfterSeconds),
  });
}
