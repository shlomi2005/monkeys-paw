import { writeSync } from 'node:fs';
import { errorLine } from './error-log';
import type { ErrorCode } from './error-log';

// Node only: the edge bundle must not import this file. Only server.ts (and tests) do.

/** Same line, written synchronously to fd 2, for a process that is about to exit. Never throws. */
export function logErrorSync(code: ErrorCode, err: unknown): void {
  try {
    writeSync(2, `${errorLine(code, err)}\n`);
  } catch {
    // Nothing left to try.
  }
}
