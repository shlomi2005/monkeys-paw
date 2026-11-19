import fc from 'fast-check';
import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { clamp01, poseJoint } from './joint-pose';
import type { JointOp, JointSpec, Quat, Vec3 } from './joint-pose';

const TOLERANCE = 1e-9;
const NUM_RUNS = 500;

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const component = fc.double({ min: -1, max: 1, noNaN: true });

/** A unit quaternion: normalise a random 4-vector, rejecting near-zero ones. */
const unitQuat: fc.Arbitrary<Quat> = fc
  .tuple(component, component, component, component)
  .filter(([x, y, z, w]) => Math.hypot(x, y, z, w) > 1e-3)
  .map(([x, y, z, w]): Quat => {
    const n = Math.hypot(x, y, z, w);
    return [x / n, y / n, z / n, w / n];
  });

/** A non-zero axis, not necessarily unit length (poseJoint normalises it). */
const axis: fc.Arbitrary<Vec3> = fc
  .tuple(
    fc.double({ min: -10, max: 10, noNaN: true }),
    fc.double({ min: -10, max: 10, noNaN: true }),
    fc.double({ min: -10, max: 10, noNaN: true }),
  )
  .filter(([x, y, z]) => Math.hypot(x, y, z) > 1e-2)
  .map((a): Vec3 => a);

const op: fc.Arbitrary<JointOp> = fc.record({
  axis,
  maxDegrees: fc.double({ min: -180, max: 180, noNaN: true }),
});

const spec: fc.Arbitrary<JointSpec> = fc.record({
  bind: unitQuat,
  ops: fc.array(op, { minLength: 0, maxLength: 3 }),
});

/** Amounts, including the awkward ones. */
const amount: fc.Arbitrary<number> = fc.oneof(
  { arbitrary: fc.double({ min: 0, max: 1, noNaN: true }), weight: 4 },
  { arbitrary: fc.double({ min: -1000, max: 1000, noNaN: true }), weight: 3 },
  {
    arbitrary: fc.constantFrom(NaN, Infinity, -Infinity, 0, -0, 1, -1, 2, Number.MAX_VALUE, -Number.MAX_VALUE),
    weight: 3,
  },
);

// ---------------------------------------------------------------------------
// Reference, built with three's Quaternion
// ---------------------------------------------------------------------------

function referencePose(s: JointSpec, a: number): Quat {
  const t = Number.isNaN(a) ? 0 : Math.min(1, Math.max(0, a));
  const q = new Quaternion(s.bind[0], s.bind[1], s.bind[2], s.bind[3]);
  for (const o of s.ops) {
    const normalisedAxis = new Vector3(o.axis[0], o.axis[1], o.axis[2]).normalize();
    const radians = (o.maxDegrees * t * Math.PI) / 180;
    q.multiply(new Quaternion().setFromAxisAngle(normalisedAxis, radians));
  }
  return [q.x, q.y, q.z, q.w];
}

function maxAbsDiff(a: Quat, b: Quat): number {
  return Math.max(
    Math.abs(a[0] - b[0]),
    Math.abs(a[1] - b[1]),
    Math.abs(a[2] - b[2]),
    Math.abs(a[3] - b[3]),
  );
}

const length = (q: Quat): number => Math.hypot(q[0], q[1], q[2], q[3]);

/** Same numbers, and the same sign of zero. */
const sameBits = (a: Quat, b: Quat): boolean => a.every((v, i) => Object.is(v, b[i]));

// ---------------------------------------------------------------------------
// P12
// ---------------------------------------------------------------------------

describe('P12: pose depends only on (bind, ops, amount)', () => {
  it('is unchanged by interleaved calls with other specs and amounts', () => {
    fc.assert(
      fc.property(
        spec,
        amount,
        fc.array(fc.tuple(spec, amount), { minLength: 0, maxLength: 6 }),
        (s, a, others) => {
          const first = poseJoint(s, a);
          for (const [otherSpec, otherAmount] of others) {
            poseJoint(otherSpec, otherAmount);
            poseJoint(s, otherAmount);
          }
          const again = poseJoint(s, a);
          expect(sameBits(again, first)).toBe(true);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('does not mutate its inputs', () => {
    fc.assert(
      fc.property(spec, amount, (s, a) => {
        const before = JSON.stringify(s);
        poseJoint(s, a);
        expect(JSON.stringify(s)).toBe(before);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('returns a unit quaternion within 1e-9', () => {
    fc.assert(
      fc.property(spec, amount, (s, a) => {
        expect(Math.abs(length(poseJoint(s, a)) - 1)).toBeLessThan(TOLERANCE);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('matches the three.js Quaternion reference within 1e-9', () => {
    fc.assert(
      fc.property(spec, amount, (s, a) => {
        expect(maxAbsDiff(poseJoint(s, a), referencePose(s, a))).toBeLessThan(TOLERANCE);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// P13
// ---------------------------------------------------------------------------

describe('P13: pose clamps', () => {
  it('clamp01 maps NaN and -Infinity to 0 and +Infinity to 1', () => {
    expect(clamp01(NaN)).toBe(0);
    expect(clamp01(-Infinity)).toBe(0);
    expect(clamp01(Infinity)).toBe(1);
  });

  it('clamp01 returns a number in [0, 1] and is the identity inside it', () => {
    fc.assert(
      fc.property(amount, (a) => {
        const c = clamp01(a);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
        if (a >= 0 && a <= 1) expect(c === a).toBe(true); // -0 === 0 is fine here
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('poseJoint(spec, a) equals poseJoint(spec, clamp01(a)) for any a', () => {
    fc.assert(
      fc.property(spec, amount, (s, a) => {
        expect(sameBits(poseJoint(s, a), poseJoint(s, clamp01(a)))).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('returns spec.bind exactly for a <= 0 and NaN', () => {
    const nonPositive = fc.oneof(
      fc.double({ max: 0, noNaN: true }),
      fc.constantFrom(NaN, -Infinity, -0, 0, -1, -Number.MAX_VALUE),
    );
    fc.assert(
      fc.property(spec, nonPositive, (s, a) => {
        const q = poseJoint(s, a);
        expect(sameBits(q, s.bind)).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('returns a fresh tuple, not the bind object itself', () => {
    fc.assert(
      fc.property(spec, (s) => {
        expect(poseJoint(s, 0)).not.toBe(s.bind);
      }),
      { numRuns: 50 },
    );
  });

  it('equals the pose at full maxDegrees for a >= 1', () => {
    const atLeastOne = fc.oneof(
      fc.double({ min: 1, max: 1e6, noNaN: true }),
      fc.constantFrom(1, Infinity, 2, Number.MAX_VALUE),
    );
    fc.assert(
      fc.property(spec, atLeastOne, (s, a) => {
        const q = poseJoint(s, a);
        expect(sameBits(q, poseJoint(s, 1))).toBe(true);
        expect(maxAbsDiff(q, referencePose(s, 1))).toBeLessThan(TOLERANCE);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
