// suggestClause: one editable EARS sentence per curse type, total over odd loophole text.

import fc from 'fast-check';
import type { Curse, CurseType } from 'paw-core';
import { describe, expect, it } from 'vitest';
import { suggestClause } from './suggest-clause';

const TYPES: readonly CurseType[] = [
  'permissions',
  'time',
  'money',
  'scale',
  'abuse',
  'privacy',
  'accessibility',
  'data-loss',
  'concurrency',
  'edge-input',
];

const EARS_START = /^(IF|WHEN|WHILE|WHERE) /;

function curse(type: CurseType, loophole: string): Pick<Curse, 'type' | 'loophole'> {
  return { type, loophole };
}

describe('suggestClause', () => {
  it.each(TYPES)('gives a non-blank EARS clause for %s', (type) => {
    const clause = suggestClause(curse(type, 'Only the owner can delete a project'));
    expect(clause.trim()).not.toBe('');
    expect(clause).toMatch(EARS_START);
    expect(clause).toContain('THE SYSTEM SHALL');
    expect(clause).toContain('Only the owner can delete a project');
  });

  it('phrases each type differently', () => {
    const clauses = new Set(TYPES.map((type) => suggestClause(curse(type, 'x'))));
    expect(clauses.size).toBe(TYPES.length);
  });

  it('is one line of text ending in a single period, with no HTML brackets', () => {
    const clause = suggestClause(curse('money', 'Refund <b>all</b> orders.\nNo questions asked. Really!'));
    expect(clause).not.toMatch(/[\n\r<>]/);
    expect(clause.endsWith('.')).toBe(true);
    expect(clause.match(/[.!?]/g)).toHaveLength(1);
  });

  it('falls back to a generic quote for a blank loophole', () => {
    for (const loophole of ['', '   ', '\n\t', '...', '<>']) {
      const clause = suggestClause(curse('time', loophole));
      expect(clause).toMatch(EARS_START);
      expect(clause).toContain('the wish as written');
    }
  });

  it('shortens a very long loophole', () => {
    const clause = suggestClause(curse('scale', 'word '.repeat(5000)));
    expect(clause.length).toBeLessThan(400);
    expect(clause).toContain('(…)');
  });

  it('keeps emoji, right-to-left text and quotes harmless', () => {
    for (const loophole of ['🙂 only 🙂', 'שלום עולם', 'say "hello" to \u201cthem\u201d']) {
      const clause = suggestClause(curse('edge-input', loophole));
      expect(clause).toMatch(EARS_START);
      expect(clause.match(/"/g)).toHaveLength(2);
    }
  });

  it('does not throw on an unknown type or malformed input', () => {
    expect(() => suggestClause({ type: 'constructor' as CurseType, loophole: 'x' })).not.toThrow();
    expect(suggestClause({ type: 'nonsense' as CurseType, loophole: 'x' })).toMatch(EARS_START);
    expect(() => suggestClause({ type: 'money', loophole: undefined as unknown as string })).not.toThrow();
    expect(() => suggestClause(null as unknown as Curse)).not.toThrow();
  });

  it('never throws and always starts with an EARS keyword, for any text', () => {
    fc.assert(
      fc.property(fc.constantFrom(...TYPES), fc.string({ unit: 'binary' }), (type, loophole) => {
        const clause = suggestClause(curse(type, loophole));
        expect(clause).toMatch(EARS_START);
        expect(clause).not.toMatch(/[\n\r<>]/);
        expect(clause.trim()).not.toBe('');
      }),
    );
  });
});
