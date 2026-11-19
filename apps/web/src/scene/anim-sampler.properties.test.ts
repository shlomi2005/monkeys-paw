import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { AnimCommand, Digit } from '../state/paw-machine-types';
import { CURL_MS, OPEN_MS, REST_MS, durationOf, sample } from './anim-sampler';
import type { Amounts } from './anim-sampler';
import { REST_SINK, REST_TILT_DEG } from './rest-pose';

// P14 part 2 (design.md): the curl amount rises monotonically in [0, 1], the open amount falls monotonically in
// [0, 1], and at elapsed >= duration the value is exactly the end value. Req 2.7: only one digit moves.

const NUM_RUNS = 500;

const digit: fc.Arbitrary<Digit> = fc.constantFrom<Digit>(0, 1, 2, 3, 4);

const amount = fc.double({ min: 0, max: 1, noNaN: true });

const baseAmounts: fc.Arbitrary<Amounts> = fc.tuple(amount, amount, amount, amount, amount);

/** Elapsed times around and well beyond every duration, including negative values. */
const elapsed = fc.double({ min: -1000, max: 5000, noNaN: true });

const elapsedPair: fc.Arbitrary<readonly [number, number]> = fc
  .tuple(elapsed, elapsed)
  .map(([a, b]): readonly [number, number] => (a <= b ? [a, b] : [b, a]));

const atOrAfter = (ms: number): fc.Arbitrary<number> =>
  fc.oneof(
    fc.constant(ms),
    fc.double({ min: ms, max: ms + 10_000, noNaN: true }),
    fc.constant(Number.POSITIVE_INFINITY),
  );

const curl = (d: Digit): AnimCommand => ({ id: 1, kind: 'curl', digit: d });
const open = (d: Digit): AnimCommand => ({ id: 2, kind: 'open', digit: d });
const rest: AnimCommand = { id: 3, kind: 'rest' };

