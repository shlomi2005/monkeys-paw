import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { cubicOut, smoothstep } from './easing';

// P14 part 1 (design.md): for any u, cubicOut and smoothstep are non-decreasing on [0, 1], return 0 at 0 and 1 at 1,
// clamp outside, and stay within [0, 1].

const NUM_RUNS = 1000;

const EASINGS: ReadonlyArray<readonly [string, (u: number) => number]> = [
  ['cubicOut', cubicOut],
  ['smoothstep', smoothstep],
];

/** Any double, including NaN and +-Infinity. */
const anyNumber = fc.double({ noNaN: false, noDefaultInfinity: false });

const unit = fc.double({ min: 0, max: 1, noNaN: true });

/** A pair u1 <= u2 in [0, 1], far apart or a hair apart (to expose floating-point wobble). */
const orderedPair: fc.Arbitrary<readonly [number, number]> = fc.oneof(
  fc.tuple(unit, unit).map(([a, b]): readonly [number, number] => (a <= b ? [a, b] : [b, a])),
  fc
    .tuple(unit, fc.double({ min: 0, max: 1e-6, noNaN: true }))
    .map(([a, delta]): readonly [number, number] => [a, Math.min(1, a + delta)]),
);

describe.each(EASINGS)('P14 easing: %s', (_name, ease) => {
  it('is non-decreasing on [0, 1]', () => {
    fc.assert(
      fc.property(orderedPair, ([u1, u2]) => {
        expect(ease(u1)).toBeLessThanOrEqual(ease(u2));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('returns exactly 0 at 0 and exactly 1 at 1', () => {
    expect(Object.is(ease(0), 0)).toBe(true);
    expect(Object.is(ease(1), 1)).toBe(true);
  });

  it('clamps: at or below 0 (and NaN) gives exactly 0, at or above 1 gives exactly 1', () => {
    for (const u of [Number.NaN, -0, -1e-300, -1, -1e9, Number.NEGATIVE_INFINITY]) {
      expect(Object.is(ease(u), 0)).toBe(true);
    }
    for (const u of [1.0000000000000002, 2, 1e9, Number.POSITIVE_INFINITY]) {
      expect(Object.is(ease(u), 1)).toBe(true);
    }
    fc.assert(
      fc.property(anyNumber, (u) => {
        if (Number.isNaN(u) || u <= 0) expect(Object.is(ease(u), 0)).toBe(true);
        else if (u >= 1) expect(Object.is(ease(u), 1)).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('stays within [0, 1] for any input', () => {
    fc.assert(
      fc.property(anyNumber, (u) => {
        const y = ease(u);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(1);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
