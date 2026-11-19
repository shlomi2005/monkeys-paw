// The driver finds bones by name in the loaded scene. This pins the facts it relies on: both GLBs carry the 16
// joint nodes under exactly the names in runtime-controls.json, at exactly their bind rotation.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { JOINT_NAMES } from './digit-joints';
import { PAW_CONTROLS } from './paw-controls';

interface GlbNode {
  readonly name?: string;
  readonly rotation?: readonly number[];
  readonly translation?: readonly number[];
  readonly scale?: readonly number[];
}

function readNodes(file: string): readonly GlbNode[] {
  const buf = readFileSync(fileURLToPath(new URL(`../../../../docs/art/paw/${file}`, import.meta.url)));
  expect(buf.readUInt32LE(0)).toBe(0x46546c67);
  const length = buf.readUInt32LE(12);
  return (JSON.parse(buf.toString('utf8', 20, 20 + length)) as { nodes: GlbNode[] }).nodes;
}

describe.each(['paw-web.glb', 'paw-mobile.glb'])('%s skeleton', (file) => {
  const nodes = readNodes(file);

  it.each(JOINT_NAMES)('has the node %s at its bind rotation', (name) => {
    const matches = nodes.filter((node) => node.name === name);
    expect(matches).toHaveLength(1);
    const rotation = matches[0]!.rotation ?? [0, 0, 0, 1];
    PAW_CONTROLS[name].bind.forEach((value, i) => expect(rotation[i]).toBeCloseTo(value, 5));
  });
});
