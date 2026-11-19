import { describe, expect, it } from 'vitest';
import type { AnimCommand } from '../state/paw-machine-types';
import { CURL_MS, OPEN_MS, REST_MS, durationOf, sample, snapSample } from './anim-sampler';
import type { Amounts } from './anim-sampler';
import { REST_SINK, REST_TILT_DEG, restTransform } from './rest-pose';

const BASE: Amounts = [0.1, 0.2, 0.3, 0.4, 0.5];
const NO_REST = { sink: 0, tilt: 0 };

const curl: AnimCommand = { id: 1, kind: 'curl', digit: 2 };
const open: AnimCommand = { id: 2, kind: 'open', digit: 3 };
const rest: AnimCommand = { id: 3, kind: 'rest' };

describe('durations (Req 2.7, 2.8, 6.1)', () => {
  it('has the documented constants', () => {
    expect(CURL_MS).toBe(500);
    expect(OPEN_MS).toBe(1208);
    expect(REST_MS).toBe(2000);
  });

  it('durationOf returns the duration of each kind', () => {
    expect(durationOf('curl')).toBe(500);
    expect(durationOf('open')).toBe(1208);
    expect(durationOf('rest')).toBe(2000);
  });
});

describe('rest-pose', () => {
  it('has the starting constants', () => {
    expect(REST_SINK).toBe(0.1);
    expect(REST_TILT_DEG).toBe(-30);
  });

  it('restTransform scales both values by p and clamps p to [0, 1]', () => {
    expect(restTransform(0)).toEqual({ sink: 0, tilt: 0 });
    expect(restTransform(1)).toEqual({ sink: REST_SINK, tilt: REST_TILT_DEG });
    expect(restTransform(0.5).sink).toBeCloseTo(REST_SINK / 2, 12);
    expect(restTransform(0.5).tilt).toBeCloseTo(REST_TILT_DEG / 2, 12);
    expect(restTransform(-3)).toEqual({ sink: 0, tilt: 0 });
    expect(restTransform(Number.NaN)).toEqual({ sink: 0, tilt: 0 });
    expect(restTransform(7)).toEqual({ sink: REST_SINK, tilt: REST_TILT_DEG });
  });
});

describe('sample: curl digit 2', () => {
  it('at 0 ms the digit is 0, other digits keep base, rest pose is zero', () => {
    expect(sample(curl, 0, BASE)).toEqual({ amounts: [0.1, 0.2, 0, 0.4, 0.5], rest: NO_REST, done: false });
  });

  it('at 250 ms the amount is cubicOut(0.5) = 0.875', () => {
    const s = sample(curl, 250, BASE);
    expect(s.amounts[2]).toBeCloseTo(0.875, 12);
    expect(s.amounts[0]).toBe(0.1);
    expect(s.done).toBe(false);
  });

  it('at 500 ms the digit is exactly 1 and done is true', () => {
    expect(sample(curl, 500, BASE)).toEqual({ amounts: [0.1, 0.2, 1, 0.4, 0.5], rest: NO_REST, done: true });
  });
});

describe('sample: open digit 3', () => {
  it('at 0 ms the digit is 1', () => {
    expect(sample(open, 0, BASE)).toEqual({ amounts: [0.1, 0.2, 0.3, 1, 0.5], rest: NO_REST, done: false });
  });

  it('at 604 ms (half way) the amount is 0.5', () => {
    const s = sample(open, 604, BASE);
    expect(s.amounts[3]).toBeCloseTo(0.5, 12);
    expect(s.amounts[2]).toBe(0.3);
    expect(s.done).toBe(false);
  });

  it('at 1208 ms the digit is exactly 0 and done is true', () => {
    expect(sample(open, 1208, BASE)).toEqual({ amounts: [0.1, 0.2, 0.3, 0, 0.5], rest: NO_REST, done: true });
  });
});

describe('sample: rest', () => {
  it('at 0 ms the pose is upright; digit amounts stay at base', () => {
    expect(sample(rest, 0, BASE)).toEqual({ amounts: BASE, rest: NO_REST, done: false });
  });

  it('at 1000 ms the pose is half way', () => {
    const s = sample(rest, 1000, BASE);
    expect(s.rest.sink).toBeCloseTo(REST_SINK / 2, 12);
    expect(s.rest.tilt).toBeCloseTo(REST_TILT_DEG / 2, 12);
    expect(s.amounts).toEqual(BASE);
    expect(s.done).toBe(false);
  });

  it('at 2000 ms the pose is full and done is true', () => {
    expect(sample(rest, 2000, BASE)).toEqual({
      amounts: BASE,
      rest: { sink: REST_SINK, tilt: REST_TILT_DEG },
      done: true,
    });
  });
});

describe('sample: odd elapsed values', () => {
  it('negative and NaN elapsed give the start values', () => {
    expect(sample(curl, -50, BASE).amounts[2]).toBe(0);
    expect(sample(curl, Number.NaN, BASE).amounts[2]).toBe(0);
    expect(sample(open, -50, BASE).amounts[3]).toBe(1);
    expect(sample(open, Number.NaN, BASE).done).toBe(false);
    expect(sample(rest, -50, BASE).rest).toEqual(NO_REST);
  });

  it('+Infinity elapsed gives the end values', () => {
    expect(sample(curl, Number.POSITIVE_INFINITY, BASE).amounts[2]).toBe(1);
    expect(sample(open, Number.POSITIVE_INFINITY, BASE).done).toBe(true);
  });

  it('does not mutate base', () => {
    const base: Amounts = [0.1, 0.2, 0.3, 0.4, 0.5];
    sample(curl, 100, base);
    expect(base).toEqual([0.1, 0.2, 0.3, 0.4, 0.5]);
  });
});

describe('snapSample', () => {
  it('rested: the given amounts, full sink and tilt, done', () => {
    expect(snapSample([0, 0, 0, 0, 0], 'rested')).toEqual({
      amounts: [0, 0, 0, 0, 0],
      rest: { sink: REST_SINK, tilt: REST_TILT_DEG },
      done: true,
    });
  });

  it('upright: the given amounts, zero sink and tilt, done', () => {
    expect(snapSample([1, 1, 0, 0, 0], 'upright')).toEqual({
      amounts: [1, 1, 0, 0, 0],
      rest: NO_REST,
      done: true,
    });
  });
});
