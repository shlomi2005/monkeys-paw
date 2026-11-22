import type { Context } from 'hono';
import { logError } from '../error-log';
import { MAX_BODY_BYTES } from '../schemas';

export const BODY_TOO_LARGE_MESSAGE = 'The request is too large.';

/** The 413 answer of every route that reads a body. */
export function bodyTooLarge(c: Context): Response {
  return c.json({ message: BODY_TOO_LARGE_MESSAGE }, 413);
}

/**
 * Read the JSON body of a request, at most MAX_BODY_BYTES. A declared length over the cap is refused
 * unread. Otherwise the stream is read chunk by chunk and given up as soon as the total passes the cap,
 * whatever the headers said. An unreadable body (not JSON, cut short, aborted) is `{ ok: false,
 * tooLarge: false }`: the caller answers 400 with its own fixed message. The thrown value is never
 * kept, because a SyntaxError message quotes part of the body. Only a fixed code and the class are
 * logged. A body that is too large is not an error and logs nothing.
 */
export async function readJsonBody(
  c: Context,
): Promise<{ ok: true; value: unknown } | { ok: false; tooLarge: boolean }> {
  const declared = c.req.header('content-length');
  if (declared !== undefined && /^\d+$/.test(declared) && Number(declared) > MAX_BODY_BYTES) {
    return { ok: false, tooLarge: true };
  }
  try {
    let buffer = new Uint8Array(1024);
    let length = 0;
    const stream = c.req.raw.body;
    if (stream) {
      const reader = stream.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const total = length + value.byteLength;
        if (total > MAX_BODY_BYTES) {
          void reader.cancel().catch(() => undefined);
          return { ok: false, tooLarge: true };
        }
        if (total > buffer.length) {
          let size = buffer.length;
          while (size < total) size *= 2;
          const grown = new Uint8Array(Math.min(size, MAX_BODY_BYTES));
          grown.set(buffer.subarray(0, length));
          buffer = grown;
        }
        buffer.set(value, length);
        length = total;
      }
    }
    return { ok: true, value: JSON.parse(new TextDecoder().decode(buffer.subarray(0, length))) };
  } catch (err) {
    logError('body_unreadable', err);
    return { ok: false, tooLarge: false };
  }
}