describe('P14 sampler: curl', () => {
  it('amount of the digit is non-decreasing in elapsed time and stays in [0, 1]', () => {
    fc.assert(
      fc.property(digit, baseAmounts, elapsedPair, (d, base, [t1, t2]) => {
        const a = sample(curl(d), t1, base).amounts[d];
        const b = sample(curl(d), t2, base).amounts[d];
        expect(a).toBeLessThanOrEqual(b);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(b).toBeLessThanOrEqual(1);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('at elapsed >= CURL_MS the digit is exactly 1 and done is true; before it done is false', () => {
    fc.assert(
      fc.property(digit, baseAmounts, atOrAfter(CURL_MS), (d, base, t) => {
        const s = sample(curl(d), t, base);
        expect(s.amounts[d]).toBe(1);
        expect(s.done).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
    fc.assert(
      fc.property(digit, baseAmounts, fc.double({ min: -1000, max: CURL_MS - 1e-9, noNaN: true }), (d, base, t) => {
        if (t >= CURL_MS) return;
        expect(sample(curl(d), t, base).done).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('moves only its own digit (Req 2.7) and leaves the rest pose at zero', () => {
    fc.assert(
      fc.property(digit, baseAmounts, elapsed, (d, base, t) => {
        const s = sample(curl(d), t, base);
        s.amounts.forEach((value, i) => {
          if (i !== d) expect(value).toBe(base[i]);
        });
        expect(s.rest).toEqual({ sink: 0, tilt: 0 });
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('P14 sampler: open', () => {
  it('amount of the digit is non-increasing in elapsed time and stays in [0, 1]', () => {
    fc.assert(
      fc.property(digit, baseAmounts, elapsedPair, (d, base, [t1, t2]) => {
        const a = sample(open(d), t1, base).amounts[d];
        const b = sample(open(d), t2, base).amounts[d];
        expect(a).toBeGreaterThanOrEqual(b);
        expect(a).toBeLessThanOrEqual(1);
        expect(b).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('at elapsed >= OPEN_MS the digit is exactly 0 and done is true; before it done is false', () => {
    fc.assert(
      fc.property(digit, baseAmounts, atOrAfter(OPEN_MS), (d, base, t) => {
        const s = sample(open(d), t, base);
        expect(Object.is(s.amounts[d], 0)).toBe(true);
        expect(s.done).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
    fc.assert(
      fc.property(digit, baseAmounts, fc.double({ min: -1000, max: OPEN_MS - 1e-9, noNaN: true }), (d, base, t) => {
        if (t >= OPEN_MS) return;
        expect(sample(open(d), t, base).done).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('moves only its own digit (Req 2.7) and leaves the rest pose at zero', () => {
    fc.assert(
      fc.property(digit, baseAmounts, elapsed, (d, base, t) => {
        const s = sample(open(d), t, base);
        s.amounts.forEach((value, i) => {
          if (i !== d) expect(value).toBe(base[i]);
        });
        expect(s.rest).toEqual({ sink: 0, tilt: 0 });
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('P14 sampler: rest', () => {
  it('sink and tilt magnitude are non-decreasing in elapsed time, from 0 to full, with the sign of REST_TILT_DEG', () => {
    const sign = Math.sign(REST_TILT_DEG);
    fc.assert(
      fc.property(baseAmounts, elapsedPair, (base, [t1, t2]) => {
        const a = sample(rest, t1, base).rest;
        const b = sample(rest, t2, base).rest;
        expect(a.sink).toBeLessThanOrEqual(b.sink);
        expect(Math.abs(a.tilt)).toBeLessThanOrEqual(Math.abs(b.tilt));
        expect(a.tilt * sign).toBeGreaterThanOrEqual(0);
        expect(b.tilt * sign).toBeGreaterThanOrEqual(0);
        expect(a.sink).toBeGreaterThanOrEqual(0);
        expect(b.sink).toBeLessThanOrEqual(REST_SINK);
        expect(Math.abs(a.tilt)).toBeGreaterThanOrEqual(0);
        expect(Math.abs(b.tilt)).toBeLessThanOrEqual(Math.abs(REST_TILT_DEG));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('at elapsed >= REST_MS sink and tilt are exactly full and done is true; before it done is false', () => {
    fc.assert(
      fc.property(baseAmounts, atOrAfter(REST_MS), (base, t) => {
        const s = sample(rest, t, base);
        expect(s.rest).toEqual({ sink: REST_SINK, tilt: REST_TILT_DEG });
        expect(s.done).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
    fc.assert(
      fc.property(baseAmounts, fc.double({ min: -1000, max: REST_MS - 1e-9, noNaN: true }), (base, t) => {
        if (t >= REST_MS) return;
        expect(sample(rest, t, base).done).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('never changes a digit amount', () => {
    fc.assert(
      fc.property(baseAmounts, elapsed, (base, t) => {
        expect(sample(rest, t, base).amounts).toEqual(base);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('P14 sampler: out-of-range elapsed', () => {
  const kinds: ReadonlyArray<AnimCommand> = [curl(2), open(2), rest];

  it('negative, -Infinity and NaN elapsed give exactly the start values, not done', () => {
    fc.assert(
      fc.property(
        baseAmounts,
        fc.oneof(
          fc.double({ min: -1e9, max: 0, noNaN: true }),
          fc.constantFrom(Number.NaN, Number.NEGATIVE_INFINITY, -0),
        ),
        (base, t) => {
          for (const command of kinds) {
            const s = sample(command, t, base);
            const start = sample(command, 0, base);
            expect(s).toEqual(start);
            expect(s.done).toBe(false);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('durationOf matches the end of the animation: done flips exactly at the duration', () => {
    fc.assert(
      fc.property(digit, baseAmounts, (d, base) => {
        for (const command of [curl(d), open(d), rest]) {
          const end = durationOf(command.kind);
          expect(sample(command, end, base).done).toBe(true);
          expect(sample(command, end - 1e-6, base).done).toBe(false);
        }
      }),
      { numRuns: 50 },
    );
  });
});
