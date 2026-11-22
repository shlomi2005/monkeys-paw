import type { Context } from 'hono';
import { logError } from '../error-log';

/**
 * Read the JSON body of a request. An unreadable body (not JSON, cut short, aborted) is a
 * plain `{ ok: false }`: the caller answers 400 with its own fixed message. The thrown value is
 * never kept, because a SyntaxError message quotes part of the body. Only a fixed code and the
 * class are logged.
 */
export async function readJsonBody(
  c: Context,
): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    return { ok: true, value: await c.req.json() };
  } catch (err) {
    logError('body_unreadable', err);
    return { ok: false };
  }
}
