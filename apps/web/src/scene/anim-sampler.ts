import type { AnimCommand } from '../state/paw-machine-types';
import { cubicOut, smoothstep } from './easing';
import { restTransform } from './rest-pose';
import type { RestTransform } from './rest-pose';

/** Req 2.7. */
export const CURL_MS = 500;
/** Req 2.8. */
export const OPEN_MS = 1208;
/** Req 6.1: "about 2s". */
export const REST_MS = 2000;

/** One amount per digit: thumb, index, middle, ring, little. */
export type Amounts = readonly [number, number, number, number, number];

export interface Sample {
  readonly amounts: Amounts;
  /** Whole-paw sink (units) and tilt (degrees). Both 0 unless the command is `rest` or a rested snap. */
  readonly rest: RestTransform;
  readonly done: boolean;
}

const NO_REST: RestTransform = { sink: 0, tilt: 0 };

export function durationOf(kind: AnimCommand['kind']): number {
  switch (kind) {
    case 'curl':
      return CURL_MS;
    case 'open':
      return OPEN_MS;
    case 'rest':
      return REST_MS;
  }
}

/** Replaces one digit and keeps the rest of `base`. Without a digit nothing moves. */
function withDigit(base: Amounts, digit: AnimCommand['digit'], value: number): Amounts {
  if (digit === undefined) return base;
  const next: [number, number, number, number, number] = [base[0], base[1], base[2], base[3], base[4]];
  next[digit] = value;
  return next;
}

/**
 * The state of a command `elapsedMs` after it started. Pure: depends only on its arguments.
 *
 * Negative or NaN elapsed gives the start values. At `elapsedMs >= duration` the values are exactly the end values
 * and `done` is true. Only the command's own digit differs from `base` (Req 2.7).
 */
export function sample(command: AnimCommand, elapsedMs: number, base: Amounts): Sample {
  const duration = durationOf(command.kind);
  const elapsed = Number.isNaN(elapsedMs) ? 0 : elapsedMs;
  const done = elapsed >= duration;
  const u = elapsed / duration;

  switch (command.kind) {
    case 'curl':
      return { amounts: withDigit(base, command.digit, cubicOut(u)), rest: NO_REST, done };
    case 'open':
      return { amounts: withDigit(base, command.digit, 1 - smoothstep(u)), rest: NO_REST, done };
    case 'rest':
      return { amounts: base, rest: restTransform(smoothstep(u)), done };
  }
}

/** The `snap` effect (reduced motion, stop): the given amounts and the end pose, in one step. */
export function snapSample(amounts: Amounts, pose: 'upright' | 'rested'): Sample {
  return { amounts, rest: pose === 'rested' ? restTransform(1) : NO_REST, done: true };
}
