import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import { BudgetExhaustedError } from './budget/guarded-client';
import { LocationRefusedError, QuotaExhaustedError } from './client/gemini';

/**
 * The one way the API reports an error (paw-api Requirement 9.7). A line is
 * `{"event":"error","code":<fixed code>,"error":<class from a fixed list>}` and nothing else.
 * The message, stack, cause and own properties of the thrown value are never read: they can hold
 * the wish, the body, the URL or upstream text.
 */

export type ErrorCode =
  | 'body_unreadable'
  | 'grant_failed'
  | 'bind_failed'
  | 'export_failed'
  | 'request_failed'
  | 'edge_failed'
  | 'server_failed'
  | 'uncaught_exception'
  | 'unhandled_rejection'
  | 'eval_failed';

export type ErrorClass =
  | 'SyntaxError'
  | 'TypeError'
  | 'RangeError'
  | 'ZodError'
  | 'HTTPException'
  | 'BudgetExhaustedError'
  | 'QuotaExhaustedError'
  | 'LocationRefusedError'
  | 'Error'
  | 'NonError';

/**
 * The class of a thrown value, by `instanceof` against a short list of known classes. Never
 * `err.name` or `constructor.name`: both can be forged. Anything else that is an `Error` is
 * `Error`; anything that is not is `NonError`.
 */
export function errorClassOf(err: unknown): ErrorClass {
  try {
    if (err instanceof SyntaxError) return 'SyntaxError';
    if (err instanceof TypeError) return 'TypeError';
    if (err instanceof RangeError) return 'RangeError';
    if (err instanceof ZodError) return 'ZodError';
    if (err instanceof HTTPException) return 'HTTPException';
    if (err instanceof BudgetExhaustedError) return 'BudgetExhaustedError';
    if (err instanceof QuotaExhaustedError) return 'QuotaExhaustedError';
    if (err instanceof LocationRefusedError) return 'LocationRefusedError';
    if (err instanceof Error) return 'Error';
  } catch {
    // A hostile prototype chain (a throwing Proxy trap) is not an error we can classify.
  }
  return 'NonError';
}

/** The JSON line, without a newline. */
export function errorLine(code: ErrorCode, err: unknown): string {
  return JSON.stringify({ event: 'error', code, error: errorClassOf(err) });
}

/** Log one error line on stderr. Never throws. */
export function logError(code: ErrorCode, err: unknown): void {
  try {
    console.error(errorLine(code, err));
  } catch {
    // Logging must not turn one failure into another.
  }
}
