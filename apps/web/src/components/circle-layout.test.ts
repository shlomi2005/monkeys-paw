// The pentagon table of design.md section 1: index to angle, quadrant of each index, three circles above the
// paw's centre line and two below, and the mobile order.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CIRCLE_ANGLES_DEG,
  CIRCLE_INDEXES,
  MOBILE_CIRCLE_ORDER,
  circleAngleDeg,
  circlePosition,
} from './circle-layout';

const EPS = 1e-9;

describe('circleAngleDeg', () => {
  it('maps each index to its angle from 12 o\'clock, clockwise', () => {
    expect(CIRCLE_INDEXES.map((i) => circleAngleDeg(i))).toEqual([-72, 0, 72, 144, 216]);
    expect(CIRCLE_ANGLES_DEG).toEqual([-72, 0, 72, 144, 216]);
  });

  it('spaces the circles 72 degrees apart, a regular pentagon', () => {
    for (let i = 1; i < 5; i += 1) expect(circleAngleDeg(i) - circleAngleDeg(i - 1)).toBe(72);
  });

  it.each([-1, 5, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects index %s', (index) => {
    expect(() => circleAngleDeg(index)).toThrow(RangeError);
    expect(() => circlePosition(index, 100, 80)).toThrow(RangeError);
  });
});

describe('circlePosition', () => {
  const RX = 480;
  const RY = 288;
  const at = (index: number) => circlePosition(index, RX, RY);

  it('puts each circle in its quadrant (y grows downwards)', () => {
    expect(at(0).x).toBeLessThan(0); // upper-left
    expect(at(0).y).toBeLessThan(0);
    expect(Math.abs(at(1).x)).toBeLessThan(EPS); // top-centre
    expect(at(1).y).toBeLessThan(0);
    expect(at(2).x).toBeGreaterThan(0); // upper-right
    expect(at(2).y).toBeLessThan(0);
    expect(at(3).x).toBeGreaterThan(0); // lower-right
    expect(at(3).y).toBeGreaterThan(0);
    expect(at(4).x).toBeLessThan(0); // lower-left
    expect(at(4).y).toBeGreaterThan(0);
  });

  it('has three circles above the centre line and two below', () => {
    const above = CIRCLE_INDEXES.filter((i) => at(i).y < 0);
    const below = CIRCLE_INDEXES.filter((i) => at(i).y > 0);
    expect(above).toEqual([0, 1, 2]);
    expect(below).toEqual([3, 4]);
  });

  it('places the top-centre circle straight above the centre at distance Ry', () => {
    expect(at(1).x).toBeCloseTo(0, 9);
    expect(at(1).y).toBeCloseTo(-RY, 9);
  });

  it('uses x = cx + Rx sin θ and y = cy - Ry cos θ', () => {
    const p = circlePosition(2, 480, 288, 10, 20);
    expect(p.x).toBeCloseTo(10 + 480 * Math.sin((72 * Math.PI) / 180), 9);
    expect(p.y).toBeCloseTo(20 - 288 * Math.cos((72 * Math.PI) / 180), 9);
  });

  it('mirrors the left and right circles', () => {
    expect(at(0).x).toBeCloseTo(-at(2).x, 9);
    expect(at(0).y).toBeCloseTo(at(2).y, 9);
    expect(at(4).x).toBeCloseTo(-at(3).x, 9);
    expect(at(4).y).toBeCloseTo(at(3).y, 9);
  });

  it('keeps the two lower circles closer together than the two upper ones', () => {
    expect(at(3).x - at(4).x).toBeLessThan(at(2).x - at(0).x);
  });

  it('with rx = ry = 1 gives the unit offsets the stylesheet scales', () => {
    for (const i of CIRCLE_INDEXES) {
      const { x, y } = circlePosition(i, 1, 1);
      expect(Math.hypot(x, y)).toBeCloseTo(1, 9);
    }
  });

  it('scales each axis by its own radius (property)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...CIRCLE_INDEXES),
        fc.double({ min: 1, max: 1000, noNaN: true }),
        fc.double({ min: 1, max: 1000, noNaN: true }),
        (index, rx, ry) => {
          const unit = circlePosition(index, 1, 1);
          const p = circlePosition(index, rx, ry);
          expect(p.x).toBeCloseTo(unit.x * rx, 6);
          expect(p.y).toBeCloseTo(unit.y * ry, 6);
        },
      ),
    );
  });
});

describe('mobile order', () => {
  it('lists the circles in index order 0 to 4', () => {
    expect(MOBILE_CIRCLE_ORDER).toEqual([0, 1, 2, 3, 4]);
    expect(CIRCLE_INDEXES).toEqual([0, 1, 2, 3, 4]);
  });
});
