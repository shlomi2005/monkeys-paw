/** The 16 joints of the paw skeleton (docs/art/paw/PAW-ASSET.md). */
export const JOINT_NAMES = [
  'wrist',
  'thumb_cmc',
  'thumb_mcp',
  'thumb_ip',
  'index_mcp',
  'index_pip',
  'index_dip',
  'middle_mcp',
  'middle_pip',
  'middle_dip',
  'ring_mcp',
  'ring_pip',
  'ring_dip',
  'little_mcp',
  'little_pip',
  'little_dip',
] as const;

export type JointName = (typeof JOINT_NAMES)[number];
export type DrivenJointName = Exclude<JointName, 'wrist'>;

/** Digit index: 0 thumb, 1 index, 2 middle, 3 ring, 4 little. */
export type DigitIndex = 0 | 1 | 2 | 3 | 4;

/** Fixed mapping from Req 2.7. */
export const DIGIT_JOINTS: readonly (readonly [DrivenJointName, DrivenJointName, DrivenJointName])[] = [
  ['thumb_cmc', 'thumb_mcp', 'thumb_ip'],
  ['index_mcp', 'index_pip', 'index_dip'],
  ['middle_mcp', 'middle_pip', 'middle_dip'],
  ['ring_mcp', 'ring_pip', 'ring_dip'],
  ['little_mcp', 'little_pip', 'little_dip'],
];

/** The 15 joints the app drives: everything except `wrist`. */
export const DRIVEN_JOINTS: readonly DrivenJointName[] = JOINT_NAMES.filter(
  (name): name is DrivenJointName => name !== 'wrist',
);
