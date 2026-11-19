import { describe, expect, it } from 'vitest';
import rawControls from '@paw-asset/runtime-controls.json';
import { DIGIT_JOINTS, DRIVEN_JOINTS, JOINT_NAMES } from './digit-joints';
import { poseJoint } from './joint-pose';
import type { Quat } from './joint-pose';
import { PAW_CONTROLS, RuntimeControlsSchema } from './paw-controls';

// The JSON is accurate to about 5e-8, so unit length is checked at 1e-6, not 1e-9.
const JSON_TOLERANCE = 1e-6;
const length = (q: Quat): number => Math.hypot(q[0], q[1], q[2], q[3]);

describe('runtime-controls.json contract', () => {
  it('has all 16 joints', () => {
    expect(Object.keys(PAW_CONTROLS).sort()).toEqual([...JOINT_NAMES].sort());
    expect(Object.keys(rawControls.joints).sort()).toEqual([...JOINT_NAMES].sort());
  });

  it('maps the 15 driven joints to digits as in Req 2.7, each with at least one operation', () => {
    const digitOf = new Map<string, number>();
    DIGIT_JOINTS.forEach((joints, digit) => joints.forEach((j) => digitOf.set(j, digit)));
    expect(digitOf.size).toBe(15);
    for (const name of DRIVEN_JOINTS) {
      expect(digitOf.has(name), name).toBe(true);
      expect(PAW_CONTROLS[name].ops.length, name).toBeGreaterThanOrEqual(1);
    }
    expect(digitOf.get('thumb_cmc')).toBe(0);
    expect(digitOf.get('index_pip')).toBe(1);
    expect(digitOf.get('middle_dip')).toBe(2);
    expect(digitOf.get('ring_mcp')).toBe(3);
    expect(digitOf.get('little_dip')).toBe(4);
  });

  it('gives the wrist no operations', () => {
    expect(PAW_CONTROLS.wrist.ops).toEqual([]);
  });

  it('has amount_range [0, 1] for every joint', () => {
    for (const name of JOINT_NAMES) {
      expect(rawControls.joints[name].amount_range, name).toEqual([0, 1]);
    }
  });

  it('has unit-length bind quaternions within 1e-6', () => {
    for (const name of JOINT_NAMES) {
      expect(Math.abs(length(PAW_CONTROLS[name].bind) - 1), name).toBeLessThan(JSON_TOLERANCE);
    }
  });

  it('has non-zero axes on every operation', () => {
    for (const name of JOINT_NAMES) {
      for (const op of PAW_CONTROLS[name].ops) {
        expect(Math.hypot(...op.axis), name).toBeGreaterThan(0.99);
      }
    }
  });

  it('poseJoint returns the bind at amount 0 and a unit quaternion at amount 1, for every joint', () => {
    for (const name of JOINT_NAMES) {
      const spec = PAW_CONTROLS[name];
      expect(poseJoint(spec, 0), name).toEqual([...spec.bind]);
      expect(Math.abs(length(poseJoint(spec, 1)) - 1), name).toBeLessThan(JSON_TOLERANCE);
    }
  });

  it('moves every driven joint away from its bind at amount 1', () => {
    for (const name of DRIVEN_JOINTS) {
      const spec = PAW_CONTROLS[name];
      const full = poseJoint(spec, 1);
      const delta = Math.max(...full.map((v, i) => Math.abs(v - spec.bind[i]!)));
      expect(delta, name).toBeGreaterThan(1e-3);
    }
  });
});

describe('RuntimeControlsSchema', () => {
  it('accepts the real file', () => {
    expect(RuntimeControlsSchema.safeParse(rawControls).success).toBe(true);
  });

  it('rejects a file with a missing joint', () => {
    const rest: Record<string, unknown> = { ...rawControls.joints };
    delete rest.thumb_ip;
    expect(RuntimeControlsSchema.safeParse({ ...rawControls, joints: rest }).success).toBe(false);
  });

  it('rejects a zero axis and a bad amount_range', () => {
    const zeroAxis = structuredClone(rawControls) as typeof rawControls;
    zeroAxis.joints.index_pip.operations_after_bind[0]!.axis_joint = [0, 0, 0];
    expect(RuntimeControlsSchema.safeParse(zeroAxis).success).toBe(false);

    const badRange = structuredClone(rawControls) as typeof rawControls;
    badRange.joints.index_pip.amount_range = [0, 2];
    expect(RuntimeControlsSchema.safeParse(badRange).success).toBe(false);
  });
});
