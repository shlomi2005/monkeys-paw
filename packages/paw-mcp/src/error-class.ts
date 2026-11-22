import { ZodError } from 'zod';

/**
 * The class of a thrown value, by `instanceof` against a short list. Never `err.name` or
 * `constructor.name`: both can be forged. The message, stack and cause are never read, because
 * they can hold what a caller sent.
 */
export type ErrorClass = 'SyntaxError' | 'TypeError' | 'RangeError' | 'ZodError' | 'Error' | 'NonError';

export function errorClassOf(err: unknown): ErrorClass {
  try {
    if (err instanceof SyntaxError) return 'SyntaxError';
    if (err instanceof TypeError) return 'TypeError';
    if (err instanceof RangeError) return 'RangeError';
    if (err instanceof ZodError) return 'ZodError';
    if (err instanceof Error) return 'Error';
  } catch {
    // a hostile prototype chain
  }
  return 'NonError';
}

/** The one line a crash writes: `{"event":"error","code":<fixed code>,"error":<class>}`. */
export function errorLine(code: 'uncaught_exception' | 'unhandled_rejection', err: unknown): string {
  return JSON.stringify({ event: 'error', code, error: errorClassOf(err) });
}
