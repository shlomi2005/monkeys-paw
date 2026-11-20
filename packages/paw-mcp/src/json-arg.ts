export type JsonArgResult<T> = { ok: true; value: T } | { ok: false; problem: string };

type Shape = 'array' | 'object';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Some clients send nested arguments as JSON strings. Accept the value itself, or a string that
 * parses to one, and say what was expected by its path when it is neither.
 */
export function parseJsonArg(value: unknown, path: string, shape: 'array'): JsonArgResult<unknown[]>;
export function parseJsonArg(value: unknown, path: string, shape: 'object'): JsonArgResult<Record<string, unknown>>;
export function parseJsonArg(value: unknown, path: string, shape: Shape): JsonArgResult<unknown> {
  const noun = shape === 'array' ? 'an array' : 'an object';
  const problem = `${path} must be ${noun}, or a JSON string of ${noun}.`;
  let candidate = value;
  if (typeof value === 'string') {
    try {
      candidate = JSON.parse(value);
    } catch {
      return { ok: false, problem };
    }
  }
  const fits = shape === 'array' ? Array.isArray(candidate) : isObject(candidate);
  return fits ? { ok: true, value: candidate } : { ok: false, problem };
}

export { isObject };
