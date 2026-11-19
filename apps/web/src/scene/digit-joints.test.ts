import { describe, expect, it } from 'vitest';
import { DIGIT_JOINTS, DRIVEN_JOINTS, JOINT_NAMES } from './digit-joints';

// Req 2.7, written out in full so the test does not share code with the module.
const EXPECTED: readonly (readonly string[])[] = [
  ['thumb_cmc', 'thumb_mcp', 'thumb_ip'],
  ['index_mcp', 'index_pip', 'index_dip'],
  ['middle_mcp', 'middle_pip', 'middle_dip'],
  ['ring_mcp', 'ring_pip', 'ring_dip'],
  ['little_mcp', 'little_pip', 'little_dip'],
];

describe('P16 (joint half): digit mapping', () => {
  it('has exactly five digits', () => {
    expect(DIGIT_JOINTS).toHaveLength(5);
  });

  it.each(EXPECTED.map((joints, digit) => [digit, joints] as const))(
    'digit %i maps to exactly its three joints, in order',
    (digit, joints) => {
      expect([...DIGIT_JOINTS[digit]!]).toEqual([...joints]);
    },
  );

  it('puts no joint in two digits', () => {
    const all = DIGIT_JOINTS.flat();
    expect(new Set(all).size).toBe(all.length);
  });

  it('covers the 15 driven joints and nothing else', () => {
    expect(DRIVEN_JOINTS).toHaveLength(15);
    expect(new Set(DIGIT_JOINTS.flat())).toEqual(new Set(DRIVEN_JOINTS));
  });

  it('does not drive the wrist', () => {
    expect(DRIVEN_JOINTS).not.toContain('wrist');
    expect(DIGIT_JOINTS.flat()).not.toContain('wrist');
  });

  it('lists 16 distinct joints, the driven ones plus the wrist', () => {
    expect(JOINT_NAMES).toHaveLength(16);
    expect(new Set(JOINT_NAMES).size).toBe(16);
    expect(new Set(JOINT_NAMES)).toEqual(new Set([...DRIVEN_JOINTS, 'wrist']));
  });
});
